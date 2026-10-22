import { beforeEach, describe, expect, it } from "vitest";

import { LocalPortError } from "./local-port";
import { PortManager, type ManagerDeps, type SessionLike } from "./manager";

const SERVER = "srv-devbox";
const WS = { id: "ws-1", directory: "/home/r/wt/abastio-1" };
const OTHER_WS = { id: "ws-10", directory: "/home/r/wt/abastio-10" };

interface FakePort {
  port: number;
  pid: number;
  cwd: string;
}

/** Raw output of the remote scan script for a supervisor (100) → worker (101) → terminal (102) tree. */
function scanOutput(ports: FakePort[], serverId = SERVER): string {
  const hex = (port: number) => port.toString(16).toUpperCase().padStart(4, "0");
  const lines = ["@pidfile", JSON.stringify({ pid: 100, serverId, listen: "127.0.0.1:6767" }), "@listen"];
  ports.forEach((p, i) => lines.push(`tcp 0100007F:${hex(p.port)} ${9000 + i}`));
  lines.push("@stat", "100 1 x", "101 100 x", "102 101 x");
  for (const p of ports) lines.push(`${p.pid} 102 x`);
  lines.push("@owners");
  ports.forEach((p, i) => lines.push(`${p.pid} ${9000 + i}`));
  for (const p of ports) lines.push(`@proc ${p.pid}`, `cwd ${p.cwd}`, "comm node", "cmd node dev");
  lines.push("@end");
  return lines.join("\n") + "\n";
}

