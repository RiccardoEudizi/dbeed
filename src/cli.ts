#!/usr/bin/env bun
import { Command } from "commander";
import { ensureServer, serverOwned } from "./ensure-server";
import { forwardLines, withLoader } from "./loader";
import { printLogo } from "./logo";
import {
  listInstances,
  createInstance,
  startInstance,
  stopInstance,
  restartInstance,
  removeInstance,
  getConnection,
  getInstance,
  getLogs,
  getDeps,
  loadServerInfo,
  shutdownServer,
} from "./api";

const program = new Command();
program.name("dbeed").description("Disposal DB fast setup for local development").version("0.1.0");

async function withServer<T>(fn: () => Promise<T>): Promise<T> {
  await ensureServer();
  return fn();
}

function table(rows: string[][]) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  for (const r of rows) console.log(r.map((c, i) => (c ?? "").padEnd(widths[i])).join("  "));
}

program
  .command("create")
  .description("create and start a disposable DB")
  .option("--db <db>", "postgres|sqlite")
  .option("--engine <engine>", "native|docker (default native)", "native")
  .option("--name <name>")
  .option("--port <port>")
  .option("--user <user>")
  .option("--password <password>")
  .option("--database <database>")
  .action(async (opts) => {
    let { db, engine, name, port, user, password, database } = opts;
    if (!db || !name) {
      // interactive fallback via readline
      const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
      if (!db) db = (await rl.question("db (postgres|sqlite) [postgres]: ")) || "postgres";
      if (!name) name = await rl.question("name: ");
      if (!name) {
        console.error("name required");
        process.exit(1);
      }
      rl.close();
    }
    const inst = await withLoader(`Creating ${db} instance "${name}"…`, () =>
      withServer(() =>
        createInstance({ db, engine, name, port: port ? Number(port) : undefined, user, password, database }),
      ),
    );
    console.log(`created ${inst.name} (${inst.db}/${inst.engine}) — ${inst.status}`);
    console.log(inst.connection);
  });

// runPostgresInstall executes the system package install for postgres
// binaries (attached to the TTY so sudo can prompt) and re-checks deps.
async function runPostgresInstall(installCommand: string | undefined, hint: string | undefined): Promise<boolean> {
  if (!installCommand) {
    console.error(`error: postgres binaries not found. ${hint ?? "Install PostgreSQL manually or retry with --engine docker."}`);
    return false;
  }
  console.log(`Installing PostgreSQL via: ${installCommand}`);
  // async spawn (not spawnSync) so the loader animates during the install.
  // Child output is piped and collapsed onto the loader line; stdin stays
  // attached to the TTY so sudo can prompt (it reads /dev/tty directly).
  const stdin = process.stdin.isTTY ? ("inherit" as const) : ("ignore" as const);
  const code = await withLoader(
    "Installing PostgreSQL",
    async (ctl) => {
      const proc = Bun.spawn(["sh", "-c", installCommand], {
        stdin,
        stdout: "pipe",
        stderr: "pipe",
      });
      await Promise.all([
        forwardLines(proc.stdout, (line) => ctl.status(line)),
        forwardLines(proc.stderr, (line) => ctl.status(line)),
        proc.exited,
      ]);
      return proc.exitCode;
    },
    { immediate: true },
  );
  if (code !== 0) {
    console.error(`install failed (exit ${code}). Install PostgreSQL manually or retry with --engine docker.`);
    return false;
  }
  const deps = await withServer(() => getDeps());
  if (!deps.postgres.installed) {
    console.error("install ran but postgres binaries are still not found. Install manually or retry with --engine docker.");
    return false;
  }
  return true;
}

program
  .command("install [db]")
  .description("download and install system dependencies for a db (postgres|sqlite)")
  .action(async (db?: string) => {
    const target = (db ?? "postgres").toLowerCase();
    if (target !== "postgres" && target !== "sqlite") {
      console.error(`error: unsupported db ${JSON.stringify(db)} (install supports: postgres|sqlite)`);
      process.exit(1);
    }
    if (target === "sqlite") {
      console.log("sqlite needs no system install — databases are local files.");
      return;
    }
    const deps = await withServer(() => getDeps());
    if (deps.postgres.installed) {
      console.log("postgres binaries already installed:");
      for (const [k, v] of Object.entries(deps.postgres.binaries ?? {})) console.log(`  ${k}: ${v}`);
      return;
    }
    const ok = await runPostgresInstall(deps.postgres.installCommand, deps.postgres.hint);
    if (!ok) process.exit(1);
    console.log("postgres binaries installed.");
  });

