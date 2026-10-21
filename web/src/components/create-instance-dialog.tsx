import { Dialog } from "@kobalte/core/dialog";
import { createSignal, Show } from "solid-js";
import { SelectField } from "~/components/select-field";
import { AlertIcon, ChevronDownIcon, CopyIcon, KeyIcon, XIcon } from "~/components/icons";
import { showToast } from "~/components/toast";
import { createInstance } from "~/lib/client";
import { ApiError, type Instance } from "~/lib/types";

export function CreateInstanceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (instance: Instance) => void;
}) {
  const [name, setName] = createSignal("");
  const [db, setDb] = createSignal<"postgres" | "sqlite">("postgres");
  const [engine, setEngine] = createSignal<"native" | "docker">("native");
  const [port, setPort] = createSignal("");
  const [user, setUser] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [database, setDatabase] = createSignal("");
  const [advanced, setAdvanced] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<ApiError | Error | null>(null);

  const reset = () => {
    setName("");
    setDb("postgres");
    setEngine("native");
    setPort("");
    setUser("");
    setPassword("");
    setDatabase("");
    setAdvanced(false);
    setError(null);
    setBusy(false);
  };

  const onOpenChange = (open: boolean) => {
    if (!busy()) {
      if (!open) reset();
      props.onOpenChange(open);
    }
  };

  async function submit(e: Event) {
    e.preventDefault();
    const trimmed = name().trim();
    if (!trimmed) {
      setError(new Error("Name is required"));
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) {
      setError(new Error("Use letters, numbers, dashes and underscores; start with a letter or number"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const instance = await createInstance({
        name: trimmed,
        db: db(),
        engine: db() === "sqlite" ? "native" : engine(),
        port: port() ? Number(port()) : undefined,
        user: user() || undefined,
        password: password() || undefined,
        database: database() || undefined,
      });
      showToast("success", `Created ${instance.name}`, instance.connection);
      props.onCreated(instance);
      reset();
      props.onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  }

  const installHint = () => {
    const err = error();
    return err instanceof ApiError && err.code === "postgres_binaries_missing" ? err.installCommand : undefined;
  };

  return (
    <Dialog open={props.open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content class="panel fixed top-1/2 left-1/2 z-50 max-h-[92dvh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-4 shadow-2xl sm:p-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title class="text-[15px] font-semibold text-stone-100">
                New disposable database
              </Dialog.Title>
              <Dialog.Description class="mt-1 text-xs text-stone-500">
                dbeed provisions it, prints a connection string, and forgets it when you remove it.
              </Dialog.Description>
            </div>
            <Dialog.CloseButton class="btn btn-ghost btn-icon" aria-label="Close">
              <XIcon size={14} />
            </Dialog.CloseButton>
          </div>

          <form class="mt-5 space-y-4" onSubmit={submit}>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label class="label" for="db-name">
                  Name
                </label>
                <input
                  id="db-name"
                  class="input"
                  placeholder="my-db"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  autofocus
                  disabled={busy()}
                />
              </div>
              <div>
                <label class="label">Database</label>
                <SelectField
                  ariaLabel="Database"
                  value={db()}
                  onChange={setDb}
                  disabled={busy()}
                  options={[
                    { value: "postgres", label: "PostgreSQL" },
                    { value: "sqlite", label: "SQLite" },
                  ]}
                />
              </div>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label class="label">Engine</label>
                <SelectField
                  ariaLabel="Engine"
                  value={engine()}
                  onChange={setEngine}
                  disabled={busy() || db() === "sqlite"}
                  options={[
                    { value: "native", label: "native" },
                    { value: "docker", label: "docker" },
                  ]}
                />
              </div>
              <div>
                <label class="label" for="db-port">
                  Port <span class="font-normal tracking-normal normal-case text-stone-600">optional</span>
                </label>
                <input
                  id="db-port"
                  class="input font-mono"
                  placeholder="auto"
                  inputmode="numeric"
                  value={port()}
                  onInput={(e) => setPort(e.currentTarget.value.replace(/[^0-9]/g, ""))}
                  disabled={busy() || db() === "sqlite"}
                />
              </div>
            </div>

            <Show when={db() === "postgres"}>
              <button
                type="button"
                class="flex items-center gap-1.5 text-[11px] text-stone-500 transition hover:text-stone-300"
                onClick={() => setAdvanced(!advanced())}
              >
                <ChevronDownIcon
                  size={12}
                  class="transition-transform"
                  classList={{ "rotate-180": advanced() }}
                />
                Credentials
                <span class="text-stone-600">— defaults to postgres/postgres</span>
              </button>
              <Show when={advanced()}>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label class="label" for="db-user">
                      User
                    </label>
                    <input
                      id="db-user"
                      class="input"
                      placeholder="postgres"
                      value={user()}
                      onInput={(e) => setUser(e.currentTarget.value)}
                      disabled={busy()}
                    />
                  </div>
                  <div>
                    <label class="label" for="db-password">
                      Password
                    </label>
                    <input
                      id="db-password"
                      class="input"
                      placeholder="postgres"
                      value={password()}
                      onInput={(e) => setPassword(e.currentTarget.value)}
                      disabled={busy()}
                    />
                  </div>
                  <div>
                    <label class="label" for="db-database">
                      Database
                    </label>
                    <input
                      id="db-database"
                      class="input"
                      placeholder={name() || "same as name"}
                      value={database()}
                      onInput={(e) => setDatabase(e.currentTarget.value)}
                      disabled={busy()}
                    />
                  </div>
                </div>
              </Show>
            </Show>

            <Show when={error()}>
              <div class="rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2.5 text-xs text-red-300">
                <div class="flex items-start gap-2">
                  <AlertIcon size={14} class="mt-0.5 shrink-0" />
                  <div class="min-w-0">
                    <p class="break-words">{error()!.message}</p>
                    <Show when={installHint()}>
                      <div class="mt-2 flex items-center gap-2 rounded border border-ink-700 bg-ink-950 px-2 py-1.5 font-mono text-[11px] text-stone-300">
                        <span class="truncate">{installHint()}</span>
                        <button
                          type="button"
                          class="ml-auto shrink-0 text-stone-500 hover:text-stone-200"
                          onClick={async () => {
                            await navigator.clipboard.writeText(installHint()!);
                            showToast("info", "Copied install command");
                          }}
                          aria-label="Copy install command"
                        >
                          <CopyIcon size={12} />
                        </button>
                      </div>
                      <p class="mt-1.5 text-[11px] text-stone-500">
                        Run it in a terminal, then try again. The web UI never runs sudo for you.
                      </p>
                    </Show>
                  </div>
                </div>
              </div>
            </Show>

            <div class="flex flex-col gap-3 border-t border-ink-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p class="flex items-center gap-1.5 text-[10.5px] leading-relaxed text-stone-600 sm:text-[11px]">
                <KeyIcon size={12} class="shrink-0" />
                Passwords are stored in plaintext in state.json — local dev only.
              </p>
              <div class="flex shrink-0 justify-end gap-2">
                <Dialog.CloseButton class="btn" disabled={busy()}>
                  Cancel
                </Dialog.CloseButton>
                <button type="submit" class="btn btn-primary" disabled={busy()}>
                  {busy() ? "Creating…" : "Create & start"}
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
