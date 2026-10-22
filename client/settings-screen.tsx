/**
 * Settings: SSH target per remote host (with a connection test), ignored ports, scan
 * interval and Open link paths.
 */
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useHosts, useRpc } from "@getpaseo/plugin/client";
import {
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { testConnectionRpc } from "../shared/contracts";
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
        <Text style={{ color: theme.colors.foregroundMuted }}>
          Found automatically: the host's name in Paseo and your ~/.ssh/config aliases are tried,
          and the one that reaches that Paseo host is used. Fill a target in only to override it.
          Uses your own SSH (keys, agent, ~/.ssh/config); password prompts are not supported.
        </Text>
        {remotes.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>No remote hosts configured.</Text>
        ) : null}
        {remotes.map((remote) => (
          <TargetRow
            key={remote.serverId}
            serverId={remote.serverId}
            label={remote.label}
            target={values.targets[remote.serverId] ?? ""}
            onChange={(text) => void setTarget(remote.serverId, text)}
            theme={theme}
          />
        ))}
      </SettingsSection>
      <SettingsSection title="Forwarding">
        <SettingsSwitch
          label="Forward automatically"
          hint="Ports of every workspace open on this machine as soon as they listen. Stop opts a workspace out."
          value={values.autoForward}
          onValueChange={(autoForward) => update((current) => ({ ...current, autoForward }))}
        />
        <SettingsSelect
          label="Open links in"
          hint="Where a port's Open button goes."
          value={values.browser}
          options={[
            { label: "Google Chrome", value: "chrome" },
            { label: "Default browser", value: "default" },
          ]}
          onValueChange={(browser) => update((current) => ({ ...current, browser }))}
        />
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

function TargetRow({
  serverId,
  label,
  target,
  onChange,
  theme,
}: {
  serverId: string;
  label: string;
  target: string;
  onChange(text: string): void;
  theme: PluginTheme;
}) {
  // What is typed, so the check uses it before the save lands.
  const [draft, setDraft] = useState(target);
  const test = useMutation({ mutationFn: useRpc(testConnectionRpc) });
  const run = () => test.mutate({ serverId, label, ...(draft.trim() ? { target: draft.trim() } : {}) });
  // Check once on open, so the status shows without a click.
  useEffect(run, []);

  const result = test.data;
  const status = test.isPending
    ? { color: theme.colors.statusWarning, text: "Checking…" }
    : test.error
      ? { color: theme.colors.statusDanger, text: String(test.error) }
      : result?.ok
        ? {
            color: theme.colors.statusSuccess,
            text: `Connected through ${result.target}${draft.trim() ? "" : " (found automatically)"}`,
          }
        : result
          ? { color: theme.colors.statusDanger, text: result.error ?? "Not connected" }
          : { color: theme.colors.border, text: "Not checked" };

  return (
    <>
      <SettingsInput
        label={label}
        hint="Optional. user@host or a ~/.ssh/config alias; empty finds it automatically."
        initialValue={target}
        placeholder="automatic"
        onChangeText={(text) => {
          setDraft(text);
          test.reset();
          onChange(text);
        }}
      />
      <SettingsRow label="Connection">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
          {test.isPending ? (
            <ActivityIndicator size="small" color={status.color} />
          ) : (
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: status.color }} />
          )}
          <Text style={{ color: status.color === theme.colors.border ? theme.colors.foregroundMuted : status.color, fontSize: 13, flexShrink: 1 }}>
            {status.text}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={test.isPending}
            onPress={run}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              opacity: test.isPending ? 0.5 : 1,
            }}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Test again</Text>
          </Pressable>
        </View>
      </SettingsRow>
    </>
  );
}