class FakeSession implements SessionLike {
  running = false;
  forwards: number[] = [];
  cancels: number[] = [];
  stopped = false;
  private listeners = new Set<(error: string) => void>();
  constructor(private readonly scan: () => string) {}
  async start() {
    this.running = true;
  }
  async exec() {
    return this.scan();
  }
  async forward(localPort: number, _host: string, remotePort: number) {
    expect(localPort).toBe(remotePort);
    this.forwards.push(remotePort);
  }
  async cancel(localPort: number) {
    this.cancels.push(localPort);
  }
  async stop() {
    this.running = false;
    this.stopped = true;
  }
  killNow() {
    this.running = false;
  }
  onExit(listener: (error: string) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  die(error: string) {
    this.running = false;
    for (const listener of this.listeners) listener(error);
  }
}

let remote: FakePort[];
let remoteServerId: string;
let sessions: FakeSession[];
let busyPorts: Set<number>;
let timeouts: (() => void)[];
let manager: PortManager;

function deps(): ManagerDeps {
  return {
    createSession: () => {
      const session = new FakeSession(() => scanOutput(remote, remoteServerId));
      sessions.push(session);
      return session;
    },
    ensureLocalPortFree: async (port) => {
      if (busyPorts.has(port)) throw new LocalPortError(port, "node (pid 7)", `port ${port} is in use on this Mac by node (pid 7)`);
    },
    log: () => {},
    setInterval: () => 0 as unknown as NodeJS.Timeout,
    clearInterval: () => {},
    setTimeout: (fn) => {
      timeouts.push(fn);
      return 0 as unknown as NodeJS.Timeout;
    },
    clearTimeout: () => {},
  };
}

const api = { port: 20250, pid: 201, cwd: `${WS.directory}/packages/api` };
const shop = { port: 20251, pid: 202, cwd: `${WS.directory}/apps/storefront` };
const ssh = { port: 22, pid: 203, cwd: WS.directory };

const forwarded = (state: { forwards: { remotePort: number; status: string }[] }) =>
  state.forwards.filter((f) => f.status === "active").map((f) => f.remotePort).sort();

beforeEach(() => {
  remote = [api, ssh];
  remoteServerId = SERVER;
  sessions = [];
  busyPorts = new Set();
  timeouts = [];
  manager = new PortManager(deps());
  manager.applySettings({ targets: { [SERVER]: "devbox" }, pollSeconds: 3, ignorePorts: [22], linkPaths: {} });
});

describe("PortManager", () => {
  it("follow forwards every port of the workspace at the same number, skipping ignorePorts", async () => {
    await manager.state(SERVER, [WS, OTHER_WS]);
    const state = await manager.follow(SERVER, WS.id);
    expect(forwarded(state)).toEqual([20250]);
    expect(state.followed).toEqual([WS.id]);
    expect(sessions[0]?.forwards).toEqual([20250]);
  });

  it("a port that opens later in a followed workspace is forwarded on the next tick", async () => {
    await manager.state(SERVER, [WS]);
    await manager.follow(SERVER, WS.id);
    remote = [api, shop];
    await manager.tick();
    expect(forwarded(await manager.state(SERVER, [WS]))).toEqual([20250, 20251]);
  });

  it("a port that closes is cancelled on the next tick", async () => {
    remote = [api, shop];
    await manager.state(SERVER, [WS]);
    await manager.follow(SERVER, WS.id);
    remote = [api];
    await manager.tick();
    expect(sessions[0]?.cancels).toEqual([20251]);
    expect(forwarded(await manager.state(SERVER, [WS]))).toEqual([20250]);
  });

  it("busy local port yields an error forward and no forward call", async () => {
    busyPorts.add(20250);
    await manager.state(SERVER, [WS]);
    const state = await manager.follow(SERVER, WS.id);
    expect(sessions[0]?.forwards).toEqual([]);
    expect(state.forwards).toEqual([
      expect.objectContaining({
        remotePort: 20250,
        status: "error",
        error: "port 20250 is in use on this Mac by node (pid 7)",
      }),
    ]);
  });

  it("serverId mismatch forwards nothing and reports scanError", async () => {
    remoteServerId = "someone-else";
    await manager.state(SERVER, [WS]);
    const state = await manager.follow(SERVER, WS.id);
    expect(sessions[0]?.forwards).toEqual([]);
    expect(state.scanError).toContain("someone-else");
  });

  it("master exit reapplies the same forwards after reconnect and keeps followed", async () => {
    remote = [api, shop];
    await manager.state(SERVER, [WS]);
    await manager.follow(SERVER, WS.id);
    sessions[0]?.die("broken pipe");
    expect(timeouts).toHaveLength(1);
    timeouts[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessions[1]?.forwards.sort()).toEqual([20250, 20251]);
    const state = await manager.state(SERVER, [WS]);
    expect(state.followed).toEqual([WS.id]);
    expect(forwarded(state)).toEqual([20250, 20251]);
  });

  it("followed workspace missing from the next state list is unfollowed and cancelled", async () => {
    await manager.state(SERVER, [WS]);
    await manager.follow(SERVER, WS.id);
    const state = await manager.state(SERVER, []);
    expect(state.followed).toEqual([]);
    expect(sessions[0]?.cancels).toEqual([20250]);
    expect(state.forwards).toEqual([]);
  });

  it("ports outside any workspace are listed with workspaceId null and are not auto-forwarded", async () => {
    remote = [api, { port: 5173, pid: 300, cwd: "/tmp/scratch" }];
    await manager.state(SERVER, [WS]);
    const state = await manager.follow(SERVER, WS.id);
    expect(state.ports.find((p) => p.port === 5173)?.workspaceId).toBeNull();
    expect(state.ports.find((p) => p.port === 20250)?.workspaceId).toBe(WS.id);
    expect(forwarded(state)).toEqual([20250]);
  });

  it("unfollow cancels the workspace forwards", async () => {
    await manager.state(SERVER, [WS]);
    await manager.follow(SERVER, WS.id);
    const state = await manager.unfollow(SERVER, WS.id);
    expect(state.followed).toEqual([]);
    expect(sessions[0]?.cancels).toEqual([20250]);
  });

  it("dispose cancels every forward and stops every session", async () => {
    remote = [api, shop];
    await manager.state(SERVER, [WS]);
    await manager.follow(SERVER, WS.id);
    await manager.dispose();
    expect(sessions[0]?.cancels.sort()).toEqual([20250, 20251]);
    expect(sessions[0]?.stopped).toBe(true);
  });
});
