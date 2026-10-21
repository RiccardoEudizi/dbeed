import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ApiError, type CreateInstanceInput, type Deps, type DbSchema, type Instance, type QueryResult, type TableRows } from "~/lib/types";

export interface ServerInfo {
  pid: number;
  token: string;
  socket?: string;
  port: number;
}

interface RawResponse {
  status: number;
  body: string;
  contentType: string;
}

export function dataDir(): string {
  if (process.env.DBEED_DATA_DIR) return process.env.DBEED_DATA_DIR;
  if (process.env.XDG_DATA_HOME) return path.join(process.env.XDG_DATA_HOME, "dbeed");
  return path.join(os.homedir(), ".local", "share", "dbeed");
}

export function loadServerInfo(): ServerInfo | null {
  try {
    const raw = fs.readFileSync(path.join(dataDir(), "server.json"), "utf8");
    return JSON.parse(raw) as ServerInfo;
  } catch {
    return null;
  }
}

function request(socketPath: string, urlPath: string, init: { method?: string; body?: string }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const body = init.body ?? "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Dbeed-Token": loadServerInfo()?.token ?? "",
    };
    if (body) headers["Content-Length"] = String(Buffer.byteLength(body));
    const req = http.request(
      {
        socketPath,
        method: init.method ?? "GET",
        path: urlPath,
        headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            contentType: String(res.headers["content-type"] ?? "application/json"),
          })
        );
        res.on("error", reject);
      }
    );
    req.setTimeout(300_000, () => req.destroy(new Error("dbeed request timed out")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function serverCandidates(): string[] {
  const cands: string[] = [];
  if (process.env.DBEED_SERVER_BIN) cands.push(process.env.DBEED_SERVER_BIN);
  cands.push(path.join(process.cwd(), "dist", "dbeed-server"));
  cands.push(path.join(process.cwd(), "..", "dist", "dbeed-server"));
  cands.push(path.join(dataDir(), "bin", "dbeed-server"));
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir) cands.push(path.join(dir, "dbeed-server"));
  }
  return cands;
}

function findServerBin(): string | null {
  for (const c of serverCandidates()) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      // ignore unreadable candidates
    }
  }
  return null;
}

async function healthy(info: ServerInfo): Promise<boolean> {
  if (!info.socket) return false;
  try {
    const res = await request(info.socket, "/healthz", {});
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

let ensuring: Promise<ServerInfo> | null = null;

/** Start dbeed-server if no healthy instance is running. */
export async function ensureServer(): Promise<ServerInfo> {
  const current = loadServerInfo();
  if (current && (await healthy(current))) return current;
  if (!ensuring) {
    ensuring = boot().finally(() => {
      ensuring = null;
    });
  }
  return ensuring;
}

async function boot(): Promise<ServerInfo> {
  // Another process may have won the race while we were checking.
  const current = loadServerInfo();
  if (current && (await healthy(current))) return current;

  const bin = findServerBin();
  if (!bin) {
    throw new Error(
      "dbeed-server binary not found. Build it with `go build -o dist/dbeed-server ./cmd/dbeed-server` or set DBEED_SERVER_BIN."
    );
  }
  fs.mkdirSync(dataDir(), { recursive: true });
  const logFile = path.join(dataDir(), "server.log");
  const logFd = fs.openSync(logFile, "a");
  const child = spawn(bin, [], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });
  child.unref();

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const info = loadServerInfo();
    if (info && (await healthy(info))) return info;
  }
  throw new Error(`dbeed-server failed to start (see ${logFile})`);
}

async function raw(urlPath: string, init: { method?: string; body?: string }, retry = true): Promise<RawResponse> {
  let info = loadServerInfo();
  if (!info?.socket) {
    info = await ensureServer();
  }
  try {
    return await request(info.socket!, urlPath, init);
  } catch (err) {
    if (!retry) throw err;
    const fresh = await ensureServer();
    return request(fresh.socket!, urlPath, init);
  }
}

function parseBody<T>(res: RawResponse): T {
  let parsed: any = null;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch {
    parsed = null;
  }
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(parsed ?? { error: res.body || `request failed with status ${res.status}` }, res.status);
  }
  return parsed as T;
}

export async function api<T>(urlPath: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const body =
    typeof init?.body === "string" ? init.body : init?.body !== undefined ? JSON.stringify(init.body) : undefined;
  const res = await raw(urlPath, { method: init?.method ?? "GET", body });
  return parseBody<T>(res);
}

/** Forward a browser request to dbeed-server without exposing the socket or token. */
export async function proxy(method: string, urlPath: string, body?: string): Promise<Response> {
  const res = await raw(urlPath, { method, body }, true);
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": res.contentType,
      "Cache-Control": "no-store",
    },
  });
}

const enc = encodeURIComponent;

export const listInstances = () => api<Instance[]>("/api/instances");
export const getInstance = (name: string) => api<Instance>(`/api/instances/${enc(name)}`);
export const getDeps = () => api<Deps>("/api/deps");
export const getConnection = (name: string) =>
  api<{ connection: string }>(`/api/instances/${enc(name)}/connection`);
export const getLogs = (name: string) => api<{ logs: string }>(`/api/instances/${enc(name)}/logs`);
export const getSchema = (name: string, counts = false) =>
  api<DbSchema>(`/api/instances/${enc(name)}/schema${counts ? "?counts=true" : ""}`);
export const getRows = (name: string, table: string, limit = 100, offset = 0) =>
  api<TableRows>(
    `/api/instances/${enc(name)}/rows?table=${enc(table)}&limit=${limit}&offset=${offset}`
  );
export const createInstance = (input: CreateInstanceInput) =>
  api<Instance>("/api/instances", { method: "POST", body: input });
export const startInstance = (name: string) =>
  api<Instance>(`/api/instances/${enc(name)}/start`, { method: "POST" });
export const stopInstance = (name: string) =>
  api<Instance>(`/api/instances/${enc(name)}/stop`, { method: "POST" });
export const restartInstance = (name: string) =>
  api<Instance>(`/api/instances/${enc(name)}/restart`, { method: "POST" });
export const removeInstance = (name: string, keepData = false) =>
  api<{ removed: string }>(`/api/instances/${enc(name)}${keepData ? "?keepData=true" : ""}`, {
    method: "DELETE",
  });
export const runQuery = (name: string, sql: string, limit = 200) =>
  api<QueryResult>(`/api/instances/${enc(name)}/query`, { method: "POST", body: { sql, limit } });
