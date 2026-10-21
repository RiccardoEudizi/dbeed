import { A, useNavigate } from "@solidjs/router";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CreateInstanceDialog } from "~/components/create-instance-dialog";
import { AlertIcon, CopyIcon, DatabaseIcon, PlusIcon, RefreshIcon, SearchIcon, Spinner, TerminalIcon } from "~/components/icons";
import { InstanceActions } from "~/components/instance-actions";
import { StatusBadge } from "~/components/status-badge";
import { showToast, toastError } from "~/components/toast";
import { Kbd } from "~/components/ui";
import { getDeps, listInstances } from "~/lib/client";
import { copyText, queryUrl, shortDate, instanceUrl } from "~/lib/format";
import type { Deps, Instance } from "~/lib/types";

export default function Dashboard() {
  const navigate = useNavigate();
  const [instances, setInstances] = createSignal<Instance[] | null>(null);
  const [deps, setDeps] = createSignal<Deps | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [createOpen, setCreateOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");

  let timer: ReturnType<typeof setInterval> | undefined;

  const refresh = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const list = await listInstances();
      setInstances(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void refresh();
    void getDeps()
      .then(setDeps)
      .catch(() => undefined);
    timer = setInterval(() => void refresh(true), 3000);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (!typing && e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setCreateOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      if (timer) clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    });
  });

  const active = createMemo(() => (instances() ?? []).filter((i) => i.status === "running").length);
  const visible = createMemo(() => {
    const q = filter().trim().toLowerCase();
    const list = instances() ?? [];
    if (!q) return list;
    return list.filter((i) => `${i.name} ${i.db} ${i.engine}`.toLowerCase().includes(q));
  });

  const copy = async (value: string, label: string) => {
    if (await copyText(value)) showToast("success", `${label} copied`);
    else toastError(new Error("Clipboard unavailable"), "Could not copy");
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header class="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
        <div class="flex flex-wrap items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4">
          <div class="min-w-0 flex-1">
            <h1 class="text-[16px] font-semibold tracking-tight text-stone-100 sm:text-[17px]">
              Databases
            </h1>
            <p class="mt-0.5 text-[11px] text-stone-500 sm:text-xs">
              Throwaway Postgres and SQLite instances, provisioned locally.
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Show when={instances()}>
              <span class="mr-1 hidden text-[11px] text-stone-600 sm:block">
                {active()} active / {instances()!.length} total
              </span>
              <button class="btn btn-icon" onClick={() => void refresh()} aria-label="Refresh">
                <RefreshIcon size={14} />
              </button>
            </Show>
            <button class="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <PlusIcon size={14} />
              <span class="sm:hidden">New</span>
              <span class="hidden sm:inline">New database</span>
              <span class="ml-1 hidden text-violet-300/50 lg:inline">
                <Kbd>c</Kbd>
              </span>
            </button>
          </div>
        </div>
      </header>

      <div class="mx-auto w-full max-w-5xl flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <Show when={deps()?.postgres && !deps()!.postgres.installed}>
          <div class="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <AlertIcon size={16} class="mt-0.5 shrink-0 text-amber-400" />
            <div class="min-w-0 text-[13px]">
              <p class="font-medium text-amber-200">PostgreSQL binaries not found</p>
              <p class="mt-0.5 text-xs leading-relaxed text-stone-400">
                Native Postgres instances need the system package. SQLite works without it, or use
                the docker engine.
              </p>
              <Show when={deps()!.postgres.installCommand}>
                <button
                  class="mt-2 inline-flex max-w-full items-center gap-2 rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 font-mono text-[11px] text-stone-300 transition hover:border-ink-600"
                  onClick={() => copy(deps()!.postgres.installCommand!, "Install command")}
                >
                  <TerminalIcon size={12} class="shrink-0 text-amber-400/80" />
                  <span class="truncate">{deps()!.postgres.installCommand}</span>
                  <CopyIcon size={11} class="shrink-0 text-stone-500" />
                </button>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={error()}>
          <div class="mb-5 flex items-start justify-between gap-4 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-[13px] text-red-300">
            <div class="flex items-start gap-2">
              <AlertIcon size={15} class="mt-0.5 shrink-0" />
              <div>
                <p class="font-medium">Cannot reach dbeed-server</p>
                <p class="mt-0.5 text-xs break-words text-stone-400">{error()}</p>
              </div>
            </div>
            <button class="btn shrink-0" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        </Show>

        <Show when={instances() && instances()!.length > 3}>
          <div class="relative mb-4 max-w-xs">
            <SearchIcon size={13} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-stone-600" />
            <input
              class="input pl-8"
              placeholder="Filter databases…"
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
            />
          </div>
        </Show>

        <Show
          when={!loading()}
          fallback={
            <div class="flex items-center justify-center gap-2 py-24 text-xs text-stone-500">
              <Spinner /> Loading instances…
            </div>
          }
        >
          <Show
            when={visible().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-700 px-6 py-16 text-center sm:py-20">
                <span class="grid h-12 w-12 place-items-center rounded-xl border border-ink-700 bg-ink-900 text-stone-600">
                  <DatabaseIcon size={22} />
                </span>
                <h2 class="mt-4 text-sm font-medium text-stone-300">
                  {filter() ? "No matching databases" : "No databases yet"}
                </h2>
                <p class="mt-1 max-w-sm text-xs leading-relaxed text-stone-500">
                  {filter()
                    ? "Try a different name, engine or database type."
                    : "Spin up a Postgres or SQLite instance in a couple of seconds. Connection string included."}
                </p>
                <Show when={!filter()}>
                  <button class="btn btn-primary mt-5" onClick={() => setCreateOpen(true)}>
                    <PlusIcon size={14} /> Create your first database
                  </button>
                </Show>
              </div>
            }
          >
            <div class="grid gap-3">
              <For each={visible()}>
                {(instance) => (
                  <article
                    class="group panel min-w-0 cursor-pointer px-3 py-3 transition hover:border-ink-600 hover:bg-ink-850 sm:px-4 sm:py-3.5"
                    onClick={() => navigate(instanceUrl(instance.name))}
                  >
                    <div class="flex flex-wrap items-center gap-2.5 sm:flex-nowrap sm:gap-3">
                      <span
                        class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-xs font-semibold uppercase sm:h-9 sm:w-9 sm:text-sm"
                        classList={{
                          "border-violet-500/25 bg-violet-500/10 text-violet-300": instance.db === "postgres",
                          "border-sky-500/20 bg-sky-500/10 text-sky-300": instance.db !== "postgres",
                        }}
                      >
                        {instance.db === "postgres" ? "pg" : "sq"}
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <A
                            href={instanceUrl(instance.name)}
                            class="max-w-[62vw] truncate text-[13.5px] font-medium text-stone-100 hover:text-violet-200 sm:max-w-none sm:text-[14px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {instance.name}
                          </A>
                          <StatusBadge status={instance.status} />
                        </div>
                        <p class="mt-0.5 truncate text-[10.5px] text-stone-500 sm:text-[11px]">
                          {instance.db} · {instance.engine}
                          <Show when={instance.port}> · port {instance.port}</Show>
                          <span class="text-stone-700"> · created {shortDate(instance.createdAt)}</span>
                        </p>
                      </div>
                      <div class="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
                        <InstanceActions instance={instance} onChanged={() => void refresh(true)} />
                      </div>
                    </div>

                    <div class="mt-2.5 flex min-w-0 flex-col gap-2 sm:mt-3 sm:flex-row sm:items-center">
                      <code class="min-w-0 flex-1 truncate rounded-md border border-ink-800 bg-ink-950/80 px-2.5 py-1.5 font-mono text-[10.5px] text-stone-400 sm:text-[11px]">
                        {instance.connection}
                      </code>
                      <div class="flex items-center gap-1.5">
                        <button
                          class="btn btn-ghost flex-1 text-[11px] sm:flex-none"
                          onClick={(e) => {
                            e.stopPropagation();
                            void copy(instance.connection, "Connection string");
                          }}
                        >
                          <CopyIcon size={12} /> Copy
                        </button>
                        <A
                          href={queryUrl(instance.name)}
                          class="btn flex-1 text-[11px] sm:flex-none"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <TerminalIcon size={12} /> Query
                        </A>
                      </div>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      <CreateInstanceDialog
        open={createOpen()}
        onOpenChange={setCreateOpen}
        onCreated={(instance) => {
          void refresh(true);
          navigate(instanceUrl(instance.name));
        }}
      />
    </div>
  );
}
