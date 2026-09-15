# dbeed — Disposal DB fast setup for local development

Pick a DB (postgres, sqlite), start it, get a connection string. Remove it when done.
List active vs total created DBs.

## Architecture (client–server)

- **Server (`cmd/dbeed-server`, `server/`, Go stdlib only):** owns state, engines, lifecycle. Localhost HTTP API with token auth.
- **Client (`src/`, Bun + TS):** `commander` commands + OpenTUI Solid TUI. Starting any client command auto-starts the server (spawn detached, discovery via `~/.local/share/dbeed/server.json`).

Server lifecycle: the client that spawns the server owns it and stops it on
exit (`POST /api/shutdown`, also on SIGINT/SIGTERM) — managed databases keep
running and are rediscovered by the next server. A client that attaches to an
already-running server leaves it alone. API calls retry once after a
re-ensure if the server died mid-command. A SIGKILLed client can't clean up;
its orphaned server is reused by the next command.

## Quick start

```sh
# build server
go build -o dist/dbeed-server ./cmd/dbeed-server

# install client deps / run (repo root is the Bun project)
bun install
export DBEED_SERVER_BIN=$PWD/dist/dbeed-server   # or put dbeed-server on PATH
bun run src/cli.ts create --db sqlite --name demo
bun run src/cli.ts list
bun run src/cli.ts connection demo

# single binaries
go build -o dist/dbeed-server ./cmd/dbeed-server
bun build ./src/cli.ts --compile --outfile ./dist/dbeed
```

Note: the compiled `dbeed` binary reads `bunfig.toml` from the current
directory at startup (standard Bun behavior). Don't run `dist/dbeed` from
inside this repo — the dev `bunfig.toml` preload only resolves with
`node_modules` present. Use `bun run src/cli.ts` here; the compiled binary
works from any other directory (verified: headless commands + TUI).

## Commands

```
dbeed create --db postgres|sqlite --engine native|docker --name N [--port P] [--user U --password P --database D]
dbeed install [db]        # download and install system deps for a db: postgres|sqlite
dbeed list [--active] | dbeed ps | dbeed start|stop|restart <name>
dbeed connection <name> | dbeed info <name> | dbeed logs <name>
dbeed remove <name> [--keep-data]   (alias: rm)
dbeed --tui   # interactive dashboard (also when run with no args)
```

`list` shows all created DBs; footer prints `N active / M total`. `ps` shows running only.
`remove` stops and deletes only instances dbeed created (docker: `docker rm -v -f dbeed-<name>`; native: `pg_ctl stop` + delete `data/<name>` unless `--keep-data`).

## Engines

- `native` (default): sqlite = file `~/.local/share/dbeed/data/<name>/db.sqlite`; postgres = system `initdb` + `pg_ctl` (searched on PATH plus distro locations like `/usr/lib/postgresql/*/bin`).
- Nothing is installed automatically. If postgres binaries are missing, `create` fails and tells you to run `dbeed install postgres` (downloads + installs via the system package manager, attached to your TTY so `sudo` can prompt), or retry with `--engine docker`.
- `docker`: `docker run -d --name dbeed-<name> -p <port>:5432 postgres:16`. SQLite under docker is still a local file.

| OS | Manager | Package |
|----|---------|---------|
| Debian/Ubuntu | apt-get | postgresql |
| Fedora/RHEL | dnf/yum | postgresql-server |
| Arch | pacman | postgresql |
| Alpine | apk | postgresql |
| openSUSE | zypper | postgresql-server |
| macOS | brew | postgresql |

Override data dir with `DBEED_DATA_DIR`, server binary with `DBEED_SERVER_BIN`.

While an operation takes longer than ~250ms (`create`, `start/stop/restart`,
`remove`, `install`, server boot), the CLI shows a thin purple gradient glow
bar on stderr — stdout stays clean for scripting. Install output is piped and
collapsed onto the same loader line instead of scrolling. Silent when piped.

## TUI

Mini overlay, not fullscreen: `dbeed --tui` (or bare `dbeed`) renders a
compact footer on the main screen (OpenTUI `split-footer`, 10 rows) and leaves
scrollback intact. A `block`-font ASCII `DB` logo sits on the left; the CLI
also prints it (rendered with the real ASCIIFont component) on stderr for
every TTY invocation. Shows up to 4 instances + selected connection string.

Keys: `↑/↓` select · `s` start · `t` stop · `d` remove · `r` refresh · `q` quit. Polls API every 3s.
