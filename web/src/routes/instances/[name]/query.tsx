import { A, useParams } from "@solidjs/router";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  AlertIcon,
  ChevronRightIcon,
  ClockIcon,
  DatabaseIcon,
  PlayIcon,
  RefreshIcon,
  SidebarIcon,
  Spinner,
  TableIcon,
  TerminalIcon,
  TrashIcon,
} from "~/components/icons";
import { ResultGrid } from "~/components/result-grid";
import { SelectField } from "~/components/select-field";
import { StatusBadge } from "~/components/status-badge";
import { SqlEditor, type SqlEditorHandle } from "~/components/sql-editor";
import { TableList } from "~/components/table-list";
import { Kbd } from "~/components/ui";
import { getInstance, getSchema, runQuery as executeQuery } from "~/lib/client";
import { instanceUrl } from "~/lib/format";
import type { Instance, QueryResult, SchemaTable } from "~/lib/types";

interface HistoryEntry {
  sql: string;
  at: number;
  ms?: number;
  rows?: number;
}

const LIMITS = [
  { value: "100", label: "100" },
  { value: "200", label: "200" },
  { value: "500", label: "500" },
  { value: "1000", label: "1000" },
];

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export default function QueryPage() {
  const params = useParams<{ name: string }>();
  const name = () => params.name;

  const [instance, setInstance] = createSignal<Instance | null>(null);
  const [tables, setTables] = createSignal<SchemaTable[]>([]);
  const [schemaError, setSchemaError] = createSignal<string | null>(null);
  const [sql, setSql] = createSignal("");
  const [limit, setLimit] = createSignal("200");
  const [result, setResult] = createSignal<QueryResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [running, setRunning] = createSignal(false);
  const [history, setHistory] = createSignal<HistoryEntry[]>([]);
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  let editor: SqlEditorHandle | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const historyKey = () => `dbeed:query-history:${name()}`;

  function loadHistory() {
    try {
      const raw = localStorage.getItem(historyKey());
      setHistory(raw ? JSON.parse(raw) : []);
    } catch {
      setHistory([]);
    }
  }

  function saveHistory(entry: HistoryEntry) {
    const next = [entry, ...history().filter((h) => h.sql !== entry.sql)].slice(0, 30);
    setHistory(next);
    try {
      localStorage.setItem(historyKey(), JSON.stringify(next));
    } catch {
      // storage full/blocked — history is best effort
    }
  }

  function clearHistory() {
    setHistory([]);
    try {
      localStorage.removeItem(historyKey());
    } catch {
      // ignore
    }
  }

  async function loadInstance() {
    try {
      setInstance(await getInstance(name()));
    } catch {
      // query execution will surface a helpful error
    }
  }

  async function loadSchema() {
    try {
      const schema = await getSchema(name());
      setTables(schema.tables);
      setSchemaError(null);
      if (!sql() && schema.tables[0]) {
        setSql(`select * from ${quoteIdent(schema.tables[0].name)} limit ${limit()};`);
      }
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : String(err));
    }
  }

  onMount(() => {
    try {
      setSidebarOpen(localStorage.getItem("dbeed:sidebar:query") !== "0");
    } catch {
      // ignore blocked storage
    }
    loadHistory();
    void loadInstance();
    void loadSchema();
    timer = setInterval(() => void loadInstance(), 3000);
    onCleanup(() => {
      if (timer) clearInterval(timer);
    });
  });

  createEffect(() => {
    try {
      localStorage.setItem("dbeed:sidebar:query", sidebarOpen() ? "1" : "0");
    } catch {
      // ignore blocked storage
    }
  });

  async function run() {
    const statement = sql().trim();
    if (!statement || running()) return;
    setRunning(true);
    setError(null);
    try {
      const res = await executeQuery(name(), statement, Number(limit()));
      setResult(res);
      saveHistory({ sql: statement, at: Date.now(), ms: res.durationMs, rows: res.rowCount });
      if (res.command && /^(create|drop|alter)\b/i.test(res.command)) void loadSchema();
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const insertTable = (table: SchemaTable) => {
    editor?.insert(quoteIdent(table.name));
  };

  const loadHistoryEntry = (entry: HistoryEntry) => {
    setSql(entry.sql);
    editor?.setValue(entry.sql);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header class="flex items-center gap-2 border-b border-ink-800 bg-ink-950/70 px-4 py-3 sm:gap-3 sm:px-5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 truncate text-[10.5px] text-stone-600 sm:text-[11px]">
            <A href="/" class="transition hover:text-stone-300">
              Databases
            </A>
            <ChevronRightIcon size={10} />
            <A href={instanceUrl(name())} class="transition hover:text-stone-300">
              {name()}
            </A>
            <ChevronRightIcon size={10} />
            <span class="text-stone-500">query</span>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <TerminalIcon size={15} class="shrink-0 text-violet-300" />
            <h1 class="truncate text-[14px] font-semibold text-stone-100 sm:text-[15px]">
              Query editor
            </h1>
            <Show when={instance()}>
              <StatusBadge status={instance()!.status} />
              <span class="hidden rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10px] text-stone-500 sm:inline">
                {instance()!.db}
                <Show when={instance()!.port}> · :{instance()!.port}</Show>
              </span>
            </Show>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            class="btn btn-icon hidden lg:inline-flex"
            onClick={() => setSidebarOpen(!sidebarOpen())}
            title={sidebarOpen() ? "Collapse tables" : "Expand tables"}
            aria-label="Toggle tables sidebar"
            aria-expanded={sidebarOpen()}
          >
            <SidebarIcon size={14} />
          </button>
          <button class="btn btn-primary" onClick={() => void run()} disabled={running() || !sql().trim()}>
            <Show when={running()} fallback={<PlayIcon size={12} />}>
              <Spinner />
            </Show>
            Run
            <span class="ml-1 hidden text-stone-500 md:inline">
              <Kbd>⌘/Ctrl ↵</Kbd>
            </span>
          </button>
        </div>
      </header>

      <div class="flex items-center gap-2 border-b border-ink-800 bg-ink-900/20 px-3 py-2 lg:hidden">
        <SelectField
          ariaLabel="Insert table"
          value={undefined}
          onChange={(table) => {
            const found = tables().find((t) => t.name === table);
            if (found) insertTable(found);
          }}
          options={tables().map((t) => ({ value: t.name, label: t.name }))}
          placeholder="Insert table…"
          class="h-8 flex-1 py-0 text-[12px]"
        />
        <button
          class="btn btn-ghost btn-icon h-8 w-8"
          onClick={() => void loadSchema()}
          title="Refresh tables"
          aria-label="Refresh tables"
        >
          <RefreshIcon size={13} />
        </button>
      </div>

      <div class="flex min-h-0 flex-1">
        <aside
          class="hidden shrink-0 flex-col overflow-hidden border-ink-800 bg-ink-900/30 transition-[width] duration-200 lg:flex"
          classList={{
            "w-60 border-r": sidebarOpen(),
            "w-0 border-r-0": !sidebarOpen(),
          }}
          aria-hidden={!sidebarOpen()}
        >
          <div class="flex min-h-0 w-60 flex-1 flex-col">
          <div class="flex items-center gap-1.5 px-3 pt-2.5">
            <TableIcon size={11} class="text-stone-500" />
            <span class="text-[10px] font-semibold tracking-[0.12em] text-stone-500 uppercase">
              Tables
              <Show when={tables().length}>
                <span class="ml-1 font-normal tracking-normal text-stone-600">{tables().length}</span>
              </Show>
            </span>
            <button
              class="ml-auto text-stone-600 transition hover:text-stone-300"
              onClick={() => void loadSchema()}
              title="Refresh tables"
            >
              <RefreshIcon size={11} />
            </button>
          </div>
          <Show when={schemaError()}>
            <p class="mx-3 mt-2 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-[10.5px] break-words text-red-300">
              {schemaError()}
            </p>
          </Show>
          <div class="min-h-0 max-h-[55%] overflow-hidden">
            <TableList tables={tables()} selected={null} onSelect={insertTable} />
          </div>

          <div class="flex items-center gap-1.5 border-t border-ink-800 px-3 py-2">
            <ClockIcon size={11} class="text-stone-500" />
            <span class="text-[10px] font-semibold tracking-[0.12em] text-stone-500 uppercase">History</span>
            <Show when={history().length > 0}>
              <button
                class="ml-auto text-stone-600 transition hover:text-stone-300"
                onClick={clearHistory}
                title="Clear history"
              >
                <TrashIcon size={11} />
              </button>
            </Show>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <Show
              when={history().length > 0}
              fallback={
                <p class="px-2 py-4 text-[10.5px] text-stone-600">
                  Executed queries will appear here.
                </p>
              }
            >
              <For each={history()}>
                {(entry) => (
                  <button
                    class="mb-0.5 w-full cursor-pointer rounded px-2 py-1.5 text-left transition hover:bg-white/4"
                    onClick={() => loadHistoryEntry(entry)}
                    title={entry.sql}
                  >
                    <p class="truncate font-mono text-[10.5px] text-stone-400">{entry.sql}</p>
                    <p class="mt-0.5 text-[9.5px] text-stone-600">
                      {new Date(entry.at).toLocaleTimeString()}
                      <Show when={entry.rows !== undefined}>
                        {" · "}
                        {entry.rows} rows
                      </Show>
                      <Show when={entry.ms !== undefined}>
                        {" · "}
                        {entry.ms} ms
                      </Show>
                    </p>
                  </button>
                )}
              </For>
            </Show>
          </div>
          </div>
        </aside>

        <section class="flex min-w-0 flex-1 flex-col">
          <div class="flex min-h-[170px] shrink-0 basis-[44%] flex-col border-b border-ink-800">
            <div class="flex items-center gap-2 border-b border-ink-800 px-3 py-1.5 sm:px-4">
              <span class="font-mono text-[10px] tracking-wider text-stone-600 uppercase">sql</span>
              <div class="ml-auto flex items-center gap-1.5 sm:gap-2">
                <span class="hidden whitespace-nowrap text-[10px] text-stone-600 sm:inline">
                  Result limit
                </span>
                <SelectField
                  ariaLabel="Result limit"
                  value={limit()}
                  onChange={setLimit}
                  options={LIMITS}
                  class="h-7 w-24 py-0 text-[11px] sm:w-28"
                  wrapperClass="w-auto shrink-0"
                />
                <button
                  class="btn btn-primary hidden text-[11px] sm:inline-flex"
                  onClick={() => void run()}
                  disabled={running() || !sql().trim()}
                >
                  <Show when={running()} fallback={<PlayIcon size={11} />}>
                    <Spinner size={12} />
                  </Show>
                  Run
                </button>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-hidden">
              <SqlEditor
                value={sql()}
                dialect={instance()?.db === "sqlite" ? "sqlite" : "postgres"}
                tables={tables().map((t) => t.name)}
                onChange={setSql}
                onRun={() => void run()}
                onReady={(handle) => {
                  editor = handle;
                }}
              />
            </div>
          </div>

          <div class="flex min-h-0 flex-1 flex-col">
            <Show when={error()}>
              <div class="flex min-h-0 flex-1 flex-col p-4">
                <div class="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-3">
                  <AlertIcon size={15} class="mt-0.5 shrink-0 text-red-400" />
                  <div class="min-w-0">
                    <p class="text-[12px] font-medium text-red-200">Query failed</p>
                    <pre class="mt-1.5 max-h-[40vh] overflow-auto font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-red-300/90">
                      {error()}
                    </pre>
                  </div>
                </div>
              </div>
            </Show>

            <Show when={!error() && running()}>
              <div class="grid flex-1 place-items-center">
                <div class="flex items-center gap-2 text-xs text-stone-500">
                  <Spinner size={18} class="text-violet-400" /> Running query…
                </div>
              </div>
            </Show>

            <Show when={!error() && !running() && result()}>
              <ResultGrid result={result()!} filename={`${name()}-query.csv`} />
            </Show>

            <Show when={!error() && !running() && !result()}>
              <div class="grid flex-1 place-items-center px-6 text-center">
                <div>
                  <span class="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-ink-700 bg-ink-900 text-stone-600">
                    <DatabaseIcon size={20} />
                  </span>
                  <p class="mt-3 text-[13px] font-medium text-stone-300">Run a query to see results</p>
                  <p class="mt-1 text-[11px] leading-relaxed text-stone-500">
                    Pick a table to insert its name.
                    <br />
                    <Kbd>⌘/Ctrl</Kbd> + <Kbd>Enter</Kbd> executes the statement.
                  </p>
                </div>
              </div>
            </Show>
          </div>
        </section>
      </div>
    </div>
  );
}
