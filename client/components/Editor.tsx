// The note editor. Owns one CodeMirror view per open path: loads the note,
// autosaves (600ms debounce + Ctrl/Cmd+S), tracks dirty state in the store,
// follows the vim toggle, and preserves per-note scroll position across
// tab switches.

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { getNote, putNote } from "../api.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { buildEditorState, setVim } from "../editor/setup.ts";

const AUTOSAVE_MS = 600;

/** Scroll positions survive switching tabs; module-level so remounts keep them. */
const scrollPositions = new Map<string, number>();

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
        toast(`Failed to save ${path}`);
      }
    };

    getNote(path)
      .then((note) => {
        if (disposed || !hostRef.current) return;
        const view = new EditorView({
          state: buildEditorState({
            doc: note.content,
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

        const savedScroll = scrollPositions.get(path);
        if (savedScroll !== undefined) {
          view.requestMeasure({
            read: () => undefined,
            write: () => {
              view.scrollDOM.scrollTop = savedScroll;
            },
          });
        }
        view.focus();
      })
      .catch((err) => {
        console.error(`Failed to open ${path}`, err);
        toast(`Failed to open ${path}`);
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
            toast(`Failed to save ${path}`);
          });
      }
      view.destroy();
    };
  }, [path]);

  useEffect(() => {
    if (viewRef.current) setVim(viewRef.current, vimMode);
  }, [vimMode]);

  return <div className="s-editor" ref={hostRef} />;
}
