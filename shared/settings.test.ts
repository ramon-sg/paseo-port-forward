import { describe, expect, it } from "vitest";

import { parsePortList, PortSettingsSchema } from "./settings";

describe("PortSettingsSchema", () => {
  it("defaults", () => {
    expect(PortSettingsSchema.parse({})).toEqual({
      targets: {},
      pollSeconds: 3,
      ignorePorts: [22],
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
