// The note editor. Owns one CodeMirror view per open path: loads the note,
// autosaves (600ms debounce + Ctrl/Cmd+S), tracks dirty state in the store,
// follows the vim toggle, and preserves per-note scroll position across
// tab switches.

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { focusIsClaimed } from "../a11y.ts";
import { getNote, putNote } from "../api.ts";
import { tf } from "../i18n.ts";
import { Lru } from "../lru.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { buildEditorState, setVim } from "../editor/setup.ts";
import { languageChanged } from "../editor/langEffect.ts";
import { findHeadingLine } from "../editor/links.ts";

const AUTOSAVE_MS = 600;

/** Offset just past a leading YAML frontmatter block (0 if none). Opening a
 *  note lands the cursor here so frontmatter renders as its properties card
 *  instead of raw YAML. */
function afterFrontmatter(content: string): number {
  if (!/^---\r?\n/.test(content)) return 0;
  const m = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
  return m ? m[0].length : 0;
}

/** Scroll positions survive switching tabs; module-level so remounts keep them.
 *  Bounded (client/lru.ts): unbounded, its ceiling is "every note edited this
 *  session", i.e. the vault. */
const scrollPositions = new Lru<number>({ max: 256 });

function markDirty(path: string, dirty: boolean): void {
  useStore.setState((state) =>
    state.dirty[path] === dirty
      ? state
      : { dirty: { ...state.dirty, [path]: dirty } },
  );
}

export default function Editor({ path }: { path: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimMode = useStore((s) => s.vimMode);
  // The editor's chrome (properties card, fold chevrons, transclusion cards,
  // upload pills) is CM6 widget DOM, not React, so it cannot subscribe to the
  // store the way i18n.ts asks components to. This is its subscription: a
  // settings language flip dispatches one effect into the live view, which is
  // what makes the decoration builders rebuild (see editor/langEffect.ts).
  const language = useStore((s) => s.language);

  useEffect(() => {
    let disposed = false;
    let dirty = false;
    let saveTimer: number | undefined;

    const save = async (view: EditorView): Promise<void> => {
      window.clearTimeout(saveTimer);
      const content = view.state.doc.toString();
      try {
        await putNote(path, content);
        // Only clear dirty if nothing changed while the request was in flight.
        if (view.state.doc.toString() === content) {
          dirty = false;
          markDirty(path, false);
        }
      } catch (err) {
        console.error(`Failed to save ${path}`, err);
        toast(tf("saveFailed", { path }));
      }
    };

    getNote(path)
      .then((note) => {
        if (disposed || !hostRef.current) return;
        const view = new EditorView({
          state: buildEditorState({
            doc: note.content,
            path,
            vimMode: useStore.getState().vimMode,
            onDocChanged: (v) => {
              dirty = true;
              markDirty(path, true);
              window.clearTimeout(saveTimer);
              saveTimer = window.setTimeout(() => void save(v), AUTOSAVE_MS);
            },
            onSave: (v) => void save(v),
          }),
          parent: hostRef.current,
        });
        viewRef.current = view;

        // Vim loads lazily; patch it into the fresh view once the module is in.
        if (useStore.getState().vimMode) setVim(view, true);

        const anchor = afterFrontmatter(note.content);
        if (anchor > 0 && anchor <= view.state.doc.length) {
          view.dispatch({ selection: { anchor } });
        }

        // [[Note#Heading]] navigation: land on the requested heading.
        const pending = useStore.getState().pendingHeading;
        if (pending !== null) {
          useStore.getState().setPendingHeading(null);
          const line = findHeadingLine(note.content, pending);
          if (line !== null && line <= view.state.doc.lines) {
            const pos = view.state.doc.line(line).from;
            view.dispatch({
              selection: { anchor: pos },
              effects: EditorView.scrollIntoView(pos, {
                y: "start",
                yMargin: 24,
              }),
            });
            if (!focusIsClaimed()) view.focus();
            return;
          }
        }

        const savedScroll = scrollPositions.get(path);
        if (savedScroll !== undefined) {
          view.requestMeasure({
            read: () => undefined,
            write: () => {
              view.scrollDOM.scrollTop = savedScroll;
            },
          });
        }
        // Opening a note normally means "I want to write in it", so the caret
        // comes here — unless a chrome widget is mid-keystroke and said the
        // focus is its (the tab bar arrowing between notes; see a11y.ts).
        if (!focusIsClaimed()) view.focus();
      })
      .catch((err) => {
        console.error(`Failed to open ${path}`, err);
        toast(tf("openFailed", { path }));
      });

    return () => {
      disposed = true;
      window.clearTimeout(saveTimer);
      const view = viewRef.current;
      viewRef.current = null;
      if (!view) return;
      scrollPositions.set(path, view.scrollDOM.scrollTop);
      if (dirty) {
        // Flush unsaved changes before the view goes away.
        const content = view.state.doc.toString();
        putNote(path, content)
          .then(() => markDirty(path, false))
          .catch((err) => {
            console.error(`Failed to save ${path}`, err);
            toast(tf("saveFailed", { path }));
          });
      }
      view.destroy();
    };
  }, [path]);

  useEffect(() => {
    if (viewRef.current) setVim(viewRef.current, vimMode);
  }, [vimMode]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageChanged.of(null) });
  }, [language]);

  // Outline (TOC) clicks: jump the editor to the heading's source line.
  useEffect(() => {
    const onGoto = (ev: Event): void => {
      const view = viewRef.current;
      if (!view) return;
      const detail =
        (ev as CustomEvent<{ line?: number; text?: string }>).detail ?? {};
      let line = detail.line ?? null;
      if (line === null && detail.text) {
        line = findHeadingLine(view.state.doc.toString(), detail.text);
      }
      if (!line || line < 1 || line > view.state.doc.lines) {
        return;
      }
      const pos = view.state.doc.line(line).from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 24 }),
      });
      view.focus();
    };
    window.addEventListener("vellum:goto-heading", onGoto);
    return () => window.removeEventListener("vellum:goto-heading", onGoto);
  }, []);

  return <div className="s-editor" ref={hostRef} />;
}
