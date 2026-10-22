/**
 * Settings: SSH target per remote host (with a connection test), ignored ports, scan
 * interval and Open link paths.
 */
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useHosts, useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { ScrollView, Text } from "react-native";

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
          Forwarding uses your own SSH (keys, agent and ~/.ssh/config). Enter user@host or an alias
          from ~/.ssh/config. Password prompts are not supported.
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

function TargetRow({
  serverId,
  label,
  target,
  onChange,
}: {
  serverId: string;
  label: string;
  target: string;
  onChange(text: string): void;
}) {
  const test = useMutation({ mutationFn: useRpc(testConnectionRpc) });
  const result = test.data;
  const testError = test.error ? String(test.error) : result && !result.ok ? result.error : null;
  return (
    <>
      <SettingsInput
        label={label}
        hint={`user@host or a ~/.ssh/config alias for ${serverId}`}
        initialValue={target}
        placeholder="not forwarded"
        onChangeText={(text) => {
          test.reset();
          onChange(text);
        }}
      />
      <SettingsAction
        label={`Test ${label}`}
        hint={result?.ok ? `Verified: this is Paseo host ${result.remoteServerId}` : "Checks that the target reaches this Paseo host."}
        error={testError}
        actionLabel={test.isPending ? "Testing…" : "Test connection"}
        disabled={!target.trim() || test.isPending}
        onPress={() => test.mutate({ serverId, target: target.trim() })}
      />
    </>
  );
}
