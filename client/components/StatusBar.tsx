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
import { countPhrase, localeNum, t, tf } from "../i18n.ts";
import { MetaSep } from "../metaSep.tsx";
import { isPublishedContent } from "../publish.ts";
import { DRAWER_QUERY, useStore } from "../state.ts";
import { choiceGroup, choiceLabel } from "../themes.ts";
import SyncBadge from "./SyncBadge.tsx";
import { openThemePicker } from "./ThemePicker.tsx";
import { openDesigner } from "./design/openDesigner.ts";
import { noteLabelOf, stripNoteExt } from "../../shared/noteFormat.ts";
import { dailyNoteLabel } from "../daily.ts";
import {
  DOC_STATS_EVENT,
  requestDocStats,
  type DocStats,
} from "../editor/bufferBridge.ts";
import { readingMinutes } from "../../shared/wordCount.ts";
import { isHardWrapped, layoutBadge, noteLayout, type NoteLayout } from "../textLayout.ts";
// The pill/tooltip/strip table moved out to its own module when this file
// became lazy — App renders the zen strip from the same table and must be able
// to read it without importing (and therefore eagerly loading) the status bar.
import { vimSubCopy } from "../vimCopy.ts";

/** True while the shell shows the sidebar as an overlay drawer (app.css's
 *  `@media (max-width: 999px)`). The switch below has to know: at those widths
 *  "the sidebar is showing" is `sidebarOpen`, not `!sidebarCollapsed`, and a
 *  switch reporting the wrong one is the invisible-state bug in miniature.
 *  Tracked live, because a window resize crosses the breakpoint without ever
 *  touching the store. */
