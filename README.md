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
- Fullscreen `dbm` explorer: databases → tables → schema *and* row data,
  with mouse-click focus and an Opencode-style neutral theme.
- Optional local web UI (`dbeed web`): manage instances, browse schema/rows and
  run ad-hoc SQL with a CodeMirror editor and result grid.
- Script-friendly: human output on TTY, clean machine output on stdout, spinners on stderr, silent when piped.

## Requirements

| Need     | Version  | Notes                                       |
|----------|----------|---------------------------------------------|
| Go       | ≥ 1.23   | builds `dbeed-server` (stdlib only, no deps) |
| Bun      | ≥ 1.3    | runs the CLI client + OpenTUI               |
| Node     | ≥ 24     | runs the optional web UI (SolidStart v2)     |
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
dbeed uninstall [postgres|sqlite] # remove system package (mirror of install)
dbeed purge [--keep-data] [-f]    # uninstall dbeed itself (see below)
dbeed server                      # show server discovery info (port/pid/token)
dbeed dbm [name]                  # fullscreen schema + data explorer
dbeed web [--port 3000] [--open]  # local web UI (with SQL editor)
dbeed --tui                       # mini TUI (also the default with no args)
```

`create` without `--db`/`--name` prompts interactively (db, engine unless
sqlite or `--engine` given, name). Ports default to `5432` and auto-bump when
taken. `remove` never touches databases it didn't create.

## Uninstalling

- `dbeed uninstall postgres` removes the system postgres package (mirror of
  `install`). Refuses while dbeed native postgres instances exist — remove
  them first or pass `--force` (stops them, keeps their data for reinstall).
  Docker instances are unaffected. `uninstall sqlite` is a no-op.
- `dbeed purge` uninstalls dbeed itself: confirms (unless `-f`), removes every
  instance, stops the server, deletes the data dir, then prints the manual
  leftovers (both binaries, system postgres, pulled images). `--keep-data`
  stops instances but keeps `data/` + `state.json` for later rediscovery.

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

### dbm explorer

`dbeed dbm [name]` opens a **fullscreen** three-pane explorer: databases on
the left, tables in the middle, detail on the right. Panes focus with `h/l`
(or mouse click); the focused pane gets the bright border. Sidebars are dark,
the detail pane uses a stone background.

`tab`/`v` toggles the detail pane between two views:

- **schema** — columns (PKs starred), row counts with `C`/`R`, relations.
- **data** — live paged rows (100/page): column headers, `NULL` rendering,
  horizontal column window + row cursor.

Keys: `j/k` rows · `h/l` focus (columns while the grid is focused) ·
`enter` drill in · `/` filter · `n/p` next/prev page · `esc` back to tables ·
`s/t/d` start/stop/remove instance · `r` refresh · `q` quit.

## Web UI

`dbeed web` starts a SolidStart v2 app on `127.0.0.1:3000` (`--port` to change,
`--open` to launch a browser):

```sh
dbeed web
# dbeed web → http://127.0.0.1:3000
```

- **Dashboard** — every instance with live status, connection string (copy),
  start/stop/restart/remove, logs and dependency hints.
- **Explorer** — tables sidebar, paged row data (100/page, `NULL` rendered
  distinctly, click a cell for its full value) and a schema view with columns,
  primary keys, defaults and relations. Row counts are opt-in.
- **Query editor** — CodeMirror 6 with SQL highlighting/autocomplete,
  `⌘/Ctrl+Enter` to run, a configurable row cap (100–1000), CSV export,
  per-instance history (localStorage) and inline database errors.

The browser never talks to the Go server directly. SolidStart API routes act
as a local BFF: they read `server.json` from the dbeed data dir and forward
requests over the unix socket with the `X-Dbeed-Token` header. No extra TCP
port is opened, the token never reaches the browser, and the Vite server binds
to `127.0.0.1` only.

Queries run one statement at a time through the `psql` / `sqlite3` CLIs, with
a default cap of 200 rows (max 1000, `truncated` is reported when hit).
Postgres statements run with `ON_ERROR_STOP=1`; database errors are surfaced
verbatim in the result pane.

### Developing the web UI

```sh
cd web
bun install          # first run
bun run dev          # http://127.0.0.1:3000 (ensures dbeed-server itself)
bunx tsc --noEmit
bun run build        # Nitro output in web/.output
bun run start        # http://127.0.0.1:3000 (HOST pinned to loopback)
```

Use `DBEED_WEB_DIR` if the web directory lives outside the repo when running
`dbeed web`.

## How it works

```
dbeed (Bun: commander + @opentui/solid)
  │  ensures dbeed-server is up (spawns detached if needed)
  ▼
