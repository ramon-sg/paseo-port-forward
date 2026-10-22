/**
 * Plugin settings, stored per Paseo host (the laptop daemon).
 */
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_IGNORE_PORTS = [22];

const PortNumber = z.number().int().min(1).max(65535);

export const PortSettingsSchema = z.object({
  /** Paseo host serverId → SSH destination (`user@host` or a `~/.ssh/config` alias). */
  targets: z.record(z.string(), z.string()).default({}),
  /** Scan interval while a workspace is followed or the screen is open, in seconds. */
  pollSeconds: z.number().int().min(1).max(60).default(3),
  ignorePorts: z.array(PortNumber).default(DEFAULT_IGNORE_PORTS),
  /** Port label → path appended to its Open link (`admin` → `/dashboard`). */
  linkPaths: z.record(z.string(), z.string().regex(/^\//)).default({}),
});

export type PortSettings = z.output<typeof PortSettingsSchema>;

export const portSettings = defineSettings({
  id: "remote-ports",
  scope: "host",
  version: 1,
  schema: PortSettingsSchema,
});

export function defaultPortSettings(): PortSettings {
  return PortSettingsSchema.parse({});
}

/** "22, 5432 6379" → [22, 5432, 6379]; anything that is not a valid port is dropped. */
export function parsePortList(text: string): number[] {
  const ports = text
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);
  return [...new Set(ports)].sort((a, b) => a - b);
}
