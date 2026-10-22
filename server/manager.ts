/**
 * Per-host state: the SSH master, the last scan, followed workspaces and active forwards.
 * Everything stays in this daemon's memory and is never sent to a remote host.
 * Adapted from alessandrocornacchia/paseo-port-forward (MIT).
 */
import type { Forward, PortRow, PortsState, SshStatus } from "../shared/contracts";
import { defaultPortSettings, type PortSettings } from "../shared/settings";
import { matchWorkspace, type WorkspaceRef } from "../shared/workspaces";
import { ensureLocalPortFree } from "./local-port";
import { analyzeScan, parseScanOutput, SCAN_SCRIPT } from "./scan";
import { HostSession } from "./ssh";

/** A scan younger than this answers `state` without touching the remote. */
const SCAN_FRESH_MS = 1_000;
/** After a failed scan or connect, wait this long before trying again on a `state` call. */
const ERROR_RETRY_MS = 5_000;
/** A host counts as on screen for this long after the client's last `state` call. */
const SCREEN_OPEN_MS = 10_000;
/** Close a master with nothing followed or forwarded that nobody has looked at for this long. */
const IDLE_MS = 120_000;
const REAP_EVERY_MS = 15_000;
const FIRST_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const LOST_CONNECTION = "SSH connection lost; reconnecting";
/** A followed workspace is dropped only after it is missing from this many lists in a row. */
const MISSING_LISTS_TO_DROP = 2;

/** Whatever the runtime's timers return (Node and React Native typings disagree). */
export type Timer = ReturnType<typeof setTimeout>;

/** The part of `HostSession` the manager uses, so tests can drive it without ssh. */
export interface SessionLike {
  readonly running: boolean;
  start(): Promise<void>;
  exec(script: string): Promise<string>;
  forward(localPort: number, connectHost: string, remotePort: number): Promise<void>;
  cancel(localPort: number, connectHost: string, remotePort: number): Promise<void>;
  stop(): Promise<void>;
  killNow(): void;
  onExit(listener: (error: string) => void): () => void;
}

export interface ManagerDeps {
  createSession(serverId: string, target: string): SessionLike;
  ensureLocalPortFree(port: number): Promise<void>;
  log(message: string): void;
  setInterval(fn: () => void, ms: number): Timer;
  clearInterval(timer: Timer): void;
  setTimeout(fn: () => void, ms: number): Timer;
  clearTimeout(timer: Timer): void;
}

