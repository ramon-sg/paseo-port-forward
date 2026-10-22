---
status: draft
plan: docs/plans/2026-10-22-paseo-port-forward.md
---

# paseo-port-forward — design

A Paseo plugin that runs only on the laptop's Paseo daemon and makes the dev servers of a
workspace on a remote Paseo host (a Linux box reached over SSH) open on the laptop's
`http://localhost:<same port>`. Inspired by
[alessandrocornacchia/paseo-port-forward](https://github.com/alessandrocornacchia/paseo-port-forward)
(MIT), which it credits in its README.

## Why

The owner works on a Linux box (`devbox`, reached over Tailscale with an SSH alias) through
the Paseo desktop app on a Mac. Apps started there, with the workspace's ▷ service or with
a dev command in a Paseo terminal, can't be opened from the Mac browser.

Opening them by the box's IP doesn't work for the project this was built for. Each web app
has the API's URL baked in as `http://localhost:<api port>`, and CORS only accepts
`localhost` origins. The browser has to believe it is on `localhost`, with the same port
numbers the remote uses. That means an SSH local forward from the Mac per port, at the
same number.

The constraint that shapes everything: **nothing goes in the project repo and nothing is
installed on the remote.** The whole solution lives in this plugin, on the laptop.

## Goals

- Pick a workspace of a remote host and get all its dev ports on the laptop's localhost,
  at the same numbers, with one action.
- A workspace that is being forwarded is *followed*: ports that open later in it (apps
  start at different times) get forwarded too, and ports that close drop their forward.
- Each forwarded port shows a recognisable name (`storefront`, `admin`, …) and an **Open**
  button that opens its URL in the laptop's browser.
- When a port can't be forwarded at the same number, say so plainly and name what holds it
  locally. Never move it to another port.
- Survive SSH drops (reconnect and reapply) and leave no `ssh` processes, sockets or local
  listeners behind when the plugin stops or crashes.

## Non-goals

- Forwarding everything on every host automatically. The upstream plugin has that mode; it
  collides with the laptop's own worktrees, which use the same port numbers.
- macOS or Windows remotes. Linux remotes only, as upstream.
- Windows laptops (no OpenSSH ControlMaster).
- Password or interactive SSH auth. Key or agent only, `BatchMode=yes`.
- Installing the plugin from the project's setup scripts. Installing it is a manual
  `paseo plugin install` on the laptop.
- Remembering forwards across a daemon restart (see "Builder's calls").

## Anti-goals

- **A forward on a different local port.** It looks like it worked, then the app fails on
  CORS or calls a dead API. Failing loudly is the correct outcome.
- **Anything listening beyond `127.0.0.1` on the laptop.**
- **Forwarding to the wrong machine.** If the SSH target is not the Paseo host it is
  mapped to, nothing is forwarded.
- **Project-specific code.** No Abastio names, ports or paths in the plugin. Anything
  project-shaped comes from settings or from what Paseo reports.

## Constraints

- Paseo `>=0.11.2` (the version in use; plugin SDK `@getpaseo/plugin` 0.11.2, daemon
  0.12.0). Only the documented plugin SDK and the daemon's public client API.
- Public repo `ramon-sg/paseo-port-forward`: code, comments, docs and UI text in English.
- Uses the system `ssh`, so `~/.ssh/config`, the agent and Tailscale routing apply
  unchanged. The remote is reached by an alias (for the owner, `devbox`).
- TypeScript and Vitest, as upstream, so its fixtures and tests carry over
  (`ramon-sg/paseo-github-issues` uses `bun test`; Vitest here is a deliberate call).

## What is decided

### Taken from upstream (same approach, rewritten)

- **Backend on the laptop daemon only.** The client UI is a global screen plus a sidebar
  item. Upstream verified that a laptop-installed plugin can't add a panel to a remote
  workspace, and that its RPC always goes to the laptop daemon.
- **One OpenSSH ControlMaster per remote host**, with `-O forward` / `-O cancel` for each
  port over the master, `ServerAlive*`, `ExitOnForwardFailure=yes`, and a short socket path
  under `/tmp`.
- **A watchdog wrapper** that kills the master when the plugin process's stdin pipe
  closes, plus a sweep of stale sockets on start.
- **Detection by a read-only `sh -s` script over the master.** It reads
  `/proc/net/tcp{,6}` LISTEN sockets, maps inodes to pids through `/proc/<pid>/fd`, and
  keeps processes that descend from the Paseo supervisor in `~/.paseo/paseo.pid`, without
  Paseo's own helpers and the daemon port. All decisions are made laptop-side in a pure,
  unit-tested `analyzeScan`. That covers both ▷ services and commands typed in a Paseo
  terminal. Containers published by Docker are not Paseo descendants and are skipped,
  which is right: the remote apps use them, the laptop doesn't.
- **Host identity check**: the remote `paseo.pid` `serverId` must equal the Paseo host the
  target is mapped to, before any forward.
- **Reconnect with backoff** (1 s to 30 s), reapplying forwards on the same local ports.

### Changed for this use

1. **Strict same port.** A forward binds `127.0.0.1:<remote port>` or fails. On failure,
   the row shows "port 9100 is in use on this Mac" plus the local process name and cwd (from
   `lsof`), when it can be read. Privileged remote ports (<1024) are not forwarded and say
   so.
2. **Per workspace, followed.** The screen groups detected ports by workspace. A process
   belongs to the workspace whose `workspaceDirectory` contains its cwd (deepest match
   wins). Workspaces come from `getPaseoClient(serverId).workspaces.list()`. **Forward** on
   a workspace marks it followed: every port in it is forwarded now and on each later scan.
   **Stop** cancels them all and unfollows. Ports outside any workspace are listed under
   "Other" with per-port forward only.
3. **Names and links.** A port's label is chosen in this order:
   1. the Paseo script name, when the workspace reports a running script on that port;
   2. otherwise the last path segment of the process cwd relative to the workspace
      directory (`apps/storefront` → `storefront`);
   3. otherwise the process name.

   **Open** calls `openExternalUrl("http://localhost:<port><path>")`. `<path>` comes from an
   optional settings map label → path (`admin` → `/dashboard`), empty by default.
4. **Scanning only while useful.** Scan every `pollSeconds` (default 3) while any workspace
   on that host is followed or the screen is open. Otherwise close the master after 2
   minutes idle, as upstream.

### Who knows what (SDK boundary)

Only the client can reach the remote host's API: `useHosts()` and `getPaseoClient(serverId)`
are client-side, and a server handler's `paseo` is the laptop's own daemon. So:

- The client lists the remote host's workspaces (`workspaces.list()`: `id`,
  `workspaceDirectory`, `scripts[]` with `scriptName`, `port`, `lifecycle`). It sends every
  workspace's `id` and `workspaceDirectory` to the server on each state request, not just
  the followed ones, so "deepest match wins" works.
