/**
 * The Remote ports screen: pick a remote host, see its workspaces with their listening
 * ports, Forward a workspace to this machine's localhost and Open its apps.
 * The host picker, SSH target form and header are adapted from
 * alessandrocornacchia/paseo-port-forward (MIT).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { getPaseoClient, openExternalUrl, useHosts, useRpc } from "@getpaseo/plugin/client";
import { SettingsInput } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import {
  followRpc,
  forwardRpc,
  stateRpc,
  testConnectionRpc,
  unfollowRpc,
  unforwardRpc,
  type Forward,
  type PortRow,
  type PortsState,
} from "../shared/contracts";
import { linkUrl, portLabel, type ScriptInfo } from "./labels";
import { makeStyles, type Styles } from "./styles";
import { usePortSettings } from "./use-port-settings";

const POLL_MS = 2_000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 20;

interface RemoteWorkspace {
  id: string;
  title: string;
  branch: string | null;
  directory: string;
  scripts: ScriptInfo[];
}

/** Every live workspace of a remote host, through that host's own API. */
async function listRemoteWorkspaces(serverId: string): Promise<RemoteWorkspace[]> {
  const client = getPaseoClient(serverId);
  const workspaces: RemoteWorkspace[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.workspaces.list({ page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) } });
    for (const entry of result.entries) {
      if (entry.archivingAt || !entry.workspaceDirectory) continue;
      workspaces.push({
        id: entry.id,
        title: entry.title || entry.name,
        branch: entry.gitRuntime?.currentBranch ?? null,
        directory: entry.workspaceDirectory,
        scripts: entry.scripts.map((script) => ({
          scriptName: script.scriptName,
          port: script.port,
          lifecycle: script.lifecycle,
        })),
      });
    }
    const next = result.pageInfo.hasMore ? result.pageInfo.nextCursor : null;
    if (!next) break;
    cursor = next;
  }
  return workspaces;
}

