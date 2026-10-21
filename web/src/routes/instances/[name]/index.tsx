import { A, useNavigate, useParams } from "@solidjs/router";
import { Switch } from "@kobalte/core/switch";
import { Tabs } from "@kobalte/core/tabs";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { DataGrid } from "~/components/data-grid";
import {
  AlertIcon,
  ChevronRightIcon,
  CopyIcon,
  DatabaseIcon,
  RefreshIcon,
  SidebarIcon,
  Spinner,
  TableIcon,
  TerminalIcon,
} from "~/components/icons";
import { InstanceActions } from "~/components/instance-actions";
import { SchemaView } from "~/components/schema-view";
import { SelectField } from "~/components/select-field";
import { StatusBadge } from "~/components/status-badge";
import { TableList } from "~/components/table-list";
import { showToast, toastError } from "~/components/toast";
import { getInstance, getSchema } from "~/lib/client";
import { copyText, queryUrl } from "~/lib/format";
import { ApiError } from "~/lib/types";
import type { DbSchema, Instance, SchemaTable } from "~/lib/types";

function CountsToggle(props: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <Switch
      checked={props.checked}
      onChange={props.onChange}
      class="flex items-center gap-1.5"
      title="Fetch row counts"
    >
      <Switch.Input />
      <Switch.Control class="flex h-4 w-7 cursor-pointer items-center rounded-full border border-ink-600 bg-ink-800 px-0.5 transition data-checked:border-violet-500/50 data-checked:bg-violet-500/30">
        <Switch.Thumb class="block h-2.5 w-2.5 rounded-full bg-stone-400 transition-transform data-checked:translate-x-3 data-checked:bg-violet-300" />
      </Switch.Control>
      <Switch.Label class="cursor-pointer text-[10px] text-stone-500">counts</Switch.Label>
    </Switch>
  );
}

