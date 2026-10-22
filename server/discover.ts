/**
 * Finds the SSH target of a remote Paseo host without configuration: the host's label in
 * Paseo and the aliases in ~/.ssh/config are tried, and the one that reaches a machine
 * whose Paseo serverId matches wins (the manager does the probing).
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Hosts that answer ssh but are never a Paseo host. */
const SKIP = new Set(["github.com", "gitlab.com", "bitbucket.org", "ssh.dev.azure.com", "vs-ssh.visualstudio.com"]);
const MAX_CANDIDATES = 12;
const VALID = /^[A-Za-z0-9._@-]+$/;

/** Concrete names from `Host` lines; patterns (`*`, `?`) and negations are skipped. */
export function sshConfigAliases(text: string): string[] {
  const aliases: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const match = /^host(?:\s+|\s*=\s*)(.+)$/i.exec(line);
    if (!match?.[1]) continue;
    for (const name of match[1].split(/\s+/)) {
      if (!name || name.startsWith("!") || /[*?]/.test(name) || !VALID.test(name)) continue;
      if (!aliases.includes(name)) aliases.push(name);
    }
  }
  return aliases;
}

/** The label (as typed, then as a lowercase slug), then the config aliases; capped. */
export function candidateTargets(label: string, aliases: readonly string[]): string[] {
  const slug = label.trim().toLowerCase().replace(/\s+/g, "-");
  const list = [label.trim(), slug, ...aliases].filter(
    (name) => name && VALID.test(name) && !SKIP.has(name.toLowerCase()),
  );
  return [...new Set(list)].slice(0, MAX_CANDIDATES);
}

export async function readSshConfig(): Promise<string> {
  try {
    return await readFile(join(homedir(), ".ssh", "config"), "utf8");
  } catch {
    return "";
  }
}
