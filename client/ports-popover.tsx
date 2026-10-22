/**
 * The Remote ports popover, opened from the sidebar so the current workspace stays on
 * screen. It lists each remote workspace with its listening ports, says which service runs
 * on each, and lets you Forward a workspace and Open its apps.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginPopoverProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useHosts, useRpc } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";

import { openUrlRpc, type PortsState } from "../shared/contracts";
import { filterGroups, groupPorts, type PortEntry, type WorkspaceGroup } from "./groups";
import { linkUrl, shortCommand } from "./labels";
import { makePopoverStyles, type PopoverStyles } from "./popover-styles";
import { usePortSettings } from "./use-port-settings";
import { useRemotePorts, type PortAction } from "./use-remote-ports";

const KIND_LABEL = {
  service: "service",
  script: "script",
  app: "app",
  process: "process",
} as const;

const WORKSPACE_KIND_LABEL = {
  worktree: "worktree",
  checkout: "checkout",
  local_checkout: "checkout",
  directory: "folder",
} as const;

export interface PortsPopoverProps extends PluginPopoverProps {
  openSettings(): void;
}

export function PortsPopover({ theme, layout, host, close, openSettings }: PortsPopoverProps) {
  const { height } = useWindowDimensions();
  const styles = useMemo(() => makePopoverStyles(theme, layout.compact, height), [theme, layout.compact, height]);
  // This plugin runs on the laptop daemon; every other configured host is a remote.
  const remotes = useHosts().filter((candidate) => candidate.serverId !== host.id);
  const { values } = usePortSettings();
  const [picked, setPicked] = useState<string | null>(null);
  const selected = remotes.find((remote) => remote.serverId === picked) ?? remotes[0] ?? null;
  const goToSettings = () => {
    close();
    openSettings();
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Remote ports</Text>
        <View style={styles.spacer} />
        <SmallButton styles={styles} label="Settings" onPress={goToSettings} />
      </View>
      {remotes.length > 1 ? (
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
      ) : null}
      {!values ? (
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      ) : !selected ? (
        <Notice
          styles={styles}
          title="No remote hosts"
          body="Add a remote Paseo host in the app first."
          action={null}
        />
      ) : selected.status !== "online" ? (
        <Notice
          styles={styles}
          title={`${selected.label} is offline`}
          body="Its workspaces show up here once the app reconnects to it."
          action={null}
        />
      ) : (
        <HostPorts
          key={selected.serverId}
          serverId={selected.serverId}
          label={selected.label}
          linkPaths={values.linkPaths}
          styles={styles}
          theme={theme}
          openSettings={goToSettings}
          searchFocus={!layout.compact}
        />
      )}
    </View>
  );
}

interface HostPortsProps {
  serverId: string;
  label: string;
  linkPaths: Record<string, string>;
  styles: PopoverStyles;
  theme: PluginTheme;
  openSettings(): void;
  /** Focus the search box on open (desktop only, so phones don't pop the keyboard). */
  searchFocus: boolean;
}