export default function InstancePage() {
  const params = useParams<{ name: string }>();
  const navigate = useNavigate();
  const name = () => params.name;

  const [instance, setInstance] = createSignal<Instance | null>(null);
  const [instanceError, setInstanceError] = createSignal<string | null>(null);
  const [schema, setSchema] = createSignal<DbSchema | null>(null);
  const [schemaError, setSchemaError] = createSignal<string | null>(null);
  const [schemaLoading, setSchemaLoading] = createSignal(true);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal("data");
  const [counts, setCounts] = createSignal(false);
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  let timer: ReturnType<typeof setInterval> | undefined;

  const table = createMemo<SchemaTable | null>(
    () => schema()?.tables.find((t) => t.name === selected()) ?? null
  );
  const tableOptions = createMemo(() =>
    (schema()?.tables ?? []).map((t) => ({ value: t.name, label: t.name }))
  );

  async function loadInstance() {
    try {
      setInstance(await getInstance(name()));
      setInstanceError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setInstance(null);
      setInstanceError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadSchema(withCounts = counts()) {
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const next = await getSchema(name(), withCounts);
      setSchema(next);
      if (!selected() || !next.tables.some((t) => t.name === selected())) {
        setSelected(next.tables[0]?.name ?? null);
      }
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : String(err));
    } finally {
      setSchemaLoading(false);
    }
  }

  onMount(() => {
    try {
      setSidebarOpen(localStorage.getItem("dbeed:sidebar:explorer") !== "0");
    } catch {
      // ignore blocked storage
    }
    void loadInstance();
    void loadSchema();
    timer = setInterval(() => void loadInstance(), 3000);
    onCleanup(() => {
      if (timer) clearInterval(timer);
    });
  });

  createEffect(() => {
    try {
      localStorage.setItem("dbeed:sidebar:explorer", sidebarOpen() ? "1" : "0");
    } catch {
      // ignore blocked storage
    }
  });

  const toggleCounts = (value: boolean) => {
    setCounts(value);
    void loadSchema(value);
  };

  const copyConnection = async () => {
    const value = instance()?.connection;
    if (!value) return;
    if (await copyText(value)) showToast("success", "Connection string copied");
    else toastError(new Error("Clipboard unavailable"), "Could not copy");
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Show
        when={instance()}
        fallback={
          <div class="grid flex-1 place-items-center">
            <Show
              when={instanceError()}
              fallback={
                <div class="flex items-center gap-2 text-xs text-stone-500">
                  <Spinner /> Loading instance…
                </div>
              }
            >
              <div class="max-w-md rounded-xl border border-red-500/25 bg-red-500/5 p-5 text-center">
                <AlertIcon size={20} class="mx-auto text-red-400" />
                <p class="mt-2 text-sm font-medium text-red-200">Instance unavailable</p>
                <p class="mt-1 text-xs leading-relaxed break-words text-stone-400">{instanceError()}</p>
                <A href="/" class="btn mt-4">
                  Back to databases
                </A>
              </div>
            </Show>
          </div>
        }
      >
        <header class="border-b border-ink-800 bg-ink-950/70 px-4 py-3 sm:px-5 sm:py-3.5">
          <div class="flex flex-col gap-3 md:flex-row md:items-start">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 text-[10.5px] text-stone-600 sm:text-[11px]">
                <A href="/" class="transition hover:text-stone-300">
                  Databases
                </A>
                <ChevronRightIcon size={10} />
                <span class="text-stone-500">{instance()!.db}</span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-2 sm:gap-2.5">
                <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-violet-500/25 bg-violet-500/10 text-violet-300 sm:h-8 sm:w-8">
                  <DatabaseIcon size={15} />
                </span>
                <h1 class="max-w-[60vw] truncate text-[15px] font-semibold tracking-tight text-stone-100 sm:max-w-none sm:text-[17px]">
                  {instance()!.name}
                </h1>
                <StatusBadge status={instance()!.status} />
                <span class="hidden rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10px] text-stone-500 sm:inline">
                  {instance()!.db} · {instance()!.engine}
                  <Show when={instance()!.port}> · :{instance()!.port}</Show>
                </span>
              </div>
              <button
                class="mt-2 flex w-full max-w-full items-center gap-2 rounded-md border border-ink-800 bg-ink-900 px-2.5 py-1.5 text-left font-mono text-[10.5px] text-stone-400 transition hover:border-ink-600 hover:text-stone-200 sm:w-auto sm:text-[11px]"
                onClick={() => void copyConnection()}
                title="Copy connection string"
              >
                <span class="min-w-0 flex-1 truncate">{instance()!.connection}</span>
                <CopyIcon size={11} class="shrink-0 text-stone-600" />
              </button>
            </div>

            <div class="flex items-center gap-1.5 sm:gap-2 md:ml-auto md:shrink-0">
              <button
                class="btn btn-icon hidden md:inline-flex"
                onClick={() => setSidebarOpen(!sidebarOpen())}
                title={sidebarOpen() ? "Collapse tables" : "Expand tables"}
                aria-label="Toggle tables sidebar"
                aria-expanded={sidebarOpen()}
              >
                <SidebarIcon size={14} />
              </button>
              <InstanceActions
                instance={instance()!}
                onChanged={() => void loadInstance()}
                onRemoved={() => navigate("/")}
              />
              <A href={queryUrl(instance()!.name)} class="btn btn-primary ml-auto md:ml-0">
                <TerminalIcon size={13} /> Query
              </A>
            </div>
          </div>

          <Show when={instance()!.db === "postgres" && instance()!.status !== "running"}>
            <div class="mt-3 flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-200/90">
              <AlertIcon size={12} class="shrink-0" />
              Instance is stopped. Start it to browse or query data.
            </div>
          </Show>
        </header>

        <div class="flex items-center gap-2 border-b border-ink-800 bg-ink-900/20 px-3 py-2 md:hidden">
          <Show
            when={tableOptions().length > 0}
            fallback={<span class="flex-1 text-[11px] text-stone-500">No tables</span>}
          >
            <SelectField
              ariaLabel="Select table"
              value={selected() ?? undefined}
              onChange={setSelected}
              options={tableOptions()}
              placeholder="Select table"
              class="h-8 flex-1 py-0 text-[12px]"
            />
          </Show>
          <CountsToggle checked={counts()} onChange={toggleCounts} />
          <button
            class="btn btn-ghost btn-icon h-8 w-8"
            onClick={() => void loadSchema()}
            title="Refresh schema"
            aria-label="Refresh schema"
          >
            <RefreshIcon size={13} />
          </button>
        </div>

        <div class="flex min-h-0 flex-1">
          <aside
            class="hidden shrink-0 flex-col overflow-hidden border-ink-800 bg-ink-900/30 transition-[width] duration-200 md:flex"
            classList={{
              "w-64 border-r": sidebarOpen(),
              "w-0 border-r-0": !sidebarOpen(),
            }}
            aria-hidden={!sidebarOpen()}
          >
            <div class="flex min-h-0 w-64 flex-1 flex-col">
              <div class="flex items-center justify-between px-3 pt-2.5">
                <span class="text-[10px] font-semibold tracking-[0.12em] text-stone-500 uppercase">
                  Tables
                  <Show when={schema()}>
                    <span class="ml-1 font-normal tracking-normal text-stone-600">
                      {schema()!.tables.length}
                    </span>
                  </Show>
                </span>
                <div class="flex items-center gap-1">
                  <CountsToggle checked={counts()} onChange={toggleCounts} />
                  <button
                    class="btn btn-ghost btn-icon h-6 w-6"
                    onClick={() => void loadSchema()}
                    title="Refresh schema"
                  >
                    <RefreshIcon size={12} />
                  </button>
                </div>
              </div>

              <Show when={schemaError()}>
                <p class="mx-3 mt-2 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-[10.5px] break-words text-red-300">
                  {schemaError()}
                </p>
              </Show>

              <Show
                when={!schemaLoading() || schema()}
                fallback={
                  <div class="flex items-center gap-2 px-4 py-6 text-[11px] text-stone-500">
                    <Spinner /> Loading schema…
                  </div>
                }
              >
                <TableList
                  tables={schema()?.tables ?? []}
                  selected={selected()}
                  onSelect={(t) => setSelected(t.name)}
                />
              </Show>
            </div>
          </aside>

          <section class="flex min-w-0 flex-1 flex-col">
            <Tabs value={tab()} onChange={setTab}>
              <Tabs.List class="flex items-center gap-1 overflow-x-auto border-b border-ink-800 px-3 py-1.5 sm:px-4">
                <Tabs.Trigger
                  value="data"
                  class="shrink-0 cursor-pointer rounded px-2.5 py-1 text-[12px] transition"
                  classList={{
                    "bg-ink-800 text-stone-100": tab() === "data",
                    "text-stone-500 hover:text-stone-300": tab() !== "data",
                  }}
                >
                  <span class="flex items-center gap-1.5">
                    <TableIcon size={12} /> Data
                  </span>
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="schema"
                  class="shrink-0 cursor-pointer rounded px-2.5 py-1 text-[12px] transition"
                  classList={{
                    "bg-ink-800 text-stone-100": tab() === "schema",
                    "text-stone-500 hover:text-stone-300": tab() !== "schema",
                  }}
                >
                  <span class="flex items-center gap-1.5">
                    <DatabaseIcon size={12} /> Schema
                  </span>
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>

            <Show when={tab() === "data"}>
              <DataGrid instance={name()} table={table()} />
            </Show>
            <Show when={tab() === "schema"}>
              <SchemaView schema={schema()} table={table()} />
            </Show>
          </section>
        </div>
      </Show>
    </div>
  );
}
