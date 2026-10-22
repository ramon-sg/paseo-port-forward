/**
 * Human names and Open links for forwarded ports.
 */
import type { PortRow } from "../shared/contracts";
import { containsPath } from "../shared/workspaces";

export interface ScriptInfo {
  scriptName: string;
  port: number | null;
  lifecycle: string;
  type: "script" | "service";
}

/** What runs on a port, for the ports list. */
export interface PortDescription {
  /** The Paseo script, else the app folder, else the process name. */
  name: string;
  /** `service`/`script` come from Paseo; `app` is a folder guess; `process` is the fallback. */
  kind: "service" | "script" | "app" | "process";
  /** Process cwd relative to the workspace (`""` at its root), or null outside a workspace. */
  folder: string | null;
}

const MAX_COMMAND = 60;

function relativeFolder(directory: string | null, cwd: string | null): string | null {
  if (!directory || !cwd || !containsPath(directory, cwd)) return null;
  return cwd.slice(directory.replace(/\/+$/, "").length).replace(/^\/+|\/+$/g, "");
}

export function describePort(row: PortRow, scripts: readonly ScriptInfo[], directory: string | null): PortDescription {
  const folder = relativeFolder(directory, row.cwd);
  const script = scripts.find((candidate) => candidate.lifecycle === "running" && candidate.port === row.port);
  if (script) return { name: script.scriptName, kind: script.type, folder };
  const last = folder?.split("/").pop();
  if (last) return { name: last, kind: "app", folder };
  return { name: row.process, kind: "process", folder };
}

/**
 * The running Paseo script on that port, else the last folder of the process cwd inside the
 * workspace (`apps/storefront` → `storefront`), else the process name.
 */
export function portLabel(row: PortRow, scripts: readonly ScriptInfo[], directory: string | null): string {
  return describePort(row, scripts, directory).name;
}

/** `/usr/bin/node /x/node_modules/.bin/vite --port 5173` → `node vite --port 5173`, capped. */
export function shortCommand(command: string): string {
  const text = command
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.includes("/") && !part.startsWith("-") ? (part.split("/").filter(Boolean).pop() ?? part) : part))
    .join(" ");
  return text.length > MAX_COMMAND ? `${text.slice(0, MAX_COMMAND - 1)}…` : text;
}

/** `http://localhost:<port>` plus the configured path for that label, if any. */
export function linkUrl(port: number, label: string, linkPaths: Readonly<Record<string, string>>): string {
  return `http://localhost:${port}${linkPaths[label] ?? ""}`;
}
