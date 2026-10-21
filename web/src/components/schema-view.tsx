import { createMemo, createSignal, For, Show } from "solid-js";
import { KeyIcon, LinkIcon, TableIcon } from "~/components/icons";
import type { DbSchema, SchemaTable } from "~/lib/types";

export function SchemaView(props: { schema: DbSchema | null; table: SchemaTable | null }) {
  const [showAllRelations, setShowAllRelations] = createSignal(false);
  const relations = createMemo(() => {
    const all = props.schema?.relations ?? [];
    if (showAllRelations()) return all;
    return all.filter(
      (r) => r.from.table === props.table?.name || r.to.table === props.table?.name
    );
  });
  const relationCount = () => relations().length;

  return (
    <div class="min-h-0 flex-1 overflow-y-auto">
      <Show
        when={props.table}
        fallback={
          <div class="grid h-full place-items-center text-xs text-stone-500">
            Select a table to inspect its schema.
          </div>
        }
      >
        <div class="border-b border-ink-800 px-4 py-3 sm:px-5">
          <div class="flex items-center gap-2">
            <TableIcon size={15} class="text-violet-300" />
            <h2 class="text-[14px] font-medium text-stone-100">{props.table!.name}</h2>
            <span class="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-stone-500">
              {props.table!.schema}
            </span>
          </div>
          <p class="mt-1 text-[11px] text-stone-500">
            {props.table!.columns.length} columns
            <Show when={props.table!.rowCount !== undefined}>
              {" · "}
              {props.table!.rowCount!.toLocaleString()} rows
            </Show>
            <Show when={props.table!.primaryKey?.length}>
              {" · "}PK: {props.table!.primaryKey!.join(", ")}
            </Show>
          </p>
        </div>

        <section class="px-4 py-4 sm:px-5">
          <h3 class="label mb-2">Columns</h3>
          <div class="overflow-x-auto rounded-lg border border-ink-700">
            <table class="w-full border-separate border-spacing-0 text-left text-[12px] sm:min-w-[540px]">
              <thead>
                <tr class="bg-ink-850 text-[10px] tracking-wider text-stone-500 uppercase">
                  <th class="border-b border-ink-700 px-3 py-2 font-medium">Name</th>
                  <th class="border-b border-ink-700 px-3 py-2 font-medium">Type</th>
                  <th class="border-b border-ink-700 px-3 py-2 font-medium">Null</th>
                  <th class="hidden border-b border-ink-700 px-3 py-2 font-medium sm:table-cell">Default</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.table!.columns}>
                  {(column) => (
                    <tr class="hover:bg-white/2">
                      <td class="border-b border-ink-800 px-3 py-2">
                        <div class="flex items-center gap-1.5">
                          <Show when={column.pk}>
                            <KeyIcon size={11} class="shrink-0 text-amber-400/80" />
                          </Show>
                          <span class="font-mono text-stone-200">{column.name}</span>
                          <Show when={column.pk}>
                            <span class="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-amber-300/90 uppercase">
                              pk
                            </span>
                          </Show>
                        </div>
                      </td>
                      <td class="border-b border-ink-800 px-3 py-2 font-mono text-[11px] break-words text-violet-300/80 sm:whitespace-nowrap">
                        {column.type || "—"}
                      </td>
                      <td class="border-b border-ink-800 px-3 py-2 text-[11px] text-stone-500">
                        {column.nullable ? "yes" : "no"}
                      </td>
                      <td class="hidden max-w-[260px] truncate border-b border-ink-800 px-3 py-2 font-mono text-[11px] text-stone-500 sm:table-cell">
                        {column.default ?? "—"}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </section>

        <section class="px-4 pb-8 sm:px-5">
          <div class="mb-2 flex items-center gap-2">
            <h3 class="label mb-0">
              Relations{" "}
              <span class="ml-1 font-normal tracking-normal normal-case text-stone-600">
                {relationCount()} {showAllRelations() ? "total" : `touching ${props.table!.name}`}
              </span>
            </h3>
            <Show when={(props.schema?.relations.length ?? 0) > 0}>
              <button
                class="ml-auto text-[10px] text-stone-500 transition hover:text-stone-300"
                onClick={() => setShowAllRelations(!showAllRelations())}
              >
                {showAllRelations() ? "only this table" : "show all"}
              </button>
            </Show>
          </div>
          <Show
            when={relations().length > 0}
            fallback={
              <p class="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-[11px] text-stone-500">
                {props.schema?.relations.length
                  ? "No foreign keys touch this table."
                  : "No foreign keys discovered in this database."}
              </p>
            }
          >
            <div class="space-y-1">
              <For each={relations()}>
                {(relation) => {
                  return (
                    <div class="flex flex-wrap items-center gap-2 rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2 font-mono text-[11px]">
                      <LinkIcon size={11} class="text-stone-500" />
                      <span class="text-stone-300">
                        {relation.from.table}.{relation.from.column}
                      </span>
                      <span class="text-stone-600">→</span>
                      <span class="text-stone-300">
                        {relation.to.table}.{relation.to.column}
                      </span>
                      <span class="ml-auto text-[10px] text-stone-600">{relation.name}</span>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </section>
      </Show>
    </div>
  );
}
