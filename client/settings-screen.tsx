/**
 * Settings: SSH target per remote host, ignored ports, scan interval and Open link paths.
 */
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useHosts } from "@getpaseo/plugin/client";
import { SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { ScrollView, Text } from "react-native";

import { formatLinkPaths, parseLinkPaths, parsePortList } from "../shared/settings";
import { usePortSettings } from "./use-port-settings";

export function PortSettingsScreen({ host, theme }: PluginSurfaceProps) {
  const { state, values, update, setTarget } = usePortSettings();
  const remotes = useHosts().filter((candidate) => candidate.serverId !== host.id);

  if (!values) {
    return (
      <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>
        {state.status === "loading" ? "Loading…" : "error" in state ? state.error : ""}
      </Text>
    );
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets>
      <SettingsSection title="SSH targets">
        {remotes.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>No remote hosts configured.</Text>
        ) : null}
        {remotes.map((remote) => (
          <SettingsInput
            key={remote.serverId}
            label={remote.label}
            hint={`user@host or a ~/.ssh/config alias for ${remote.serverId}`}
            initialValue={values.targets[remote.serverId] ?? ""}
            placeholder="not forwarded"
            onChangeText={(text) => void setTarget(remote.serverId, text)}
          />
        ))}
      </SettingsSection>
      <SettingsSection title="Forwarding">
        <SettingsInput
          label="Ignored ports"
          hint="Never forwarded with a workspace. Separate with commas or spaces."
          initialValue={values.ignorePorts.join(", ")}
          onChangeText={(text) => void update((current) => ({ ...current, ignorePorts: parsePortList(text) }))}
        />
        <SettingsInput
          label="Scan interval (seconds)"
          hint="How often a followed workspace is checked for new and closed ports."
          initialValue={String(values.pollSeconds)}
          onChangeText={(text) => {
            const pollSeconds = Number(text);
            if (Number.isInteger(pollSeconds) && pollSeconds >= 1 && pollSeconds <= 60) {
              void update((current) => ({ ...current, pollSeconds }));
            }
          }}
        />
        <SettingsInput
          label="Open link paths"
          hint="label=/path pairs, separated by commas, added to a port's Open link (admin=/dashboard)."
          initialValue={formatLinkPaths(values.linkPaths)}
          placeholder="admin=/dashboard, vendor=/seller"
          onChangeText={(text) => void update((current) => ({ ...current, linkPaths: parseLinkPaths(text) }))}
        />
      </SettingsSection>
    </ScrollView>
  );
}
