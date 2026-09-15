import fs from "node:fs";

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

export async function api<T = any>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const info = loadServerInfo();
  if (!info) throw new Error("server not running (no server.json). Start via `dbeed`.");
  const url = `http://127.0.0.1:${info.port}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", "X-Dbeed-Token": info.token, ...(init?.headers ?? {}) },
    });
  } catch (e) {
    // server died mid-command (e.g. its owner exited) — boot a fresh one and retry once
    if (!retry) throw e;
    const { ensureServer } = await import("./ensure-server");
    await ensureServer();
    return api<T>(path, init, false);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body, res.status);
  return body as T;
}

export const listInstances = () => api<Instance[]>("/api/instances");
export const getInstance = (name: string) => api<Instance>(`/api/instances/${name}`);
export const getConnection = (name: string) => api<{ connection: string }>(`/api/instances/${name}/connection`);
export const getLogs = (name: string) => api<{ logs: string }>(`/api/instances/${name}/logs`);
export const startInstance = (name: string) =>
  api<Instance>(`/api/instances/${name}/start`, { method: "POST" });
export const stopInstance = (name: string) =>
  api<Instance>(`/api/instances/${name}/stop`, { method: "POST" });
export const restartInstance = (name: string) =>
  api<Instance>(`/api/instances/${name}/restart`, { method: "POST" });
export const removeInstance = (name: string, keepData = false) =>
  api<{ removed: string }>(`/api/instances/${name}${keepData ? "?keepData=true" : ""}`, { method: "DELETE" });
export const createInstance = (body: Record<string, unknown>) =>
  api<Instance>("/api/instances", { method: "POST", body: JSON.stringify(body) });
export const getDeps = () => api<Deps>("/api/deps");
export const shutdownServer = () =>
  api<{ status: string }>("/api/shutdown", { method: "POST" }, false).catch(() => ({ status: "gone" }));
