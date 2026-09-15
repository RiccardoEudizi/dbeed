# dbeed

```
██████╗  ██████╗
██╔══██╗ ██╔══██╗
██║  ██║ ██████╔╝
██║  ██║ ██╔══██╗
██████╔╝ ██████╔╝
╚═════╝  ╚═════╝
```

**Disposal DBs for local development.** Pick a database, start it, grab the
connection string, throw it away when you're done.

```sh
dbeed create --db postgres --name demo
# created demo (postgres/native) — running
# postgres://postgres:postgres@127.0.0.1:5432/demo?sslmode=disable

dbeed list
# NAME  DB        ENGINE  STATUS   CONNECTION
# demo  postgres  native  running  postgres://postgres:postgres@127.0.0.1:5432/demo?sslmode=disable
# 1 active / 1 total

dbeed remove demo
# removed demo
```

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Connection strings](#connection-strings)
- [Engines](#engines)
- [TUI](#tui)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [HTTP API](#http-api)
- [Project layout](#project-layout)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

## Features

- One command to provision a **throwaway postgres or sqlite** for local dev.
- Prints a ready-to-paste **connection string** on create.
- `list` shows everything ever created; footer shows `N active / M total`; `ps` shows only running.
- `remove` tears down **only** instances dbeed created (container + data dir).
- Native binaries by default, Docker when you want it — per instance.
- Missing postgres binaries? `dbeed install postgres` fetches them via your system package manager. Nothing is ever installed implicitly.
- Mini TUI footer (never fullscreen) with live status, start/stop/remove keys.
- Script-friendly: human output on TTY, clean machine output on stdout, spinners on stderr, silent when piped.

## Requirements

| Need     | Version  | Notes                                       |
|----------|----------|---------------------------------------------|
| Go       | ≥ 1.23   | builds `dbeed-server` (stdlib only, no deps) |
| Bun      | ≥ 1.3    | runs the CLI client + OpenTUI               |
| Docker   | optional | only for `--engine docker`                  |
| Postgres | optional | only for native postgres (`dbeed install postgres` gets it) |

## Install

```sh
git clone <repo> && cd dbeed

# 1. build the server
go build -o dist/dbeed-server ./cmd/dbeed-server

# 2. install client deps
bun install

# 3. point the client at the server binary (or put dbeed-server on PATH)
export DBEED_SERVER_BIN=$PWD/dist/dbeed-server

# 4. run it
bun run src/cli.ts list
```

Single-binary distribution:

```sh
go build -o dist/dbeed-server ./cmd/dbeed-server
bun build ./src/cli.ts --compile --outfile ./dist/dbeed
```

> The compiled `dbeed` reads `bunfig.toml` from the current directory at
> startup (standard Bun behavior). Don't run `dist/dbeed` from inside this
> repo — the dev `bunfig.toml` preload only resolves with `node_modules`
> present. Use `bun run src/cli.ts` here; the compiled binary works from any
> other directory.

## Quick start

```sh
# sqlite: zero dependencies, just a file
dbeed create --db sqlite --name demo
# created demo (sqlite/native) — running
# sqlite:///home/you/.local/share/dbeed/data/demo/db.sqlite

# postgres with defaults (user/password postgres, db = name, port 5432+)
dbeed create --db postgres --name demo
dbeed connection demo     # print just the connection string
dbeed stop demo && dbeed start demo
dbeed logs demo           # server log tail (or docker logs)
dbeed remove demo         # stop + delete container/data + forget it
```

## Commands

```
dbeed create --db postgres|sqlite --engine native|docker --name NAME
    [--port PORT] [--user USER --password PASS --database DB]
dbeed install [postgres|sqlite]   # download + install system deps (explicit only)
dbeed list [--active|-a]          # all created DBs + "N active / M total" footer
dbeed ps                          # running DBs only
dbeed start|stop|restart NAME
dbeed connection NAME             # print only the connection string (stdout-safe)
dbeed info NAME                   # full instance record as JSON
dbeed logs NAME                   # server log tail / docker logs
dbeed remove NAME [--keep-data]   # alias: rm — uninstall what dbeed created
dbeed server                      # show server discovery info (port/pid/token)
dbeed --tui                       # mini TUI (also the default with no args)
```

`create` without `--db`/`--name` prompts interactively. Ports default to
`5432` and auto-bump when taken. `remove` never touches databases it didn't
create.

## Connection strings

- postgres: `postgres://USER:PASS@127.0.0.1:PORT/DB?sslmode=disable`
- sqlite: `sqlite:///absolute/path/to/db.sqlite`

`dbeed connection NAME` prints exactly this and nothing else — safe to capture:

```sh
export DATABASE_URL=$(dbeed connection demo)
```

## Engines

`native` (default) runs real binaries as your user, supervised per instance:

- sqlite → a file under `~/.local/share/dbeed/data/<name>/db.sqlite`.
- postgres → system `initdb` + `pg_ctl` (found on `PATH` plus distro spots
  like `/usr/lib/postgresql/*/bin`). Sockets live inside the instance dir, so
  no root-owned socket paths are needed. A `pg_ctl` failure includes the
  `server.log` tail, and failed provisions clean up after themselves.

`docker` runs `postgres:16` as `dbeed-<name>` (`-p PORT:5432`). SQLite under
docker is still just a local file.

Missing postgres binaries are never fetched implicitly — `create` tells you to
run `dbeed install postgres` (runs attached to your TTY so `sudo` can prompt)
or retry with `--engine docker`:

| OS            | Manager        | Package            |
|---------------|----------------|--------------------|
| Debian/Ubuntu | apt-get        | postgresql         |
| Fedora/RHEL   | dnf / yum      | postgresql-server  |
| Arch          | pacman         | postgresql         |
| Alpine        | apk            | postgresql         |
| openSUSE      | zypper         | postgresql-server  |
| macOS         | brew           | postgresql         |

## TUI

`dbeed` with no args (or `--tui`) opens a **mini overlay, not fullscreen**: a
compact OpenTUI `split-footer` panel on the main screen that leaves your
scrollback intact. ASCII `DB` logo on the left, up to 4 instances with live
status, selected connection string, all polling every 3s.

`↑/↓` select · `c` create · `s` start · `t` stop · `d` remove · `r` refresh · `q` quit

`c` opens a small borderless step-by-step modal (db → engine → name; sqlite
skips engine). `↑/↓` choose · `enter` next · `esc` cancel.

## How it works

```
dbeed (Bun: commander + @opentui/solid)
  │  ensures dbeed-server is up (spawns detached if needed)
  ▼
dbeed-server (Go, stdlib only) — 127.0.0.1:random-port, token auth
  │  engines: native pg/sqlite, docker pg · state: state.json
  ▼
postgres (pg_ctl / docker) · sqlite files
```

- **Server lifecycle:** whoever spawns the server owns it and stops it on exit
  (`POST /api/shutdown`, also on SIGINT/SIGTERM). Managed databases keep
  running and are rediscovered by the next server. A client that attaches to
  an already-running server leaves it alone. API calls retry once after a
  re-ensure if the server died mid-command.
- **CLI feedback:** operations slower than ~250ms show a thin purple gradient
  loader on stderr; install output is piped and collapsed onto the same line.
  Stdout stays script-clean; everything is silent when piped.

## Configuration

| Variable           | Default                              | Meaning                              |
|--------------------|--------------------------------------|--------------------------------------|
| `DBEED_DATA_DIR`   | `~/.local/share/dbeed` (`$XDG_DATA_HOME/dbeed`) | state, instance data, server.json |
| `DBEED_SERVER_BIN` | searched next to binary, `dist/`, `PATH` | `dbeed-server` executable         |
| `DBEED_PORT`       | `0` (random)                         | server listen port (server-side)     |

Layout of the data dir: `state.json` (instances, passwords in plaintext —
local dev only), `server.json` (port/pid/token — never commit),
`server.log`, `data/<name>/`.

## HTTP API

All but `/healthz` require the `X-Dbeed-Token` header.

```
GET    /healthz
GET    /api/deps                        # { postgres: {installed,…}, docker: {…} }
GET    /api/instances                   # all, with live status
POST   /api/instances                   # {db, engine, name, port?, user?, password?, database?}
GET    /api/instances/:name
GET    /api/instances/:name/connection
GET    /api/instances/:name/logs
POST   /api/instances/:name/start|stop|restart
DELETE /api/instances/:name[?keepData=true]
GET    /events                          # SSE status stream (TUI polling uses plain GET)
POST   /api/shutdown                    # stop the server, keep the databases
```

## Project layout

```
cmd/dbeed-server/   server entrypoint
server/             Go server: api, store, engines (native/docker), deps, paths
src/cli.ts          commander commands (thin HTTP client)
src/tui.tsx         mini footer TUI (@opentui/solid)
src/api.ts          typed API client + retry
src/ensure-server.ts spawn/discover/ownership
src/loader.ts       stderr gradient loader + log collapsing
src/logo.tsx        ASCII DB logo (real ASCIIFont render)
```

## Development

```sh
go vet ./... && go test ./...     # server unit tests (fake-bin engine tests)
bunx tsc --noEmit                 # client typecheck
```

## Troubleshooting

- **`postgres binaries not found`** → `dbeed install postgres`, or `--engine docker`.
- **`pg_ctl start failed`** → the error now includes the `server.log` tail; full log at `~/.local/share/dbeed/data/<name>/server.log`. Common cause (fixed): socket dir permissions — sockets now live in the instance dir.
- **`initdb refuses root`** → run as a normal user or use `--engine docker`.
- **Port taken** → dbeed auto-bumps from the requested port; pass `--port` to choose.
- **Orphaned server** (killed -9 client) → harmless, reused by the next command; kill `dbeed-server` manually to drop it.
- **Compiled binary says `preload not found`** → you're running `dist/dbeed` from inside this repo; run it elsewhere or use `bun run src/cli.ts`.

## Roadmap

More databases (mysql, redis, mongo), `dbeed exec/psql` shell, idle server timeout, versioned postgres selection.
