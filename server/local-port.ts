/**
 * Strict local ports. A forward keeps the remote port number or fails: web apps bake their
 * API URL and CORS origins in as `localhost:<port>`, so a moved port looks fine and breaks.
 */
import { execFile } from "node:child_process";
import { createServer } from "node:net";

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

/** True when nothing on this machine is listening on 127.0.0.1:`port`. */
export function isLocalPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
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

/** Who listens on `port` locally, best effort. */
export function localPortHolder(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"],
      { timeout: LSOF_TIMEOUT_MS },
      (_error, stdout) => resolve(parseLsof(String(stdout ?? ""))),
    );
  });
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
