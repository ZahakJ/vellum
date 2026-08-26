// VAULT-WIDE SEARCH AND REPLACE, in the sidebar it belongs in.
//
// 650 likes on the forum, eight years open, and Obsidian's answer is still
// "open the folder in VS Code." The reason nobody ships it is not that it is
// hard to write — it is that a bad vault-wide edit is unrecoverable, so the
// tool has to earn a press before it gets one. This panel is that earning, and
// it is four things in a row:
//
//   1. A RULE, stated before the reader types: matching is exact, frontmatter
//      is never touched. The search box above folds diacritics and shrugs at
//      case, because finding is a question. This does neither, because
//      replacing is a WRITE — see server/searchReplace.ts.
//   2. A DRY RUN, always, and it is the operation: the same transform over the
//      same reads (server/bulkRewrite.ts's first promise). Every matched line
//      is quoted with its replacement beside it, and every one has a checkbox.
//   3. A SNAPSHOT, offered as a ticked box whenever the vault is a git
//      repository. This is why v1.8 shipped history FIRST: the in-memory undo
//      bundle expires, and the commit does not.
//   4. AN UNDO, on the toast, through the same bundle the tag rename uses.
//
// THE SCOPE IS THE SEARCH BOX. The panel does not have its own note filter —
// the operators the reader already typed (`tag:recipes`, `path:Journal`,
// `-is:published`) decide which notes are considered, and the results they are
// looking at are the notes it will touch. Find is pre-filled from the same
// query's free text and is then theirs to edit, because a regular expression is
// not a search query.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { applyReplace, previewReplace } from "../api.ts";
import { bulkDoneToast } from "../bulkEdit.ts";
import { confirmModal } from "./Confirm.tsx";
import { countPhrase, localeNum, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { onSyncChange, refreshSyncStatus, syncSnapshot } from "../sync.ts";
import { parseSearchQuery } from "../../shared/searchQuery.ts";
import type { ReplacePreview, ReplacePreviewFile } from "../../shared/types.ts";
import "../styles/replace.css";

/** Long enough that typing a word does not fire a vault-wide scan per
 *  keystroke, short enough that the preview feels like it is answering. Wider
 *  than the search box's own debounce because this reads FILES. */
const PREVIEW_DEBOUNCE_MS = 320;

/** One file's selection: `null` is "every match in it", a Set is the lines the
 *  reader left ticked, and an ABSENT key is a file that is out. */
type Selection = Map<string, Set<number> | null>;

/** Every file selected whole — what a fresh preview starts as. A tool whose
 *  boxes all start empty makes the reader tick four hundred of them to do the
 *  thing they asked for; the risk this panel guards against is an unnoticed
 *  edit, not a deliberate one. */
function selectAll(preview: ReplacePreview): Selection {
  return new Map(preview.files.map((f) => [f.path, null] as const));
}

/** Is this file in, and how much of it? */
function fileState(sel: Selection, file: ReplacePreviewFile): "all" | "some" | "none" {
  if (!sel.has(file.path)) return "none";
  const lines = sel.get(file.path) ?? null;
  if (lines === null) return "all";
  if (lines.size === 0) return "none";
  return lines.size === file.lines.length ? "all" : "some";
}

export default function ReplacePanel({
  query,
  onClose,
}: {
  /** The sidebar's search box, verbatim — operators and all. */
  query: string;
  onClose: () => void;
}): React.JSX.Element {
  // Pre-filled from the SAME parser the server uses (shared/searchQuery.ts):
  // the operators stay behind as scope, the words become the needle. A second
  // parser here would eventually disagree with the server about what the
  // reader typed, in a panel that is about to rewrite four hundred files.
  const [find, setFind] = useState(() => parseSearchQuery(query).text);
  const [replace, setReplace] = useState("");
  const [regex, setRegex] = useState(false);
  // The snapshot box appears only where a commit can actually be made — the
  // vault is a git work tree. `configured`/`enabled` are about the REMOTE, and
  // a local commit needs neither; the point of the offer is the way back that
  // outlives the undo bundle, and that lives on this disk.
  const gitReady = useSyncExternalStore(onSyncChange, () => syncSnapshot()?.repo === true);
  const [snapshot, setSnapshot] = useState(true);
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Selection>(() => new Map());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
    // The badge may never have asked. A panel that offers a snapshot only
    // after some other surface happened to load the status is a panel whose
    // safety net appears at random.
    if (syncSnapshot() === null) void refreshSyncStatus();
  }, []);

  // The dry run, debounced and abortable. A late answer for an abandoned
  // needle must never repopulate the list the reader is about to press a
  // button under — that is the one stale render in this product that could
  // rewrite the wrong files.
  useEffect(() => {
    if (find === "") {
      setPreview(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      previewReplace(query, find, replace, regex, controller.signal)
        .then((next) => {
          setPreview(next);
          setSelection(selectAll(next));
          setOpen(new Set());
          setError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          console.error("vellum: previewing a vault-wide replace failed", err);
          setPreview(null);
          // A pattern the server refused is the common case here and it is not
          // a failure — it is the reader half-way through typing `(\d+`.
          setError(t("replaceBadPattern"));
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, find, replace, regex]);

  const chosen = useMemo(() => {
    if (preview === null) return { notes: 0, edits: 0, files: [] as ReplacePreviewFile[] };
    const files = preview.files.filter((f) => fileState(selection, f) !== "none");
    let edits = 0;
    for (const file of files) {
      const lines = selection.get(file.path);
      edits += lines == null
        ? file.count
        : file.lines.filter((l) => lines.has(l.line)).reduce((n, l) => n + l.count, 0);
    }
    return { notes: files.length, edits, files };
  }, [preview, selection]);

  const toggleFile = useCallback((file: ReplacePreviewFile) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (fileState(prev, file) === "none") next.set(file.path, null);
      else next.delete(file.path);
      return next;
    });
  }, []);

  const toggleLine = useCallback((file: ReplacePreviewFile, line: number) => {
    setSelection((prev) => {
      const next = new Map(prev);
      const current = prev.get(file.path);
      // A file ticked WHOLE has no line set yet; opening one box means the
      // rest stay on, so untick turns "all" into "all but this".
      const lines = new Set(current == null ? file.lines.map((l) => l.line) : current);
      if (lines.has(line)) lines.delete(line);
      else lines.add(line);
      if (lines.size === 0) next.delete(file.path);
      else next.set(file.path, lines);
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    if (preview === null || chosen.notes === 0) return;
    const lines = [
      tf("replaceConfirmBody", {
        edits: countPhrase(chosen.edits, "replacements"),
        notes: countPhrase(chosen.notes, "notes"),
      }),
    ];
    if (snapshot && gitReady) lines.push(t("replaceConfirmSnapshot"));
    const ok = await confirmModal({
      title: t("replaceConfirmTitle"),
      body: lines.join(" "),
      // The button says what it will DO, with the number in it — the dialog's
      // title already says which tool this is.
      confirmLabel: tf("replaceRun", { count: countPhrase(chosen.notes, "notes") }),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await applyReplace({
        find,
        replace,
        regex,
        snapshot: snapshot && gitReady,
        files: chosen.files.map((file) => {
          const picked = selection.get(file.path);
          return {
            path: file.path,
            mtimeMs: file.mtimeMs,
            lines: picked == null ? null : [...picked],
          };
        }),
      });
      const store = useStore.getState();
      void store.loadTree();
      void store.refreshBacklinks();
      void store.loadPublished();
      // The two things only this tool has to say, before the shared toast says
      // the rest: what it snapshotted, and what moved out from under it.
      if (result.snapshot !== null) {
        toast(tf("replaceSnapshotTaken", { sha: result.snapshot }));
      }
      if (result.conflicts.length > 0) {
        toast(tf("replaceStale", { count: countPhrase(result.conflicts.length, "notes") }), "error");
      }
      bulkDoneToast(
        tf("replaceDoneToast", {
          edits: countPhrase(result.edits, "replacements"),
          notes: countPhrase(result.notes, "notes"),
        }),
        result,
      );
      onClose();
    } catch (err) {
      console.error("vellum: a vault-wide replace failed", err);
      toast(t("replaceFailed"), "error");
    } finally {
      setBusy(false);
    }
  }, [preview, chosen, find, replace, regex, snapshot, gitReady, selection, onClose]);

  return (
    <div className="s-replace" role="region" aria-label={t("replaceTitle")}>
      <div className="s-replace__head">
        <h2 className="s-replace__title">{t("replaceTitle")}</h2>
        <button
          type="button"
          className="s-replace__close s-iconbtn"
          onClick={onClose}
          title={t("replaceClose")}
          aria-label={t("replaceClose")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <label className="s-replace__field">
        <span className="s-replace__label">{t("replaceFind")}</span>
        <input
          ref={findRef}
          className="s-replace__input"
          value={find}
          dir="auto"
          spellCheck={false}
          onChange={(e) => setFind(e.target.value)}
        />
      </label>
      <label className="s-replace__field">
        <span className="s-replace__label">{t("replaceWith")}</span>
        <input
          className="s-replace__input"
          value={replace}
          dir="auto"
          spellCheck={false}
          onChange={(e) => setReplace(e.target.value)}
        />
      </label>

      <div className="s-replace__opts">
        <label className="s-replace__opt">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
          <span>{t("replaceRegex")}</span>
        </label>
        {/* Offered only where it can be honoured. A ticked box that quietly
            does nothing is worse than no box: this one is the reason the
            release shipped git history first. */}
        {gitReady && (
          <label className="s-replace__opt">
            <input
              type="checkbox"
              checked={snapshot}
              onChange={(e) => setSnapshot(e.target.checked)}
            />
            <span>{t("replaceSnapshot")}</span>
          </label>
        )}
      </div>

      <p className="s-replace__rule">{t("replaceRule")}</p>
      <p className="s-replace__rule">{t("replaceScope")}</p>

      {preview !== null && preview.files.length > 1 && (
        // Forty files start ticked, and the reader who wants two of them
        // should not have to untick thirty-eight. Both directions, because
        // either can be the shorter road.
        <div className="s-replace__bulk">
          <button
            type="button"
            className="s-replace__bulkbtn"
            onClick={() => setSelection(selectAll(preview))}
          >
            {t("replaceSelectAll")}
          </button>
          <button
            type="button"
            className="s-replace__bulkbtn"
            onClick={() => setSelection(new Map())}
          >
            {t("replaceSelectNone")}
          </button>
        </div>
      )}

      <div className="s-replace__results">
        {error !== null && <p className="s-replace__none">{error}</p>}
        {error === null && preview !== null && preview.files.length === 0 && (
          <p className="s-replace__none">{t("replaceNothing")}</p>
        )}
        {preview !== null && preview.truncated && (
          <p className="s-replace__warn">{t("replaceTooMany")}</p>
        )}
        {preview?.files.map((file) => {
          const state = fileState(selection, file);
          const expanded = open.has(file.path);
          return (
            <div key={file.path} className="s-replace-file">
              <div className="s-replace-file__head">
                <label className="s-replace-file__pick">
                  <input
                    type="checkbox"
                    checked={state !== "none"}
                    ref={(el) => {
                      if (el) el.indeterminate = state === "some";
                    }}
                    onChange={() => toggleFile(file)}
                    aria-label={file.path}
                  />
                  <span className="s-replace-file__path" dir="auto">{file.path}</span>
                </label>
                <button
                  type="button"
                  className="s-replace-file__count s-iconbtn"
                  aria-expanded={expanded}
                  aria-label={file.path}
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(file.path)) next.delete(file.path);
                      else next.add(file.path);
                      return next;
                    })
                  }
                >
                  {localeNum(file.count)}
                </button>
              </div>
              {expanded && (
                <div className="s-replace-file__lines">
                  {file.lines.map((line) => {
                    const picked = selection.get(file.path);
                    const on = selection.has(file.path) && (picked == null || picked.has(line.line));
                    return (
                      <label key={line.line} className="s-replace-line">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={file.truncated}
                          onChange={() => toggleLine(file, line.line)}
                          aria-label={`${localeNum(line.line)}`}
                        />
                        <span className="s-replace-line__no" aria-hidden="true">
                          {localeNum(line.line)}
                        </span>
                        {/* The strike-through says "before" to an eye and
                            nothing at all to a screen reader, so each half
                            names itself. */}
                        <span className="s-replace-line__text">
                          <span
                            className="s-replace-line__before"
                            dir="auto"
                            aria-label={`${t("replaceLineFrom")}: ${line.before}`}
                          >
                            {line.before}
                          </span>
                          <span
                            className="s-replace-line__after"
                            dir="auto"
                            aria-label={`${t("replaceLineTo")}: ${line.after}`}
                          >
                            {line.after}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {file.truncated && (
                    <p className="s-replace-file__more">
                      {tf("replaceMoreLines", {
                        count: countPhrase(file.count - file.lines.length, "replacements"),
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="s-replace__foot">
        <span className="s-replace__summary" role="status">
          {preview === null
            ? ""
            : tf("replaceSummary", {
                edits: countPhrase(chosen.edits, "replacements"),
                notes: countPhrase(chosen.notes, "notes"),
              })}
        </span>
        <button
          type="button"
          className="s-replace__run"
          disabled={busy || chosen.notes === 0}
          onClick={() => void run()}
        >
          {busy
            ? t("replaceRunning")
            : tf("replaceRun", { count: countPhrase(chosen.notes, "notes") })}
        </button>
      </div>
    </div>
  );
}
