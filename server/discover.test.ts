import { describe, expect, it } from "vitest";

import { candidateTargets, sshConfigAliases } from "./discover";

describe("sshConfigAliases", () => {
  it("reads concrete Host names, skipping wildcards and negations", () => {
    const text = [
      "Host github.com",
      " HostName github.com",
      "Host devbox build-*",
      "  HostName 100.109.152.31",
      "host Staging  !bad",
      "Host *",
      "  ServerAliveInterval 30",
      "# Host commented",
      "Match host x",
    ].join("\n");
    expect(sshConfigAliases(text)).toEqual(["github.com", "devbox", "Staging"]);
  });

  it("accepts Host=name", () => {
    expect(sshConfigAliases("Host=box\n")).toEqual(["box"]);
  });
});

describe("candidateTargets", () => {
  it("the host label first, then the config aliases, without git hosts or duplicates", () => {
    expect(candidateTargets("devbox", ["github.com", "devbox", "staging", "gitlab.com"])).toEqual([
      "devbox",
      "staging",
    ]);
  });

  it("a label with spaces is not a target, its lowercase slug is tried", () => {
    expect(candidateTargets("Dev Box", ["dev-box"])).toEqual(["dev-box"]);
  });

  it("the label alone when there is no config", () => {
    expect(candidateTargets("Devbox", [])).toEqual(["Devbox", "devbox"]);
  });

  it("caps the list", () => {
    const aliases = Array.from({ length: 30 }, (_, i) => `h${i}`);
    expect(candidateTargets("x", aliases).length).toBe(12);
  });
});
