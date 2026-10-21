import { createEffect, createSignal, For, Show } from "solid-js";
import { AlertIcon, ChevronRightIcon, CopyIcon, RefreshIcon, Spinner } from "~/components/icons";
import { showToast } from "~/components/toast";
import { getRows } from "~/lib/client";
import { copyText, truncate } from "~/lib/format";
import type { SchemaTable, TableRows } from "~/lib/types";

const PAGE_SIZE = 100;

export function DataGrid(props: { instance: string; table: SchemaTable | null }) {
  const [data, setData] = createSignal<TableRows | null>(null);
  const [offset, setOffset] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [cell, setCell] = createSignal<{ column: string; value: string | null } | null>(null);
  let requestId = 0;
  let lastTable: string | null = null;

  async function load(nextOffset: number) {
    const table = props.table;
    if (!table) return;
    const id = ++requestId;
    setLoading(true);
    setError(null);
    try {
      const rows = await getRows(props.instance, table.name, PAGE_SIZE, nextOffset);
      if (id !== requestId) return;
      setData(rows);
      setOffset(nextOffset);
      setCell(null);
    } catch (err) {
      if (id !== requestId) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === requestId) setLoading(false);
    }
  }

  createEffect(() => {
    const table = props.table?.name ?? null;
    props.instance;
    if (table !== lastTable) {
      lastTable = table;
      setData(null);
      setError(null);
      setCell(null);
    }
    if (table) void load(0);
  });

  const total = () => data()?.total ?? 0;
  const from = () => (total() === 0 ? 0 : offset() + 1);
  const to = () => Math.min(offset() + PAGE_SIZE, total());

  const copyCell = async () => {
    const selected = cell();
    if (!selected) return;
    if (await copyText(selected.value ?? "")) showToast("success", "Value copied");
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show
        when={props.table}
        fallback={
          <div class="grid flex-1 place-items-center text-xs text-stone-500">
            Select a table to browse its rows.
          </div>
        }
      >
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-ink-800 px-3 py-2 sm:px-4 sm:py-2.5">
          <span class="max-w-[55vw] truncate text-[12px] font-medium text-stone-300 sm:max-w-none">{props.table!.name}</span>
          <span class="hidden text-[11px] text-stone-600 sm:inline">
            {props.table!.schema}
            <Show when={props.table!.columns.length}> · {props.table!.columns.length} columns</Show>
          </span>
          <Show when={data()}>
            <span class="ml-auto text-[11px] text-stone-500">
              {total().toLocaleString()} rows
            </span>
          </Show>
          <button class="btn btn-icon" onClick={() => void load(offset())} aria-label="Refresh rows">
            <RefreshIcon size={13} />
          </button>
        </div>

        <Show when={error()}>
          <div class="flex items-start gap-2 border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">
            <AlertIcon size={14} class="mt-0.5 shrink-0" />
            <span class="break-words">{error()}</span>
          </div>
        </Show>

        <div class="relative min-h-0 flex-1 overflow-auto">
          <Show when={loading()}>
            <div class="absolute inset-0 z-10 grid place-items-center bg-ink-950/50 backdrop-blur-[1px]">
              <Spinner size={20} class="text-violet-400" />
            </div>
          </Show>

          <table class="min-w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th class="sticky top-0 left-0 z-20 w-12 border-r border-b border-ink-700 bg-ink-850 px-2 py-2 text-right font-mono text-[10px] font-normal text-stone-600">
                  #
                </th>
                <For each={data()?.columns ?? []}>
                  {(column) => (
                    <th class="sticky top-0 z-10 border-b border-ink-700 bg-ink-850 px-3 py-2 font-mono text-[11px] font-medium whitespace-nowrap text-stone-400">
                      {column}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={data()?.rows ?? []}>
                {(row, rowIndex) => (
                  <tr class="group hover:bg-white/2">
                    <td class="sticky left-0 z-10 border-r border-b border-ink-800 bg-ink-900 px-2 py-1.5 text-right font-mono text-[10px] text-stone-600 group-hover:bg-ink-850">
                      {offset() + rowIndex() + 1}
                    </td>
                    <For each={row}>
                      {(value, colIndex) => (
                        <td class="max-w-[320px] border-b border-ink-800 px-3 py-1.5">
                          <button
                            class="block max-w-full cursor-pointer truncate text-left font-mono text-[11.5px]"
                            classList={{
                              "text-stone-300": value !== null,
                              "text-stone-600 italic": value === null,
                            }}
                            title={value ?? "NULL"}
                            onClick={() =>
                              setCell({ column: data()!.columns[colIndex()], value })
                            }
                          >
                            {value === null ? "NULL" : truncate(value, 160)}
                          </button>
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
              <Show when={!loading() && data() && data()!.rows.length === 0}>
                <tr>
                  <td
                    colspan={(data()?.columns.length ?? 0) + 1}
                    class="px-4 py-10 text-center text-xs text-stone-500"
                  >
                    No rows in this table.
                  </td>
                </tr>
              </Show>
            </tbody>
          </table>

          <Show when={!data() && !loading() && !error()}>
            <div class="grid place-items-center py-16 text-xs text-stone-500">No data loaded.</div>
          </Show>
        </div>

        <Show when={cell()}>
          <div class="border-t border-ink-700 bg-ink-850 px-4 py-2.5">
            <div class="flex items-center gap-2">
              <span class="font-mono text-[11px] text-violet-300">{cell()!.column}</span>
              <span class="text-[10px] text-stone-600">
                {cell()!.value === null ? "NULL" : `${cell()!.value!.length} chars`}
              </span>
              <button class="btn btn-ghost btn-icon ml-auto" onClick={() => void copyCell()} title="Copy value">
                <CopyIcon size={12} />
              </button>
              <button class="btn btn-ghost btn-icon" onClick={() => setCell(null)} title="Close">
                <ChevronRightIcon size={12} class="rotate-90" />
              </button>
            </div>
            <pre class="mt-1.5 max-h-28 overflow-auto font-mono text-[11.5px] break-all whitespace-pre-wrap text-stone-300">
              {cell()!.value === null ? "NULL" : cell()!.value}
            </pre>
          </div>
        </Show>

        <footer class="flex items-center gap-2 border-t border-ink-800 px-3 py-2 text-[11px] text-stone-500 sm:px-4">
          <span>
            {from().toLocaleString()}–{to().toLocaleString()} of {total().toLocaleString()}
          </span>
          <div class="ml-auto flex items-center gap-1">
            <button
              class="btn text-[11px]"
              disabled={offset() === 0 || loading()}
              onClick={() => void load(Math.max(0, offset() - PAGE_SIZE))}
            >
              Previous
            </button>
            <button
              class="btn text-[11px]"
              disabled={offset() + PAGE_SIZE >= total() || loading()}
              onClick={() => void load(offset() + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </footer>
      </Show>
    </div>
  );
}
