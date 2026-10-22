/**
 * Strict local ports. A forward keeps the remote port number or fails: web apps bake their
 * API URL and CORS origins in as `localhost:<port>`, so a moved port looks fine and breaks.
 */
import { execFile } from "node:child_process";
import { connect, createServer } from "node:net";

/** Ports below this need root locally; they are never forwarded. */
const FIRST_UNPRIVILEGED_PORT = 1024;
const LSOF_TIMEOUT_MS = 3_000;

export class LocalPortError extends Error {
  constructor(
    readonly port: number,
    readonly holder: string | null,
    message: string,
  ) {
    super(message);
    this.name = "LocalPortError";
  }
}

export interface LocalPortDeps {
  isFree(port: number): Promise<boolean>;
  holder(port: number): Promise<string | null>;
}

/** Loopback addresses a browser's `localhost` may reach; a listener on any of them shadows a forward. */
const LOOPBACKS = ["127.0.0.1", "::1"];
const CONNECT_TIMEOUT_MS = 500;

/** True when something accepts a TCP connection on `host:port`. */
function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** True when 127.0.0.1:`port` can be bound exclusively. */
function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * True when nothing on this machine listens on `port` at any loopback address. Binding
 * 127.0.0.1 alone is not enough: on macOS it succeeds next to a listener on `::1`,
 * `0.0.0.0` or `::`, and the browser's `localhost` would reach that one instead.
 */
export async function isLocalPortFree(port: number): Promise<boolean> {
  const reached = await Promise.all(LOOPBACKS.map((host) => accepts(host, port)));
  if (reached.some(Boolean)) return false;
  return canBind(port);
}

/** `lsof -F pc` output → `"<command> (pid <pid>)"`, or null when there is nothing to read. */
export function parseLsof(output: string): string | null {
  let pid: string | null = null;
  let command: string | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p") && pid === null) pid = line.slice(1);
    else if (line.startsWith("c") && command === null) command = line.slice(1);
  }
  if (!pid) return null;
  return command ? `${command} (pid ${pid})` : `pid ${pid}`;
}

/** `lsof -d cwd -Fn` output → the working directory, or null. */
export function parseLsofCwd(output: string): string | null {
  const line = output.split("\n").find((candidate) => candidate.startsWith("n"));
  return line ? line.slice(1) || null : null;
}

function runLsof(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("lsof", args, { timeout: LSOF_TIMEOUT_MS }, (_error, stdout) => resolve(String(stdout ?? "")));
  });
}

/** Who listens on `port` locally and where it runs from, best effort: `node (pid 42) in /path`. */
export async function localPortHolder(port: number): Promise<string | null> {
  const holder = parseLsof(await runLsof(["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]));
  const pid = holder?.match(/pid (\d+)/)?.[1];
  if (!holder || !pid) return holder;
  const cwd = parseLsofCwd(await runLsof(["-a", "-p", pid, "-d", "cwd", "-Fn"]));
  return cwd ? `${holder} in ${cwd}` : holder;
}

const defaultDeps: LocalPortDeps = { isFree: isLocalPortFree, holder: localPortHolder };

/** Resolves when `port` can be bound on 127.0.0.1; throws `LocalPortError` otherwise. */
export async function ensureLocalPortFree(
  port: number,
  deps: LocalPortDeps = defaultDeps,
): Promise<void> {
  if (port < FIRST_UNPRIVILEGED_PORT) {
    throw new LocalPortError(port, null, `port ${port} is below 1024 and is not forwarded`);
  }
  if (await deps.isFree(port)) return;
  const holder = await deps.holder(port);
  const suffix = holder ? ` by ${holder}` : "";
  throw new LocalPortError(port, holder, `port ${port} is in use on this Mac${suffix}`);
}
