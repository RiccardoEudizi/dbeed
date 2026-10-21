import { Toaster, toast } from "sonner-solid";
import type { JSX } from "solid-js";

export function ToastProvider(props: { children: JSX.Element }) {
  return (
    <>
      {props.children}
      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        closeButton
        visibleToasts={3}
        duration={4500}
        gap={8}
        offset={16}
        containerAriaLabel="Notifications"
        className="dbeed-toaster"
      />
    </>
  );
}

type ToastKind = "success" | "error" | "info";

export function showToast(kind: ToastKind, title: string, description?: string) {
  const options = { description, duration: kind === "error" ? 8000 : 4500 };
  if (kind === "success") toast.success(title, options);
  else if (kind === "error") toast.error(title, options);
  else toast.info(title, options);
}

export function toastError(err: unknown, fallback = "Something went wrong") {
  const message = err instanceof Error ? err.message : String(err ?? fallback);
  showToast("error", fallback, message);
}
