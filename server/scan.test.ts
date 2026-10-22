import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { analyzeScan, connectHostFor, decodeProcAddress, parseDockerPorts, parseScanOutput } from "./scan";

const fixture = readFileSync(new URL("./fixtures/linux-scan.txt", import.meta.url), "utf8");

describe("decodeProcAddress", () => {
  it("decodes IPv4 little-endian addresses", () => {
    expect(decodeProcAddress("tcp", "0100007F:0BB8")).toEqual({ address: "127.0.0.1", port: 3000 });
    expect(decodeProcAddress("tcp", "00000000:1A6F")).toEqual({ address: "0.0.0.0", port: 6767 });
  });

  it("decodes IPv6 wildcard, loopback and v4-mapped addresses", () => {
    expect(decodeProcAddress("tcp6", "00000000000000000000000000000000:1435")).toEqual({
      address: "::",
      port: 5173,
    });
    expect(decodeProcAddress("tcp6", "00000000000000000000000001000000:1F90")).toEqual({
      address: "::1",
      port: 8080,
    });
    expect(decodeProcAddress("tcp6", "0000000000000000FFFF00000100007F:0050")).toEqual({
      address: "127.0.0.1",
      port: 80,
    });
  });
});

describe("connectHostFor", () => {
  it("maps wildcard and loopback binds to loopback and keeps specific addresses", () => {
    expect(connectHostFor("0.0.0.0")).toBe("127.0.0.1");
    expect(connectHostFor("127.0.0.1")).toBe("127.0.0.1");
    expect(connectHostFor("::")).toBe("localhost");
    expect(connectHostFor("::1")).toBe("[::1]");
    expect(connectHostFor("10.0.0.5")).toBe("10.0.0.5");
  });
});

describe("analyzeScan on a real Linux remote", () => {
  const raw = parseScanOutput(fixture);

  it("parses every section", () => {
    expect(raw.complete).toBe(true);
    expect(raw.pidFile).toEqual({ pid: 29, serverId: "srv_RVCaSQhbaNyq", listen: "127.0.0.1:6767" });
    expect(raw.listen.map((socket) => socket.port).sort((a, b) => a - b)).toEqual([
      22, 22, 3000, 5173, 6767, 9999, 41665,
    ]);
  });

  it("keeps only ports opened under Paseo terminals and agents", () => {
    const { ports } = analyzeScan(raw);
    expect(ports.map((port) => port.port)).toEqual([3000, 5173]);
    expect(ports[0]).toMatchObject({ process: "python3", agentId: null, cwd: "/home/dev/proj" });
    expect(ports[1]).toMatchObject({
      bind: "::",
      connectHost: "localhost",
      agentId: "agent-fake-123",
      cwd: "/home/dev/proj",
    });
  });

  it("returns nothing without a pid file", () => {
    expect(analyzeScan({ ...raw, pidFile: null }).ports).toEqual([]);
  });

  it("drops output that never reached the end marker", () => {
    expect(parseScanOutput(fixture.replace("@end", "")).complete).toBe(false);
  });
});

const WT = "/home/r/wt/abastio-1";

/** A tiny scan: supervisor 100 → worker 101; pid 200 is outside Paseo (an ssh shell or tmux). */
function rawScan(extra: { docker?: string[]; outsideCwd?: string } = {}): string {
  return [
    "@pidfile",
    JSON.stringify({ pid: 100, serverId: "srv", listen: "127.0.0.1:6767" }),
    "@listen",
    "tcp 0100007F:4F18 7001",
    "@stat",
    "100 1 x",
    "101 100 x",
    "200 1 x",
    "@owners",
    "200 7001",
    "@proc 200",
    `cwd ${extra.outsideCwd ?? `${WT}/apps/storefront`}`,
    "comm node",
    "cmd node next dev",
    "@docker",
    ...(extra.docker ?? []),
    "@end",
    "",
  ].join("\n");
}

describe("ports outside Paseo inside a workspace", () => {
  it("a process outside Paseo whose cwd is inside a workspace dir is kept", () => {
    const ports = analyzeScan(parseScanOutput(rawScan()), [WT]).ports;
    expect(ports.map((p) => [p.port, p.cwd])).toEqual([[20248, `${WT}/apps/storefront`]]);
  });

  it("a process outside Paseo and outside every workspace dir is dropped", () => {
    expect(analyzeScan(parseScanOutput(rawScan({ outsideCwd: "/srv/other" })), [WT]).ports).toEqual([]);
  });

  it("without workspace dirs nothing outside Paseo is kept", () => {
    expect(analyzeScan(parseScanOutput(rawScan())).ports).toEqual([]);
  });
});

describe("docker compose ports", () => {
  const docker = [
    `0.0.0.0:24284->9000/tcp, [::]:24284->9000/tcp\t${WT}\trustfs`,
    `127.0.0.1:24285->8069/tcp\t${WT}\todoo`,
    `5432/tcp\t${WT}\tpostgres-internal`,
    `0.0.0.0:7000->80/tcp\t/srv/elsewhere\tweb`,
  ];

  it("published ports of a compose project in a workspace dir are kept, named by service", () => {
    const ports = analyzeScan(parseScanOutput(rawScan({ docker, outsideCwd: "/srv/other" })), [WT]).ports;
    expect(ports.map((p) => [p.port, p.process, p.cwd, p.connectHost])).toEqual([
      [24284, "rustfs", WT, "127.0.0.1"],
      [24285, "odoo", WT, "127.0.0.1"],
    ]);
  });

  it("parseDockerPorts reads binds, ranges and skips unpublished ports", () => {
    expect(parseDockerPorts("0.0.0.0:8000-8001->8000-8001/tcp, 9000/tcp, [::]:7000->70/tcp, 0.0.0.0:53->53/udp")).toEqual([
      { bind: "0.0.0.0", port: 8000 },
      { bind: "0.0.0.0", port: 8001 },
      { bind: "::", port: 7000 },
    ]);
  });
});
