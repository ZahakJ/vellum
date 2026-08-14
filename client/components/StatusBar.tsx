// Status bar: word/char count of the open note, plus vim / theme / view
// toggles. The store deliberately does not hold note content, so the count is
// fetched here — on note switch, after each autosave (dirty -> clean), and
// after external reloads — with minimal store subscriptions.

import { Fragment, useEffect, useState } from "react";
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
  const readingMode = useStore((s) => s.readingMode);
  const setView = useStore((s) => s.setView);
  const setTheme = useStore((s) => s.setTheme);
  const toggleVim = useStore((s) => s.toggleVim);
  const toggleReading = useStore((s) => s.toggleReading);
  const admin = useStore((s) => s.admin);
  const setLoginOpen = useStore((s) => s.setLoginOpen);

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

  const crumbs = openPath ? openPath.replace(/\.md$/, "").split("/") : [];

  return (
    <footer className="s-statusbar">
      {crumbs.length > 0 ? (
        <span className="s-statusbar__crumbs" title={openPath ?? undefined}>
          {crumbs.map((part, i) => (
            <Fragment key={`${i}:${part}`}>
              {i > 0 && (
                <span className="s-statusbar__crumb-sep" aria-hidden="true">
                  ›
                </span>
              )}
              <span
                className={`s-statusbar__crumb${
                  i === crumbs.length - 1 ? " s-statusbar__crumb--leaf" : ""
                }`}
              >
                {part}
              </span>
            </Fragment>
          ))}
        </span>
      ) : (
        <span className="s-statusbar__crumbs s-statusbar__crumb">No note open</span>
      )}
      <span className="s-statusbar__spacer" />
      {counts && (
        <>
          <span className="s-statusbar__counts">
            {counts.words} word{counts.words === 1 ? "" : "s"} · {counts.chars}{" "}
            chars
          </span>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
        </>
      )}
      {admin && (
        <>
          <button
            type="button"
            className={`s-statusbar__btn${readingMode ? " s-statusbar__btn--on" : ""}`}
            onClick={toggleReading}
            title="Toggle reading view (Ctrl/Cmd+E)"
          >
            read
          </button>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className={`s-statusbar__btn${vimMode ? " s-statusbar__btn--on" : ""}`}
            onClick={toggleVim}
            title="Toggle vim keybindings"
          >
            vim
          </button>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
        </>
      )}
      <button
        type="button"
        className="s-statusbar__btn"
        onClick={() => setTheme(theme === "iron-gall" ? "parchment" : "iron-gall")}
        title={`Switch to ${theme === "iron-gall" ? "parchment" : "iron-gall"} theme`}
        aria-label="Toggle theme"
      >
        {theme === "iron-gall" ? "☾" : "☀"}
      </button>
      <span className="s-statusbar__dot" aria-hidden="true">
        ·
      </span>
      <button
        type="button"
        className={`s-statusbar__btn${view === "graph" ? " s-statusbar__btn--on" : ""}`}
        onClick={() => setView(view === "graph" ? "editor" : "graph")}
        title="Toggle graph view (Ctrl/Cmd+G)"
      >
        graph
      </button>
      {!admin && (
        <>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className="s-statusbar__btn s-statusbar__signin"
            onClick={() => setLoginOpen(true)}
            title="Sign in to edit this vault"
          >
            Sign in
          </button>
        </>
      )}
    </footer>
  );
}
