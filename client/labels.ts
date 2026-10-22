/**
 * Human names and Open links for forwarded ports.
 */
import type { PortRow } from "../shared/contracts";
import { containsPath } from "../shared/workspaces";

export interface ScriptInfo {
  scriptName: string;
  port: number | null;
  lifecycle: string;
}

/**
 * The running Paseo script on that port, else the last folder of the process cwd inside the
 * workspace (`apps/storefront` → `storefront`), else the process name.
 */
export function portLabel(row: PortRow, scripts: readonly ScriptInfo[], directory: string | null): string {
  const script = scripts.find((candidate) => candidate.lifecycle === "running" && candidate.port === row.port);
  if (script) return script.scriptName;
  if (directory && row.cwd && containsPath(directory, row.cwd)) {
    const relative = row.cwd.slice(directory.replace(/\/+$/, "").length).replace(/^\/+|\/+$/g, "");
    const last = relative.split("/").pop();
    if (last) return last;
  }
  return row.process;
}

/** `http://localhost:<port>` plus the configured path for that label, if any. */
export function linkUrl(port: number, label: string, linkPaths: Readonly<Record<string, string>>): string {
  return `http://localhost:${port}${linkPaths[label] ?? ""}`;
}