- The server keeps the latest copy. A followed workspace keeps being scanned and forwarded
  while the screen is closed.
- Labels are computed on the client, where the script names are.
- "The screen is open" means the client asked for state within the last few seconds, as
  upstream. Nothing in the SDK pushes it.

### Settings (host scope, as upstream)

- `targets`: Paseo `serverId` → SSH target.
- `pollSeconds`: default 3.
- `ignorePorts`: default `22`.
- `linkPaths`: label → path, default `{}`.

A settings screen with **Test connection**, as upstream.

### The flow it must support

1. The owner presses ▷ on a workspace in `devbox`, or runs the dev command in its terminal.
2. On the Mac, they open **Ports**, see the workspace with its ports appearing, and press
   **Forward**.
3. Rows turn active with their labels. **Open** on `storefront` opens the shop and it talks
   to the forwarded API.
4. They stop the apps on `devbox`. Within one poll the forwards disappear, and the
   workspace stays followed, so starting again forwards again.

## Builder's calls

- Followed workspaces and forwards live in memory. A daemon or plugin restart forgets them,
  and the owner presses **Forward** again. Persisting them is a later step if it turns out
  to be annoying.
- Screen layout, empty and error states, and icons.
- The plugin id: anything but upstream's `port-forward`, so both can be installed.
- Whether to copy upstream files and adapt them, or rewrite. Either way the README credits
  upstream and keeps its MIT notice where code is copied.
- Code structure, error wording, and test layout. The detection parser, the workspace
  matching, the labels and the strict-port choice get unit tests with fixtures.
- Whether a remote workspace can also show a header button that opens this screen. Only if
  the SDK allows it from a laptop-only plugin. Not required.