function HostPorts({ serverId, label, linkPaths, styles, theme, openSettings, searchFocus }: HostPortsProps) {
  const { workspaces, state, loadError, action } = useRemotePorts(serverId, label);
  const [query, setQuery] = useState("");

  if (!state || !workspaces) {
    return (
      <View style={styles.centered}>
        {loadError ? (
          <Text style={styles.danger}>{String(loadError)}</Text>
        ) : (
          <ActivityIndicator color={theme.colors.foregroundMuted} />
        )}
      </View>
    );
  }

  if (state.ssh.state === "discovering" || (state.ssh.state === "unmapped" && !state.ssh.target)) {
    const finding = state.ssh.state === "discovering" || !state.ssh.error;
    return finding ? (
      <View style={[styles.row, styles.centered]}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
        <Text style={styles.meta}>Finding the SSH connection to {label}…</Text>
      </View>
    ) : (
      <Notice
        styles={styles}
        title={`Can't reach ${label} over SSH`}
        body={`Tried "${label}" and the hosts in ~/.ssh/config. Add an alias for it there, or set its SSH target in Settings.`}
        action={{ label: "Open settings", onPress: openSettings }}
      />
    );
  }

  const all = groupPorts(workspaces, state);
  const groups = filterGroups(all, query);
  const busy = action.isPending;
  const run = (input: PortAction) => action.mutate(input);
  const empty = all.workspaces.length === 0 && all.loose.length === 0;
  const noMatch = !empty && groups.workspaces.length === 0 && groups.loose.length === 0;
  const portCount = all.workspaces.reduce((sum, group) => sum + group.ports.length, 0) + all.loose.length;

  return (
    <>
      <SshLine label={label} state={state} activeCount={groups.activeCount} styles={styles} theme={theme} />
      {action.error ? <Text style={styles.danger}>{String(action.error)}</Text> : null}
      {!empty ? (
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter by worktree, branch, service or port"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoFocus={searchFocus}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.search}
          />
          {query ? <SmallButton styles={styles} label="Clear" onPress={() => setQuery("")} /> : null}
          <Text style={styles.meta}>
            {all.workspaces.length} {all.workspaces.length === 1 ? "worktree" : "worktrees"} · {portCount}{" "}
            {portCount === 1 ? "port" : "ports"}
          </Text>
        </View>
      ) : null}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {empty && !state.scanError ? (
          <Notice
            styles={styles}
            title="No dev servers running"
            body="Start a workspace's service with ▷, or a dev command in a Paseo terminal. It shows up here within a few seconds."
            action={null}
          />
        ) : null}
        {noMatch ? <Text style={[styles.meta, styles.centered]}>Nothing matches "{query.trim()}".</Text> : null}
        {groups.workspaces.map((group) => (
          <WorkspaceCard
            key={group.workspace.id}
            group={group}
            busy={busy}
            run={run}
            linkPaths={linkPaths}
            styles={styles}
            theme={theme}
          />
        ))}
        {groups.loose.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitles}>
                <Text style={styles.eyebrow}>Not in a workspace</Text>
                <Text style={styles.cardTitle}>Other ports</Text>
                <Text style={styles.meta}>Forward these one at a time.</Text>
              </View>
            </View>
            {groups.loose.map((entry) => (
              <PortRowView
                key={entry.row.port}
                entry={entry}
                linkPaths={linkPaths}
                styles={styles}
                theme={theme}
                idleText="not forwarded"
                toggle={{
                  label: entry.forward ? "Stop" : "Forward",
                  disabled: busy,
                  onPress: () => run({ kind: "port", port: entry.row.port, on: !entry.forward }),
                }}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function SshLine({
  label,
  state,
  activeCount,
  styles,
  theme,
}: {
  label: string;
  state: PortsState;
  activeCount: number;
  styles: PopoverStyles;
  theme: PluginTheme;
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
    <View style={styles.stack}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.text}>{label}</Text>
        <Text style={styles.meta}>
          {ssh.target}
          {ssh.auto ? " (auto)" : ""} · {ssh.state}
        </Text>
        <View style={styles.spacer} />
        {activeCount > 0 ? (
          <Text style={styles.meta}>
            {activeCount} forwarded
          </Text>
        ) : null}
      </View>
      {error ? <Text style={styles.danger}>{error}</Text> : null}
    </View>
  );
}

interface WorkspaceCardProps {
  group: WorkspaceGroup;
  busy: boolean;
  run(input: PortAction): void;
  linkPaths: Record<string, string>;
  styles: PopoverStyles;
  theme: PluginTheme;
}

function WorkspaceCard({ group, busy, run, linkPaths, styles, theme }: WorkspaceCardProps) {
  const { workspace, followed, ports } = group;
  return (
    <View style={[styles.card, followed && styles.cardFollowed]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitles}>
          <Text style={styles.eyebrow} numberOfLines={1}>
            {workspace.project}
          </Text>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {workspace.title}
          </Text>
          <View style={styles.row}>
            {workspace.branch ? (
              <Text style={styles.branch} numberOfLines={1}>
                ⎇ {workspace.branch}
              </Text>
            ) : null}
            <Text style={styles.tag}>{WORKSPACE_KIND_LABEL[workspace.kind]}</Text>
          </View>
        </View>
        <SmallButton
          styles={styles}
          primary={!followed}
          disabled={busy}
          label={followed ? "Stop" : "Forward"}
          onPress={() => run({ kind: followed ? "unfollow" : "follow", workspaceId: workspace.id })}
        />
      </View>
      {ports.length === 0 ? (
        <Text style={styles.meta}>Waiting for its dev servers to listen…</Text>
      ) : (
        ports.map((entry) => (
          <PortRowView
            key={entry.row.port}
            entry={entry}
            linkPaths={linkPaths}
            styles={styles}
            theme={theme}
            idleText={followed ? "connecting…" : "stopped · press Forward to open it here"}
            toggle={null}
          />
        ))
      )}
    </View>
  );
}

interface PortRowViewProps {
  entry: PortEntry;
  linkPaths: Record<string, string>;
  styles: PopoverStyles;
  theme: PluginTheme;
  /** Status line shown when the port has no forward. */
  idleText: string;
  toggle: { label: string; disabled: boolean; onPress(): void } | null;
}

function PortRowView({ entry, linkPaths, styles, theme, idleText, toggle }: PortRowViewProps) {
  const { row, description, forward } = entry;
  const openInBrowser = useRpc(openUrlRpc);
  const active = forward?.status === "active";
  const dot = !forward
    ? theme.colors.border
    : active
      ? theme.colors.statusSuccess
      : forward.status === "opening"
        ? theme.colors.statusWarning
        : theme.colors.statusDanger;
  const url = linkUrl(row.port, description.name, linkPaths);
  const where =
    description.folder === null ? null : description.folder === "" ? "workspace root" : description.folder;
  const command = shortCommand(row.command) || row.process;
  const status = !forward
    ? idleText
    : active
      ? `localhost:${row.port}`
      : forward.status === "opening"
        ? "opening…"
        : null;

  return (
    <View style={styles.portRow}>
      <View style={[styles.dot, styles.portDot, { backgroundColor: dot }]} />
      <View style={styles.portBody}>
        <View style={styles.row}>
          <Text style={styles.portName} numberOfLines={1}>
            {description.name}
          </Text>
          <Text style={styles.tag}>{KIND_LABEL[description.kind]}</Text>
          <View style={styles.spacer} />
          <Text style={styles.portNumber}>:{row.port}</Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {where ? `${where} · ` : ""}
          {command}
        </Text>
        {forward?.error ? (
          <Text style={styles.danger}>{forward.error}</Text>
        ) : status ? (
          <Text style={active ? styles.ok : styles.meta}>{status}</Text>
        ) : null}
      </View>
      <View style={styles.portActions}>
        {active ? <SmallButton
            styles={styles}
            label="Open ↗"
            onPress={() => void openInBrowser({ url }).catch(() => openExternalUrl(url))}
          /> : null}
        {toggle ? (
          <SmallButton
            styles={styles}
            primary={!forward}
            disabled={toggle.disabled}
            label={toggle.label}
            onPress={toggle.onPress}
          />
        ) : null}
      </View>
    </View>
  );
}

function Notice({
  title,
  body,
  action,
  styles,
}: {
  title: string;
  body: string;
  action: { label: string; onPress(): void } | null;
  styles: PopoverStyles;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.meta}>{body}</Text>
      {action ? (
        <View style={styles.row}>
          <SmallButton styles={styles} primary label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

function SmallButton({
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
  styles: PopoverStyles;
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
