/**
 * Which remote workspace a listening process belongs to, by its working directory.
 */
import { z } from "zod";

export const WorkspaceRefSchema = z.object({ id: z.string().min(1), directory: z.string() });
export type WorkspaceRef = z.infer<typeof WorkspaceRefSchema>;

function trimSlashes(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** True when `dir` is `path` or one of its parents, on a `/` boundary. */
export function containsPath(dir: string, path: string): boolean {
  const parent = trimSlashes(dir);
  const child = trimSlashes(path);
  return child === parent || child.startsWith(parent === "/" ? "/" : `${parent}/`);
}

/** Id of the deepest workspace whose directory contains `cwd`, or null. */
export function matchWorkspace(cwd: string | null, workspaces: readonly WorkspaceRef[]): string | null {
  if (!cwd) return null;
  let best: WorkspaceRef | null = null;
  for (const workspace of workspaces) {
    if (!workspace.directory || !containsPath(workspace.directory, cwd)) continue;
    if (!best || trimSlashes(workspace.directory).length > trimSlashes(best.directory).length) {
      best = workspace;
    }
  }
  return best?.id ?? null;
}