export function PortsScreen({ theme, layout, host, params }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  // This plugin runs on the laptop daemon; every other configured host is a remote.
  const remotes = useHosts().filter((candidate) => candidate.serverId !== host.id);
  const [picked, setPicked] = useState<string | null>(params.serverId ?? null);
  const selected = remotes.find((remote) => remote.serverId === picked) ?? remotes[0] ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Remote ports</Text>
      <Text style={styles.muted}>
        Forward a remote workspace's dev servers to this machine's localhost, at the same port
        numbers, over your own SSH connection.
      </Text>
      {remotes.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.text}>No remote hosts.</Text>
          <Text style={styles.muted}>Add a remote Paseo host in the app first.</Text>
        </View>
      ) : (
        <>
          <View style={styles.chips}>
            {remotes.map((remote) => {
              const active = remote.serverId === selected?.serverId;
              return (
                <Pressable
                  key={remote.serverId}
                  accessibilityRole="button"
                  onPress={() => setPicked(remote.serverId)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={active ? styles.chipTextActive : styles.chipText}>{remote.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {selected ? (
            <HostPorts
              key={selected.serverId}
              serverId={selected.serverId}
              label={selected.label}
              online={selected.status === "online"}
              styles={styles}
              theme={theme}
            />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

interface HostPortsProps {
  serverId: string;
  label: string;
  online: boolean;
  styles: Styles;
  theme: PluginTheme;
}

function HostPorts({ serverId, label, online, styles, theme }: HostPortsProps) {
  const { values, setTarget } = usePortSettings();
  const target = values?.targets[serverId] ?? null;
  const [editing, setEditing] = useState(false);

  if (!values) return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (!target || editing) {
    return (
      <TargetForm
        serverId={serverId}
        label={label}
        initial={target ?? ""}
        styles={styles}
        onSave={async (next) => {
          await setTarget(serverId, next);
          setEditing(false);
        }}
        onCancel={target ? () => setEditing(false) : null}
      />
    );
  }
  if (!online) {
    return (
      <View style={styles.card}>
        <Text style={styles.text}>{label} is offline in Paseo.</Text>
        <Text style={styles.muted}>Its workspaces show up here once the app reconnects to it.</Text>
      </View>
    );
  }
  return (
    <WorkspacePorts
      serverId={serverId}
      linkPaths={values.linkPaths}
      styles={styles}
      theme={theme}
      onEditTarget={() => setEditing(true)}
    />
  );
}

interface TargetFormProps {
  serverId: string;
  label: string;
  initial: string;
  styles: Styles;
  onSave(target: string): Promise<void>;
  onCancel: (() => void) | null;
}

function TargetForm({ serverId, label, initial, styles, onSave, onCancel }: TargetFormProps) {
  const [draft, setDraft] = useState(initial);
  const test = useMutation({ mutationFn: useRpc(testConnectionRpc) });
  const result = test.data;
  return (
    <View style={styles.card}>
      <Text style={styles.text}>SSH target for {label}</Text>
      <Text style={styles.muted}>
        Forwarding uses your own SSH (keys, agent and ~/.ssh/config). Enter user@host or an alias
        from ~/.ssh/config. Password prompts are not supported.
      </Text>
      <SettingsInput
        label="SSH target"
        initialValue={initial}
        placeholder="devbox"
        onChangeText={setDraft}
        error={result && !result.ok ? result.error : null}
        {...(result?.ok ? { hint: `Verified: this is Paseo host ${result.remoteServerId}` } : {})}
      />
      <View style={styles.row}>
        <Button
          styles={styles}
          label={test.isPending ? "Testing…" : "Test connection"}
          disabled={!draft.trim() || test.isPending}
          onPress={() => test.mutate({ serverId, target: draft.trim() })}
        />
        <Button styles={styles} primary label="Save" disabled={!draft.trim()} onPress={() => void onSave(draft)} />
        {onCancel ? <Button styles={styles} label="Cancel" onPress={onCancel} /> : null}
      </View>
    </View>
  );
}

type Action =
  | { kind: "follow" | "unfollow"; workspaceId: string }
  | { kind: "port"; port: number; on: boolean };

interface WorkspacePortsProps {
  serverId: string;
  linkPaths: Record<string, string>;
  styles: Styles;
  theme: PluginTheme;
  onEditTarget(): void;
}

function WorkspacePorts({ serverId, linkPaths, styles, theme, onEditTarget }: WorkspacePortsProps) {
  const loadState = useRpc(stateRpc);
  const follow = useRpc(followRpc);
  const unfollow = useRpc(unfollowRpc);
  const forward = useRpc(forwardRpc);
  const unforward = useRpc(unforwardRpc);
  const queryClient = useQueryClient();
  const workspacesQuery = useQuery({
    queryKey: ["remote-workspaces", serverId],
    queryFn: () => listRemoteWorkspaces(serverId),
    refetchInterval: POLL_MS,
  });
  const workspaces = workspacesQuery.data;
  const stateKey = ["remote-ports", serverId];
  const query = useQuery({
    queryKey: stateKey,
    enabled: workspaces !== undefined,
    queryFn: () =>
      loadState({
        serverId,
        workspaces: (workspaces ?? []).map((workspace) => ({ id: workspace.id, directory: workspace.directory })),
      }),
    refetchInterval: POLL_MS,
  });
  const action = useMutation({
    mutationFn: async (input: Action) => {
      if (input.kind === "port") {
        if (input.on) await forward({ serverId, remotePort: input.port });
        else await unforward({ serverId, remotePort: input.port });
        return;
      }
      if (input.kind === "follow") await follow({ serverId, workspaceId: input.workspaceId });
      else await unfollow({ serverId, workspaceId: input.workspaceId });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: stateKey }),
  });

  const state = query.data;
  const loadError = workspacesQuery.error ?? query.error;
  if (!state || !workspaces) {
    return (
      <View style={styles.card}>
        {loadError ? (
          <Text style={styles.danger}>{String(loadError)}</Text>
        ) : (
          <ActivityIndicator color={theme.colors.foregroundMuted} />
        )}
      </View>
    );
  }

  const forwards = new Map(state.forwards.map((item) => [item.remotePort, item]));
  const followed = new Set(state.followed);
  const shown = workspaces.filter(
    (workspace) => followed.has(workspace.id) || state.ports.some((port) => port.workspaceId === workspace.id),
  );
  const loose = state.ports.filter((port) => port.workspaceId === null);
  const busy = action.isPending;

  return (
    <View style={styles.stack}>
      <SshHeader state={state} styles={styles} theme={theme} onEditTarget={onEditTarget} />
      {action.error ? <Text style={styles.danger}>{String(action.error)}</Text> : null}
      {shown.length === 0 && loose.length === 0 && !state.scanError ? (
        <View style={styles.card}>
          <Text style={styles.text}>No dev servers running.</Text>
          <Text style={styles.muted}>
            Start a workspace's service with ▷, or a dev command in a Paseo terminal, and it shows
            up here within a few seconds.
          </Text>
        </View>
      ) : null}
      {shown.map((workspace) => {
        const isFollowed = followed.has(workspace.id);
        const ports = state.ports.filter((port) => port.workspaceId === workspace.id);
        return (
          <View key={workspace.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.port}>{workspace.title}</Text>
              {workspace.branch ? <Text style={styles.muted}>{workspace.branch}</Text> : null}
              <View style={styles.spacer} />
              <Button
                styles={styles}
                primary={!isFollowed}
                disabled={busy}
                label={isFollowed ? "Stop" : "Forward"}
                onPress={() => action.mutate({ kind: isFollowed ? "unfollow" : "follow", workspaceId: workspace.id })}
              />
            </View>
            {ports.length === 0 ? <Text style={styles.muted}>Waiting for its dev servers to listen…</Text> : null}
            {ports.map((port) => (
              <PortLine
                key={port.port}
                label={portLabel(port, workspace.scripts, workspace.directory)}
                port={port}
                forward={forwards.get(port.port) ?? null}
                linkPaths={linkPaths}
                styles={styles}
                theme={theme}
                toggle={null}
              />
            ))}
          </View>
        );
      })}
      {loose.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.port}>Other</Text>
          <Text style={styles.muted}>Ports outside any workspace. Forward them one by one.</Text>
          {loose.map((port) => {
            const current = forwards.get(port.port) ?? null;
            return (
              <PortLine
                key={port.port}
                label={portLabel(port, [], null)}
                port={port}
                forward={current}
                linkPaths={linkPaths}
                styles={styles}
                theme={theme}
                toggle={{
                  label: current ? "Stop" : "Forward",
                  disabled: busy,
                  onPress: () => action.mutate({ kind: "port", port: port.port, on: !current }),
                }}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function SshHeader({
  state,
  styles,
  theme,
  onEditTarget,
}: {
  state: PortsState;
  styles: Styles;
  theme: PluginTheme;
  onEditTarget(): void;
}) {
  const { ssh } = state;
  const color =
    ssh.state === "connected"
      ? theme.colors.statusSuccess
      : ssh.state === "error"
        ? theme.colors.statusDanger
        : theme.colors.statusWarning;
  const error = ssh.error ?? state.scanError;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.text}>
          SSH {ssh.state} · {ssh.target}
        </Text>
        <View style={styles.spacer} />
        <Button styles={styles} label="Change target" onPress={onEditTarget} />
      </View>
      {error ? <Text style={styles.danger}>{error}</Text> : null}
    </View>
  );
}

interface PortLineProps {
  label: string;
  port: PortRow;
  forward: Forward | null;
  linkPaths: Record<string, string>;
  styles: Styles;
  theme: PluginTheme;
  toggle: { label: string; disabled: boolean; onPress(): void } | null;
}

function PortLine({ label, port, forward, linkPaths, styles, theme, toggle }: PortLineProps) {
  const active = forward?.status === "active";
  const dot = !forward
    ? theme.colors.border
    : active
      ? theme.colors.statusSuccess
      : forward.status === "opening"
        ? theme.colors.statusWarning
        : theme.colors.statusDanger;
  const url = linkUrl(port.port, label, linkPaths);
  return (
    <View style={styles.stack}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={styles.text}>{label}</Text>
        <Text style={styles.muted}>:{port.port}</Text>
        <View style={styles.spacer} />
        {active ? <Button styles={styles} label="Open" onPress={() => void openExternalUrl(url)} /> : null}
        {toggle ? (
          <Button styles={styles} primary={!forward} disabled={toggle.disabled} label={toggle.label} onPress={toggle.onPress} />
        ) : null}
      </View>
      {forward?.error ? <Text style={styles.danger}>{forward.error}</Text> : null}
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  primary,
  styles,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary && styles.buttonPrimary, disabled && styles.buttonDisabled]}
    >
      <Text style={primary ? styles.buttonPrimaryText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
