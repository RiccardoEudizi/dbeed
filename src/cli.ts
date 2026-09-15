#!/usr/bin/env bun
import { Command } from "commander";
import fs from "node:fs";
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
  dataDir,
  loadServerInfo,
  shutdownServer,
  type Instance,
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
      // Interactive fallback. Bun's readline/promises can stall on the 2nd+
      // question with piped stdin, so pipes are slurped upfront instead.
      const piped = process.stdin.isTTY ? [] : fs.readFileSync(0, "utf8").split(/\r?\n/);
      let li = 0;
      const rlBox: { current: { question: (q: string) => Promise<string>; close: () => void } | null } = { current: null };
      const ask = async (q: string): Promise<string> => {
        if (li < piped.length) {
          const a = piped[li++];
          process.stdout.write(`${q}${a}\n`);
          return a;
        }
        if (!process.stdin.isTTY) {
          process.stdout.write(`${q}\n`);
          return "";
        }
        if (!rlBox.current) {
          rlBox.current = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
        }
        return rlBox.current.question(q);
      };
      try {
        if (!db) db = (await ask("db (postgres|sqlite) [postgres]: ")) || "postgres";
        if (db !== "sqlite" && !process.argv.includes("--engine")) {
          for (;;) {
            const ans = ((await ask("engine (native|docker) [native]: ")) || "native").toLowerCase();
            if (ans === "native" || ans === "docker") {
              engine = ans;
              break;
            }
            console.log("engine must be native or docker");
          }
        }
        if (!name) name = await ask("name: ");
      } finally {
        if (rlBox.current) rlBox.current.close();
      }
      if (!name) {
        console.error("name required");
        process.exit(1);
      }
    }
    const inst = await withLoader(`Creating ${db} instance "${name}"…`, () =>
      withServer(() =>
        createInstance({ db, engine, name, port: port ? Number(port) : undefined, user, password, database }),
      ),
    );
    console.log(`created ${inst.name} (${inst.db}/${inst.engine}) — ${inst.status}`);
    console.log(inst.connection);
  });

// runSystemCommand runs a shell command with inherited stdin (so sudo can
// prompt on a TTY) while stdout/stderr are piped and collapsed onto the
// purple loader line. Returns the exit code.
async function runSystemCommand(label: string, command: string): Promise<number> {
  const stdin = process.stdin.isTTY ? ("inherit" as const) : ("ignore" as const);
  return withLoader(
    label,
    async (ctl) => {
      const proc = Bun.spawn(["sh", "-c", command], {
        stdin,
        stdout: "pipe",
        stderr: "pipe",
      });
      await Promise.all([
        forwardLines(proc.stdout, (line) => ctl.status(line)),
        forwardLines(proc.stderr, (line) => ctl.status(line)),
      ]);
      return proc.exited;
    },
    { immediate: true },
  );
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(question)).trim().toLowerCase();
  rl.close();
  return ans === "y" || ans === "yes";
}

