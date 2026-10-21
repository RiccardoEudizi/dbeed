export interface Instance {
  id: string;
  name: string;
  db: string;
  engine: string;
  status: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  dataDir: string;
  connection: string;
  createdAt: string;
  logFile?: string;
}

export interface DepStatus {
  installed: boolean;
  binaries?: Record<string, string>;
  manager?: string;
  package?: string;
  installCommand?: string;
  uninstallCommand?: string;
  hint?: string;
}

export interface Deps {
  postgres: DepStatus;
  docker: DepStatus & { path?: string };
}

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

export interface TableRows {
  table: string;
  schema: string;
  columns: string[];
  rows: (string | null)[][];
  total: number;
  limit: number;
  offset: number;
}

export interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  rowCount: number;
  command?: string;
  truncated: boolean;
  durationMs: number;
}

export interface CreateInstanceInput {
  db: string;
  engine: string;
  name: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export class ApiError extends Error {
  code?: string;
  installCommand?: string;
  manager?: string;
  hint?: string;
  status: number;

  constructor(body: any, status: number) {
    super(body?.error ?? `request failed with status ${status}`);
    this.name = "ApiError";
    this.code = body?.code;
    this.installCommand = body?.installCommand;
    this.manager = body?.manager;
    this.hint = body?.hint;
    this.status = status;
  }
}
