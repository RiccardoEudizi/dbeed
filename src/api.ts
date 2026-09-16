import fs from "node:fs";
import http from "node:http";

export interface Instance {
  id: string;
  name: string;
  db: string;
  engine: string;
  status: string;
  port?: number;
  user?: string;
  database?: string;
  dataDir: string;
  connection: string;
  createdAt: string;
}

export interface ServerInfo {
  port: number;
  pid: number;
  token: string;
  socket?: string;
}

function baseDir(): string {
  if (process.env.DBEED_DATA_DIR) return process.env.DBEED_DATA_DIR;
  if (process.env.XDG_DATA_HOME) return `${process.env.XDG_DATA_HOME}/dbeed`;
  const home = process.env.HOME ?? "/tmp";
  return `${home}/.local/share/dbeed`;
}

/** Local data dir (state, instance data, server discovery). */
export function dataDir(): string {
  return baseDir();
}

export function loadServerInfo(): ServerInfo | null {
  try {
    const data = fs.readFileSync(`${baseDir()}/server.json`, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  code?: string;
  installCommand?: string;
  manager?: string;
  hint?: string;
  constructor(body: any, status: number) {
    super(body?.error ?? `request failed: ${status}`);
    this.code = body?.code;
    this.installCommand = body?.installCommand;
    this.manager = body?.manager;
    this.hint = body?.hint;
  }
}

export interface Deps {
  postgres: {
    installed: boolean;
    binaries?: Record<string, string>;
    manager?: string;
    package?: string;
    installCommand?: string;
    uninstallCommand?: string;
    hint?: string;
  };
  docker: { installed: boolean; path?: string; hint?: string };
}

/** Perform an HTTP request via unix socket when socketPath is set. */
export function request(
  socketPath: string,
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Dbeed-Token": init.headers?.["X-Dbeed-Token"] ?? "",
      ...(init.headers ?? {}),
    };
    const req = http.request(
      {
        socketPath,
        method: init.method ?? "GET",
        headers,
        path,
      },
      (res: http.IncomingMessage) => {
        resolve(res);
      },
    );
    req.on("error", reject);
    if (init.body && init.method !== "GET") {
      req.write(init.body);
    }
    req.end();
  });
}

/** Check if an IncomingMessage has a 2xx status code. */
function isOk(res: http.IncomingMessage): boolean {
  const code = res.statusCode;
  return typeof code === "number" && code >= 200 && code < 300;
}

/** Read the full body of an IncomingMessage as a string. */
function readBody(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    res.on("data", (chunk: string | Buffer) => {
      body += chunk.toString?.() ?? String(chunk);
    });
    res.on("end", () => {
      resolve(body);
    });
    res.on("error", reject);
  });
}

export async function api<T = any>(
  path: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
  retry = true
): Promise<T> {
  const info = loadServerInfo();
  if (!info) throw new Error("server not running (no server.json). Start via `dbeed`.");
  const socketPath = info.socket ?? "";
  if (!socketPath) throw new Error("no unix socket configured; start server first");
  // Always include the auth token from server.json, unless explicitly overridden
  const headers: Record<string, string> = {
    "X-Dbeed-Token": info.token,
    ...(init?.headers ?? {}),
  };
  const urlPath = path.startsWith("/") ? path : path;
  let res: http.IncomingMessage;
  const bodyStr = typeof init?.body === "string" ? init.body : init?.body ? JSON.stringify(init.body) : undefined;
  try {
    res = await request(socketPath, urlPath, {
      method: init?.method ?? "GET",
      headers,
      body: bodyStr,
    });
  } catch (e) {
    // server died mid-command (e.g. its owner exited) — boot a fresh one and retry once
    if (!retry) throw e;
    const { ensureServer } = await import("./ensure-server");
    await ensureServer();
    return api<T>(path, init, false);
  }
  const body = await readBody(res);
  if (!isOk(res)) throw new ApiError(JSON.parse(body), res.statusCode ?? 0);
  return JSON.parse(body) as T;
}

export const listInstances = () => api<Instance[]>("/api/instances");
export const getInstance = (name: string) => api<Instance>(`/api/instances/${name}`);
export const getConnection = (name: string) =>
  api<{ connection: string }>(`/api/instances/${name}/connection`);
export const getLogs = (name: string) => api<{ logs: string }>(`/api/instances/${name}/logs`);
export const startInstance = (name: string) =>
  api<Instance>(`/api/instances/${name}/start`, { method: "POST" });
export const stopInstance = (name: string) =>
  api<Instance>(`/api/instances/${name}/stop`, { method: "POST" });
export const restartInstance = (name: string) =>
  api<Instance>(`/api/instances/${name}/restart`, { method: "POST" });
export const removeInstance = (name: string, keepData = false) =>
  api<{ removed: string }>(
    `/api/instances/${name}${keepData ? "?keepData=true" : ""}`,
    { method: "DELETE" }
  );
export const createInstance = (body: Record<string, unknown>) =>
  api<Instance>("/api/instances", { method: "POST", body: JSON.stringify(body) });
export const getDeps = () => api<Deps>("/api/deps");
export const shutdownServer = () =>
  api<{ status: string }>("/api/shutdown", { method: "POST" }, false).catch(
    () => ({ status: "gone" })
  );

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  default?: string | null;
  pk?: boolean;
}

export interface SchemaTable {
  name: string;
  schema: string;
  columns: SchemaColumn[];
  primaryKey?: string[];
  rowCount?: number;
}

export interface SchemaRelation {
  name: string;
  from: { table: string; column: string };
  to: { table: string; column: string };
}

export interface DbSchema {
  database: string;
  db: string;
  tables: SchemaTable[];
  relations: SchemaRelation[];
}

export const getSchema = (name: string, counts = false) =>
  api<DbSchema>(`/api/instances/${encodeURIComponent(name)}/schema${counts ? "?counts=true" : ""}`);

export interface TableRows {
  table: string;
  schema: string;
  columns: string[];
  rows: (string | null)[][];
  total: number;
  limit: number;
  offset: number;
}

export const getRows = (name: string, table: string, limit = 100, offset = 0) =>
  api<TableRows>(
    `/api/instances/${encodeURIComponent(name)}/rows?table=${encodeURIComponent(table)}&limit=${limit}&offset=${offset}`,
  );