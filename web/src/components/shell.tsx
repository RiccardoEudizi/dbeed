import { A, useLocation } from "@solidjs/router";
import { Show, Suspense, type JSX } from "solid-js";
import { DatabaseIcon } from "~/components/icons";

export function Shell(props: { children: JSX.Element }) {
  const location = useLocation();
  const databasesActive = () =>
    location.pathname === "/" || location.pathname.startsWith("/instances");

  return (
    <div class="flex h-dvh flex-col overflow-hidden bg-ink-950 md:flex-row">
      <aside class="hidden w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900/50 md:flex">
        <A href="/" class="flex items-center gap-2.5 px-4 py-5 transition hover:bg-white/2">
          <span class="grid h-8 w-8 place-items-center rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-300">
            <DatabaseIcon size={17} />
          </span>
          <span class="flex flex-col leading-none">
            <span class="text-[15px] font-semibold tracking-tight text-stone-100">dbeed</span>
            <span class="mt-1 text-[10px] tracking-[0.14em] text-stone-500 uppercase">disposal dbs</span>
          </span>
        </A>

        <nav class="flex flex-col gap-0.5 px-2 py-2">
          <A
            href="/"
            class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition"
            classList={{
              "bg-violet-500/10 text-violet-200": databasesActive(),
              "text-stone-400 hover:bg-white/4 hover:text-stone-200": !databasesActive(),
            }}
            end
          >
            <DatabaseIcon size={15} />
            Databases
          </A>
        </nav>

        <div class="mt-auto border-t border-ink-800 px-4 py-4 text-[10px] leading-relaxed text-stone-600">
          <div class="flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
            local only
          </div>
          <div class="mt-1">unix socket · 0600</div>
          <div class="mt-2 text-stone-700">dbeed web</div>
        </div>
      </aside>

      <header class="flex shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900/60 px-4 pt-[calc(env(safe-area-inset-top)+0.625rem)] pb-2.5 md:hidden">
        <A href="/" class="flex items-center gap-2">
          <span class="grid h-7 w-7 place-items-center rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-300">
            <DatabaseIcon size={14} />
          </span>
          <span class="text-[14px] font-semibold tracking-tight text-stone-100">dbeed</span>
          <span class="ml-0.5 text-[9px] tracking-[0.14em] text-stone-500 uppercase">disposal dbs</span>
        </A>
        <Show
          when={location.pathname !== "/"}
          fallback={<span class="text-[10px] tracking-wide text-stone-600">local only</span>}
        >
          <A href="/" class="btn btn-ghost h-8 text-[11px]">
            <DatabaseIcon size={12} />
            Databases
          </A>
        </Show>
      </header>

      <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Suspense
          fallback={
            <div class="grid flex-1 place-items-center text-xs text-stone-500">Loading…</div>
          }
        >
          {props.children}
        </Suspense>
      </main>
    </div>
  );
}
