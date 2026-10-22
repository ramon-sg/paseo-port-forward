/**
 * Opens a URL on this machine, in Google Chrome when asked and installed, else in the
 * default browser.
 */
import { execFile } from "node:child_process";

type Run = (command: string, args: string[]) => Promise<void>;

const run: Run = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000 }, (error) => (error ? reject(error) : resolve()));
  });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Only forwarded apps are opened: an http(s) URL on this machine, re-serialized by URL so
 * nothing but a plain URL ever reaches a command line.
 */
export function safeLocalUrl(text: string): string {
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`Not a URL: ${text}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http(s) links can be opened");
  if (!LOCAL_HOSTS.has(parsed.hostname)) throw new Error("Only localhost links can be opened");
  if (parsed.username || parsed.password) throw new Error("Links with credentials are not opened");
  return parsed.href;
}

/** Commands that open a URL in Chrome, tried in order, for this platform. No shells. */
export function chromeCommands(platform: NodeJS.Platform, url: string): [string, string[]][] {
  if (platform === "darwin") return [["open", ["-a", "Google Chrome", url]]];
  if (platform === "win32") return [];
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].map((bin) => [bin, [url]]);
}

export function defaultCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

export async function openUrl(
  text: string,
  browser: "chrome" | "default",
  platform: NodeJS.Platform = process.platform,
  exec: Run = run,
): Promise<"chrome" | "default"> {
  const url = safeLocalUrl(text);
  if (browser === "chrome") {
    for (const [command, args] of chromeCommands(platform, url)) {
      try {
        await exec(command, args);
        return "chrome";
      } catch {
        // Not installed under this name; try the next, then the default browser.
      }
    }
  }
  const [command, args] = defaultCommand(platform, url);
  await exec(command, args);
  return "default";
}
