import { describe, expect, it } from "vitest";

import { matchWorkspace } from "./workspaces";

describe("matchWorkspace", () => {
  const one = [{ id: "a", directory: "/w/a" }];

  it("exact dir matches", () => {
    expect(matchWorkspace("/w/a", one)).toBe("a");
  });

  it("subdir matches", () => {
    expect(matchWorkspace("/w/a/apps/storefront", one)).toBe("a");
  });

  it("sibling prefix does not match", () => {
    expect(matchWorkspace("/w/abastio-10/x", [{ id: "1", directory: "/w/abastio-1" }])).toBeNull();
  });

  it("deepest wins", () => {
    const nested = [
      { id: "root", directory: "/w" },
      { id: "a", directory: "/w/a" },
    ];
    expect(matchWorkspace("/w/a/x", nested)).toBe("a");
    expect(matchWorkspace("/w/b", nested)).toBe("root");
  });

  it("trailing slash ignored", () => {
    expect(matchWorkspace("/w/a/x/", [{ id: "a", directory: "/w/a/" }])).toBe("a");
  });

  it("null cwd → null", () => {
    expect(matchWorkspace(null, one)).toBeNull();
  });
});
