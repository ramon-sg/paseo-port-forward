import { describe, expect, it } from "vitest";

import { openUrl, safeLocalUrl } from "./open-url";

const URL = "http://localhost:5173/";

function recorder(failing: string[] = []) {
  const calls: string[] = [];
  const exec = async (command: string, args: string[]) => {
    calls.push([command, ...args].join(" "));
    if (failing.includes(command)) throw new Error(`${command}: not found`);
  };
  return { calls, exec };
}

describe("openUrl", () => {
  it("macOS opens Google Chrome", async () => {
    const { calls, exec } = recorder();
    expect(await openUrl(URL, "chrome", "darwin", exec)).toBe("chrome");
    expect(calls).toEqual([`open -a Google Chrome ${URL}`]);
  });

  it("falls back to the default browser when Chrome is missing", async () => {
    const calls: string[] = [];
    const exec = async (command: string, args: string[]) => {
      calls.push([command, ...args].join(" "));
      if (args.includes("Google Chrome")) throw new Error("Unable to find application");
    };
    expect(await openUrl(URL, "chrome", "darwin", exec)).toBe("default");
    expect(calls.at(-1)).toBe(`open ${URL}`);
  });

  it("Linux tries the Chrome binaries in order", async () => {
    const { calls, exec } = recorder(["google-chrome"]);
    expect(await openUrl(URL, "chrome", "linux", exec)).toBe("chrome");
    expect(calls).toEqual([`google-chrome ${URL}`, `google-chrome-stable ${URL}`]);
  });

  it("default skips Chrome", async () => {
    const { calls, exec } = recorder();
    expect(await openUrl(URL, "default", "linux", exec)).toBe("default");
    expect(calls).toEqual([`xdg-open ${URL}`]);
  });
});

describe("safeLocalUrl", () => {
  it("keeps a localhost link", () => {
    expect(safeLocalUrl("http://localhost:5173/admin?x=1")).toBe("http://localhost:5173/admin?x=1");
  });

  it("rejects other hosts, schemes and credentials", () => {
    expect(() => safeLocalUrl("https://example.com")).toThrow(/localhost/);
    expect(() => safeLocalUrl("file:///etc/passwd")).toThrow(/http/);
    expect(() => safeLocalUrl("http://a:b@localhost:1/")).toThrow(/credentials/);
    expect(() => safeLocalUrl("not a url")).toThrow(/Not a URL/);
  });

  it("escapes shell metacharacters by re-serializing", () => {
    expect(safeLocalUrl('http://localhost:1/a&calc"|b')).toBe("http://localhost:1/a&calc%22|b");
  });

  it("Windows uses rundll32, never cmd", async () => {
    const calls: string[] = [];
    await openUrl("http://localhost:1/", "chrome", "win32", async (command) => {
      calls.push(command);
    });
    expect(calls).toEqual(["rundll32"]);
  });
});
