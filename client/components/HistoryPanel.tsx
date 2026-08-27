// Note history — the undo of last resort, in the right panel.
//
// Backup & sync has been committing the whole vault since v1.6 and there was
// no way in the product to LOOK at what it kept. That is the locked-fire-exit
// shape the trash browser was built to fix one floor down: a safety net
// nobody can reach is a safety net in the same sense that a locked fire exit
// is a fire exit. This is `git log --follow` over the open note, a read-only
// render of any revision, and one button that puts it back.
//
// It ships FIRST in this release and the scary tools stand on it. Vault-wide
// search & replace and tag rename are what a note-taker most wants and least
// trusts, and the reason is that a bad vault-wide edit is unrecoverable.
//
// THREE DECISIONS WORTH THE INK:
//
// 1. THE SECTION STARTS COLLAPSED AND ASKS GIT NOTHING UNTIL IT IS OPENED.
//    `git log --follow` is a PROCESS, and the panel would otherwise spawn one
//    on every note the reader opens, for ever, to fill a list most sessions
//    never look at. The header is always there — it is a door, not a hover
//    reveal — and the choice persists, so the reader who wants history pays
//    for it and nobody else does. Same storage idiom as the local graph.
//
// 2. RESTORING IS AN ORDINARY EDIT. It goes through `applyNoteContent`, the
//    same seam the outline's section moves use: one transaction into the open
//    editor when one holds the note (so Ctrl+Z takes it back and the existing
//    autosave carries it to disk under its precondition), and `putNote`
//    otherwise. Nothing here writes a special path, and a restore is itself a
//    revision — which is exactly why the toast's Undo is a second restore, of
//    the text that was on screen a moment ago, rather than a rollback verb
//    this feature would have had to invent.
//
// 3. NO DIFF VIEW, AND THE MARKERS INSTEAD. The spec offered a diff if it were
//    cheap. A real line-level diff is a renderer, a stylesheet and a second
//    modal state; what a timeline is actually asked is "how much of this was
//    that edit", and `+12 −3` answers it from numbers `git log --numstat`
//    already put in the same response. The whole revision is one tap away for
//    the reader who needs more than a number.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { noteLabelOf } from "../../shared/noteFormat.ts";
import type { NoteRevision } from "../../shared/types.ts";
import { getNoteHistory, getNoteRevision } from "../api.ts";
import { relativeDate, siteDate } from "../dates.ts";
import { localeNum, t, tf } from "../i18n.ts";
import { applyNoteContent, noteContent } from "../sectionActions.ts";
import { HISTORY_CHANGED_EVENT } from "../sync.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { actionToast } from "../undoToast.ts";
import { renderNoteContent } from "../reading/renderNote.ts";
import { applyNoteLayoutTo } from "../textLayout.ts";
import "../styles/history.css";

const COLLAPSED_KEY = "vellum.history-collapsed";

/** "Open the history section." Rung by any surface that wants to SHOW this
 *  list rather than merely reveal the pane around it — the tour's history
 *  folio is the first. Declared here because the listener is here; callers
 *  outside this chunk dispatch the literal rather than import it, so pressing
 *  a button never fetches the revision reader. */
export const HISTORY_REVEAL_EVENT = "vellum:history-reveal";

/** Collapsed BY DEFAULT — see decision 1 above. An unreadable stored value is
 *  the default, not a crash: private windows throw on the accessor. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) !== "false";
  } catch {
    return true;
  }
}

type Feed =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; repo: boolean; revisions: NoteRevision[]; truncated: boolean };

/** When a revision was made. Recent enough and it is a DISTANCE ("3 days
 *  ago") — which is how a reader looking for "the version before I broke it"
 *  thinks; older and it is a date in the instance's own calendar. Both come
 *  out of client/dates.ts, so a Hijri instance dates its history in Hijri. */
function when(iso: string, locale: string): string {
  return relativeDate(iso, locale, { month: "short", day: "numeric", year: "numeric" });
}

