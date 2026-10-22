/**
 * RPC contracts and shared types between the client screen and the laptop daemon.
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

import { WorkspaceRefSchema } from "./workspaces";

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

export const SshStatusSchema = z.object({
  state: z.enum(["unmapped", "idle", "connecting", "connected", "error"]),
  target: z.string().nullable(),
  error: z.string().nullable(),
  /** serverId read from the remote's paseo.pid, once connected. */
  remoteServerId: z.string().nullable(),
});
export type SshStatus = z.infer<typeof SshStatusSchema>;

/** A detected remote port and the workspace its process belongs to. */
export const PortRowSchema = RemotePortSchema.extend({ workspaceId: z.string().nullable() });
export type PortRow = z.infer<typeof PortRowSchema>;

/** A forward is always `127.0.0.1:<remotePort>` on this machine. */
export const ForwardSchema = z.object({
  remotePort: z.number().int(),
  connectHost: z.string(),
  status: z.enum(["active", "error"]),
  error: z.string().nullable(),
  workspaceId: z.string().nullable(),
});
export type Forward = z.infer<typeof ForwardSchema>;

export const PortsStateSchema = z.object({
  ssh: SshStatusSchema,
  ports: z.array(PortRowSchema),
  forwards: z.array(ForwardSchema),
  followed: z.array(z.string()),
  scannedAt: z.string().nullable(),
  scanError: z.string().nullable(),
});
export type PortsState = z.infer<typeof PortsStateSchema>;

const ServerInput = z.object({ serverId: z.string().min(1) });
const PortInput = ServerInput.extend({ remotePort: z.number().int().min(1).max(65535) });
const WorkspaceInput = ServerInput.extend({ workspaceId: z.string().min(1) });

export const pingRpc = defineRpc({
  name: "ports.ping",
  input: z.object({}),
  output: z.object({ pong: z.literal(true), pid: z.number().int(), platform: z.string() }),
});

/** The client sends every workspace of the host, so the server can group and prune. */
export const stateRpc = defineRpc({
  name: "ports.state",
  input: ServerInput.extend({ workspaces: z.array(WorkspaceRefSchema) }),
  output: PortsStateSchema,
});

export const followRpc = defineRpc({ name: "ports.follow", input: WorkspaceInput, output: PortsStateSchema });

export const unfollowRpc = defineRpc({ name: "ports.unfollow", input: WorkspaceInput, output: PortsStateSchema });

/** For ports outside any workspace. */
export const forwardRpc = defineRpc({ name: "ports.forward", input: PortInput, output: ForwardSchema });

export const unforwardRpc = defineRpc({
  name: "ports.unforward",
  input: PortInput,
  output: z.object({ ok: z.boolean() }),
});

export const testConnectionRpc = defineRpc({
  name: "ports.test-connection",
  input: ServerInput.extend({ target: z.string().min(1).optional() }),
  output: z.object({
    ok: z.boolean(),
    remoteServerId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
