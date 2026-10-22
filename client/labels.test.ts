import { describe, expect, it } from "vitest";

import type { PortRow } from "../shared/contracts";
import { describePort, linkUrl, portLabel, shortCommand } from "./labels";

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
    const scripts = [{ scriptName: "abastio", port: 20250, lifecycle: "running", type: "service" as const }];
    expect(portLabel(row(20250, `${DIR}/packages/api`), scripts, DIR)).toBe("abastio");
  });

  it("stopped script is ignored", () => {
    const scripts = [{ scriptName: "api", port: 20250, lifecycle: "stopped", type: "service" as const }];
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

describe("describePort", () => {
  it("a running Paseo service: its name, kind and folder", () => {
    const scripts = [{ scriptName: "web", port: 5173, lifecycle: "running", type: "service" as const }];
    expect(describePort(row(5173, `${DIR}/apps/web`), scripts, DIR)).toEqual({
      name: "web",
      kind: "service",
      folder: "apps/web",
    });
  });

  it("a running Paseo script", () => {
    const scripts = [{ scriptName: "dev", port: 3000, lifecycle: "running", type: "script" as const }];
    expect(describePort(row(3000, DIR), scripts, DIR).kind).toBe("script");
  });

  it("no script: the app folder, kind app", () => {
    expect(describePort(row(20251, `${DIR}/apps/storefront`), [], DIR)).toEqual({
      name: "storefront",
      kind: "app",
      folder: "apps/storefront",
    });
  });

  it("at the workspace root: the process name, folder empty", () => {
    expect(describePort(row(8080, DIR, "bun"), [], DIR)).toEqual({ name: "bun", kind: "process", folder: "" });
  });

  it("outside any workspace: the process name, no folder", () => {
    expect(describePort(row(9000, "/opt/x", "redis"), [], null)).toEqual({
      name: "redis",
      kind: "process",
      folder: null,
    });
  });
});

describe("shortCommand", () => {
  it("drops paths down to their last part", () => {
    expect(shortCommand("/usr/bin/node /home/r/wt/app/node_modules/.bin/vite --port 5173")).toBe(
      "node vite --port 5173",
    );
  });

  it("caps long commands", () => {
    const text = shortCommand(`node ${"x".repeat(100)}`);
    expect(text.length).toBeLessThanOrEqual(60);
    expect(text.endsWith("…")).toBe(true);
  });

  it("empty stays empty", () => {
    expect(shortCommand("  ")).toBe("");
  });
});
