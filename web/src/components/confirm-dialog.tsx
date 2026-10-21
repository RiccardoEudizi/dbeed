import { Dialog } from "@kobalte/core/dialog";
import { Show, type JSX } from "solid-js";
import { XIcon } from "~/components/icons";

export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  children?: JSX.Element;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content class="panel fixed top-1/2 left-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 p-4 shadow-2xl sm:p-5">
          <div class="flex items-start justify-between gap-4">
            <Dialog.Title class="text-[15px] font-semibold text-stone-100">{props.title}</Dialog.Title>
            <Dialog.CloseButton class="btn btn-ghost btn-icon" aria-label="Close">
              <XIcon size={14} />
            </Dialog.CloseButton>
          </div>
          <Dialog.Description class="mt-2 text-[13px] leading-relaxed text-stone-400">
            {props.description}
          </Dialog.Description>
          <Show when={props.children}>
            <div class="mt-3">{props.children}</div>
          </Show>
          <div class="mt-5 flex justify-end gap-2">
            <Dialog.CloseButton class="btn">Cancel</Dialog.CloseButton>
            <button
              class="btn"
              classList={{ "btn-danger": props.danger, "btn-primary": !props.danger }}
              disabled={props.busy}
              onClick={() => props.onConfirm()}
            >
              <Show when={props.busy} fallback={props.confirmLabel ?? "Confirm"}>
                Working…
              </Show>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
