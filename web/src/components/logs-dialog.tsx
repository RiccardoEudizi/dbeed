import { Dialog } from "@kobalte/core/dialog";
import { createEffect, createSignal, Show } from "solid-js";
import { getLogs } from "~/lib/client";
import { LogsIcon, RefreshIcon, Spinner, XIcon } from "~/components/icons";

export function LogsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
}) {
  const [logs, setLogs] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  let pre: HTMLPreElement | undefined;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getLogs(props.name);
      setLogs(res.logs || "(no logs)");
      queueMicrotask(() => {
        if (pre) pre.scrollTop = pre.scrollHeight;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (props.open) void load();
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content class="panel fixed top-1/2 left-1/2 z-50 flex h-[min(80dvh,640px)] w-[min(94vw,860px)] -translate-x-1/2 -translate-y-1/2 flex-col p-3 shadow-2xl sm:p-4">
          <div class="flex items-center gap-2">
            <LogsIcon size={16} class="text-violet-300" />
            <Dialog.Title class="truncate text-[13px] font-semibold text-stone-100 sm:text-[15px]">
              {props.name} · logs
            </Dialog.Title>
            <div class="ml-auto flex items-center gap-1">
              <button class="btn btn-ghost btn-icon" onClick={() => void load()} title="Refresh">
                <RefreshIcon size={14} />
              </button>
              <Dialog.CloseButton class="btn btn-ghost btn-icon" aria-label="Close">
                <XIcon size={14} />
              </Dialog.CloseButton>
            </div>
          </div>
          <Show when={error()}>
            <p class="mt-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error()}
            </p>
          </Show>
          <div class="relative mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-ink-700 bg-ink-950">
            <Show when={loading()}>
              <div class="absolute top-2 right-2 z-10 text-stone-400">
                <Spinner />
              </div>
            </Show>
            <pre
              ref={pre}
              class="h-full overflow-auto p-3 font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-stone-400"
            >
              {logs()}
            </pre>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
