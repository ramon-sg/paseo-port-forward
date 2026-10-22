/**
 * Client side of the plugin: a sidebar item that opens the Remote ports popover (and keeps
 * automatic forwarding running), and the plugin's settings screen.
 */
import type { PluginClientContext, PluginPopoverProps } from "@getpaseo/plugin/client";

import { PortsPopover } from "./client/ports-popover";
import { PortSettingsScreen } from "./client/settings-screen";
import { makeSidebarItem } from "./client/sidebar-item";

const SETTINGS_ID = "remote-ports";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings(SETTINGS_ID);

  function Popover(props: PluginPopoverProps) {
    return <PortsPopover {...props} openSettings={openSettings} />;
  }

  const PortsSidebarItem = makeSidebarItem(Popover);

  client.addSidebarHeaderItem({ id: "remote-ports", title: "Remote ports", Component: PortsSidebarItem });
  client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "Remote ports",
    icon: "Cable",
    Component: PortSettingsScreen,
  });
  client.addCommandCenterItem({
    id: "open-remote-ports-settings",
    title: "Remote ports settings",
    icon: "Cable",
    keywords: ["ports", "forward", "ssh", "localhost", "tunnel", "remote"],
    context: "global",
    onSelect(context) {
      context.openSettings(SETTINGS_ID);
    },
  });
  return () => {};
}
