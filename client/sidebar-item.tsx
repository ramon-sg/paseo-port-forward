/**
 * The sidebar row: opens the ports popover, shows how many ports are forwarded, and keeps
 * each online remote host polled in the background so automatic forwarding runs while the
 * popover is closed.
 */
import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useHosts } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Text } from "react-native";

import { BACKGROUND_POLL_MS, useRemotePorts } from "./use-remote-ports";

function HostWatcher({
  serverId,
  label,
  onCount,
}: {
  serverId: string;
  label: string;
  onCount(serverId: string, count: number): void;
}) {
  const { state } = useRemotePorts(serverId, label, BACKGROUND_POLL_MS);
  const count = state?.forwards.filter((forward) => forward.status === "active").length ?? 0;
  useEffect(() => {
    onCount(serverId, count);
    return () => onCount(serverId, 0);
  }, [serverId, count, onCount]);
  return null;
}

export function makeSidebarItem(Popover: ComponentType<PluginPopoverProps>) {
  return function PortsSidebarItem({ host, theme, openPopover }: PluginSidebarItemProps) {
    const remotes = useHosts().filter(
      (candidate) => candidate.serverId !== host.id && candidate.status === "online",
    );
    const [counts, setCounts] = useState<Record<string, number>>({});
    const onCount = useCallback((serverId: string, count: number) => {
      setCounts((current) => (current[serverId] === count ? current : { ...current, [serverId]: count }));
    }, []);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

    return (
      <>
        {remotes.map((remote) => (
          <HostWatcher key={remote.serverId} serverId={remote.serverId} label={remote.label} onCount={onCount} />
        ))}
        <SidebarRow
          icon="Cable"
          onPress={() => openPopover(Popover)}
          trailing={
            total > 0 ? (
              <Text style={{ color: theme.colors.statusSuccess, fontSize: 12, fontVariant: ["tabular-nums"] }}>
                {total}
              </Text>
            ) : undefined
          }
        />
      </>
    );
  };
}
