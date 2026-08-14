// Status bar: word/char count of the open note, plus vim / theme / view
// toggles. The store deliberately does not hold note content, so the count is
// fetched here — on note switch, after each autosave (dirty -> clean), and
// after external reloads — with minimal store subscriptions.

import { useEffect, useState } from "react";
import { getNote } from "../api.ts";
import { useStore } from "../state.ts";

function countWords(text: string): number {
  const words = text.trim().split(/\s+/);
  return words[0] === "" ? 0 : words.length;
}

export default function StatusBar() {
  const openPath = useStore((s) => s.openPath);
  const isDirty = useStore((s) => (s.openPath ? !!s.dirty[s.openPath] : false));
  const reloadTick = useStore((s) => s.reloadTick);
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);
  const vimMode = useStore((s) => s.vimMode);
  const setView = useStore((s) => s.setView);
  const setTheme = useStore((s) => s.setTheme);
  const toggleVim = useStore((s) => s.toggleVim);

  const [counts, setCounts] = useState<{ words: number; chars: number } | null>(null);

  useEffect(() => {
    if (!openPath) {
      setCounts(null);
      return;
    }
    if (isDirty) return; // wait for the autosave to land, then recount
    let cancelled = false;
    getNote(openPath)
      .then((note) => {
        if (!cancelled) {
          setCounts({ words: countWords(note.content), chars: note.content.length });
        }
      })
      .catch((err: unknown) => {
        console.error("vellum: loading note for word count failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [openPath, isDirty, reloadTick]);

  return (
    <footer className="s-statusbar">
      <span className="s-statusbar__counts">
        {counts
          ? `${counts.words} word${counts.words === 1 ? "" : "s"} · ${counts.chars} chars`
          : "—"}
      </span>
      <span className="s-statusbar__spacer" />
      <button
        type="button"
        className={`s-statusbar__btn${vimMode ? " s-statusbar__btn--on" : ""}`}
        onClick={toggleVim}
        title="Toggle vim keybindings"
      >
        vim
      </button>
      <button
        type="button"
        className="s-statusbar__btn"
        onClick={() => setTheme(theme === "iron-gall" ? "parchment" : "iron-gall")}
        title="Toggle theme"
      >
        {theme === "iron-gall" ? "parchment" : "iron-gall"}
      </button>
      <button
        type="button"
        className={`s-statusbar__btn${view === "graph" ? " s-statusbar__btn--on" : ""}`}
        onClick={() => setView(view === "graph" ? "editor" : "graph")}
        title="Toggle graph view (Ctrl/Cmd+G)"
      >
        graph
      </button>
    </footer>
  );
}