program
  .command("list")
  .description("list all created DBs")
  .option("-a, --active", "only active")
  .action(async (opts) => {
    const list = await withServer(() => listInstances());
    const rows = list.filter((i) => (opts.active ? i.status === "running" : true));
    if (rows.length === 0) {
      console.log(opts.active ? "no active DBs" : "no DBs yet");
      return;
    }
    table([["NAME", "DB", "ENGINE", "STATUS", "CONNECTION"], ...rows.map((i) => [i.name, i.db, i.engine, i.status, i.connection])]);
    const active = list.filter((i) => i.status === "running").length;
    console.error(`${active} active / ${list.length} total`);
  });

program.command("ps").description("list active DBs").action(async () => {
  const list = await withServer(() => listInstances());
  const rows = list.filter((i) => i.status === "running");
  if (rows.length === 0) {
    console.log("no active DBs");
    return;
  }
  table([["NAME", "DB", "ENGINE", "STATUS", "CONNECTION"], ...rows.map((i) => [i.name, i.db, i.engine, i.status, i.connection])]);
});

for (const name of ["start", "stop", "restart"] as const) {
  program
    .command(`${name} <name>`)
    .description(`${name} a DB`)
    .action(async (n: string) => {
      const fn = name === "start" ? startInstance : name === "stop" ? stopInstance : restartInstance;
      const past = name === "start" ? "started" : name === "stop" ? "stopped" : "restarted";
      const doing = name === "start" ? "Starting" : name === "stop" ? "Stopping" : "Restarting";
      const inst = await withLoader(`${doing} ${n}…`, () => withServer(() => fn(n)));
      console.log(`${past} ${inst.name} — ${inst.status}`);
    });
}

program
  .command("connection <name>")
  .description("print connection string")
  .action(async (n: string) => {
    const c = await withServer(() => getConnection(n));
    console.log(c.connection);
  });

program
  .command("info <name>")
  .description("show instance details")
  .action(async (n: string) => {
    const i = await withServer(() => getInstance(n));
    console.log(JSON.stringify(i, null, 2));
  });

program
  .command("logs <name>")
  .description("show logs")
  .action(async (n: string) => {
    const l = await withServer(() => getLogs(n));
    process.stdout.write(l.logs || "(no logs)\n");
  });

program
  .command("remove <name>")
  .alias("rm")
  .description("uninstall a DB created through dbeed")
  .option("--keep-data", "keep data dir")
  .option("-f, --force", "no confirmation (default non-interactive anyway)")
  .action(async (n: string, opts: { keepData?: boolean }) => {
    await withLoader(`Removing ${n}…`, () => withServer(() => removeInstance(n, !!opts.keepData)));
    console.log(`removed ${n}`);
  });

program
  .command("server")
  .description("server status")
  .action(async () => {
    const info = await withServer(async () => loadServerInfo());
    console.log(JSON.stringify(info, null, 2));
  });

program.option("--tui", "launch interactive TUI");

// Stop the server on exit, but only if this process spawned it — attached
// clients leave a shared server alone. Managed DBs keep running; the next
// server rediscovers them via state.json.
let exiting = false;
async function stopOwnedServer() {
  if (exiting || !serverOwned()) return;
  exiting = true;
  try {
    await Promise.race([shutdownServer(), new Promise((r) => setTimeout(r, 2000))]);
  } catch {}
}
process.on("SIGINT", () => void stopOwnedServer().then(() => process.exit(130)));
process.on("SIGTERM", () => void stopOwnedServer().then(() => process.exit(143)));

// bare `dbeed` (no subcommand) -> TUI; otherwise commander
const raw = process.argv.slice(2);
if (raw.length === 0 || (raw.length === 1 && raw[0] === "--tui")) {
  await ensureServer();
  const { runTui } = await import("./tui");
  await runTui(serverOwned());
} else if (raw.includes("--tui")) {
  await ensureServer();
  const { runTui } = await import("./tui");
  await runTui(serverOwned());
} else {
  await printLogo();
  try {
    await program.parseAsync(process.argv);
  } catch (e: any) {
    console.error(`error: ${e?.message ?? e}`);
    await stopOwnedServer();
    process.exit(1);
  }
  await stopOwnedServer();
}
