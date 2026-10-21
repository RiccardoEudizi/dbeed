import {
  ApiError,
  type CreateInstanceInput,
  type DbSchema,
  type Deps,
  type Instance,
  type QueryResult,
  type TableRows,
} from "~/lib/types";

async function api<T>(urlPath: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/dbeed${urlPath}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new ApiError(body ?? { error: `request failed with status ${res.status}` }, res.status);
  return body as T;
}

const enc = encodeURIComponent;

export const listInstances = () => api<Instance[]>("/instances");
export const getInstance = (name: string) => api<Instance>(`/instances/${enc(name)}`);
export const getDeps = () => api<Deps>("/deps");
export const getConnection = (name: string) =>
  api<{ connection: string }>(`/instances/${enc(name)}/connection`);
export const getLogs = (name: string) => api<{ logs: string }>(`/instances/${enc(name)}/logs`);
export const getSchema = (name: string, counts = false) =>
  api<DbSchema>(`/instances/${enc(name)}/schema${counts ? "?counts=true" : ""}`);
export const getRows = (name: string, table: string, limit = 100, offset = 0) =>
  api<TableRows>(
    `/instances/${enc(name)}/rows?table=${enc(table)}&limit=${limit}&offset=${offset}`
  );
export const createInstance = (input: CreateInstanceInput) =>
  api<Instance>("/instances", { method: "POST", body: input });
export const startInstance = (name: string) =>
  api<Instance>(`/instances/${enc(name)}/start`, { method: "POST" });
export const stopInstance = (name: string) =>
  api<Instance>(`/instances/${enc(name)}/stop`, { method: "POST" });
export const restartInstance = (name: string) =>
  api<Instance>(`/instances/${enc(name)}/restart`, { method: "POST" });
export const removeInstance = (name: string, keepData = false) =>
  api<{ removed: string }>(`/instances/${enc(name)}${keepData ? "?keepData=true" : ""}`, {
    method: "DELETE",
  });
export const runQuery = (name: string, sql: string, limit = 200) =>
  api<QueryResult>(`/instances/${enc(name)}/query`, { method: "POST", body: { sql, limit } });
