import { createSignal, createEffect, For, Show, onMount } from "solid-js";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import {
  listInstances,
  createInstance,
  startInstance,
  stopInstance,
  removeInstance,
  shutdownServer,
  type Instance,
} from "./api";
import { ensureServer } from "./ensure-server";

const MAX_ROWS = 4;

function shortConn(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function App(props: { owned: boolean }) {
  const [instances, setInstances] = createSignal<Instance[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [counts, setCounts] = createSignal("…");
  const [detail, setDetail] = createSignal("connecting to dbeed-server…");
  const renderer = useRenderer();

  // create-modal state
  const [modalOpen, setModalOpen] = createSignal(false);
  const [field, setField] = createSignal(0); // 0=db, 1=engine, 2=name
  const [db, setDb] = createSignal("postgres");
  const [engine, setEngine] = createSignal("native");
  const [name, setName] = createSignal("");
  const [formError, setFormError] = createSignal("");
  const [creating, setCreating] = createSignal(false);

  const refresh = async () => {
    try {
      await ensureServer();
      const list = await listInstances();
      setInstances(list);
      if (selected() >= list.length) setSelected(Math.max(0, list.length - 1));
      const active = list.filter((i) => i.status === "running").length;
      setCounts(`${active} active / ${list.length} total`);
      updateDetail(list, selected());
    } catch (e: any) {
      setDetail(`server error: ${e.message}`);
    }
  };

  const updateDetail = (list: Instance[], sel: number) => {
    const cur = list[sel];
    setDetail(cur ? `${cur.name} [${cur.db}/${cur.engine}] ${cur.status} · ${shortConn(cur.connection)}` : "no instances — press c to create one");
  };

  const openModal = () => {
    setFormError("");
    setCreating(false);
    setField(0);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setCreating(false);
  };

  const submitModal = () => {
    if (!modalOpen() || creating()) return;
    const n = name().trim();
    if (!n) {
      setFormError("name required");
      setField(2);
      return;
    }
    setCreating(true);
    setFormError("");
    void (async () => {
      try {
        const inst = await createInstance({ db: db(), engine: engine(), name: n });
        closeModal();
        setDetail(`created ${inst.name} — ${inst.connection}`);
        await refresh();
      } catch (e: any) {
        setCreating(false);
        setFormError(shortConn(e.message ?? String(e), 70));
      }
    })();
  };

  onMount(() => {
    refresh();
    const t = setInterval(() => {
      if (!modalOpen()) refresh();
    }, 3000);
    return () => clearInterval(t);
  });

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      if (modalOpen()) {
        closeModal();
        return;
      }
      void (async () => {
        if (props.owned) await shutdownServer();
        renderer.destroy();
        process.exit(0);
      })();
      return;
    }
    if (modalOpen()) {
      if (key.name === "escape") closeModal();
      else if (key.name === "tab") setField((f) => (f + 1) % 3);
      else if (key.name === "enter" || key.name === "return") submitModal();
      return; // never leak list keys (s/t/d/r/q…) into typing
    }
    const list = instances();
    if (key.name === "c") {
      openModal();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      const s = Math.max(0, selected() - 1);
      setSelected(s);
      updateDetail(list, s);
    }
    if (key.name === "down" || key.name === "j") {
      const s = Math.min(Math.max(0, list.length - 1), selected() + 1);
      setSelected(s);
      updateDetail(list, s);
    }
    if (key.name === "r") refresh();
    const cur = list[selected()];
    if (!cur) return;
    if (key.name === "s") startInstance(cur.name).then(refresh).catch((e) => setDetail(`start failed: ${e.message}`));
    if (key.name === "t") stopInstance(cur.name).then(refresh).catch((e) => setDetail(`stop failed: ${e.message}`));
    if (key.name === "d") removeInstance(cur.name).then(refresh).catch((e) => setDetail(`remove failed: ${e.message}`));
  });

  createEffect(() => updateDetail(instances(), selected()));

  const visible = () => instances().slice(0, MAX_ROWS);
  const hidden = () => instances().length - visible().length;

  return (
    <box borderStyle="single" borderColor="#334155" flexDirection="row" width="100%" paddingLeft={1} paddingRight={1} gap={2}>
      <box flexDirection="column" width={21}>
        <ascii_font text="DB" font="block" color="#a855f7" />
        <text fg="#64748b">dbeed</text>
      </box>
      <box flexDirection="column" flexGrow={1}>
        <text fg="#7dd3fc">dbeed · {counts()}</text>
        <Show when={instances().length > 0} fallback={<text fg="#64748b">(empty)</text>}>
          <For each={visible()}>
            {(inst, i) => (
              <text fg={i() === selected() ? "#c084fc" : inst.status === "running" ? "#4ade80" : "#94a3b8"}>
                {`${i() === selected() ? "▸ " : "  "}${inst.name} (${inst.db}) ${inst.status}`}
              </text>
            )}
          </For>
          <Show when={hidden() > 0}>
            <text fg="#64748b">  … +{hidden()} more</text>
          </Show>
        </Show>
        <text fg="#94a3b8">{detail()}</text>
        <text fg="#64748b">↑/↓ select · c create · s start · t stop · d remove · r refresh · q quit</text>
      </box>
      <Show when={modalOpen()}>
        <box
          position="absolute"
          left="20%"
          top={1}
          width="60%"
          borderStyle="rounded"
          borderColor="#a855f7"
          backgroundColor="#0f172a"
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
          title="Create database"
        >
          <box flexDirection="row" gap={1}>
            <text fg="#64748b">DB:</text>
            <tab_select
              focused={field() === 0}
              selectedBackgroundColor="#3b2d5e"
              selectedTextColor="#e9d5ff"
              options={[
                { name: "postgres", description: "", value: "postgres" },
                { name: "sqlite", description: "", value: "sqlite" },
              ]}
              onChange={(_i, o) => o?.value && setDb(String(o.value))}
            />
          </box>
          <box flexDirection="row" gap={1}>
            <text fg="#64748b">Engine:</text>
            <tab_select
              focused={field() === 1}
              selectedBackgroundColor="#3b2d5e"
              selectedTextColor="#e9d5ff"
              options={[
                { name: "native", description: "", value: "native" },
                { name: "docker", description: "", value: "docker" },
              ]}
              onChange={(_i, o) => o?.value && setEngine(String(o.value))}
            />
          </box>
          <box flexDirection="row" gap={1}>
            <text fg="#64748b">Name:</text>
            <input
              focused={field() === 2}
              placeholder="instance name"
              width={24}
              value={name()}
              onInput={setName}
            />
          </box>
          <Show when={creating()}>
            <text fg="#a855f7">creating…</text>
          </Show>
          <Show when={formError()}>
            <text fg="#f87171">{formError()}</text>
          </Show>
          <text fg="#64748b">tab next · ←/→ choose · enter create · esc cancel</text>
        </box>
      </Show>
    </box>
  );
}

export async function runTui(owned: boolean) {
  await render(() => <App owned={owned} />, {
    screenMode: "split-footer",
    footerHeight: 12,
    exitOnCtrlC: true,
  });
}
