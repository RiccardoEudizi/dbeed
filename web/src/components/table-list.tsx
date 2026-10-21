import { createMemo, createSignal, For, Show } from "solid-js";
import { SearchIcon, TableIcon } from "~/components/icons";
import type { SchemaTable } from "~/lib/types";

export function TableList(props: {
  tables: SchemaTable[];
  selected: string | null;
  onSelect: (table: SchemaTable) => void;
}) {
  const [filter, setFilter] = createSignal("");
  const visible = createMemo(() => {
    const q = filter().trim().toLowerCase();
    if (!q) return props.tables;
    return props.tables.filter((t) => t.name.toLowerCase().includes(q));
  });

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="relative px-3 py-2">
        <SearchIcon size={12} class="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-stone-600" />
        <input
          class="input h-8 py-1 pl-7 text-[12px]"
          placeholder="Filter tables…"
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
        />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Show
          when={visible().length > 0}
          fallback={
            <p class="px-2 py-6 text-center text-[11px] text-stone-600">
              {props.tables.length === 0 ? "No tables" : "No matches"}
            </p>
          }
        >
          <For each={visible()}>
            {(table) => (
              <button
                class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition"
                classList={{
                  "bg-violet-500/10 text-violet-200": props.selected === table.name,
                  "text-stone-400 hover:bg-white/4 hover:text-stone-200": props.selected !== table.name,
                }}
                onClick={() => props.onSelect(table)}
                title={table.name}
              >
                <TableIcon size={13} class="shrink-0 opacity-70" />
                <span class="min-w-0 flex-1 truncate font-mono text-[11.5px]">{table.name}</span>
                <Show when={table.rowCount !== undefined}>
                  <span class="shrink-0 font-mono text-[10px] text-stone-600">
                    {table.rowCount!.toLocaleString()}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
