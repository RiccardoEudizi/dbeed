import { indentWithTab } from "@codemirror/commands";
import { PostgreSQL, SQLite, sql } from "@codemirror/lang-sql";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { createEffect, onCleanup, onMount } from "solid-js";

export interface SqlEditorHandle {
  setValue(value: string): void;
  insert(text: string): void;
  focus(): void;
}

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", height: "100%" },
    "&.cm-focused": { outline: "none" },
    ".cm-content": { padding: "12px 0", caretColor: "#a78bfa" },
    ".cm-line": { padding: "0 14px" },
    ".cm-gutters": { backgroundColor: "transparent", borderRight: "1px solid #2a2521" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.025)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.025)" },
    ".cm-tooltip-autocomplete": {
      backgroundColor: "#1c1815",
      border: "1px solid #3a332d",
      borderRadius: "8px",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "rgba(139,92,246,0.18)",
      color: "#ede9fe",
    },
  },
  { dark: true }
);

export function SqlEditor(props: {
  value: string;
  dialect: "postgres" | "sqlite";
  tables?: string[];
  onChange: (value: string) => void;
  onRun: () => void;
  onReady?: (handle: SqlEditorHandle) => void;
  class?: string;
}) {
  let host: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const schemaCompartment = new Compartment();

  const language = () =>
    sql({
      dialect: props.dialect === "postgres" ? PostgreSQL : SQLite,
      schema: props.tables?.length
        ? { [props.dialect === "postgres" ? "public" : "main"]: props.tables }
        : undefined,
      upperCaseKeywords: true,
    });

  onMount(() => {
    if (!host) return;

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  props.onRun();
                  return true;
                },
              },
              indentWithTab,
            ])
          ),
          basicSetup,
          theme,
          schemaCompartment.of(language()),
          placeholder("select * from …    —  ⌘/Ctrl + Enter to run"),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) props.onChange(update.state.doc.toString());
          }),
          EditorView.lineWrapping,
        ],
      }),
    });

    props.onReady?.({
      setValue(value: string) {
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
        view.focus();
      },
      insert(text: string) {
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },
      focus() {
        view?.focus();
      },
    });
  });

  createEffect(() => {
    // Reconfigure when the schema/dialect arrives after mount so autocomplete
    // picks up the tables loaded asynchronously.
    props.dialect;
    props.tables;
    if (view) view.dispatch({ effects: schemaCompartment.reconfigure(language()) });
  });

  createEffect(() => {
    const value = props.value;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  });

  onCleanup(() => view?.destroy());

  return <div ref={host} class={props.class ?? "h-full"} />;
}