dbeed-server (Go, stdlib only) — unix socket + token auth
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
- **Web UI:** SolidStart renders the app and proxies `/api/dbeed/*` over the
  same unix socket. The Go server never opens a TCP port; the token stays in
  `server.json` and is read by the BFF.

## Configuration

| Variable           | Default                              | Meaning                              |
|--------------------|--------------------------------------|--------------------------------------|
| `DBEED_DATA_DIR`   | `~/.local/share/dbeed` (`$XDG_DATA_HOME/dbeed`) | state, instance data, server.json |
| `DBEED_SERVER_BIN` | searched next to binary, `dist/`, `PATH` | `dbeed-server` executable         |
| `DBEED_WEB_DIR`    | auto-detected from repo/cwd         | location of the `web/` app for `dbeed web` |

Layout of the data dir: `state.json` (instances, passwords in plaintext —
local dev only), `server.json` (socket/pid/token — never commit),
`server.log`, `data/<name>/`, `dbeed.sock`.

## HTTP API (over unix socket)

All but `/healthz` require the `X-Dbeed-Token` header. Clients connect via the
unix socket at `~/.local/share/dbeed/dbeed.sock`.

```
GET    /healthz
GET    /api/deps                        # { postgres: {installed,…}, docker: {…} }
GET    /api/instances                   # all, with live status
POST   /api/instances                   # {db, engine, name, port?, user?, password?, database?}
GET    /api/instances/:name
GET    /api/instances/:name/connection
GET    /api/instances/:name/logs
GET    /api/instances/:name/schema[?counts=true]   # tables, columns, PKs, relations
GET    /api/instances/:name/rows?table=T&limit=N&offset=M  # paged row data (NULL-aware)
POST   /api/instances/:name/query                  # {sql, limit?} → columns/rows/command
POST   /api/instances/:name/start|stop|restart
DELETE /api/instances/:name[?keepData=true]
GET    /events                          # SSE status stream (TUI polling uses plain GET)
POST   /api/shutdown                    # stop the server, keep the databases
```

## Project layout

```
cmd/dbeed-server/   server entrypoint
server/             Go server: api, store, engines (native/docker), deps, paths,
                    schema (introspection), rows (paged table data), query
src/cli.ts          commander commands (thin HTTP client)
src/tui.tsx         mini footer TUI (@opentui/solid)
src/dbm-tui.tsx     fullscreen dbm explorer: schema + data views (@opentui/solid)
src/api.ts          typed API client + retry
src/ensure-server.ts spawn/discover/ownership
src/loader.ts       stderr gradient loader + log collapsing
src/logo.tsx        ASCII DB logo (real ASCIIFont render)
web/                SolidStart v2 web UI (Solid, Tailwind, Kobalte, CodeMirror)
```

## Development

```sh
go vet ./... && go test ./...     # server unit tests (fake-bin engine tests)
bunx tsc --noEmit                 # CLI typecheck
cd web && bunx tsc --noEmit       # web typecheck
cd web && bun run build           # production web build
```

## Troubleshooting

- **`postgres binaries not found`** → `dbeed install postgres`, or `--engine docker`.
- **`pg_ctl start failed`** → the error now includes the `server.log` tail; full log at `~/.local/share/dbeed/data/<name>/server.log`. Common cause (fixed): socket dir permissions — sockets now live in the instance dir.
- **`initdb refuses root`** → run as a normal user or use `--engine docker`.
- **Port taken** → dbeed auto-bumps from the requested port; pass `--port` to choose.
- **Orphaned server** (killed -9 client) → harmless, reused by the next command; kill `dbeed-server` manually to drop it.
- **New endpoint 404s (e.g. `/rows`) after a server change** → the TUI talks
  to the prebuilt `dist/dbeed-server`: rebuild it
  (`go build -o dist/dbeed-server ./cmd/dbeed-server`) and restart the
  server (kill `dbeed-server`; the next command respawns it). The `compile`
  script only bundles the TS CLI, never the Go server.
- **Compiled binary says `preload not found`** → you're running `dist/dbeed` from inside this repo; run it elsewhere or use `bun run src/cli.ts`.

## Roadmap

More databases (mysql, redis, mongo), `dbeed exec/psql` shell, idle server timeout, versioned postgres selection.
