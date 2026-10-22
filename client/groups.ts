/**
 * Arranges a host's ports for the list: one group per workspace that has ports or is
 * followed (followed first, then by title), and the ports outside any workspace.
 */
import type { Forward, PortRow, PortsState } from "../shared/contracts";
import { describePort, type PortDescription } from "./labels";
import type { RemoteWorkspace } from "./use-remote-ports";

export interface PortEntry {
  row: PortRow;
  description: PortDescription;
  forward: Forward | null;
}

export interface WorkspaceGroup {
  workspace: RemoteWorkspace;
  followed: boolean;
  ports: PortEntry[];
}

export interface PortGroups {
  workspaces: WorkspaceGroup[];
  loose: PortEntry[];
  activeCount: number;
}

export function groupPorts(workspaces: readonly RemoteWorkspace[], state: PortsState): PortGroups {
  const forwards = new Map(state.forwards.map((item) => [item.remotePort, item]));
  const followed = new Set(state.followed);
  const sorted = [...state.ports].sort((a, b) => a.port - b.port);
  const entry = (row: PortRow, workspace: RemoteWorkspace | null): PortEntry => ({
    row,
    description: describePort(row, workspace?.scripts ?? [], workspace?.directory ?? null),
    forward: forwards.get(row.port) ?? null,
  });

  const groups = workspaces
    .map((workspace) => ({
      workspace,
      followed: followed.has(workspace.id),
      ports: sorted.filter((row) => row.workspaceId === workspace.id).map((row) => entry(row, workspace)),
    }))
    .filter((group) => group.followed || group.ports.length > 0)
    .sort(
      (a, b) => Number(b.followed) - Number(a.followed) || a.workspace.title.localeCompare(b.workspace.title),
    );

  return {
    workspaces: groups,
    loose: sorted.filter((row) => row.workspaceId === null).map((row) => entry(row, null)),
    activeCount: state.forwards.filter((item) => item.status === "active").length,
  };
}

function matches(query: string, fields: readonly (string | null | undefined)[]): boolean {
  return fields.some((field) => field?.toLowerCase().includes(query));
}

function portFields(entry: PortEntry): (string | null)[] {
  return [
    entry.description.name,
    entry.description.folder,
    String(entry.row.port),
    entry.row.process,
    entry.row.command,
  ];
}

/**
 * Keeps what matches every word of the query. A workspace that matches by itself (title,
 * project, branch) keeps all its ports; otherwise only its matching ports are kept.
 */
export function filterGroups(groups: PortGroups, query: string): PortGroups {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  const entryMatches = (entry: PortEntry, extra: (string | null)[]) =>
    words.every((word) => matches(word, [...portFields(entry), ...extra]));

  const workspaces = groups.workspaces.flatMap((group) => {
    const { title, project, branch } = group.workspace;
    const own = [title, project, branch];
    if (words.every((word) => matches(word, own))) return [group];
    const ports = group.ports.filter((entry) => entryMatches(entry, own));
    return ports.length > 0 ? [{ ...group, ports }] : [];
  });
  return {
    workspaces,
    loose: groups.loose.filter((entry) => entryMatches(entry, [])),
    activeCount: groups.activeCount,
  };
}
