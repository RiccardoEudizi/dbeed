import { createSignal, For, Show } from "solid-js";
import { CopyIcon, DownloadIcon, XIcon } from "~/components/icons";
import { showToast } from "~/components/toast";
import { copyText, downloadCSV, formatDuration, truncate } from "~/lib/format";
import type { QueryResult } from "~/lib/types";

export function ResultGrid(props: { result: QueryResult; filename: string }) {
  const [cell, setCell] = createSignal<{ column: string; value: string | null } | null>(null);

  const exportCSV = () => {
    downloadCSV(props.filename, props.result.columns, props.result.rows);
    showToast("success", "CSV exported", props.filename);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex flex-wrap items-center gap-2 border-b border-ink-800 px-3 py-2 sm:px-4">
        <Show
          when={props.result.columns.length > 0}
          fallback={
            <span class="text-[11px] text-stone-500">
              {props.result.command ? "Statement executed" : "0 rows"}
            </span>
          }
        >
          <span class="text-[11px] text-stone-400">
            {props.result.rowCount.toLocaleString()} row{props.result.rowCount === 1 ? "" : "s"}
            <Show when={props.result.truncated}>
              <span class="text-amber-300/90"> · truncated</span>
            </Show>
          </span>
        </Show>
        <span class="text-[10px] text-stone-600">{formatDuration(props.result.durationMs)}</span>
        <Show when={props.result.command}>
          <code class="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-stone-400">
            {props.result.command}
          </code>
        </Show>
        <Show when={props.result.columns.length > 0}>
          <button class="btn btn-ghost ml-auto text-[11px]" onClick={exportCSV}>
            <DownloadIcon size={12} /> CSV
          </button>
        </Show>
      </div>

      <Show when={props.result.columns.length > 0}>
        <div class="min-h-0 flex-1 overflow-auto">
          <table class="min-w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th class="sticky top-0 left-0 z-20 w-12 border-r border-b border-ink-700 bg-ink-850 px-2 py-2 text-right font-mono text-[10px] font-normal text-stone-600">
                  #
                </th>
                <For each={props.result.columns}>
                  {(column) => (
                    <th class="sticky top-0 z-10 border-b border-ink-700 bg-ink-850 px-3 py-2 font-mono text-[11px] font-medium whitespace-nowrap text-stone-400">
                      {column}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={props.result.rows}>
                {(row, rowIndex) => (
                  <tr class="group hover:bg-white/2">
                    <td class="sticky left-0 z-10 border-r border-b border-ink-800 bg-ink-900 px-2 py-1.5 text-right font-mono text-[10px] text-stone-600 group-hover:bg-ink-850">
                      {rowIndex() + 1}
                    </td>
                    <For each={row}>
                      {(value, colIndex) => (
                        <td class="max-w-[360px] border-b border-ink-800 px-3 py-1.5">
                          <button
                            class="block max-w-full cursor-pointer truncate text-left font-mono text-[11.5px]"
                            classList={{
                              "text-stone-300": value !== null,
                              "text-stone-600 italic": value === null,
                            }}
                            title={value ?? "NULL"}
                            onClick={() =>
                              setCell({
                                column: props.result.columns[colIndex()],
                                value,
                              })
                            }
                          >
                            {value === null ? "NULL" : truncate(value, 180)}
                          </button>
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
              <Show when={props.result.rows.length === 0}>
                <tr>
                  <td
                    colspan={props.result.columns.length + 1}
                    class="px-4 py-10 text-center text-xs text-stone-500"
                  >
                    Query returned no rows.
                  </td>
                </tr>
              </Show>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={props.result.columns.length === 0 && props.result.command}>
        <div class="grid flex-1 place-items-center text-xs text-stone-500">
          <div class="text-center">
            <p class="font-mono text-sm text-stone-300">{props.result.command}</p>
            <p class="mt-1 text-[11px]">Command completed in {formatDuration(props.result.durationMs)}.</p>
          </div>
        </div>
      </Show>

      <Show when={cell()}>
        <div class="border-t border-ink-700 bg-ink-850 px-4 py-2.5">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] text-violet-300">{cell()!.column}</span>
            <span class="text-[10px] text-stone-600">
              {cell()!.value === null ? "NULL" : `${cell()!.value!.length} chars`}
            </span>
            <button
              class="btn btn-ghost btn-icon ml-auto"
              onClick={async () => {
                if (await copyText(cell()!.value ?? "")) showToast("success", "Value copied");
              }}
              title="Copy value"
            >
              <CopyIcon size={12} />
            </button>
            <button class="btn btn-ghost btn-icon" onClick={() => setCell(null)} title="Close">
              <XIcon size={12} />
            </button>
          </div>
          <pre class="mt-1.5 max-h-28 overflow-auto font-mono text-[11.5px] break-all whitespace-pre-wrap text-stone-300">
            {cell()!.value === null ? "NULL" : cell()!.value}
          </pre>
        </div>
      </Show>
    </div>
  );
}