// runPostgresInstall executes the system package install for postgres
// binaries (attached to the TTY so sudo can prompt) and re-checks deps.
async function runPostgresInstall(installCommand: string | undefined, hint: string | undefined): Promise<boolean> {
  if (!installCommand) {
    console.error(`error: postgres binaries not found. ${hint ?? "Install PostgreSQL manually or retry with --engine docker."}`);
    return false;
  }
  console.log(`Installing PostgreSQL via: ${installCommand}`);
  const code = await runSystemCommand("Installing PostgreSQL", installCommand);
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
  .command("uninstall [db]")
  .description("uninstall system dependencies for a db (mirror of install)")
  .option("-f, --force", "stop dbeed native postgres instances first instead of refusing")
  .action(async (db?: string, opts?: { force?: boolean }) => {
    const target = (db ?? "postgres").toLowerCase();
    if (target !== "postgres" && target !== "sqlite") {
      console.error(`error: unsupported db ${JSON.stringify(db)} (uninstall supports: postgres|sqlite)`);
      process.exit(1);
    }
    if (target === "sqlite") {
      console.log("sqlite has no system install — nothing to uninstall.");
      return;
    }
    const deps = await withServer(() => getDeps());
    if (!deps.postgres.installed) {
      console.log("postgres is not installed (nothing to do).");
      return;
    }
    if (!deps.postgres.uninstallCommand) {
      console.error(`error: no supported package manager detected. Remove the ${deps.postgres.package ?? "postgresql"} package manually.`);
      process.exit(1);
    }
    const list = await withServer(() => listInstances());
    const nativePg = list.filter((i) => i.db === "postgres" && i.engine === "native");
    if (nativePg.length > 0 && !opts?.force) {
      console.error(
        `refusing: ${nativePg.length} dbeed native postgres instance(s) still exist (${nativePg.map((i) => i.name).join(", ")}). ` +
          `Remove them first, or re-run with --force to stop them and continue.`,
      );
      process.exit(1);
    }
    for (const inst of nativePg) {
      try {
        await withServer(() => stopInstance(inst.name));
        console.log(`stopped ${inst.name}`);
      } catch (e: any) {
        console.error(`warning: could not stop ${inst.name}: ${e.message}`);
      }
    }
    const dockers = list.filter((i) => i.db === "postgres" && i.engine === "docker" && i.status === "running");
    if (dockers.length > 0) {
      console.log(`note: ${dockers.length} docker instance(s) keep running (unaffected by system uninstall).`);
    }
    console.log(`Uninstalling PostgreSQL via: ${deps.postgres.uninstallCommand}`);
    const code = await runSystemCommand("Uninstalling PostgreSQL", deps.postgres.uninstallCommand);
    if (code !== 0) {
      console.error(`uninstall failed (exit ${code}). Remove the package manually.`);
      process.exit(1);
    }
    const after = await withServer(() => getDeps());
    if (after.postgres.installed) {
      console.error("package removed but postgres binaries are still on PATH (another installation?).");
      process.exit(1);
    }
    console.log("postgres uninstalled.");
  });

program
  .command("purge")
  .description("uninstall dbeed itself: remove all instances, stop the server, delete data")
  .option("--keep-data", "stop instances but keep the data dir + state")
  .option("-f, --force", "skip confirmation")
  .action(async (opts: { keepData?: boolean; force?: boolean }) => {
    if (!opts.force) {
      if (!process.stdin.isTTY) {
        console.error("error: refusing to purge without --force when not interactive.");
        process.exit(1);
      }
      const ok = await askYesNo("Remove ALL dbeed instances and data? [y/N] ");
      if (!ok) {
        console.log("aborted.");
        return;
      }
    }
    let list: Instance[] = [];
    try {
      await ensureServer();
      list = await listInstances();
    } catch (e: any) {
      console.error(`warning: server unavailable (${e.message}) — removing data dir only.`);
    }
    for (const inst of list) {
      try {
        if (opts.keepData) {
          await stopInstance(inst.name);
          console.log(`stopped ${inst.name}`);
        } else {
          await removeInstance(inst.name);
          console.log(`removed ${inst.name}`);
        }
      } catch (e: any) {
        console.error(`warning: ${opts.keepData ? "stop" : "remove"} ${inst.name} failed: ${e.message}`);
      }
    }
    try {
      await shutdownServer();
    } catch {}
    const fs = await import("node:fs");
    const dir = dataDir();
    try {
      if (opts.keepData) {
        fs.rmSync(`${dir}/server.json`, { force: true });
        fs.rmSync(`${dir}/server.log`, { force: true });
        console.log(`kept data in ${dir} (server files removed).`);
      } else {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`deleted ${dir}.`);
      }
    } catch (e: any) {
      console.error(`warning: could not delete ${dir}: ${e.message}`);
    }
    console.log("dbeed uninstalled. Leftovers to remove by hand:");
    const srvBin = process.env.DBEED_SERVER_BIN;
    if (srvBin) console.log(`  rm ${srvBin}   # dbeed-server binary`);
    else console.log("  remove the dbeed-server binary (DBEED_SERVER_BIN or PATH)");
    console.log("  remove the dbeed binary itself from your PATH");
    console.log("  system postgres is untouched — `dbeed uninstall postgres` needs a server, use your package manager now");
    console.log("  pulled images stay — e.g. `docker rmi postgres:16`");
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
