/**
 * Server side of the plugin, on the laptop daemon: settings and RPCs over one PortManager.
 * Adapted from alessandrocornacchia/paseo-port-forward (MIT).
 */
import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  followRpc,
  forwardRpc,
  openUrlRpc,
  pingRpc,
  stateRpc,
  testConnectionRpc,
  unfollowRpc,
  unforwardRpc,
} from "./shared/contracts";
import { portSettings } from "./shared/settings";
import { PortManager } from "./server/manager";
import { openUrl } from "./server/open-url";
import { sweepStaleSockets } from "./server/ssh";

export default function contribute(server: PluginServerContext) {
  const manager = new PortManager();
  const settings = server.registerSettings(portSettings);

  let browser: "chrome" | "default" = "chrome";
  const load = async () => {
    const state = await settings.read();
    if (state.status === "ready") {
      manager.applySettings(state.values);
      browser = state.values.browser;
    }
    else console.warn(`[remote-ports] settings are invalid: ${state.error}`);
  };
  const ready = sweepStaleSockets()
    .catch((error: unknown) => console.warn("[remote-ports] stale socket sweep failed", error))
    .then(load);
  const unsubscribe = settings.subscribe((state) => {
    if (state.status === "ready") {
      manager.applySettings(state.values);
      browser = state.values.browser;
    }
  });

  server.handle(pingRpc, () => ({ pong: true as const, pid: process.pid, platform: process.platform }));
  server.handle(stateRpc, async ({ serverId, workspaces, label }) => {
    await ready;
    return manager.state(serverId, workspaces, label);
  });
  server.handle(followRpc, async ({ serverId, workspaceId }) => {
    await ready;
    return manager.follow(serverId, workspaceId);
  });
  server.handle(unfollowRpc, async ({ serverId, workspaceId }) => {
    await ready;
    return manager.unfollow(serverId, workspaceId);
  });
  server.handle(forwardRpc, async ({ serverId, remotePort }) => {
    await ready;
    return manager.forward(serverId, remotePort);
  });
  server.handle(unforwardRpc, async ({ serverId, remotePort }) => {
    await ready;
    return { ok: await manager.unforward(serverId, remotePort) };
  });
  server.handle(testConnectionRpc, async ({ serverId, target, label }) => {
    await ready;
    return manager.testConnection(serverId, target, label);
  });

  server.handle(openUrlRpc, async ({ url }) => {
    await ready;
    return { opened: await openUrl(url, browser) };
  });

  // The plugin process can die without running cleanup; never leave ssh masters behind.
  const onExit = () => manager.killAll();
  process.once("exit", onExit);

  return async () => {
    process.off("exit", onExit);
    unsubscribe();
    await manager.dispose();
  };
}
