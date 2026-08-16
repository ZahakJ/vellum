// The note editor. Owns one CodeMirror view per open path: loads the note,
// autosaves (600ms debounce + Ctrl/Cmd+S), tracks dirty state in the store,
// follows the vim toggle, and preserves per-note scroll position across
// tab switches.

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { getNote, isNotPublishedError, putNote } from "../api.ts";
import { t, tf } from "../i18n.ts";
import { markSelfWrite, useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { buildEditorState, setVim } from "../editor/setup.ts";
import { attachVimStatus, detachVimStatus } from "../editor/vimStatus.ts";
import { languageChanged } from "../editor/langEffect.ts";
import { noteLayoutChanged } from "../editor/noteLayout.ts";
import { findHeadingLine } from "../editor/links.ts";
import { anchorLine } from "../../shared/anchors.ts";
import { isTexPath } from "../../shared/noteFormat.ts";
import { findTexFrontmatter } from "../../shared/tex.ts";
import { INSERT_TEMPLATE_EVENT, type InsertTemplateDetail } from "../templateActions.ts";
import { applyTemplate, splitFrontmatter } from "../templates.ts";

const AUTOSAVE_MS = 600;

/** Offset just past a leading frontmatter block (0 if none). Opening a note
 *  lands the cursor here so frontmatter renders as its properties card instead
 *  of raw source — in BOTH formats: a `.tex` note's frontmatter is a `%--- …
 *  %---%` comment block, and landing the caret inside it would have opened
 *  every LaTeX note on five lines of raw YAML-in-comments. */
function afterFrontmatter(path: string, content: string): number {
  if (isTexPath(path)) return findTexFrontmatter(content)?.end ?? 0;
  if (!/^---\r?\n/.test(content)) return 0;
  const m = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
  return m ? m[0].length : 0;
}

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
  // The editor's chrome (properties card, fold chevrons, transclusion cards,
  // upload pills) is CM6 widget DOM, not React, so it cannot subscribe to the
  // store the way i18n.ts asks components to. This is its subscription: a
  // settings language flip dispatches one effect into the live view, which is
  // what makes the decoration builders rebuild (see editor/langEffect.ts).
  const language = useStore((s) => s.language);
  // The site's note-layout defaults — half of what the editor's direction and
  // alignment resolve to (the note's own frontmatter is the other half).
  const siteTextDirection = useStore((s) => s.textDirection);
  const siteTextAlign = useStore((s) => s.textAlign);

  useEffect(() => {
    let disposed = false;
    let dirty = false;
    let saveTimer: number | undefined;

    const save = async (view: EditorView): Promise<void> => {
      window.clearTimeout(saveTimer);
      const content = view.state.doc.toString();
      try {
        // Claim the write BEFORE sending it: the server notifies its SSE
        // subscribers while it is still handling the PUT, so the echo of this
        // save reaches App's handler before `putNote` resolves and before
        // `dirty` clears. Without this the reader's own autosave was reported
        // back to them as "changed on disk" (see markSelfWrite in state.ts).
        markSelfWrite(path);
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
        // The module may already be cached, in which case buildEditorState()
        // brought the vim plugin up with the view and setVim's async path
        // never runs — the pill would then show VIM with no sub-mode.
        else attachVimStatus(view);

        const anchor = afterFrontmatter(path, note.content);
        if (anchor > 0 && anchor <= view.state.doc.length) {
          view.dispatch({ selection: { anchor } });
        }

        // [[Note#Heading]] navigation: land on the requested heading.
        const pending = useStore.getState().pendingHeading;
        if (pending !== null) {
          useStore.getState().setPendingHeading(null);
          // Format-blind: a markdown heading and a LaTeX \label are the same
          // kind of anchor, so one lookup lands on either.
          const line = anchorLine(path, note.content, pending);
          if (line !== null && line <= view.state.doc.lines) {
            const pos = view.state.doc.line(line).from;
            view.dispatch({
              selection: { anchor: pos },
              effects: EditorView.scrollIntoView(pos, {
                y: "start",
                yMargin: 24,
              }),
            });
            view.focus();
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
        view.focus();
      })
      .catch((err) => {
        // See ReadingView: a 404 inside visitor preview means "not
        // published", which is the correct answer, not a failure.
        if (isNotPublishedError(err)) {
          toast(t("previewNotPublished"));
          return;
        }
        console.error(`Failed to open ${path}`, err);
        toast(tf("openFailed", { path }), "error");
      });

    return () => {
      disposed = true;
      window.clearTimeout(saveTimer);
      const view = viewRef.current;
      viewRef.current = null;
      if (!view) return;
      scrollPositions.set(path, view.scrollDOM.scrollTop);
      if (dirty) {
        // Flush unsaved changes before the view goes away — claimed like
        // every other write, so the echo is not read as an external edit.
        const content = view.state.doc.toString();
        markSelfWrite(path);
        putNote(path, content)
          .then(() => markDirty(path, false))
          .catch((err) => {
            console.error(`Failed to save ${path}`, err);
            toast(tf("saveFailed", { path }), "error");
          });
      }
      // The bar must not keep reporting a sub-mode for an editor that is
      // gone (switching to reading mode, closing the last tab).
      detachVimStatus(view);
      view.destroy();
    };
  }, [path]);

  useEffect(() => {
    if (viewRef.current) setVim(viewRef.current, vimMode);
  }, [vimMode]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageChanged.of(null) });
  }, [language]);

  // The SITE's note direction/alignment moved (a settings save). Same shape as
  // the language signal above and for the same reason — the editor is not a
  // React tree — and deliberately NOT a state rebuild: repainting two
  // attributes must not cost the reader their undo history.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: noteLayoutChanged.of(null) });
  }, [siteTextDirection, siteTextAlign]);

  // "Insert template…" — ONE transaction, so one Ctrl+Z takes the whole thing
  // back out. The frontmatter merge and the body insert are computed together
  // (client/templates.ts) because they are one edit: a template's `tags:` line
  // belongs in the note's existing `---` block, never in a second one halfway
  // down the file, and undoing "insert template" must not leave the merged
  // keys behind.
  useEffect(() => {
    const onInsert = (ev: Event): void => {
      const view = viewRef.current;
      const detail = (ev as CustomEvent<InsertTemplateDetail>).detail;
      if (!view || !detail) return;
      const doc = view.state.doc.toString();
      const applied = applyTemplate(detail.source, doc, detail.vars);
      // Where the note's own frontmatter block ends today, and what it
      // becomes. `content` is the merged block plus the untouched body, so
      // the difference in length is the difference in the block.
      const bodyStart = doc.length - splitFrontmatter(doc).body.length;
      const newBlockLength = applied.content.length - splitFrontmatter(applied.content).body.length;
      const newBlock = applied.content.slice(0, newBlockLength);
      const changes: { from: number; to?: number; insert: string }[] = [];
      if (newBlock !== doc.slice(0, bodyStart)) {
        changes.push({ from: 0, to: bodyStart, insert: newBlock });
      }
      // The caret, clamped out of the frontmatter it must never land inside.
      const caret = Math.max(view.state.selection.main.head, bodyStart);
      if (applied.insert !== "") changes.push({ from: caret, insert: applied.insert });
      if (changes.length === 0) {
        detail.handled.value = true;
        return;
      }
      const shift = newBlockLength - bodyStart;
      view.dispatch({
        changes,
        selection: { anchor: caret + shift + applied.insert.length },
        scrollIntoView: true,
      });
      view.focus();
      detail.handled.value = true;
    };
    window.addEventListener(INSERT_TEMPLATE_EVENT, onInsert);
    return () => window.removeEventListener(INSERT_TEMPLATE_EVENT, onInsert);
  }, []);

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
