// Status bar: word/char count of the open note, the MODE CLUSTER (reading /
// vim / preview), the pane toggles, and the theme / view / session controls.
// The store deliberately does not hold note content, so the count is fetched
// here — on note switch, after each autosave (dirty -> clean), and after
// external reloads — with minimal store subscriptions.
//
// The mode cluster is the headline of this bar. A mode that takes typing away
// (reading, preview) used to render as grey lowercase text no heavier than
// the word count, and readers sat in it wondering why the keyboard was dead.
// An ACTIVE mode is a lit pill — accent-filled, glowing, with a dot — and
// clicking it leaves that mode; an inactive one stays a calm outline so the
// bar reads as a row of switches rather than a row of alarms.

import { Fragment, useEffect, useState } from "react";
import { getNote } from "../api.ts";
import { countPhrase, t, tf } from "../i18n.ts";
import { isPublishedContent } from "../publish.ts";
import { useStore } from "../state.ts";
import { themeGroup } from "../themes.ts";
import SyncBadge from "./SyncBadge.tsx";
import { openThemePicker } from "./ThemePicker.tsx";

function countWords(text: string): number {
  const words = text.trim().split(/\s+/);
  return words[0] === "" ? 0 : words.length;
}

/** One switch in the mode cluster. `on` is not a shade of grey: it fills with
 *  the accent and glows, because the whole point is that it cannot be missed
 *  from across the room. */
