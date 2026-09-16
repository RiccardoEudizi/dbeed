import { createSignal, createMemo, For, Show, onMount, createEffect } from "solid-js";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import {
  listInstances,
  createInstance,
  startInstance,
  stopInstance,
  removeInstance,
  getSchema,
  getRows,
  shutdownServer,
  type Instance,
  type DbSchema,
  type TableRows,
} from "./api";
import { ensureServer } from "./ensure-server";

type View = "schema" | "data";
type Focus = "dbs" | "tables" | "main";

// Opencode-style neutral theme: no purple, dark sidebars, stone visualizer.
const BG_SIDE = "#0e0e11";
const BG_MAIN = "#1c1917";
const BG_CHROME = "#111113";
const BG_SELECT = "#292524";
const BORDER = "#262626";
const BORDER_FOCUS = "#737373";
const FG = "#e7e5e4";
const FG_BRIGHT = "#fafaf9";
const FG_DIM = "#a8a29e";
const FG_FAINT = "#57534e";

const ROW_LIMIT = 100;
const ROW_WIN = 18;
const CELL_W = 18;
const COL_WIN = 6;

function short(s: string, n = 48): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function cell(s: string | null, n = CELL_W): string {
  if (s === null) return "NULL";
  const flat = s.replace(/[\r\n\t]+/g, " ");
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

function App(props: { owned: boolean; preselect?: string }) {
  const [instances, setInstances] = createSignal<Instance[]>([]);
  const [selDb, setSelDb] = createSignal(0);
  const [selTbl, setSelTbl] = createSignal(0);
  const [schema, setSchema] = createSignal<DbSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = createSignal(false);
  const [schemaError, setSchemaError] = createSignal("");
  const [status, setStatus] = createSignal("connecting…");
  const [view, setView] = createSignal<View>("schema");
  const [focus, setFocus] = createSignal<Focus>("dbs");
  const [withCounts, setWithCounts] = createSignal(false);
  const [dbOffset, setDbOffset] = createSignal(0);
  const [tblOffset, setTblOffset] = createSignal(0);

  // data view state
  const [rows, setRows] = createSignal<TableRows | null>(null);
  const [rowsLoading, setRowsLoading] = createSignal(false);
  const [rowsError, setRowsError] = createSignal("");
  const [rowSel, setRowSel] = createSignal(0);
  const [colOff, setColOff] = createSignal(0);
  const [rowOffset, setRowOffset] = createSignal(0);

  // filter mode: "/" types into focused sidebar filter
  const [filtering, setFiltering] = createSignal<null | Focus>(null);
  const [dbFilter, setDbFilter] = createSignal("");
  const [tblFilter, setTblFilter] = createSignal("");

  // create wizard (copied minimal from mini tui)
  const [modalOpen, setModalOpen] = createSignal(false);
  const [step, setStep] = createSignal(0);
  const [db, setDb] = createSignal("postgres");
  const [engine, setEngine] = createSignal("native");
  const [name, setName] = createSignal("");
  const [formError, setFormError] = createSignal("");
  const [creating, setCreating] = createSignal(false);

  const renderer = useRenderer();

  const filteredDbs = createMemo(() => {
    const f = dbFilter().toLowerCase();
    const list = instances();
    if (!f) return list;
    return list.filter((inst) => inst.name.toLowerCase().includes(f));
  });

  const curDb = createMemo(() => {
    const rows = filteredDbs();
    if (rows.length === 0) return null;
    const safe = Math.min(selDb(), rows.length - 1);
    return rows[safe] ?? null;
  });

  const filteredTbls = createMemo(() => {
    const f = tblFilter().toLowerCase();
    const tbls = schema()?.tables ?? [];
    if (!f) return tbls;
    return tbls.filter((t) => t.name.toLowerCase().includes(f));
  });

  const curTbl = createMemo(() => {
    const rows = filteredTbls();
    if (rows.length === 0) return null;
    return rows[Math.min(selTbl(), rows.length - 1)] ?? null;
  });

  const refreshInstances = async () => {
    try {
      await ensureServer();
      const list = await listInstances();
      setInstances(list);
      if (props.preselect) {
        const i = filteredDbs().findIndex((inst) => inst.name === props.preselect);
        if (i >= 0) setSelDb(i);
      }
      if (selDb() >= Math.max(1, filteredDbs().length)) setSelDb(0);
      const c = curDb();
      setStatus(
        c
          ? `${c.name} [${c.db}/${c.engine}] ${c.status}`
          : list.length === 0
            ? "no instances — press c to create one"
            : "select a database",
      );
    } catch (e: any) {
      setStatus(`server error: ${e.message}`);
    }
  };

  const loadSchema = async (counts?: boolean) => {
    const c = curDb();
    if (!c) {
      setSchema(null);
      return;
    }
    if (c.status !== "running") {
      setSchema(null);
      setSchemaError("stopped — press s to start");
      return;
    }
    setSchemaLoading(true);
    setSchemaError("");
    try {
      await ensureServer();
      const s = await getSchema(c.name, counts ?? withCounts());
      setSchema(s);
      setSelTbl((prev) => Math.min(prev, Math.max(0, s.tables.length - 1)));
    } catch (e: any) {
      setSchema(null);
      setSchemaError(short(e.message ?? String(e), 90));
    } finally {
      setSchemaLoading(false);
    }
  };

  const rowsKey = () => `${curDb()?.name ?? ""}.${curTbl()?.name ?? ""}`;
  let lastRowsKey = "";

  const loadRows = async (resetPage = false) => {
    const dbInst = curDb();
    const tbl = curTbl();
    if (!dbInst || !tbl) {
      setRows(null);
      return;
    }
    if (dbInst.status !== "running") {
      setRows(null);
      setRowsError("stopped — press s to start");
      return;
    }
    if (resetPage) {
      setRowOffset(0);
      setRowSel(0);
      setColOff(0);
    }
    setRowsLoading(true);
    setRowsError("");
    try {
      await ensureServer();
      const r = await getRows(dbInst.name, tbl.name, ROW_LIMIT, resetPage ? 0 : rowOffset());
      setRows(r);
      lastRowsKey = rowsKey();
      setRowSel((prev) => Math.min(prev, Math.max(0, r.rows.length - 1)));
      setColOff((prev) => Math.min(prev, Math.max(0, r.columns.length - 1)));
    } catch (e: any) {
      setRows(null);
      setRowsError(short(e.message ?? String(e), 90));
    } finally {
      setRowsLoading(false);
    }
  };

  const maybeReloadRows = () => {
    if (view() !== "data") return;
    if (rowsKey() !== lastRowsKey) {
      void loadRows(true);
    }
  };

  const refreshAll = async () => {
    await refreshInstances();
    await loadSchema();
    if (view() === "data") await loadRows();
  };

  // keep selection window visible + reload schema when DB changes
  let lastDbName = "";
  const syncSelection = () => {
    const rows = filteredDbs().length;
    if (selDb() >= rows) setSelDb(Math.max(0, rows - 1));
    if (selDb() < dbOffset()) setDbOffset(selDb());
    if (selDb() >= dbOffset() + 18) setDbOffset(Math.max(0, selDb() - 17));
    const trows = filteredTbls().length;
    if (selTbl() >= trows) setSelTbl(Math.max(0, trows - 1));
    if (selTbl() < tblOffset()) setTblOffset(selTbl());
    if (selTbl() >= tblOffset() + 18) setTblOffset(Math.max(0, selTbl() - 17));
    const nm = curDb()?.name ?? "";
    if (nm !== lastDbName) {
      lastDbName = nm;
      setSelTbl(0);
      setTblOffset(0);
      setTblFilter("");
      lastRowsKey = "";
      setRows(null);
      void loadSchema().then(() => maybeReloadRows());
    } else {
      maybeReloadRows();
    }
  };

  onMount(() => {
    void refreshAll().then(() => {
      lastDbName = curDb()?.name ?? "";
    });
    const t = setInterval(() => {
      if (!modalOpen()) void refreshInstances();
    }, 5000);
    return () => clearInterval(t);
  });

  // reload rows when the selected table changes while in data view
  createEffect(() => {
    const key = rowsKey();
    if (view() === "data" && key && key !== lastRowsKey) {
      void loadRows(true);
    }
  });

  const openModal = () => {
    setFormError("");
    setCreating(false);
    setStep(0);
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setCreating(false);
  };
  const submitModal = () => {
    const n = name().trim();
    if (!n) {
      setFormError("name required");
      setStep(2);
      return;
    }
    setCreating(true);
    void (async () => {
      try {
        await createInstance({ db: db(), engine: engine(), name: n });
        closeModal();
        await refreshAll();
      } catch (e: any) {
        setCreating(false);
        setFormError(short(e.message ?? String(e), 70));
      }
    })();
  };

  const toggleView = () => {
    setView((v) => {
      const next = v === "schema" ? "data" : "schema";
      if (next === "data") {
        lastRowsKey = "";
        void loadRows(true);
      }
      return next;
    });
  };

  const nextPage = () => {
    const r = rows();
    if (!r) {
      void loadRows();
      return;
    }
    if (r.offset + r.rows.length >= r.total) return;
    setRowOffset(r.offset + ROW_LIMIT);
    setRowSel(0);
    void loadRows();
  };

  const prevPage = () => {
    const r = rows();
    const off = r ? r.offset - ROW_LIMIT : rowOffset() - ROW_LIMIT;
    if (off < 0 && rowOffset() <= 0) return;
    setRowOffset(Math.max(0, off));
    setRowSel(0);
    void loadRows();
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      void (async () => {
        if (props.owned) await shutdownServer().catch(() => {});
        renderer.destroy();
        process.exit(0);
      })();
      return;
    }
    if (modalOpen()) {
      if (key.name === "escape") closeModal();
      else if (key.name === "enter" || key.name === "return") {
        if (step() === 0) setStep(db() === "sqlite" ? 2 : 1);
        else if (step() === 1) setStep(2);
        else submitModal();
      }
      return;
    }
    const flt = filtering();
    if (flt) {
      if (key.name === "escape" || key.name === "enter" || key.name === "return") {
        setFiltering(null);
        return;
      }
      if (key.name === "backspace") {
        if (flt === "dbs") setDbFilter((s) => s.slice(0, -1));
        else setTblFilter((s) => s.slice(0, -1));
        setSelDb(0);
        setSelTbl(0);
        return;
      }
      if (key.sequence && key.sequence.length === 1 && /^[\w.\-]$/.test(key.sequence)) {
        if (flt === "dbs") setDbFilter((s) => s + key.sequence);
        else setTblFilter((s) => s + key.sequence);
        setSelDb(0);
        setSelTbl(0);
        return;
      }
      return;
    }

    const f = focus();
    const inDataMain = f === "main" && view() === "data";

    // data-grid navigation takes over h/l while the grid is focused;
    // esc returns to the tables pane
    if (inDataMain) {
      const ncols = rows()?.columns.length ?? 0;
      const nrows = rows()?.rows.length ?? 0;
      switch (key.name) {
        case "escape":
          setFocus("tables");
          return;
        case "tab":
        case "v":
          toggleView();
          return;
        case "up":
        case "k":
          if (nrows > 0) setRowSel((s) => Math.max(0, s - 1));
          return;
        case "down":
        case "j":
          if (nrows > 0) {
            if (rowSel() >= nrows - 1) nextPage();
            else setRowSel((s) => Math.min(nrows - 1, s + 1));
          }
          return;
        case "left":
        case "h":
          setColOff((c) => Math.max(0, c - 1));
          return;
        case "right":
        case "l":
          setColOff((c) => Math.min(Math.max(0, ncols - 1), c + 1));
          return;
        case "n":
        case "pagedown":
        case "]":
          nextPage();
          return;
        case "p":
        case "pageup":
        case "[":
          prevPage();
          return;
        case "r":
          void loadRows();
          return;
        case "q":
          void (async () => {
            if (props.owned) await shutdownServer().catch(() => {});
            renderer.destroy();
            process.exit(0);
          })();
          return;
      }
    }

    switch (key.name) {
      case "q":
        void (async () => {
          if (props.owned) await shutdownServer().catch(() => {});
          renderer.destroy();
          process.exit(0);
        })();
        return;
      case "tab":
      case "v":
        toggleView();
        return;
      case "r":
      case "R":
        if (key.name === "R" || key.shift) {
          void (async () => {
            setWithCounts(true);
            await loadSchema(true);
          })();
        } else {
          void refreshAll();
        }
        return;
      case "c":
      case "C":
        if (key.name === "C" || key.shift) {
          setWithCounts((w) => {
            void loadSchema(!w);
            return !w;
          });
        } else {
          openModal();
        }
        return;
      case "/":
        setFiltering(f === "main" ? "tables" : f);
        return;
      case "escape":
        setDbFilter("");
        setTblFilter("");
        return;
      case "h":
      case "left":
        setFocus(f === "dbs" ? "main" : f === "tables" ? "dbs" : "tables");
        return;
      case "l":
      case "right":
        setFocus(f === "dbs" ? "tables" : f === "tables" ? "main" : "dbs");
        return;
      case "up":
      case "k":
        if (f === "dbs") setSelDb((s) => Math.max(0, s - 1));
        else setSelTbl((s) => Math.max(0, s - 1));
        syncSelection();
        return;
      case "down":
      case "j":
        if (f === "dbs") setSelDb((s) => Math.min(Math.max(0, filteredDbs().length - 1), s + 1));
        else setSelTbl((s) => Math.min(Math.max(0, filteredTbls().length - 1), s + 1));
        syncSelection();
        return;
      case "enter":
      case "return":
        if (f === "dbs") {
          setFocus("tables");
          void loadSchema();
        } else if (f === "tables") setFocus("main");
        return;
    }
    const cur = curDb();
    if (!cur) return;
    if (key.name === "s") {
      setStatus(`starting ${cur.name}…`);
      void startInstance(cur.name)
        .then(() => refreshAll())
        .catch((e) => setStatus(`start failed: ${e.message}`));
    }
    if (key.name === "t") {
      setStatus(`stopping ${cur.name}…`);
      void stopInstance(cur.name)
        .then(() => refreshAll())
        .catch((e) => setStatus(`stop failed: ${e.message}`));
    }
    if (key.name === "d") {
      setStatus(`removing ${cur.name}…`);
      void removeInstance(cur.name)
        .then(() => {
          setSchema(null);
          setRows(null);
          lastRowsKey = "";
          setSelDb(0);
          return refreshAll();
        })
        .catch((e) => setStatus(`remove failed: ${e.message}`));
    }
  });

  const dbRows = createMemo(() => filteredDbs().slice(dbOffset(), dbOffset() + 18));
  const tblRows = createMemo(() => {
    const all = filteredTbls();
    return all.slice(tblOffset(), tblOffset() + 18);
  });

  const relsFor = (table: string) =>
    (schema()?.relations ?? []).filter((r) => r.from.table === table || r.to.table === table);

  const visCols = createMemo(() => {
    const cols = rows()?.columns ?? [];
    return cols.slice(colOff(), colOff() + COL_WIN);
  });

  const visRows = createMemo(() => {
    const all = rows()?.rows ?? [];
    if (all.length <= ROW_WIN) return { list: all.map((r, i) => ({ r, i })), start: 0 };
    const start = Math.max(0, Math.min(rowSel() - 9, all.length - ROW_WIN));
    return { list: all.slice(start, start + ROW_WIN).map((r, k) => ({ r, i: start + k })), start };
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={BG_SIDE}>
      <box flexDirection="row" height={4} borderStyle="single" borderColor={BORDER} backgroundColor={BG_CHROME} paddingLeft={1} paddingRight={1}>
        <box flexDirection="column" flexGrow={1}>
          <text fg={FG}>{`dbeed dbm | ${instances().length} dbs | ${schema()?.tables.length ?? 0} tables | ${schema()?.relations.length ?? 0} rels`}</text>
          <text fg={FG_FAINT}>{`view:${view()} (tab/v) | focus:${focus()} (h/l) | counts:${withCounts() ? "on" : "off"} (C)`}</text>
        </box>
        <box flexDirection="column" width={30}>
          <text fg={view() === "schema" ? FG_BRIGHT : FG_FAINT}>{`${view() === "schema" ? ">" : " "} schema view`}</text>
          <text fg={view() === "data" ? FG_BRIGHT : FG_FAINT}>{`${view() === "data" ? ">" : " "} data view`}</text>
        </box>
      </box>

      <box flexDirection="row" flexGrow={1}>
        <box
          flexDirection="column"
          width={24}
          borderStyle="single"
          borderColor={focus() === "dbs" ? BORDER_FOCUS : BORDER}
          title="dbs"
          titleColor={focus() === "dbs" ? FG_BRIGHT : FG_FAINT}
          backgroundColor={BG_SIDE}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={() => setFocus("dbs")}
        >
          <Show when={filtering() === "dbs" || dbFilter()}>
            <text fg="#fbbf24">{`/${dbFilter()}${filtering() === "dbs" ? "▌" : ""}`}</text>
          </Show>
          <Show when={filteredDbs().length > 0} fallback={<text fg={FG_FAINT}>(empty)</text>}>
            <For each={dbRows()}>
              {(row, pos) => {
                const absPos = () => dbOffset() + pos();
                const sel = () => absPos() === selDb();
                return (
                  <text selectable={false} fg={sel() ? FG_BRIGHT : row.status === "running" ? FG : FG_DIM} bg={sel() ? BG_SELECT : undefined}>
                    {`${sel() ? "> " : "  "}${row.status === "running" ? "*" : "o"} ${row.name} (${row.db})`}
                  </text>
                );
              }}
            </For>
          </Show>
        </box>

        <box
          flexDirection="column"
          width={30}
          borderStyle="single"
          borderColor={focus() === "tables" ? BORDER_FOCUS : BORDER}
          title={`tables (${filteredTbls().length})`}
          titleColor={focus() === "tables" ? FG_BRIGHT : FG_FAINT}
          backgroundColor={BG_SIDE}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={() => setFocus("tables")}
        >
          <Show when={schemaLoading()}>
            <text fg={FG_DIM}>loading schema…</text>
          </Show>
          <Show when={schemaError()}>
            <text fg="#f87171">{schemaError()}</text>
          </Show>
          <Show when={filtering() === "tables" || tblFilter()}>
            <text fg="#fbbf24">{`/${tblFilter()}${filtering() === "tables" ? "|" : ""}`}</text>
          </Show>
          <Show when={!schemaLoading() && !schemaError() && filteredTbls().length === 0}>
            <text fg={FG_FAINT}>{schema() ? "(no tables)" : "(no schema)"}</text>
          </Show>
          <For each={tblRows()}>
            {(t, pos) => {
              const absPos = () => tblOffset() + pos();
              const sel = () => absPos() === selTbl();
              const nrels = () => (schema()?.relations ?? []).filter((r) => r.from.table === t.name || r.to.table === t.name).length;
              return (
                <text selectable={false} fg={sel() ? FG_BRIGHT : FG} bg={sel() ? BG_SELECT : undefined}>
                  {`${sel() ? "> " : "  "}${t.name} (${t.columns.length}c${nrels() > 0 ? ` ${nrels()}x` : ""})`}
                </text>
              );
            }}
          </For>
        </box>

        <box
          flexDirection="column"
          flexGrow={1}
          borderStyle="single"
          borderColor={focus() === "main" ? BORDER_FOCUS : BORDER}
          title={curTbl() ? `${curTbl()!.name} | ${view()}` : "detail"}
          titleColor={focus() === "main" ? FG_BRIGHT : FG_FAINT}
          backgroundColor={BG_MAIN}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={() => setFocus("main")}
        >
          <Show when={curTbl()}>
            <Show when={view() === "schema"}>
              <text fg={FG}>{`${curTbl()!.schema}.${curTbl()!.name}${curTbl()!.rowCount !== undefined ? ` | ${curTbl()!.rowCount} rows` : ""}`}</text>
              <For each={curTbl()!.columns}>
                {(c) => (
                  <text fg={c.pk ? "#fbbf24" : FG}>
                    {`  ${c.pk ? "*" : "-"} ${c.name}: ${c.type}${c.nullable ? "" : " NOT NULL"}${c.default ? ` = ${c.default}` : ""}`}
                  </text>
                )}
              </For>
              <text fg={FG_FAINT}> </text>
              <text fg={FG_DIM}>{`relations (${relsFor(curTbl()!.name).length})`}</text>
              <Show when={relsFor(curTbl()!.name).length === 0}>
                <text fg={FG_FAINT}>  (none)</text>
              </Show>
              <For each={relsFor(curTbl()!.name)}>
                {(r) => (
                  <text fg={FG_DIM}>{`  ${r.from.table}.${r.from.column} -> ${r.to.table}.${r.to.column}  (${r.name})`}</text>
                )}
              </For>
            </Show>
            <Show when={view() === "data"}>
              <Show when={rowsLoading()}>
                <text fg={FG_DIM}>loading rows…</text>
              </Show>
              <Show when={rowsError()}>
                <text fg="#f87171">{rowsError()}</text>
              </Show>
              <Show when={!rowsLoading() && !rowsError() && rows()}>
                <text fg={FG_FAINT}>{`${rows()!.columns.length} cols | rows ${rows()!.offset + 1}-${rows()!.offset + rows()!.rows.length} of ${rows()!.total} | row ${rowSel() + 1}/${rows()!.rows.length}`}</text>
                <text fg={FG_BRIGHT}>{visCols().map((c) => cell(c).padEnd(CELL_W)).join(" | ")}</text>
                <text fg={FG_FAINT}>{visCols().map(() => "-".repeat(CELL_W)).join("-+-")}</text>
                <For each={visRows().list}>
                  {({ r, i }) => {
                    const sel = () => i === rowSel();
                    return (
                      <text selectable={false} fg={sel() ? FG_BRIGHT : FG} bg={sel() ? BG_SELECT : undefined}>
                        {r
                          .slice(colOff(), colOff() + COL_WIN)
                          .map((v) => cell(v).padEnd(CELL_W))
                          .join(" | ")}
                      </text>
                    );
                  }}
                </For>
                <text fg={FG_FAINT}> </text>
                <text fg={FG_FAINT}>j/k row | h/l cols | n/p page | esc tables | tab schema</text>
              </Show>
              <Show when={!rowsLoading() && !rowsError() && !rows()}>
                <text fg={FG_FAINT}>press tab/v to load data</text>
              </Show>
            </Show>
          </Show>
          <Show when={!curTbl() && !schemaLoading()}>
            <text fg={FG_FAINT}>select a table</text>
          </Show>
        </box>
      </box>

      <box flexDirection="row" height={4} borderStyle="single" borderColor={BORDER} backgroundColor={BG_CHROME} paddingLeft={1} paddingRight={1}>
        <box flexDirection="column" flexGrow={1}>
          <text fg={FG_DIM}>{short(status(), 100)}</text>
          <text fg={FG_FAINT}>j/k nav | h/l focus | enter open | tab/v schema|data | / filter | s/t/d db | r refresh | R counts | q quit</text>
        </box>
      </box>

      <Show when={modalOpen()}>
        <box position="absolute" left={0} top={0} width="100%" height="100%" flexDirection="column" justifyContent="center" alignItems="center">
          <box width="60%" backgroundColor={BG_MAIN} borderStyle="single" borderColor={BORDER} paddingLeft={2} paddingRight={2} flexDirection="column" gap={1}>
            <text fg={FG_BRIGHT}>Create database ({step() + 1}/3)</text>
            <Show when={step() === 0}>
              <text fg={FG}>Which database?</text>
              <select
                focused
                showDescription={false}
                height={2}
                selectedBackgroundColor={BG_SELECT}
                selectedTextColor={FG_BRIGHT}
                options={[
                  { name: "postgres", description: "", value: "postgres" },
                  { name: "sqlite", description: "", value: "sqlite" },
                ]}
                onChange={(_i, o) => o?.value && setDb(String(o.value))}
              />
            </Show>
            <Show when={step() === 1}>
              <text fg={FG}>Which engine?</text>
              <select
                focused
                showDescription={false}
                height={2}
                selectedBackgroundColor={BG_SELECT}
                selectedTextColor={FG_BRIGHT}
                options={[
                  { name: "native", description: "", value: "native" },
                  { name: "docker", description: "", value: "docker" },
                ]}
                onChange={(_i, o) => o?.value && setEngine(String(o.value))}
              />
            </Show>
            <Show when={step() === 2}>
              <text fg={FG}>Instance name?</text>
              <input focused placeholder="my-db" width={24} value={name()} onInput={setName} />
            </Show>
            <Show when={creating()}>
              <text fg={FG_DIM}>creating…</text>
            </Show>
            <Show when={formError()}>
              <text fg="#f87171">{formError()}</text>
            </Show>
            <text fg={FG_FAINT}>enter next | esc cancel</text>
          </box>
        </box>
      </Show>
    </box>
  );
}

export async function runDbmTui(owned: boolean, preselect?: string) {
  await render(() => <App owned={owned} preselect={preselect} />, {
    exitOnCtrlC: true,
  });
}
