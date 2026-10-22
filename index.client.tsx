/**
 * Client side of the plugin: the Remote ports screen, its sidebar item and settings.
 */
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

import { PortsScreen } from "./client/ports-screen";
import { PortSettingsScreen } from "./client/settings-screen";

const SCREEN_ID = "remote-ports";

function PortsSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Cable"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN_ID, title: "Remote ports", Component: PortsScreen });
  client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Remote ports", Component: PortsSidebarItem });
  client.addSettingsScreen({
    id: SCREEN_ID,
    title: "Remote ports",
    icon: "Cable",
    Component: PortSettingsScreen,
  });
  client.addCommandCenterItem({
    id: "open-remote-ports",
    title: "Open Remote ports",
    icon: "Cable",
    keywords: ["ports", "forward", "ssh", "localhost", "tunnel", "remote"],
    context: "global",
    onSelect(context) {
      context.openScreen({ screenId: SCREEN_ID });
    },
  });
  return () => {};
}
