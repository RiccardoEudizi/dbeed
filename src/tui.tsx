import { createSignal, createEffect, For, Show, onMount } from "solid-js";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { listInstances, startInstance, stopInstance, removeInstance, shutdownServer, type Instance } from "./api";
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
    setDetail(cur ? `${cur.name} [${cur.db}/${cur.engine}] ${cur.status} · ${shortConn(cur.connection)}` : "no instances — `dbeed create --db postgres --name demo`");
  };

  onMount(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  });

  useKeyboard((key) => {
    const list = instances();
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      void (async () => {
        if (props.owned) await shutdownServer();
        renderer.destroy();
        process.exit(0);
      })();
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
              <text fg={i() === selected() ? "#facc15" : inst.status === "running" ? "#4ade80" : "#94a3b8"}>
                {`${i() === selected() ? "▸ " : "  "}${inst.name} (${inst.db}) ${inst.status}`}
              </text>
            )}
          </For>
          <Show when={hidden() > 0}>
            <text fg="#64748b">  … +{hidden()} more</text>
          </Show>
        </Show>
        <text fg="#94a3b8">{detail()}</text>
        <text fg="#64748b">↑/↓ select · s start · t stop · d remove · r refresh · q quit</text>
      </box>
    </box>
  );
}

export async function runTui(owned: boolean) {
  await render(() => <App owned={owned} />, {
    screenMode: "split-footer",
    footerHeight: 10,
    exitOnCtrlC: true,
  });
}
