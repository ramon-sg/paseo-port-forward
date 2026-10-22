---
status: draft
spec: docs/specs/2026-10-22-paseo-port-forward-design.md
---

# paseo-port-forward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A laptop-only Paseo plugin that forwards a remote workspace's dev ports to the
laptop's `localhost` at the same numbers, per followed workspace, with named **Open** links.

**Architecture:**
- **Server (laptop daemon):** one SSH ControlMaster per remote host, a read-only `/proc`
  scan, and a `PortManager` that keeps followed workspaces forwarded and prunes closed
  ports.
- **Client:** lists the remote host's workspaces through `getPaseoClient(serverId)`, sends
  `{id, directory}` to the server with every state request, and computes labels and URLs.
- SSH and scan code is adapted from upstream (MIT).

**Tech Stack:** TypeScript, `@getpaseo/plugin` 0.11.2, React Native (Paseo UI), zod 4,
Vitest, OpenSSH.

**Spec:** `docs/specs/2026-10-22-paseo-port-forward-design.md`

**Upstream source to adapt:** `alessandrocornacchia/paseo-port-forward`. Clone it read-only
to a temp dir; never run its scripts.

## Global Constraints

- Paseo `>=0.11.2`. Only the documented plugin SDK and the daemon's public client API.
- Public repo: code, comments, docs and UI text in English.
- Plugin id `remote-ports` (not upstream's `port-forward`). Display name "Remote ports".
- Local forwards bind `127.0.0.1:<remote port>` only. Never another local port, and never
  a non-loopback address.
- Remote ports below 1024 are never forwarded.
- Nothing is forwarded until the remote `paseo.pid` `serverId` matches the mapped host.
- Settings, host scope:
  - `targets` (serverId → SSH target): default `{}`.
  - `pollSeconds`: default `3`, range 1–60.
  - `ignorePorts`: default `[22]`.
  - `linkPaths` (label → path starting with `/`): default `{}`.
- Linux remotes, macOS/Linux laptop, key or agent SSH only (`BatchMode=yes`).
- LICENSE is MIT, keeping upstream's copyright line next to ours. The README credits
  upstream.
- Creating the GitHub repo, pushing and `paseo plugin install` are checkpoints. Stop and
  ask the owner for each.

## Review Focus

1. **A laptop worktree already holds the port** (same port block as the remote). Expect a
   row error naming the local holder, and the port is not moved. Tests: Task 2 and Task 5.
2. **Sibling workspace directories** (`/w/abastio-1` vs `/w/abastio-10`). A process under
   `-10` must not match `-1`. Test: Task 3.
3. **SSH drops while a workspace is followed.** Expect a reconnect that reapplies the same
   local ports and keeps the workspace followed. Test: Task 5.
4. **A followed workspace is archived** (it no longer appears in the client's list). Expect
   it to be unfollowed and its forwards cancelled. Test: Task 5.
5. **The plugin is disposed or reloaded with active forwards.** Expect every forward
   cancelled and the masters stopped. Test: Task 5. The crash path is a manual check in
   Task 7.

---

## File structure

| File | Responsibility |
| --- | --- |
| `server/ssh.ts` | ControlMaster session, watchdog, `runSsh`, stale-socket sweep (from upstream) |
| `server/scan.ts` + test + `server/fixtures/linux-scan.txt` | Remote scan script and pure `analyzeScan` (from upstream) |
| `server/local-port.ts` + test | Strict same-port check and the local holder description |
| `shared/workspaces.ts` + test | Matching a cwd to a workspace |
| `shared/contracts.ts`, `shared/settings.ts` + test | RPC schemas and settings |
| `server/manager.ts` + test | Hosts, follow and unfollow, forwards, ticks, reconnect, dispose |
| `index.server.ts` | Wires the settings and RPCs to the manager |
| `client/labels.ts` + test | Port label and link URL |
| `client/ports-screen.tsx`, `client/settings-screen.tsx`, `client/styles.ts`, `client/use-port-settings.ts`, `index.client.tsx` | UI |
| `package.json`, `tsconfig.json`, `paseo-plugin.json`, `LICENSE`, `README.md`, `OVERVIEW.md`, `.gitignore` | Package |

---

### Task 1: Scaffold and upstream base

**Files:**
- Create: the package files from the table.
- Copy and adapt from upstream: `server/ssh.ts`, `server/scan.ts`, `server/scan.test.ts`,
  `server/fixtures/linux-scan.txt`.

**Interfaces:**
- Produces:
  - `HostSession` (`start`, `exec`, `forward`, `cancel`, `stop`, `killNow`, `onExit`,
    `running`).
  - `runSsh`, `sweepStaleSockets`, `SCAN_SCRIPT`, `parseScanOutput`, `analyzeScan`.
  - `RemotePort` (`port`, `bind`, `connectHost`, `pid`, `process`, `command`, `agentId`,
    `cwd`). For now it lives in `server/scan.ts`; Task 4 moves it to `shared/contracts.ts`.

- [ ] **Step 1:** Write `package.json`, `tsconfig.json` and `paseo-plugin.json`.
  - `package.json`: name `paseo-port-forward`, `"type": "module"`, scripts
    `typecheck: tsc --noEmit` and `test: vitest run`, upstream's devDependencies with
    `@getpaseo/*` at `0.11.2`, and a `files` list like upstream's.
  - `tsconfig.json`: upstream's, with `noUncheckedIndexedAccess`.
  - `paseo-plugin.json`: id `remote-ports`, name "Remote ports", requirement
    `paseo >=0.11.2`.
- [ ] **Step 2:** Write `LICENSE` (MIT: "Copyright (c) 2026 Alessandro Cornacchia" and
  "Copyright (c) 2026 ramon-sg"), `.gitignore` (`node_modules/`), and a README stub with
  the credit line.
- [ ] **Step 3:** Copy the four upstream files.
  - Change the log prefix `[port-forward]` to `[remote-ports]`.
  - Change the runtime dir to `/tmp/paseo-rp-<uid>`, so it never sweeps upstream's
    sockets.
  - Leave the rest as is.
- [ ] **Step 4:** Run `npm install && npm test && npm run typecheck`.
  Expected: the upstream scan tests pass and typecheck is clean.
- [ ] **Step 5:** Commit: `chore: scaffold remote-ports with upstream ssh and scan`.

### Task 2: Strict same-port check

**Files:** `server/local-port.ts` (replaces upstream's `pickLocalPort`),
`server/local-port.test.ts`.

**Interfaces:**
- Produces:
  - `class LocalPortError extends Error { port: number; holder: string | null }`
  - `ensureLocalPortFree(port, deps?): Promise<void>`. It throws `LocalPortError` when the
    port is below 1024 or busy.
  - `deps = { isFree(port): Promise<boolean>, holder(port): Promise<string | null> }`.
    The defaults are upstream's `isLocalPortFree` and `lsof -nP -iTCP:<port> -sTCP:LISTEN
    -Fpcn` parsed to `"<command> (pid <pid>)"`, or `null` if unreadable.

- [ ] **Step 1: Failing tests.**
  - `free port resolves`.
  - `busy port throws with holder`: message `port 9100 is in use on this Mac by node (pid 42)`,
    `err.port === 9100`, `err.holder === "node (pid 42)"`.
  - `busy port with unknown holder`: message `port 9100 is in use on this Mac`.
  - `privileged port throws`: message `port 80 is below 1024 and is not forwarded`.
  - `parseLsof` on `p42\ncnode\nn127.0.0.1:9100\n` returns `node (pid 42)`.
- [ ] **Step 2:** Run `npx vitest run server/local-port.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Export `parseLsof(output): string | null` for the test.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: forwards keep the remote port number or fail`.

### Task 3: Workspace matching

**Files:** `shared/workspaces.ts`, `shared/workspaces.test.ts`.

**Interfaces:**
- Produces:
  - `type WorkspaceRef = { id: string; directory: string }`
  - `matchWorkspace(cwd: string | null, workspaces: WorkspaceRef[]): string | null`. It
    returns the id of the deepest directory that equals the cwd or is its parent, on a `/`
    boundary, ignoring trailing slashes.

- [ ] **Step 1: Failing tests.**
  - `exact dir matches`.
  - `subdir matches`: `/w/a/apps/storefront` → `a`.
  - `sibling prefix does not match`: `/w/abastio-10/x` against `/w/abastio-1` → `null`.
  - `deepest wins`: `/w` and `/w/a`, cwd `/w/a/x` → `a`.
  - `trailing slash ignored`.
  - `null cwd → null`.
- [ ] **Step 2:** Run `npx vitest run shared/workspaces.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: match remote processes to workspaces by directory`.

### Task 4: Contracts and settings

**Files:** `shared/contracts.ts`, `shared/settings.ts`, `shared/settings.test.ts`. Move
`RemotePort` from `server/scan.ts` to `shared/contracts.ts` (zod schema plus type).

**Interfaces:**
- Consumes: `WorkspaceRef` (Task 3).
- Produces:
  - `PortSettingsSchema` and `portSettings`, settings id `remote-ports`, scope `host`, with
    the defaults from Global Constraints.
  - `linkPaths` values must match `/^\//`.
  - `parsePortList` (from upstream).
  - Types:
    - `SshStatus`: upstream's.
    - `PortRow = RemotePort & { workspaceId: string | null }`.
    - `Forward = { remotePort; connectHost; status: "active" | "error"; error: string | null; workspaceId: string | null }`.
    - `PortsState = { ssh; ports: PortRow[]; forwards: Forward[]; followed: string[]; scannedAt; scanError }`.
  - RPCs, all with `serverId`:
    - `ports.state`: `{ workspaces: WorkspaceRef[] }` → `PortsState`.
    - `ports.follow`: `{ workspaceId }` → `PortsState`.
    - `ports.unfollow`: `{ workspaceId }` → `PortsState`.
    - `ports.forward`: `{ remotePort }` → `Forward`. For ports outside any workspace.
    - `ports.unforward`: `{ remotePort }` → `{ ok }`.
    - `ports.test-connection`: upstream's.
  - There is no `localPort` field: it always equals `remotePort`.

- [ ] **Step 1: Failing tests.**
  - `defaults`: `PortSettingsSchema.parse({})` gives `{ targets: {}, pollSeconds: 3, ignorePorts: [22], linkPaths: {} }`.
  - `linkPaths rejects a path without a leading slash`.
  - `parsePortList("22, 5432 x")` gives `[22, 5432]`.
- [ ] **Step 2:** Run `npx vitest run shared`. Expected: FAIL.
- [ ] **Step 3:** Implement and update `server/scan.ts` imports.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: contracts and settings for followed workspaces`.

### Task 5: PortManager

**Files:** `server/manager.ts`, `server/manager.test.ts`.

**Interfaces:**
- Consumes:
  - `HostSession`, `SCAN_SCRIPT`, `parseScanOutput` and `analyzeScan` (Task 1).
  - `ensureLocalPortFree` (Task 2).
  - `matchWorkspace` (Task 3).
  - Contracts and settings (Task 4).
- Produces:
  - `class PortManager`, built with `new PortManager(deps?)`.
  - `deps = { createSession(serverId, target): SessionLike, ensureLocalPortFree, log, setInterval, clearInterval }`.
  - `SessionLike` is the subset of `HostSession` the manager uses.
  - Methods:
    - `applySettings(s)`
    - `state(serverId, workspaces)`
    - `follow(serverId, workspaceId)`
    - `unfollow(serverId, workspaceId)`
    - `forward(serverId, remotePort)`
    - `unforward(serverId, remotePort)`
    - `testConnection(serverId, target?)`
    - `tick(): Promise<void>`, public so tests can drive it.
    - `dispose()`
    - `killAll()`

**Behavior:**
- **Workspaces:** `state` stores the latest `workspaces` per host. Every scan tags each port
  with `matchWorkspace(port.cwd, workspaces)`.
- **Following:** after each good, verified scan, every port of a followed workspace that is
  not ignored and not already forwarded gets forwarded.
- **Errors:** a `LocalPortError` or ssh refusal becomes a `Forward` with
  `status: "error"`. It is retried on the next tick and never moved to another port.
- **Closed ports:** after a good scan, a forward whose remote port is gone is cancelled.
- **Archived workspaces:** a followed id missing from the latest `workspaces` list is
  unfollowed and its forwards cancelled. This only happens once a `state` call has
  supplied a list.
- **Ticks:** every `pollSeconds` for hosts with followed workspaces or a `state` call in
  the last 10 s.
- **Idle:** a master with nothing followed and no `state` call in 120 s closes.
- **Reconnect and identity:** reconnect with backoff (1 s to 30 s) and the identity check,
  as upstream.

- [ ] **Step 1: Failing tests,** with a fake `SessionLike` that returns scripted scan
  output (built from small fixture strings) and records `forward` and `cancel` calls.
  - `follow forwards every port of the workspace at the same number, skipping ignorePorts`
  - `a port that opens later in a followed workspace is forwarded on the next tick`
  - `a port that closes is cancelled on the next tick`
  - `busy local port yields an error forward and no forward call`. Covers Review Focus 1.
  - `serverId mismatch forwards nothing and reports scanError`
  - `master exit reapplies the same forwards after reconnect and keeps followed`. Covers
    Review Focus 3.
  - `followed workspace missing from the next state list is unfollowed and cancelled`.
    Covers Review Focus 4.
  - `ports outside any workspace are listed with workspaceId null and are not auto-forwarded`
  - `dispose cancels every forward and stops every session`. Covers Review Focus 5.
- [ ] **Step 2:** Run `npx vitest run server/manager.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, adapting upstream's `manager.ts`.
  - Drop `autoForward` and `pickLocalPort`.
  - Add follow state per host (`Set<string>`) and the latest workspaces list.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: port manager follows workspaces with strict ports`.

### Task 6: Server entry, labels and UI

**Files:** `index.server.ts`, `client/labels.ts`, `client/labels.test.ts`, and the client
files from the table.

**Interfaces:**
- Consumes: `PortManager` (Task 5) and contracts (Task 4).
- Produces:
  - `portLabel(row: PortRow, scripts: { scriptName: string; port: number | null; lifecycle: string }[], directory: string | null): string`.
    It applies the spec's order:
    1. the running script name on that port;
    2. the last segment of the cwd relative to the workspace directory;
    3. `row.process`.
  - `linkUrl(port: number, label: string, linkPaths: Record<string, string>): string`
    returns `http://localhost:<port><path>`.

- [ ] **Step 1: Failing label tests.**
  - `running script name wins`.
  - `stopped script is ignored`.
  - `cwd apps/storefront → storefront`.
  - `cwd equal to the workspace dir → process name`.
  - `linkUrl adds the path for admin`: `/dashboard`.
  - `linkUrl without path`.
- [ ] **Step 2:** Run `npx vitest run client/labels.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `labels.ts`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Write `index.server.ts`, upstream's wiring with the new RPCs.
- [ ] **Step 6:** Write `index.client.tsx`.
  - Screen `ports` titled "Remote ports", a sidebar item, a settings screen and a
    command-center item "Open Remote ports".
- [ ] **Step 7:** Write the ports screen.
  - Host picker: the remotes from `useHosts()`, without `host.id`.
  - Every 2 s it calls `getPaseoClient(serverId).workspaces.list()`, then `ports.state`
    with `{ id, directory: workspaceDirectory }`.
  - One card per workspace (title = workspace name or folder basename, branch if any)
    with **Forward** / **Stop**.
  - One row per port: label, port, status or error text, and **Open** through
    `openExternalUrl(linkUrl(...))`.
  - An "Other" card with per-port forward.
- [ ] **Step 8:** Write the settings screen: targets per host with **Test connection**,
  `pollSeconds`, `ignorePorts`, and `linkPaths` as `label=/path` lines.
- [ ] **Step 9:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 10:** Commit: `feat: remote ports screen, settings and server wiring`.

### Task 7: Docs, publish and install (checkpoints)

- [ ] **Step 1:** Write the README: what it does, why the port is the same, setup, how it
  works, limits, credit to upstream. Write `OVERVIEW.md` (Paseo's plugin page). Commit:
  `docs: readme and overview`.
- [ ] **Step 2: CHECKPOINT.** Ask the owner before
  `gh repo create ramon-sg/paseo-port-forward --public --source . --push`.
- [ ] **Step 3: CHECKPOINT.** Ask the owner before
  `paseo plugin install /Users/ramon/Projects/ramon-sg/paseo-port-forward` on the Mac
  daemon.
- [ ] **Step 4: Manual check,** with the owner, against `devbox`:
  1. Set the target `devbox` and run **Test connection**. Expected: ok.
  2. Press ▷ `abastio` on a devbox workspace, then **Forward**. Expected: four rows
     active.
  3. Press **Open** on storefront. Expected: the shop loads and calls the API.
  4. Stop the apps. Expected: the rows drop within 3 s.
  5. `paseo plugin reload remote-ports`. Expected: `pgrep -f paseo-rp-` shows nothing.