function useDrawerShell(): boolean {
  const [drawer, setDrawer] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DRAWER_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(DRAWER_QUERY);
    const onChange = (e: MediaQueryListEvent): void => setDrawer(e.matches);
    mq.addEventListener("change", onChange);
    setDrawer(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return drawer;
}

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
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const drawerShell = useDrawerShell();
  /** Is the notes sidebar on screen right now, in whichever shell this is? */
  const sidebarShown = drawerShell ? sidebarOpen : !sidebarCollapsed;
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
  // What the site's own settings are costing in reach right now. Admin-only
  // and present only while something MATERIAL is being withheld (the server
  // decides that — server/visibility.ts::isReducingReach), so this pill is a
  // fact worth a glance rather than permanent furniture.
  const visibility = useStore((s) => s.visibility);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  useStore((s) => s.language); // re-render the chrome strings on language change

  const vimSub = vimMode ? vimSubCopy(vimSubMode) : null;

  const [counts, setCounts] = useState<{ words: number; chars: number } | null>(null);
  // The LIVE numbers, published by the buffer registry as the reader types
  // (client/editor/buffers.ts). They win over `counts` above, which is derived
  // from a fetched copy of the note and is therefore always at least one
  // autosave behind. `counts` remains the answer for a surface with no buffer —
  // the reading view — and as the value before the first keystroke lands.
  const [live, setLive] = useState<DocStats | null>(null);
  useEffect(() => {
    setLive(null);
    if (!openPath) return;
    const onStats = (e: Event): void => {
      const detail = (e as CustomEvent<DocStats>).detail;
      // The registry speaks for every open buffer; this bar draws one note.
      if (detail.path === openPath) setLive(detail);
    };
    window.addEventListener(DOC_STATS_EVENT, onStats);
    // Ask once on open, so the bar is right BEFORE the first keystroke rather
    // than after it. A no-op when the editor chunk has not landed yet.
    requestDocStats(openPath);
    return () => window.removeEventListener(DOC_STATS_EVENT, onStats);
  }, [openPath]);
  // The open note's direction/alignment, resolved against the site default.
  // It rides the SAME fetch the word count already makes — a second request
  // per note open to read two frontmatter keys would be a request nobody
  // asked for. Re-resolved whenever the site default moves, too.
  const [layout, setLayout] = useState<NoteLayout | null>(null);
  const [hardWrapped, setHardWrapped] = useState(false);
  const siteDir = useStore((s) => s.textDirection);
  const siteAlign = useStore((s) => s.textAlign);
  const layoutChip = layout ? layoutBadge(layout, hardWrapped) : null;

  useEffect(() => {
    if (!openPath) {
      setCounts(null);
      setLayout(null);
      setHardWrapped(false);
      return;
    }
    if (isDirty) return; // wait for the autosave to land, then recount
    let cancelled = false;
    getNote(openPath)
      .then((note) => {
        if (!cancelled) {
          setCounts({ words: countWords(note.content), chars: note.content.length });
          setLayout(noteLayout(note.content));
          setHardWrapped(isHardWrapped(note.content));
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
    // siteDir/siteAlign are dependencies because the RESOLUTION depends on
    // them: a note carrying `align: center` stops disagreeing the moment the
    // site itself is set to centre, and the segment has to go away with it.
  }, [openPath, isDirty, reloadTick, siteDir, siteAlign]);

  // Visitors browse a flat curated collection — never leak folder structure.
  // A DAILY NOTE KEEPS ITS ISO FILENAME AND SHOWS THE INSTANCE'S CALENDAR.
  // `daily/2026-08-16.md` is still `daily/2026-08-16.md` on disk, in every
  // wikilink and in every sort — but on a Hijri instance the bar names it
  // «٢ صفر ١٤٤٨ هـ», which is the date its writer was actually living in.
  // Null in gregorian mode, where the filename already IS that date.
  const leaf = openPath ? (dailyNoteLabel(openPath) ?? noteLabelOf(openPath)) : "";
  const crumbs = openPath
    ? admin
      ? [...stripNoteExt(openPath).split("/").slice(0, -1), leaf]
      : [leaf]
    : [];

  return (
    // A named landmark, because this <footer> is not a site footer: it is the
    // app's status strip, and "contentinfo" with no name says nothing.
    <footer className="s-statusbar" aria-label={t("statusBarAria")}>
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
      {/* ── The ambient pair ──────────────────────────────────────────────
          Both of the bar's COUNTS, in one group. They used to sit apart with
          a `·` between them and the publish toggle wedged in the middle,
          which is how the bar ended up mixing dot separators between some
          neighbours and hairlines between others — the thing DESIGN.md
          forbids. Together they are also one unit of sacrifice: `.s-statusbar
          __ambient` is what the ≤1280 rule drops, so the group never
          degrades into a hairline with nothing after it.
          (Publish state renders wherever an admin is signed in. It used to
          hang off `authProtected` as well, which meant the count — and with
          it the only route to the published filter — vanished on an open
          local vault and on every PUBLIC=false instance, while the publish
          TOGGLE stayed, still saying "Published — live for visitors".) */}
      {(counts || live || (admin && publishedCounts)) && (
        <span className="s-statusbar__group s-statusbar__ambient">
          {(live || counts) && (
            // SELECTION-AWARE. The moment something is selected the bar reports
            // the selection instead of the note, because a writer trimming a
            // paragraph to length is asking about the paragraph. Reading time
            // sits here too: it was computed for VISITORS and shown to them,
            // and hidden from the one person deciding whether the piece is too
            // long. Both numbers come from one function (shared/wordCount.ts),
            // so the author and the reader cannot be told different things.
            <span className="s-statusbar__counts">
              {live && live.selWords !== null ? (
                <>
                  {countPhrase(live.selWords, "words")}
                  <MetaSep />
                  {countPhrase(live.selChars ?? 0, "chars")}
                  <MetaSep />
                  <span className="s-statusbar__selected">{t("statusSelected")}</span>
                </>
              ) : (
                <>
                  {countPhrase(live ? live.words : (counts?.words ?? 0), "words")}
                  <MetaSep />
                  {countPhrase(live ? live.chars : (counts?.chars ?? 0), "chars")}
                  {readingMinutes(live ? live.words : (counts?.words ?? 0)) > 0 && (
                    <>
                      <MetaSep />
                      {countPhrase(
                        readingMinutes(live ? live.words : (counts?.words ?? 0)),
                        "readMinutes",
                      )}
                    </>
                  )}
                </>
              )}
              {live && live.ranges > 1 && (
                // Only past one, where it stops being noise and becomes the
                // answer to "why is it typing in four places at once".
                <>
                  <MetaSep />
                  <span className="s-statusbar__carets">
                    {tf("statusCarets", { n: localeNum(live.ranges) })}
                  </span>
                </>
              )}
            </span>
          )}
          {admin && publishedCounts && (
            <button
              type="button"
              className={`s-statusbar__btn s-statusbar__pubcount${
                publishedFilter ? " s-statusbar__btn--on" : ""
              }`}
              // It narrows the whole tree and stays narrowed — a state, not an
              // action, and the only visual cue for it is a class.
              aria-pressed={publishedFilter}
              onClick={() => setPublishedFilter(!publishedFilter)}
              title={t(publishedFilter ? "showFullVault" : "filterToPublished")}
            >
              {countPhrase(publishedCounts.notes, "publishedNotes")}
            </button>
          )}
          {/* THE ONGOING HALF of "never silently hide a site". The published
              count beside it answers "how much have I published"; this one
              answers the question nobody could ask before — "how much of it
              can anyone actually find". It sits next to its sibling because
              the two numbers disagreeing is precisely the state worth
              noticing, and it opens Settings because that is where the
              disagreement gets resolved. */}
          {admin && visibility && (
            <button
              type="button"
              className={`s-statusbar__btn s-statusbar__reach${
                visibility.fallback || !visibility.publicReads || visibility.visible * 2 < visibility.published
                  ? " s-statusbar__reach--warn"
                  : ""
              }`}
              onClick={() => setSettingsOpen(true)}
              /* Priority is "what would surprise the reader most", not
                 field order: reads being closed outranks everything, a filter
                 that stood down outranks a count, and a homepage pointing at
                 a note visitors cannot see is the only reason left that can
                 fire while the count itself reads N/N. */
              title={
                !visibility.publicReads
                  ? t("reachClosedTitle")
                  : visibility.fallback
                    ? t("reachFallbackTitle")
                    : visibility.visible === visibility.published
                      ? t("homeNoteHidden")
                      : tf("reachTitle", {
                          hidden: localeNum(visibility.published - visibility.visible),
                        })
              }
            >
              {tf("reachPill", {
                visible: localeNum(visibility.visible),
                total: localeNum(visibility.published),
              })}
            </button>
          )}
        </span>
      )}
      {/* The publish toggle is an ACT, not ambient trivia, so it is its own
          group and it survives every width down to the phone. */}
      {admin && openPath && (
        <span className="s-statusbar__group">
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
        </span>
      )}
      {/* Backup & sync: renders nothing unless this is an admin session on an
          instance where sync is switched on with a remote. Its own root
          (`.s-sync`) takes the group hairline from app.css — the component
          alone knows whether it draws anything, and an empty wrapper here
          would leave a rule with nothing behind it. */}
      <SyncBadge />
      {/* ── The open note's own text layout ───────────────────────────────
          Shown ONLY when the note disagrees with the site default — a segment
          that is always lit says nothing, and the site's own setting is
          already named in Settings → Language. The words and the tooltip come
          from client/textLayout.ts, the same source the properties card
          prints, so the two surfaces cannot drift. Quiet by construction: it
          is a label, not a switch (the value lives in the note's frontmatter,
          which is where it is changed), so it takes no ModePill treatment. */}
      {layoutChip && (
        <span
          className="s-statusbar__group s-statusbar__layout"
          title={layoutChip.title}
          aria-label={`${t("layoutSegmentLabel")}: ${layoutChip.title}`}
        >
          {layoutChip.text}
        </span>
      )}
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
          strip rather than the deliberate groups the code actually builds.
          Every right-cluster segment is a group now — the counts, the publish
          toggle, the sync badge, the mode pills, these two, the panes, the
          view controls and the session control — and app.css drops the rule
          on whichever one opens the cluster, because a hairline with nothing
          on its far side is a rule separating a group from empty space. */}
      {admin && (
        <span className="s-statusbar__group">
          {/* THE DESIGNER'S OWN DOOR. `openDesigner()` used to have exactly one
              call site in the client — the command palette — so the whole
              feature was behind Ctrl+P and a guess at the word. It sits beside
              the gear because that is where an admin already goes to change
              what a visitor sees, and its glyph is the shape of a composed
              page: a masthead over a column and a grid. */}
          <button
            type="button"
            className="s-statusbar__btn s-statusbar__icon"
            onClick={openDesigner}
            title={t("designTitle")}
            aria-label={t("designTitle")}
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
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 9v12" />
            </svg>
          </button>
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
          className={`s-statusbar__btn s-statusbar__icon${sidebarShown ? " s-statusbar__btn--on" : ""}`}
          onClick={() => useStore.getState().toggleSidebar()}
          title={t(sidebarShown ? "hidePaneNotes" : "showPaneNotes")}
          aria-label={t(sidebarShown ? "hidePaneNotes" : "showPaneNotes")}
          aria-pressed={sidebarShown}
        >
          <PaneIcon kind="sidebar" />
        </button>
        <button
          type="button"
          className={`s-statusbar__btn s-statusbar__icon s-statusbar__pane-outline${panelCollapsed ? "" : " s-statusbar__btn--on"}`}
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
      {/* Twenty-one themes cannot hang off a button that steps to the next one:
          blind cycling is the same invisible state as a silent reading mode —
          the only feedback is that everything changed. It opens the PICKER,
          which shows what is available, previews live and can be cancelled.
          The glyph reads the theme's GROUP, not one theme's name: with a whole
          group of light rooms, `theme === "parchment"` drew a moon on every one
          of them but parchment. */}
      {/* View group: what the centre column shows, and in what light. */}
      <span className="s-statusbar__group">
        <button
          type="button"
          className="s-statusbar__btn"
          onClick={openThemePicker}
          title={tf("themeTitle", { theme: choiceLabel(theme) })}
          aria-label={t("browseThemes")}
        >
          {choiceGroup(theme) === "light" ? "☀" : "☾"}
        </button>
        <button
          type="button"
          className={`s-statusbar__btn${view === "graph" ? " s-statusbar__btn--on" : ""}`}
          // A toggle, not a link: it swaps the workspace between the note and
          // the graph, and the class that says so visually needs a twin a
          // screen reader can hear.
          aria-pressed={view === "graph"}
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
