import { describe, expect, it } from "vitest";

import type { Forward, PortRow, PortsState } from "../shared/contracts";
import { filterGroups, groupPorts } from "./groups";
import type { RemoteWorkspace } from "./use-remote-ports";

function workspace(id: string, title: string, directory: string): RemoteWorkspace {
  return { id, title, project: "shop", kind: "worktree", branch: `feat/${id}`, directory, scripts: [] };
}

function port(portNumber: number, workspaceId: string | null, cwd: string | null): PortRow {
  return {
    port: portNumber,
    bind: "127.0.0.1",
    connectHost: "127.0.0.1",
    pid: portNumber,
    process: "node",
    command: "node dev",
    agentId: null,
    cwd,
    workspaceId,
  };
}

function forward(remotePort: number): Forward {
  return { remotePort, connectHost: "127.0.0.1", status: "active", error: null, workspaceId: null };
}

function state(ports: PortRow[], followed: string[], forwards: Forward[] = []): PortsState {
  return {
    ssh: { state: "connected", target: "devbox", auto: true, error: null, remoteServerId: "r" },
    ports,
    forwards,
    followed,
    scannedAt: null,
    scanError: null,
  };
}

const A = workspace("a", "Zeta", "/wt/a");
const B = workspace("b", "Alpha", "/wt/b");
const C = workspace("c", "Idle", "/wt/c");

describe("groupPorts", () => {
  it("shows workspaces with ports or followed, followed first then by title", () => {
    const result = groupPorts([A, B, C], state([port(3000, "b", "/wt/b"), port(4000, "a", "/wt/a")], ["a"]));
    expect(result.workspaces.map((group) => group.workspace.id)).toEqual(["a", "b"]);
    expect(result.workspaces[0]?.followed).toBe(true);
  });

  it("describes each port and attaches its forward, sorted by port", () => {
    const result = groupPorts(
      [A],
      state([port(5173, "a", "/wt/a/apps/web"), port(3000, "a", "/wt/a/apps/api")], ["a"], [forward(5173)]),
    );
    const ports = result.workspaces[0]?.ports ?? [];
    expect(ports.map((entry) => [entry.row.port, entry.description.name, entry.forward?.status ?? null])).toEqual([
      [3000, "api", null],
      [5173, "web", "active"],
    ]);
  });

  it("ports outside any workspace go to loose", () => {
    const result = groupPorts([A], state([port(6379, null, "/opt")], []));
    expect(result.workspaces).toEqual([]);
    expect(result.loose.map((entry) => entry.row.port)).toEqual([6379]);
    expect(result.loose[0]?.description.folder).toBeNull();
  });

  it("counts active forwards", () => {
    const result = groupPorts([A], state([port(1, "a", "/wt/a"), port(2, "a", "/wt/a")], ["a"], [forward(1)]));
    expect(result.activeCount).toBe(1);
  });
});

describe("filterGroups", () => {
  const groups = () =>
    groupPorts(
      [A, B],
      state(
        [port(3000, "a", "/wt/a/apps/api"), port(5173, "a", "/wt/a/apps/web"), port(4000, "b", "/wt/b"), port(6379, null, "/opt")],
        ["a"],
      ),
    );

  it("an empty query keeps everything", () => {
    expect(filterGroups(groups(), "  ")).toEqual(groups());
  });

  it("a workspace name keeps all its ports", () => {
    const result = filterGroups(groups(), "zeta");
    expect(result.workspaces.map((group) => [group.workspace.id, group.ports.length])).toEqual([["a", 2]]);
    expect(result.loose).toEqual([]);
  });

  it("a service name keeps only that port, under its workspace", () => {
    const result = filterGroups(groups(), "web");
    expect(result.workspaces.map((group) => group.ports.map((entry) => entry.row.port))).toEqual([[5173]]);
  });

  it("words combine across workspace and service, case-insensitive", () => {
    const result = filterGroups(groups(), "ZETA api");
    expect(result.workspaces.map((group) => group.ports.map((entry) => entry.row.port))).toEqual([[3000]]);
  });

  it("matches port numbers, branches and loose ports", () => {
    expect(filterGroups(groups(), "6379").loose.map((entry) => entry.row.port)).toEqual([6379]);
    expect(filterGroups(groups(), "feat/b").workspaces.map((group) => group.workspace.id)).toEqual(["b"]);
  });
});
