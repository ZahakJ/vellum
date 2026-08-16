// Status bar: word/char count of the open note, plus vim / theme / view
// toggles. The store deliberately does not hold note content, so the count is
// fetched here — on note switch, after each autosave (dirty -> clean), and
// after external reloads — with minimal store subscriptions.

import { Fragment, useEffect, useState } from "react";
import { getNote } from "../api.ts";
import { countPhrase, t, tf } from "../i18n.ts";
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
  useStore((s) => s.language); // re-render the chrome strings on language change

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
    // A named landmark, because this <footer> is not a site footer: it is the
    // app's status strip, and "contentinfo" with no name says nothing.
    <footer className="s-statusbar" aria-label={t("statusBarAria")}>
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
                // Per segment, not per crumb trail: a folder/note name picks
                // its own direction while the trail keeps the chrome's order.
                dir="auto"
              >
                {part}
              </span>
            </Fragment>
          ))}
        </span>
      ) : (
        <span className="s-statusbar__crumbs s-statusbar__crumb">{t("noNoteOpen")}</span>
      )}
      <span className="s-statusbar__spacer" />
      {counts && (
        <>
          <span className="s-statusbar__counts">
            {countPhrase(counts.words, "words")} · {countPhrase(counts.chars, "chars")}
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
            aria-pressed={openPublished === true}
            onClick={() => void togglePublish(openPath)}
            title={t(openPublished ? "unpublishTitle" : "publishTitle")}
          >
            <span className="s-statusbar__pubstar" aria-hidden="true">
              {openPublished ? "✦" : "✧"}
            </span>
            {t(openPublished ? "published" : "publish")}
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
            aria-pressed={publishedFilter}
            onClick={() => setPublishedFilter(!publishedFilter)}
            title={t(publishedFilter ? "showFullVault" : "filterToPublished")}
          >
            {countPhrase(publishedCounts.notes, "publishedNotes")}
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
            className="s-statusbar__btn s-statusbar__gear"
            onClick={() => useStore.getState().setSettingsOpen(true)}
            title={t("siteSettingsTitle")}
            aria-label={t("siteSettings")}
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
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className="s-statusbar__btn s-statusbar__eye"
            onClick={() => void useStore.getState().setPreviewVisitor(true)}
            title={t("previewAsVisitorTitle")}
            aria-label={t("previewAsVisitor")}
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
            aria-pressed={readingMode}
            onClick={toggleReading}
            title={t("readTitle")}
          >
            {t("read")}
          </button>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className={`s-statusbar__btn${vimMode ? " s-statusbar__btn--on" : ""}`}
            aria-pressed={vimMode}
            onClick={toggleVim}
            title={t("vimTitle")}
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
        title={tf("themeTitle", { theme, next: nextTheme(theme) })}
        aria-label={t("cycleTheme")}
      >
        {theme === "parchment" ? "☀" : "☾"}
      </button>
      <span className="s-statusbar__dot" aria-hidden="true">
        ·
      </span>
      <button
        type="button"
        className={`s-statusbar__btn${view === "graph" ? " s-statusbar__btn--on" : ""}`}
        aria-pressed={view === "graph"}
        onClick={() => setView(view === "graph" ? "editor" : "graph")}
        title={t("graphTitle")}
      >
        {t("graph")}
      </button>
      {admin && authProtected && (
        <>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className="s-statusbar__btn s-statusbar__signout"
            onClick={() => void useStore.getState().logout()}
            title={t("signOutTitle")}
            aria-label={t("signOut")}
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
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            <span className="s-statusbar__signout-label">{t("signOut")}</span>
          </button>
        </>
      )}
      {!admin && (
        <>
          <span className="s-statusbar__dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className="s-statusbar__btn s-statusbar__signin"
            onClick={() => setLoginOpen(true)}
            title={t("signInTitle")}
          >
            {t("signIn")}
          </button>
        </>
      )}
    </footer>
  );
}
