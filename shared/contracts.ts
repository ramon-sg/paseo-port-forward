/**
 * RPC contracts and shared types between the client screen and the laptop daemon.
 */
import { z } from "zod";

export const RemotePortSchema = z.object({
  port: z.number().int(),
  /** Address the remote socket is bound to, as printed by the remote (e.g. `0.0.0.0`, `::1`). */
  bind: z.string(),
  /** Host the forward connects to on the remote side. */
  connectHost: z.string(),
  pid: z.number().int(),
  process: z.string(),
  command: z.string(),
  agentId: z.string().nullable(),
  cwd: z.string().nullable(),
});
export type RemotePort = z.infer<typeof RemotePortSchema>;
