import { describe, expect, it } from "vitest";

import type { PortRow } from "../shared/contracts";
import { linkUrl, portLabel } from "./labels";

const DIR = "/home/r/wt/abastio-1";

function row(port: number, cwd: string | null, process = "node"): PortRow {
  return {
    port,
    bind: "127.0.0.1",
    connectHost: "127.0.0.1",
    pid: 1,
    process,
    command: "node dev",
    agentId: null,
    cwd,
    workspaceId: "ws-1",
  };
}

describe("portLabel", () => {
  it("running script name wins", () => {
    const scripts = [{ scriptName: "abastio", port: 20250, lifecycle: "running" }];
    expect(portLabel(row(20250, `${DIR}/packages/api`), scripts, DIR)).toBe("abastio");
  });

  it("stopped script is ignored", () => {
    const scripts = [{ scriptName: "api", port: 20250, lifecycle: "stopped" }];
    expect(portLabel(row(20250, `${DIR}/packages/api`), scripts, DIR)).toBe("api");
  });

  it("cwd apps/storefront → storefront", () => {
    expect(portLabel(row(20251, `${DIR}/apps/storefront`), [], DIR)).toBe("storefront");
  });

  it("cwd equal to the workspace dir → process name", () => {
    expect(portLabel(row(20251, DIR, "bun"), [], DIR)).toBe("bun");
  });

  it("no workspace directory → process name", () => {
    expect(portLabel(row(5173, "/tmp/x", "vite"), [], null)).toBe("vite");
  });
});

describe("linkUrl", () => {
  it("linkUrl adds the path for admin", () => {
    expect(linkUrl(20252, "admin", { admin: "/dashboard" })).toBe("http://localhost:20252/dashboard");
  });

  it("linkUrl without path", () => {
    expect(linkUrl(20251, "storefront", { admin: "/dashboard" })).toBe("http://localhost:20251");
  });
});