/** The full moment, for the row's title and the revision modal's header. */
function fullWhen(iso: string, locale: string): string {
  return siteDate(iso, locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Vellum's own commit subjects, told in the reader's language. `commit()`
 *  writes `vellum snapshot:` / `vellum sync:` and an ISO instant — the subject
 *  for a terminal `git log`, and the wrong one in a timeline whose first
 *  column is already the moment: the row would say when twice, once in words
 *  and once as a machine timestamp. Anyone else's subject is left as written. */
const MACHINE_SUBJECT = /^vellum (snapshot|sync): /;

function subjectOf(rev: NoteRevision): string {
  const m = MACHINE_SUBJECT.exec(rev.subject);
  if (m !== null) return t(m[1] === "snapshot" ? "revisionSnapshot" : "revisionBackup");
  return rev.subject || rev.short;
}

function IconClock() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

// ── The revision viewer ─────────────────────────────────────────────────────

/** One revision, rendered read-only, with the way back on the footer.
 *
 *  `renderNoteContent` and not a second renderer: a `.tex` revision has to
 *  read as a `.tex` note, and that entry point is what makes that true by
 *  construction everywhere else in the product. `applyNoteLayoutTo` after it,
 *  so a revision of an Arabic note is read right-to-left here exactly as it is
 *  in the reading view. */
function RevisionModal({
  path,
  revision,
  onClose,
}: {
  path: string;
  revision: NoteRevision;
  onClose: () => void;
}) {
  const locale = useStore((s) => s.blogLocale);
  const [body, setBody] = useState<{ state: "loading" | "error" } | { state: "ready"; content: string }>({
    state: "loading",
  });
  const [restoring, setRestoring] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let dead = false;
    setBody({ state: "loading" });
    getNoteRevision(revision.path, revision.sha)
      .then((blob) => {
        if (!dead) setBody({ state: "ready", content: blob.content });
      })
      .catch((err: unknown) => {
        console.error("vellum: reading a revision failed", err);
        if (!dead) setBody({ state: "error" });
      });
    return () => {
      dead = true;
    };
  }, [revision.path, revision.sha]);

  // Render into a detached tree and swap it in, the way every reading surface
  // in this product does — the renderer answers with an element, not a string,
  // because a string would mean `innerHTML` over note text.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || body.state !== "ready") return;
    const el = renderNoteContent(body.content, {
      notePath: revision.path,
      tree: useStore.getState().tree,
    });
    el.classList.add("s-revision__content");
    applyNoteLayoutTo(el, body.content);
    host.replaceChildren(el);
  }, [body, revision.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const restore = () => {
    if (body.state !== "ready" || restoring) return;
    setRestoring(true);
    void (async () => {
      try {
        // The text as it stands RIGHT NOW, buffer first — that is what Undo
        // has to put back, and the file on disk can be 600ms behind the
        // keyboard. Read before writing, or the undo restores the restore.
        const before = await noteContent(path);
        await applyNoteContent(path, body.content);
        onClose();
        actionToast(
          tf("revisionRestored", {
            // The tree's own label, like the delete toast and the tab bar
            // (state.ts::deleteNote) — a toast reading “Target.md” beside a
            // row reading "Target" is one file wearing two names.
            name: noteLabelOf(path),
            when: fullWhen(revision.iso, locale),
          }),
          t("undo"),
          () => {
            void applyNoteContent(path, before)
              .then(() => toast(t("revisionRestoreUndone")))
              .catch((err: unknown) => {
                console.error("vellum: undoing a restore failed", err);
                toast(t("revisionRestoreFailed"), "error");
              });
          },
        );
      } catch (err) {
        console.error("vellum: restoring a revision failed", err);
        toast(t("revisionRestoreFailed"), "error");
        setRestoring(false);
      }
    })();
  };

  return createPortal(
    <div className="s-revision-overlay" onMouseDown={onClose}>
      <div
        className="s-revision"
        role="dialog"
        aria-modal="true"
        aria-label={t("revisionTitle")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="s-revision__header">
          <span className="s-revision__glyph" aria-hidden="true">
            <IconClock />
          </span>
          <span className="s-revision__heading">
            <span className="s-revision__title" dir="auto">
              {subjectOf(revision)}
            </span>
            {/* One text run, not three spans: a run of facts joined for the
                bidi algorithm reorders against itself when they are separate
                elements inside an RTL block. */}
            <span className="s-revision__meta" dir="auto">
              {`${fullWhen(revision.iso, locale)} — ${revision.short}`}
            </span>
          </span>
          <button
            type="button"
            className="s-revision__close s-iconbtn"
            title={t("close")}
            aria-label={t("closeRevision")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="s-revision__body">
          {body.state === "loading" && <p className="s-revision__note">{t("revisionLoading")}</p>}
          {body.state === "error" && <p className="s-revision__note">{t("revisionOpenFailed")}</p>}
          {body.state === "ready" && body.content.trim() === "" && (
            <p className="s-revision__note">{t("revisionEmpty")}</p>
          )}
          <div ref={hostRef} className="s-revision__render" />
        </div>
        <footer className="s-revision__footer">
          <button
            type="button"
            className="s-revision__restore"
            onClick={restore}
            disabled={body.state !== "ready" || restoring}
          >
            {t("restoreRevision")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ── The timeline ────────────────────────────────────────────────────────────

export default function HistoryPanel() {
  const openPath = useStore((s) => s.openPath);
  const admin = useStore((s) => s.admin);
  const preview = useStore((s) => s.previewVisitor);
  const locale = useStore((s) => s.blogLocale);
  useStore((s) => s.language); // re-render the chrome strings on a language change
  const openSettingsAt = useStore((s) => s.openSettingsAt);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [feed, setFeed] = useState<Feed>({ state: "idle" });
  const [viewing, setViewing] = useState<NoteRevision | null>(null);

  const active = !collapsed && !!openPath && admin && !preview;

  const load = useCallback(() => {
    if (!active || !openPath) return () => {};
    let dead = false;
    setFeed({ state: "loading" });
    getNoteHistory(openPath)
      .then((answer) => {
        if (dead) return;
        setFeed({ state: "ready", repo: answer.repo, revisions: answer.revisions, truncated: answer.truncated });
      })
      .catch((err: unknown) => {
        console.error("vellum: reading note history failed", err);
        if (!dead) setFeed({ state: "error" });
      });
    return () => {
      dead = true;
    };
  }, [active, openPath]);

  useEffect(load, [load]);

  // A snapshot taken from the palette while this list is open MUST show up in
  // it — the reader just made that row on purpose.
  useEffect(() => {
    if (!active) return;
    // `load()` hands back its own abandon-this-request function, and it is
    // kept rather than dropped: a refetch still in flight when the reader
    // switches notes must not land its answer in the new note's timeline.
    let abandon: (() => void) | null = null;
    const onChanged = () => {
      abandon?.();
      abandon = load();
    };
    window.addEventListener(HISTORY_CHANGED_EVENT, onChanged);
    return () => {
      abandon?.();
      window.removeEventListener(HISTORY_CHANGED_EVENT, onChanged);
    };
  }, [active, load]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // storage unavailable — the collapse still works for this session
    }
  };

  // "Show me the history" from somewhere that is not this header. The section
  // is collapsed by default and its collapse is component-local (decision 1
  // above), so there is no store flag another surface could set — and a
  // caller that wrote `COLLAPSED_KEY` itself would be a second copy of this
  // component's state living in another file. A bus instead: the tour's
  // history folio rings it, and anything else that grows a door can too.
  useEffect(() => {
    const onReveal = () => {
      setCollapsed(false);
      try {
        localStorage.setItem(COLLAPSED_KEY, "false");
      } catch {
        // storage unavailable — it still opens for this session
      }
    };
    window.addEventListener(HISTORY_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(HISTORY_REVEAL_EVENT, onReveal);
  }, []);

  // A visitor has no history at all (both routes 404 to one), and an admin
  // PREVIEWING as a visitor must see exactly what a stranger would.
  if (!openPath || !admin || preview) return null;

  const ready = feed.state === "ready" ? feed : null;

  return (
    <section className="s-history">
      <header className="s-panel-header s-history__header">
        <button
          type="button"
          className="s-history__toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={t(collapsed ? "showHistory" : "hideHistory")}
        >
          <span
            className={`s-tree__chevron${collapsed ? "" : " s-tree__chevron--open"}`}
            aria-hidden="true"
          >
            ›
          </span>
          <span className="s-panel-title">{t("history")}</span>
          {ready !== null && ready.repo && ready.revisions.length > 0 && (
            <span className="s-panel-count">
              {localeNum(ready.revisions.length)}
              {ready.truncated ? "+" : ""}
            </span>
          )}
        </button>
      </header>
      {!collapsed && (
        <div className="s-history__body">
          {feed.state === "loading" && <p className="s-history__note">{t("historyLoading")}</p>}
          {feed.state === "error" && <p className="s-history__note">{t("historyFailed")}</p>}
          {/* The empty states get DOORS. "Backup is off" with nothing to press
              is the sentence this release exists to stop printing. */}
          {ready !== null && !ready.repo && (
            <div className="s-history__empty">
              <p className="s-history__note">{t("historyNoRepo")}</p>
              <button
                type="button"
                className="s-history__door"
                onClick={() => openSettingsAt("rowSyncEnabled")}
              >
                {t("historyOpenBackup")}
              </button>
            </div>
          )}
          {ready !== null && ready.repo && ready.revisions.length === 0 && (
            <div className="s-history__empty">
              <p className="s-history__note">{t("historyEmpty")}</p>
              <button
                type="button"
                className="s-history__door"
                onClick={() => void import("../sync.ts").then((m) => m.runSnapshotNow())}
              >
                {t("snapshotNow")}
              </button>
            </div>
          )}
          {ready !== null && ready.revisions.length > 0 && (
            <ol className="s-history__list" aria-label={t("historyAria")}>
              {ready.revisions.map((rev) => (
                <li key={rev.sha}>
                  <button
                    type="button"
                    className="s-histrow"
                    onClick={() => setViewing(rev)}
                    title={`${fullWhen(rev.iso, locale)} — ${rev.short}`}
                    aria-label={t("revisionAria")}
                  >
                    <span className="s-histrow__when" dir="auto">
                      {when(rev.iso, locale)}
                    </span>
                    <span className="s-histrow__subject" dir="auto">
                      {subjectOf(rev)}
                    </span>
                    {rev.added !== null && rev.removed !== null && (
                      <span
                        className="s-histrow__stat"
                        title={tf("revisionChanges", {
                          added: localeNum(rev.added),
                          removed: localeNum(rev.removed),
                        })}
                      >
                        <span className="s-histrow__plus">{`+${localeNum(rev.added)}`}</span>
                        <span className="s-histrow__minus">{`−${localeNum(rev.removed)}`}</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {ready !== null && ready.truncated && (
            <p className="s-history__note s-history__note--foot">{t("historyOlder")}</p>
          )}
        </div>
      )}
      {viewing !== null && (
        <RevisionModal path={openPath} revision={viewing} onClose={() => setViewing(null)} />
      )}
    </section>
  );
}