function ModePill(props: {
  label: string;
  on: boolean;
  title: string;
  onClick: () => void;
  extraClass?: string;
  /** Second word inside the pill: vim's live sub-mode. A mode with STATES
   *  needs its state, not just its name — VIM alone says the extension is
   *  loaded, which is never what traps anybody. */
  sub?: string;
}) {
  const { label, on, title, onClick, extraClass, sub } = props;
  return (
    <button
      type="button"
      className={`s-mode${on ? " s-mode--on" : ""}${extraClass ? ` ${extraClass}` : ""}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={on}
    >
      <span className="s-mode__dot" aria-hidden="true" />
      {label}
      {sub && <span className="s-mode__sub">{sub}</span>}
    </button>
  );
}

/** Copy for a vim sub-mode: the pill word, its tooltip and the zen strip
 *  sentence all come from one table so they can never disagree. */
const VIM_SUB = {
  normal: { pill: "vimNormal", title: "vimNormalTitle", strip: "vimStripNormal" },
  insert: { pill: "vimInsert", title: "vimInsertTitle", strip: "vimStripInsert" },
  visual: { pill: "vimVisual", title: "vimVisualTitle", strip: "vimStripVisual" },
  replace: { pill: "vimReplace", title: "vimReplaceTitle", strip: "vimStripReplace" },
} as const;

export function vimSubCopy(mode: keyof typeof VIM_SUB | null) {
  return mode ? VIM_SUB[mode] : null;
}

/** Pane toggles: an icon each, so the sidebar, the right panel and zen are
 *  never keyboard-only secrets. The tooltip names the keystroke. */
function PaneIcon({ kind }: { kind: "sidebar" | "panel" | "zen" | "help" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "sidebar" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </>
      )}
      {kind === "panel" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16" />
        </>
      )}
      {kind === "zen" && (
        <>
          <path d="M4 9V5a1 1 0 0 1 1-1h4" />
          <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
          <path d="M4 15v4a1 1 0 0 0 1 1h4" />
          <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
        </>
      )}
      {kind === "help" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4" />
          <path d="M12 17.2h.01" />
        </>
      )}
    </svg>
  );
}

export default function StatusBar() {
  const openPath = useStore((s) => s.openPath);
  const isDirty = useStore((s) => (s.openPath ? !!s.dirty[s.openPath] : false));
  const reloadTick = useStore((s) => s.reloadTick);
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);
  const vimMode = useStore((s) => s.vimMode);
  const vimSubMode = useStore((s) => s.vimSubMode);
  const readingMode = useStore((s) => s.readingMode);
  const setView = useStore((s) => s.setView);
  const toggleVim = useStore((s) => s.toggleVim);
  const toggleReading = useStore((s) => s.toggleReading);
  const previewVisitor = useStore((s) => s.previewVisitor);
  const setPreviewVisitor = useStore((s) => s.setPreviewVisitor);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const panelCollapsed = useStore((s) => s.panelCollapsed);
  const setPanelCollapsed = useStore((s) => s.setPanelCollapsed);
  const setZen = useStore((s) => s.setZen);
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen);
  const admin = useStore((s) => s.admin);
  const setLoginOpen = useStore((s) => s.setLoginOpen);
  const authProtected = useStore((s) => s.authProtected);
  const openPublished = useStore((s) => s.openPublished);
  const publishedCounts = useStore((s) => s.publishedCounts);
  const publishedFilter = useStore((s) => s.publishedFilter);
  const setPublishedFilter = useStore((s) => s.setPublishedFilter);
  const togglePublish = useStore((s) => s.togglePublish);
  useStore((s) => s.language); // re-render the chrome strings on language change

  const vimSub = vimMode ? vimSubCopy(vimSubMode) : null;

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
        // Two flex children, not one segment per folder, and that is what
        // keeps a squeezed trail readable. Every segment used to shrink
        // equally, so the bar's one job — naming the open note — was the
        // first casualty: `1 - Source Material › Wiki › Nobel Prize in
        // Physiology or Medicine` truncated to `… › Wiki › Nobel Pri…`, two
        // folders intact and the note's name cut. Giving the LEAF a low
        // shrink factor fixed the priority but left the elided ancestors
        // behind as bare `› ›` chevrons, because a separator between two
        // collapsed spans is still a separator. So the ancestors and their
        // separators are ONE ellipsizing run: it thins to `1 - Sourc…`, then
        // to `…`, then to nothing at all, and the note name is the last
        // thing standing.
        <span className="s-statusbar__crumbs" title={openPath ?? undefined}>
          {crumbs.length > 1 && (
            <span className="s-statusbar__crumbpath">
              {crumbs.slice(0, -1).map((part, i) => (
                <Fragment key={`${i}:${part}`}>
                  {/* Per segment, not per trail: a folder name picks its own
                      direction while the trail keeps the chrome's order. */}
                  <span className="s-statusbar__crumb" dir="auto">
                    {part}
                  </span>
                  <span className="s-statusbar__crumb-sep" aria-hidden="true">
                    ›
                  </span>
                </Fragment>
              ))}
            </span>
          )}
          <span className="s-statusbar__crumb s-statusbar__crumb--leaf" dir="auto">
            {crumbs[crumbs.length - 1]}
          </span>
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
      {/* Backup & sync: renders nothing unless this is an admin session on an
          instance where sync is switched on with a remote. */}
      <SyncBadge />
      {/* ── Mode cluster ──────────────────────────────────────────────────
          Lit = this mode is ON right now. Every pill leaves its own mode. */}
      {(admin || previewVisitor) && (
        <span className="s-modes" role="group" aria-label={t("modesLabel")}>
          {previewVisitor && (
            <ModePill
              label={t("modePreview")}
              on
              title={t("modePreviewTitle")}
              onClick={() => void setPreviewVisitor(false)}
            />
          )}
          {admin && (
            <>
              <ModePill
                label={t("modeRead")}
                on={readingMode}
                title={t(readingMode ? "modeReadOnTitle" : "modeReadOffTitle")}
                onClick={toggleReading}
              />
              {/* The sub-mode is the load-bearing half: reading mode got a
                  pill, a strip and a rule, and vim got a pill that only ever
                  meant "the extension is loaded". */}
              <ModePill
                label={t("modeVim")}
                on={vimMode}
                sub={vimSub ? t(vimSub.pill) : undefined}
                title={
                  vimSub ? t(vimSub.title) : t(vimMode ? "modeVimOnTitle" : "modeVimOffTitle")
                }
                onClick={toggleVim}
              />
            </>
          )}
        </span>
      )}
      {/* ── Admin tools: the two doors OUT of the workspace ───────────────
          Groups are marked by ONE hairline each, never by sprinkled dots.
          The bar had eleven controls with separator dots between some
          neighbours and not others, which read as an undifferentiated icon
          strip rather than the deliberate groups the code actually builds. */}
      {admin && (
        <span className="s-statusbar__group">
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
        </span>
      )}
      {/* ── Pane toggles ──────────────────────────────────────────────────
          Sidebar, right panel and zen each get a visible switch: a keystroke
          nobody can see is a feature nobody finds. */}
      <span className="s-statusbar__panes">
        <button
          type="button"
          className={`s-statusbar__btn s-statusbar__icon${sidebarCollapsed ? "" : " s-statusbar__btn--on"}`}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={t(sidebarCollapsed ? "showPaneNotes" : "hidePaneNotes")}
          aria-label={t(sidebarCollapsed ? "showPaneNotes" : "hidePaneNotes")}
          aria-pressed={!sidebarCollapsed}
        >
          <PaneIcon kind="sidebar" />
        </button>
        <button
          type="button"
          className={`s-statusbar__btn s-statusbar__icon${panelCollapsed ? "" : " s-statusbar__btn--on"}`}
          onClick={() => setPanelCollapsed(!panelCollapsed)}
          title={t(panelCollapsed ? "showPaneOutline" : "hidePaneOutline")}
          aria-label={t(panelCollapsed ? "showPaneOutline" : "hidePaneOutline")}
          aria-pressed={!panelCollapsed}
        >
          <PaneIcon kind="panel" />
        </button>
        <button
          type="button"
          className="s-statusbar__btn s-statusbar__icon"
          onClick={() => setZen(true)}
          title={t("enterZen")}
          aria-label={t("enterZen")}
        >
          <PaneIcon kind="zen" />
        </button>
        <button
          type="button"
          className="s-statusbar__btn s-statusbar__icon"
          onClick={() => setShortcutsOpen(true)}
          title={t("shortcutsTitleKey")}
          aria-label={t("shortcutsTitleKey")}
        >
          <PaneIcon kind="help" />
        </button>
      </span>
      {/* Fifteen themes cannot hang off a button that steps to the next one:
          blind cycling is the same invisible state as a silent reading mode —
          the only feedback is that everything changed. It opens the PICKER,
          which shows what is available, previews live and can be cancelled.
          The glyph reads the theme's GROUP, not one theme's name: with four
          light rooms, `theme === "parchment"` drew a moon on three of them. */}
      {/* View group: what the centre column shows, and in what light. */}
      <span className="s-statusbar__group">
        <button
          type="button"
          className="s-statusbar__btn"
          onClick={openThemePicker}
          title={tf("themeTitle", { theme })}
          aria-label={t("browseThemes")}
        >
          {themeGroup(theme) === "light" ? "☀" : "☾"}
        </button>
        <button
          type="button"
          className={`s-statusbar__btn${view === "graph" ? " s-statusbar__btn--on" : ""}`}
          onClick={() => setView(view === "graph" ? "editor" : "graph")}
          title={t("graphTitle")}
        >
          {t("graph")}
        </button>
      </span>
      {admin && authProtected && (
        <span className="s-statusbar__group">
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
        </span>
      )}
      {!admin && (
        <span className="s-statusbar__group">
          {previewVisitor ? (
            // Inside preview the session IS still an admin one — the shell is
            // only wearing a visitor's clothes — so "Sign in to edit this
            // vault" was a lie the product could not honour: the modal opened,
            // the password was accepted, and the shell stayed a visitor shell.
            // The honest control here is the way OUT, which is the same door
            // the PREVIEW pill and Esc already use.
            <button
              type="button"
              className="s-statusbar__btn s-statusbar__exitpreview"
              onClick={() => void setPreviewVisitor(false)}
              title={t("exitPreviewTitle")}
            >
              {t("exitPreview")}
            </button>
          ) : (
            <button
              type="button"
              className="s-statusbar__btn s-statusbar__signin"
              onClick={() => setLoginOpen(true)}
              title={t("signInTitle")}
            >
              {t("signIn")}
            </button>
          )}
        </span>
      )}
    </footer>
  );
}
