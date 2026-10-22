# paseo-port-forward

A [Paseo](https://paseo.sh) plugin that makes the dev servers of a workspace on a remote
Paseo host open on your laptop's `http://localhost:<port>`, at **the same port numbers**,
over your own SSH connection.

Based on [alessandrocornacchia/paseo-port-forward](https://github.com/alessandrocornacchia/paseo-port-forward)
(MIT), which forwards ports host-wide. This one works per workspace and never moves a port.

## Why the same port

Many web apps bake their API URL and CORS origins in as `http://localhost:<port>`. If a
forward lands on another local port, the page loads and then fails to reach the API. So a
forward here binds `127.0.0.1:<remote port>` or fails with a clear message that says what is
holding the port on your laptop.

## Setup

1. Install it on the **laptop** daemon only:
   ```bash
   paseo plugin install /path/to/paseo-port-forward
   ```
2. Nothing to configure if `ssh <host name in Paseo>` or an alias in `~/.ssh/config`
   reaches the remote: the plugin tries them and keeps the one whose Paseo host matches.
   Otherwise set its SSH target (`user@host` or an alias) in Settings → Plugins →
   **Remote ports**, where **Test connection** checks it.
3. Start a workspace's dev servers on the remote (its ▷ service, or a command in a Paseo
   terminal). Its ports open on this machine by themselves. Click the **Remote ports** icon
   in the sidebar (it shows how many are forwarded): a popover opens over the current
   workspace. **Open** a port in Chrome, or **Stop** a workspace to free its ports.

Nothing is installed on the remote, and the project repo needs no changes.

Settings → Plugins → **Remote ports**:
- **SSH targets** (optional, found automatically), each with **Test connection**.
- **Forward automatically:** default on. Off, a workspace forwards only after **Forward**.
- **Open links in:** Google Chrome (default) or the default browser.
- **Ignored ports:** default `22`.
- **Scan interval:** default 3 s.
- **Open link paths:** `label=/path` pairs added to Open links, such as
  `admin=/dashboard, vendor=/seller`.

## How it works

- **SSH target:** the one in settings; else the host's name in Paseo or a `~/.ssh/config`
  alias, tried in parallel, whichever reaches a machine with that Paseo serverId.
- **Connection:** one OpenSSH ControlMaster per remote host, with your keys, agent and
  `~/.ssh/config`, and `BatchMode=yes`.
- **Detection:** a read-only script over that connection reads `/proc/net/tcp{,6}` and
  `docker ps`. It keeps:
  - sockets owned by processes that descend from the remote Paseo daemon (agents, terminals
    and services);
  - sockets of processes started outside Paseo (an ssh shell, tmux) whose working directory
    is inside a workspace;
  - ports that Docker Compose publishes for a project whose working directory is inside a
    workspace (named after the compose service, e.g. `rustfs`). Containers from other
    folders are skipped.
- **Grouping:** the popover lists the remote host's workspaces through Paseo, each with its
  project, branch and ports. Each port belongs to the workspace whose directory contains
  its process's working directory.
- **Following:** every workspace with a listening port is followed automatically (or after
  **Forward**, with that setting off): its ports are forwarded now, and the ones that open
  later. Ports that close lose their forward. **Stop** cancels them all and keeps that
  workspace stopped until **Forward**. A workspace that is archived is dropped. Two
  workspaces on the same port can't both have it: the first one keeps it, the other shows
  the port as in use.
- **Background:** the sidebar item polls each online remote host every 5 s, so forwarding
  runs with the popover closed.
- **Labels:** the running Paseo service or script on that port; else the app folder
  (`apps/storefront` → `storefront`); else the process name. Each port also shows its
  kind, its folder in the workspace and a short form of its command.
- **Reconnects** with backoff and reapplies the same ports.
- **Cleanup:** a watchdog kills the SSH master if the plugin process dies, and stale control
  sockets are swept on start.

Paseo plugins belong to the daemon they are installed on, so a laptop plugin can't add
UI inside a remote workspace. The sidebar popover is the closest place to it.

Followed workspaces live in memory: after a daemon restart, press **Forward** again.

## Requirements and limits

- Paseo `>=0.11.2`.
- A macOS or Linux laptop, and Linux remotes.
- Key- or agent-based SSH. Password prompts fail with an error.
- Remote ports below 1024 are not forwarded.

## Development

```bash
npm install
npm test
npm run typecheck
```

## License

MIT. See [LICENSE](LICENSE).