const defaultDeps: ManagerDeps = {
  createSession: (serverId, target) => new HostSession(serverId, target),
  ensureLocalPortFree: (port) => ensureLocalPortFree(port),
  log: (message) => console.log(message),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (timer) => clearInterval(timer),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

interface HostEntry {
  serverId: string;
  session: SessionLike | null;
  ssh: SshStatus;
  ports: PortRow[];
  /** Latest list from the client; null until the first `state` call supplies one. */
  workspaces: WorkspaceRef[] | null;
  followed: Set<string>;
  /** Followed workspace id → consecutive client lists it was missing from. */
  missing: Map<string, number>;
  forwards: Map<number, Forward>;
  scannedAt: number | null;
  scanError: string | null;
  scanning: Promise<void> | null;
  connecting: Promise<void> | null;
  lastState: number;
  backoffMs: number;
  reconnectTimer: Timer | null;
}

export class PortManager {
  private readonly deps: ManagerDeps;
  private hosts = new Map<string, HostEntry>();
  private settings: PortSettings = defaultPortSettings();
  private reapTimer: Timer;
  private tickTimer: Timer | null = null;
  private disposed = false;
  private ticking = false;

  constructor(deps: Partial<ManagerDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
    this.reapTimer = this.deps.setInterval(() => void this.reapIdle(), REAP_EVERY_MS);
    this.scheduleTick();
  }

  applySettings(settings: PortSettings): void {
    const previous = this.settings;
    this.settings = settings;
    for (const entry of this.hosts.values()) {
      const target = settings.targets[entry.serverId]?.trim() || null;
      if (target === entry.ssh.target) continue;
      this.deps.log(`[remote-ports] target for ${entry.serverId} changed to ${target ?? "(none)"}`);
      // NOTE: the new target is set before closing, so a refresh in between never reconnects to the old one.
      const state = target ? "idle" : "unmapped";
      entry.ssh = { ...entry.ssh, target, state, error: null };
      void this.closeHost(entry, state);
    }
    if (previous.pollSeconds !== settings.pollSeconds) this.scheduleTick();
  }

  async state(serverId: string, workspaces: WorkspaceRef[]): Promise<PortsState> {
    const entry = this.entry(serverId);
    entry.lastState = Date.now();
    entry.workspaces = workspaces;
    await this.pruneArchived(entry);
    if (entry.ssh.target) {
      // The first call waits for a result; later ones answer from the last scan and refresh behind.
      const pending = this.refresh(entry);
      if (entry.scannedAt === null || entry.ssh.state === "idle") await pending;
    }
    return snapshot(entry);
  }

  async follow(serverId: string, workspaceId: string): Promise<PortsState> {
    const entry = this.entry(serverId);
    entry.followed.add(workspaceId);
    await this.refresh(entry, true);
    return snapshot(entry);
  }

  async unfollow(serverId: string, workspaceId: string): Promise<PortsState> {
    const entry = this.entry(serverId);
    await this.dropWorkspace(entry, workspaceId);
    return snapshot(entry);
  }

  /** Forward one port by hand, for ports outside any workspace. */
  async forward(serverId: string, remotePort: number): Promise<Forward> {
    const entry = this.entry(serverId);
    await this.scan(entry, true);
    if (!this.verified(entry)) {
      throw new Error(entry.scanError ?? "The remote host's identity could not be verified");
    }
    const row = entry.ports.find((candidate) => candidate.port === remotePort);
    if (!row) throw new Error(`Port ${remotePort} is not listening on the remote`);
    return { ...(await this.openForward(entry, row.port, row.connectHost, row.workspaceId)) };
  }

  async unforward(serverId: string, remotePort: number): Promise<boolean> {
    const entry = this.hosts.get(serverId);
    if (!entry?.forwards.has(remotePort)) return false;
    await this.cancelForward(entry, remotePort);
    return true;
  }

  async testConnection(
    serverId: string,
    target?: string,
  ): Promise<{ ok: boolean; remoteServerId: string | null; error: string | null }> {
    const resolved = target?.trim() || this.settings.targets[serverId]?.trim();
    if (!resolved) return { ok: false, remoteServerId: null, error: "No SSH target configured" };
    const session = this.deps.createSession(`${serverId}-test`, resolved);
    try {
      await session.start();
      const raw = parseScanOutput(await session.exec(SCAN_SCRIPT));
      const remoteServerId = raw.pidFile?.serverId ?? null;
      if (!raw.pidFile) {
        return { ok: false, remoteServerId, error: "Connected, but no Paseo daemon was found there" };
      }
      if (remoteServerId !== serverId) {
        return {
          ok: false,
          remoteServerId,
          error: `Connected, but that machine is Paseo host ${remoteServerId}, not ${serverId}`,
        };
      }
      return { ok: true, remoteServerId, error: null };
    } catch (error) {
      return { ok: false, remoteServerId: null, error: message(error) };
    } finally {
      await session.stop();
    }
  }

  /**
   * One background pass: every host with a followed workspace, a forward, or the screen
   * open is rescanned and reconciled. Public so tests can drive it.
   */
  async tick(): Promise<void> {
    if (this.ticking || this.disposed) return;
    this.ticking = true;
    try {
      const now = Date.now();
      for (const entry of this.hosts.values()) {
        if (!entry.ssh.target) continue;
        const busy = entry.followed.size > 0 || entry.forwards.size > 0;
        if (!busy && now - entry.lastState > SCREEN_OPEN_MS) continue;
        // A dropped master is the reconnect timer's job.
        if (entry.reconnectTimer !== null) continue;
        await this.refresh(entry, true);
      }
    } finally {
      this.ticking = false;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.deps.clearInterval(this.reapTimer);
    if (this.tickTimer) this.deps.clearInterval(this.tickTimer);
    await Promise.all([...this.hosts.values()].map((entry) => this.closeHost(entry, "idle")));
    this.hosts.clear();
  }

  /** For process exit, where nothing async runs. */
  killAll(): void {
    for (const entry of this.hosts.values()) entry.session?.killNow();
  }

  private entry(serverId: string): HostEntry {
    let entry = this.hosts.get(serverId);
    if (entry) return entry;
    const target = this.settings.targets[serverId]?.trim() || null;
    entry = {
      serverId,
      session: null,
      ssh: { state: target ? "idle" : "unmapped", target, error: null, remoteServerId: null },
      ports: [],
      workspaces: null,
      followed: new Set(),
      missing: new Map(),
      forwards: new Map(),
      scannedAt: null,
      scanError: null,
      scanning: null,
      connecting: null,
      lastState: 0,
      backoffMs: FIRST_BACKOFF_MS,
      reconnectTimer: null,
    };
    this.hosts.set(serverId, entry);
    return entry;
  }

  /** Scan, then bring forwards in line with what is followed and what still listens. */
  private async refresh(entry: HostEntry, force = false): Promise<void> {
    await this.scan(entry, force);
    if (!this.verified(entry) || entry.scanError) return;
    await this.pruneClosed(entry);
    await this.pruneArchived(entry);
    const ignore = new Set(this.settings.ignorePorts);
    for (const row of entry.ports) {
      if (ignore.has(row.port)) continue;
      const followed = row.workspaceId !== null && entry.followed.has(row.workspaceId);
      const retry = entry.forwards.get(row.port)?.status === "error";
      if (!followed && !retry) continue;
      await this.openForward(entry, row.port, row.connectHost, row.workspaceId);
    }
  }

  private ensureConnected(entry: HostEntry): Promise<void> {
    const target = entry.ssh.target;
    if (!target) return Promise.reject(new Error("No SSH target configured for this host"));
    if (entry.session?.running && entry.ssh.state === "connected") return Promise.resolve();
    if (entry.connecting) return entry.connecting;
    // A pending reconnect owns the next attempt, with its backoff.
    if (entry.reconnectTimer !== null) return Promise.reject(new Error(`Reconnecting to ${target}…`));
    const previous = entry.session;
    if (previous) void previous.stop();
    const session = this.deps.createSession(entry.serverId, target);
    entry.session = session;
    entry.ssh = { ...entry.ssh, state: "connecting", error: null };
    entry.connecting = session
      .start()
      .then(async () => {
        if (this.disposed) {
          await session.stop();
          return;
        }
        entry.ssh = { ...entry.ssh, state: "connected", error: null };
        entry.backoffMs = FIRST_BACKOFF_MS;
        session.onExit((error) => this.onMasterExit(entry, session, error));
        this.deps.log(`[remote-ports] connected to ${target} for ${entry.serverId}`);
        await this.reapplyForwards(entry);
      })
      .catch((error: unknown) => {
        entry.session = null;
        entry.ssh = { ...entry.ssh, state: "error", error: message(error) };
        throw error;
      })
      .finally(() => {
        entry.connecting = null;
      });
    return entry.connecting;
  }

  private onMasterExit(entry: HostEntry, session: SessionLike, error: string): void {
    if (entry.session !== session || this.disposed) return;
    entry.session = null;
    entry.ssh = { ...entry.ssh, state: "error", error: `Connection lost: ${error}` };
    for (const forward of entry.forwards.values()) {
      forward.status = "error";
      forward.error = LOST_CONNECTION;
    }
    this.deps.log(`[remote-ports] master for ${entry.serverId} exited: ${error}`);
    if (entry.forwards.size > 0 || entry.followed.size > 0) this.scheduleReconnect(entry);
  }

  private scheduleReconnect(entry: HostEntry): void {
    if (entry.reconnectTimer !== null || this.disposed) return;
    const delay = entry.backoffMs;
    entry.backoffMs = Math.min(entry.backoffMs * 2, MAX_BACKOFF_MS);
    entry.reconnectTimer = this.deps.setTimeout(() => {
      entry.reconnectTimer = null;
      this.ensureConnected(entry).catch(() => this.scheduleReconnect(entry));
    }, delay);
  }

  /** After a reconnect, every known forward is opened again on the same port. */
  private async reapplyForwards(entry: HostEntry): Promise<void> {
    for (const forward of [...entry.forwards.values()]) {
      await this.openForward(entry, forward.remotePort, forward.connectHost, forward.workspaceId);
    }
  }

  /**
   * Opens `127.0.0.1:<port>` → remote `<connectHost>:<port>`. A busy local port or an ssh
   * refusal is kept as an error forward and retried on the next pass, never moved.
   */
  private async openForward(
    entry: HostEntry,
    port: number,
    connectHost: string,
    workspaceId: string | null,
  ): Promise<Forward> {
    const existing = entry.forwards.get(port);
    if (existing?.status === "active" || existing?.status === "opening") return existing;
    const forward: Forward = { remotePort: port, connectHost, status: "opening", error: null, workspaceId };
    entry.forwards.set(port, forward);
    let opened: SessionLike | null = null;
    try {
      await this.deps.ensureLocalPortFree(port);
      const session = entry.session;
      if (!session?.running) throw new Error(LOST_CONNECTION);
      await session.forward(port, connectHost, port);
      opened = session;
    } catch (error) {
      forward.status = "error";
      forward.error = message(error);
    }
    if (entry.forwards.get(port) !== forward) {
      // Stopped while it was opening: undo what ssh just added.
      await opened?.cancel(port, connectHost, port).catch(() => {});
      return forward;
    }
    if (opened) {
      forward.status = "active";
      this.deps.log(`[remote-ports] ${entry.serverId}: localhost:${port} → ${connectHost}:${port}`);
    }
    return forward;
  }

  private async cancelForward(entry: HostEntry, port: number): Promise<void> {
    const forward = entry.forwards.get(port);
    if (!forward) return;
    entry.forwards.delete(port);
    if (forward.status !== "active" || !entry.session?.running) return;
    await entry.session
      .cancel(port, forward.connectHost, port)
      .catch((error: unknown) => this.deps.log(`[remote-ports] cancel failed: ${message(error)}`));
    this.deps.log(`[remote-ports] ${entry.serverId}: stopped localhost:${port}`);
  }

  private async dropWorkspace(entry: HostEntry, workspaceId: string): Promise<void> {
    entry.followed.delete(workspaceId);
    entry.missing.delete(workspaceId);
    for (const forward of [...entry.forwards.values()]) {
      if (forward.workspaceId === workspaceId) await this.cancelForward(entry, forward.remotePort);
    }
  }

  /** Forwards whose remote port no longer listens are cancelled. Only after a good scan. */
  private async pruneClosed(entry: HostEntry): Promise<void> {
    const open = new Set(entry.ports.map((row) => row.port));
    for (const port of [...entry.forwards.keys()]) {
      if (!open.has(port)) await this.cancelForward(entry, port);
    }
  }

  /** A followed workspace the client no longer lists was archived: unfollow it. */
  private async pruneArchived(entry: HostEntry): Promise<void> {
    if (!entry.workspaces) return;
    const known = new Set(entry.workspaces.map((workspace) => workspace.id));
    for (const id of [...entry.followed]) {
      if (known.has(id)) {
        entry.missing.delete(id);
        continue;
      }
      const misses = (entry.missing.get(id) ?? 0) + 1;
      entry.missing.set(id, misses);
      if (misses >= MISSING_LISTS_TO_DROP) await this.dropWorkspace(entry, id);
    }
  }

  private scan(entry: HostEntry, force = false): Promise<void> {
    const freshFor = entry.scanError ? ERROR_RETRY_MS : SCAN_FRESH_MS;
    if (!force && entry.scannedAt && Date.now() - entry.scannedAt < freshFor) return Promise.resolve();
    if (entry.scanning) return entry.scanning;
    entry.scanning = (async () => {
      try {
        await this.ensureConnected(entry);
        const session = entry.session;
        if (!session) throw new Error(LOST_CONNECTION);
        const raw = parseScanOutput(await session.exec(SCAN_SCRIPT));
        if (!raw.complete) throw new Error("Port scan output was truncated");
        const dirs = (entry.workspaces ?? []).map((workspace) => workspace.directory);
        const result = analyzeScan(raw, dirs);
        entry.ssh = { ...entry.ssh, remoteServerId: result.pidFile?.serverId ?? null };
        if (!result.pidFile) {
          throw new Error("No Paseo daemon found on the remote (~/.paseo/paseo.pid is missing)");
        }
        if (result.pidFile.serverId !== entry.serverId) {
          entry.ports = [];
          throw new Error(
            `SSH target is Paseo host ${result.pidFile.serverId ?? "(unknown)"}, not ${entry.serverId}. ` +
              "Check the SSH target for this host.",
          );
        }
        const workspaces = entry.workspaces ?? [];
        entry.ports = result.ports.map((port) => ({ ...port, workspaceId: matchWorkspace(port.cwd, workspaces) }));
        entry.scanError = null;
      } catch (error) {
        entry.scanError = message(error);
        const unreachable = !entry.session && entry.ssh.state === "error";
        if (unreachable && (entry.followed.size > 0 || entry.forwards.size > 0)) this.scheduleReconnect(entry);
      } finally {
        entry.scannedAt = Date.now();
        entry.scanning = null;
      }
    })();
    return entry.scanning;
  }

  private verified(entry: HostEntry): boolean {
    return entry.ssh.remoteServerId === entry.serverId;
  }

  private scheduleTick(): void {
    if (this.tickTimer) this.deps.clearInterval(this.tickTimer);
    this.tickTimer = this.disposed
      ? null
      : this.deps.setInterval(() => void this.tick(), this.settings.pollSeconds * 1000);
  }

  private async reapIdle(): Promise<void> {
    const now = Date.now();
    for (const entry of this.hosts.values()) {
      if (!entry.session?.running || entry.followed.size > 0 || entry.forwards.size > 0) continue;
      if (now - entry.lastState < IDLE_MS) continue;
      this.deps.log(`[remote-ports] closing idle connection for ${entry.serverId}`);
      await this.closeHost(entry, "idle");
    }
  }

  private async closeHost(entry: HostEntry, state: SshStatus["state"]): Promise<void> {
    if (entry.reconnectTimer !== null) this.deps.clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
    for (const port of [...entry.forwards.keys()]) await this.cancelForward(entry, port);
    const session = entry.session;
    entry.session = null;
    await session?.stop();
    entry.followed.clear();
    entry.ports = [];
    entry.scannedAt = null;
    entry.ssh = { ...entry.ssh, state, error: null, remoteServerId: null };
  }
}

function snapshot(entry: HostEntry): PortsState {
  return {
    ssh: { ...entry.ssh },
    ports: entry.ports.map((port) => ({ ...port })),
    forwards: [...entry.forwards.values()].map((forward) => ({ ...forward })),
    followed: [...entry.followed],
    scannedAt: entry.scannedAt ? new Date(entry.scannedAt).toISOString() : null,
    scanError: entry.scanError,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
