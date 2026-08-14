// Status bar: word/char count of the open note, plus vim / theme / view
// toggles. The store deliberately does not hold note content, so the count is
// fetched here — on note switch, after each autosave (dirty -> clean), and
// after external reloads — with minimal store subscriptions.

import { Fragment, useEffect, useState } from "react";
import { getNote } from "../api.ts";
import { isPublishedContent } from "../publish.ts";
import { nextTheme, useStore } from "../state.ts";

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
  const authProtected = useStore((s) => s.authProtected);
  const openPublished = useStore((s) => s.openPublished);
  const publishedCounts = useStore((s) => s.publishedCounts);
  const publishedFilter = useStore((s) => s.publishedFilter);
  const setPublishedFilter = useStore((s) => s.setPublishedFilter);
  const togglePublish = useStore((s) => s.togglePublish);

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
          // Single source for the open note's publish state: its frontmatter.
          const s = useStore.getState();
          if (s.openPath === openPath) s.setOpenPublished(isPublishedContent(note.content));
        }
      })
      .catch((err: unknown) => {
        console.error("vellum: loading note for word count failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [openPath, isDirty, reloadTick]);

  // Visitors browse a flat curated collection — never leak folder structure.
  const crumbs = openPath
    ? admin
      ? openPath.replace(/\.md$/, "").split("/")
      : [openPath.replace(/\.md$/, "").split("/").pop()!]
    : [];

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
      {admin && openPath && (
        <>
          <button
            type="button"
            className={`s-statusbar__btn s-statusbar__pub${
              openPublished ? " s-statusbar__pub--on" : ""
            }`}
            onClick={() => void togglePublish(openPath)}
            title={
              openPublished
                ? "Unpublish this note (Ctrl/Cmd+Shift+P)"
                : "Publish this note for visitors (Ctrl/Cmd+Shift+P)"
            }
          >
            <span className="s-statusbar__pubstar" aria-hidden="true">
              {openPublished ? "✦" : "✧"}
            </span>
            {openPublished ? "Published" : "Publish"}
          </button>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
        </>
      )}
      {admin && authProtected && publishedCounts && (
        <>
          <button
            type="button"
            className={`s-statusbar__btn s-statusbar__pubcount${
              publishedFilter ? " s-statusbar__btn--on" : ""
            }`}
            onClick={() => setPublishedFilter(!publishedFilter)}
            title={
              publishedFilter
                ? "Show the full vault in the sidebar"
                : "Filter the sidebar to published notes"
            }
          >
            {publishedCounts.notes} published
          </button>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
        </>
      )}
      {admin && (
        <>
          <button
            type="button"
            className="s-statusbar__btn s-statusbar__eye"
            onClick={() => void useStore.getState().setPreviewVisitor(true)}
            title="Preview as visitor — see exactly what the public site serves"
            aria-label="Preview as visitor"
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
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
        onClick={() => setTheme(nextTheme(theme))}
        title={`Theme: ${theme} — click for ${nextTheme(theme)}`}
        aria-label="Cycle theme"
      >
        {theme === "parchment" ? "☀" : "☾"}
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
