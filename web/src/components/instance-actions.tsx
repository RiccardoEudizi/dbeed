import { Checkbox } from "@kobalte/core/checkbox";
import { createSignal, Show } from "solid-js";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { CheckIcon, LogsIcon, PlayIcon, RestartIcon, Spinner, StopIcon, TrashIcon } from "~/components/icons";
import { LogsDialog } from "~/components/logs-dialog";
import { showToast, toastError } from "~/components/toast";
import { Tip } from "~/components/ui";
import { restartInstance, removeInstance, startInstance, stopInstance } from "~/lib/client";
import type { Instance } from "~/lib/types";

export function InstanceActions(props: {
  instance: Instance;
  onChanged?: () => void;
  onRemoved?: () => void;
  compact?: boolean;
}) {
  const running = () => props.instance.status === "running";
  const [busy, setBusy] = createSignal<string | null>(null);
  const [logsOpen, setLogsOpen] = createSignal(false);
  const [removeOpen, setRemoveOpen] = createSignal(false);
  const [keepData, setKeepData] = createSignal(false);

  async function run(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key);
    try {
      await fn();
      showToast("success", message);
      props.onChanged?.();
    } catch (err) {
      toastError(err, "Operation failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Show
        when={running()}
        fallback={
          <Tip label="Start">
            <button
              class="btn btn-icon"
              disabled={!!busy()}
              onClick={() => run("start", () => startInstance(props.instance.name), "Started")}
              aria-label="Start"
            >
              <Show when={busy() === "start"} fallback={<PlayIcon size={13} />}>
                <Spinner />
              </Show>
            </button>
          </Tip>
        }
      >
        <Tip label="Stop">
          <button
            class="btn btn-icon"
            disabled={!!busy()}
            onClick={() => run("stop", () => stopInstance(props.instance.name), "Stopped")}
            aria-label="Stop"
          >
            <Show when={busy() === "stop"} fallback={<StopIcon size={12} />}>
              <Spinner />
            </Show>
          </button>
        </Tip>
      </Show>

      <Tip label="Restart">
        <button
          class="btn btn-icon"
          disabled={!!busy()}
          onClick={() => run("restart", () => restartInstance(props.instance.name), "Restarted")}
          aria-label="Restart"
        >
          <Show when={busy() === "restart"} fallback={<RestartIcon size={13} />}>
            <Spinner />
          </Show>
        </button>
      </Tip>

      <Tip label="Logs">
        <button class="btn btn-icon" onClick={() => setLogsOpen(true)} aria-label="Logs">
          <LogsIcon size={13} />
        </button>
      </Tip>

      <Tip label="Remove">
        <button class="btn btn-icon" onClick={() => setRemoveOpen(true)} aria-label="Remove">
          <TrashIcon size={13} />
        </button>
      </Tip>

      <LogsDialog open={logsOpen()} onOpenChange={setLogsOpen} name={props.instance.name} />

      <ConfirmDialog
        open={removeOpen()}
        onOpenChange={setRemoveOpen}
        title={`Remove ${props.instance.name}?`}
        description="dbeed stops the instance and removes what it created. This cannot be undone unless you keep the data directory."
        confirmLabel="Remove"
        danger
        busy={busy() === "remove"}
        onConfirm={() =>
          run(
            "remove",
            async () => {
              await removeInstance(props.instance.name, keepData());
              setRemoveOpen(false);
              props.onRemoved?.();
            },
            "Removed"
          )
        }
      >
        <Checkbox
          checked={keepData()}
          onChange={setKeepData}
          class="flex cursor-pointer items-center gap-2 text-xs text-stone-400"
        >
          <Checkbox.Input />
          <Checkbox.Control class="grid h-4 w-4 place-items-center rounded border border-ink-600 bg-ink-950 data-checked:border-violet-500/60 data-checked:bg-violet-500/20">
            <Checkbox.Indicator>
              <CheckIcon size={10} class="text-violet-300" />
            </Checkbox.Indicator>
          </Checkbox.Control>
          <Checkbox.Label class="cursor-pointer select-none">Keep data directory</Checkbox.Label>
        </Checkbox>
      </ConfirmDialog>
    </div>
  );
}
