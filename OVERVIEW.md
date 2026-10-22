# Remote ports

Open a remote workspace's dev servers on this machine's `localhost`, at the same port
numbers, over your own SSH connection.

- **Forward** a workspace: its ports are forwarded now and as they open; closed ones drop.
- **Open** each app by name (`storefront`, `admin`, …).
- A busy local port is reported, never moved to another number.
- Runs only on this machine's daemon; nothing is installed on the remote.
