import { describe, expect, it } from "vitest";

import { formatLinkPaths, parseLinkPaths, parsePortList, PortSettingsSchema } from "./settings";

describe("PortSettingsSchema", () => {
  it("defaults", () => {
    expect(PortSettingsSchema.parse({})).toEqual({
      targets: {},
      pollSeconds: 3,
      ignorePorts: [22],
      autoForward: true,
      browser: "chrome",
      linkPaths: {},
    });
  });

  it("linkPaths rejects a path without a leading slash", () => {
    expect(PortSettingsSchema.safeParse({ linkPaths: { admin: "dashboard" } }).success).toBe(false);
    expect(PortSettingsSchema.safeParse({ linkPaths: { admin: "/dashboard" } }).success).toBe(true);
  });
});

describe("parsePortList", () => {
  it("keeps valid ports, sorted and unique", () => {
    expect(parsePortList("22, 5432 x")).toEqual([22, 5432]);
    expect(parsePortList("5432 22 22 70000")).toEqual([22, 5432]);
  });
});

describe("parseLinkPaths", () => {
  it("reads label=/path lines and skips the rest", () => {
    expect(parseLinkPaths("admin=/dashboard\n vendor = /seller \nbad\nshop=nope\n")).toEqual({
      admin: "/dashboard",
      vendor: "/seller",
    });
  });

  it("accepts commas as separators", () => {
    expect(parseLinkPaths("admin=/dashboard, vendor=/seller")).toEqual({ admin: "/dashboard", vendor: "/seller" });
  });

  it("round-trips with formatLinkPaths", () => {
    expect(parseLinkPaths(formatLinkPaths({ admin: "/dashboard" }))).toEqual({ admin: "/dashboard" });
  });
});
