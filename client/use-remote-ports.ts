/**
 * Live data for one remote host: its workspaces (from that host's Paseo API) and the
 * ports and forwards the laptop daemon sees for them, plus the actions on them.
 */
import { getPaseoClient, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { followRpc, forwardRpc, stateRpc, unfollowRpc, unforwardRpc } from "../shared/contracts";
import type { ScriptInfo } from "./labels";

const POLL_MS = 2_000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 20;

export interface RemoteWorkspace {
  id: string;
  title: string;
  project: string;
  kind: "directory" | "local_checkout" | "checkout" | "worktree";
  branch: string | null;
  directory: string;
  scripts: ScriptInfo[];
}

/** Every live workspace of a remote host, through that host's own API. */
async function listRemoteWorkspaces(serverId: string): Promise<RemoteWorkspace[]> {
  const client = getPaseoClient(serverId);
  const workspaces: RemoteWorkspace[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.workspaces.list({ page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) } });
    for (const entry of result.entries) {
      if (entry.archivingAt || !entry.workspaceDirectory) continue;
      workspaces.push({
        id: entry.id,
        title: entry.title || entry.name,
        project: entry.projectCustomName || entry.projectDisplayName,
        kind: entry.workspaceKind,
        branch: entry.gitRuntime?.currentBranch ?? null,
        directory: entry.workspaceDirectory,
        scripts: entry.scripts.map((script) => ({
          scriptName: script.scriptName,
          port: script.port,
          lifecycle: script.lifecycle,
          type: script.type,
        })),
      });
    }
    const next = result.pageInfo.hasMore ? result.pageInfo.nextCursor : null;
    if (!next) break;
    cursor = next;
  }
  return workspaces;
}

export type PortAction =
  | { kind: "follow" | "unfollow"; workspaceId: string }
  | { kind: "port"; port: number; on: boolean };

export function useRemotePorts(serverId: string) {
  const loadState = useRpc(stateRpc);
  const follow = useRpc(followRpc);
  const unfollow = useRpc(unfollowRpc);
  const forward = useRpc(forwardRpc);
  const unforward = useRpc(unforwardRpc);
  const queryClient = useQueryClient();

  const workspacesQuery = useQuery({
    queryKey: ["remote-workspaces", serverId],
    queryFn: () => listRemoteWorkspaces(serverId),
    refetchInterval: POLL_MS,
  });
  const workspaces = workspacesQuery.data;
  const stateKey = ["remote-ports", serverId];
  const stateQuery = useQuery({
    queryKey: stateKey,
    enabled: workspaces !== undefined,
    queryFn: () =>
      loadState({
        serverId,
        workspaces: (workspaces ?? []).map((workspace) => ({ id: workspace.id, directory: workspace.directory })),
      }),
    refetchInterval: POLL_MS,
  });
  const action = useMutation({
    mutationFn: async (input: PortAction) => {
      if (input.kind === "port") {
        if (input.on) await forward({ serverId, remotePort: input.port });
        else await unforward({ serverId, remotePort: input.port });
        return;
      }
      if (input.kind === "follow") await follow({ serverId, workspaceId: input.workspaceId });
      else await unfollow({ serverId, workspaceId: input.workspaceId });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: stateKey }),
  });

  return {
    workspaces,
    state: stateQuery.data,
    loadError: workspacesQuery.error ?? stateQuery.error,
    action,
  };
}
