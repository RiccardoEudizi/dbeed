import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withLoader } from "./loader";
import { request } from "./api";

function baseDir(): string {
  if (process.env.DBEED_DATA_DIR) return process.env.DBEED_DATA_DIR;
  if (process.env.XDG_DATA_HOME) return path.join(process.env.XDG_DATA_HOME, "dbeed");
  return path.join(os.homedir(), ".local", "share", "dbeed");
}

function serverCandidates(): string[] {
  const cands: string[] = [];
  if (process.env.DBEED_SERVER_BIN) cands.push(process.env.DBEED_SERVER_BIN);
  // sibling of compiled binary / dev tree
  cands.push(path.join(path.dirname(process.execPath), "dbeed-server"));
  cands.push(path.join(process.cwd(), "dist", "dbeed-server"));
  cands.push(path.join(baseDir(), "bin", "dbeed-server"));
  return cands;
}

function findServerBin(): string | null {
  for (const c of serverCandidates()) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {}
  }
  // PATH lookup
  const pathEnv = (process.env.PATH ?? "").split(":");
  for (const d of pathEnv) {
    const c = path.join(d, "dbeed-server");
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

async function healthy(info: { socket?: string; port: number; token: string }): Promise<boolean> {
  try {
    if (!info.socket) return false;
    const res = await request(info.socket, "/healthz", {});
    return (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
  } catch {
    return false;
  }
}

// owned is true when THIS process spawned the server. Only the owner stops
// it on exit — attached clients leave a shared server alone.
let owned = false;
export function serverOwned(): boolean {
  return owned;
}

async function waitHealthy(info: { socket?: string; port: number; token: string }, tries: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    if (await healthy(info)) return true;
  }
  return false;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function ensureServer(): Promise<{ socket?: string; port: number; token: string }> {
  const file = path.join(baseDir(), "server.json");
  try {
    const raw = fs.readFileSync(file, "utf8");
    const info = JSON.parse(raw);
    if (info.socket && (await healthy(info))) return info;
    // pid alive but unhealthy -> another client is booting it; wait with status
    if (info.pid && pidAlive(info.pid)) {
      const ok = await withLoader("Starting server", () => waitHealthy(info, 10, 300), { immediate: true });
      if (ok) return info;
    }
  } catch {}

  const bin = findServerBin();
  if (!bin) {
    throw new Error(
      "dbeed-server binary not found. Build it with `go build -o dist/dbeed-server ./cmd/dbeed-server` or set DBEED_SERVER_BIN."
    );
  }
  const logFile = path.join(baseDir(), "server.log");
  try {
    fs.mkdirSync(baseDir(), { recursive: true });
  } catch {}
  const logFd = fs.openSync(logFile, "a");
  const child = spawn(bin, [], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });
  child.unref();
  owned = true;

  // wait for server.json + healthz
  return withLoader(
    "Starting server",
    async () => {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        try {
          const raw = fs.readFileSync(file, "utf8");
          const info = JSON.parse(raw);
          if (info.socket && (await healthy(info))) return info;
        } catch {}
      }
      throw new Error(`dbeed-server failed to start (see ${logFile})`);
    },
    { immediate: true },
  );
}