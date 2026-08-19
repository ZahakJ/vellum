// The note editor: one CodeMirror VIEW per pane showing a note.
//
// It no longer owns the document. `client/editor/buffers.ts` does — the note's
// EditorState, its undo history, its dirty flag, its autosave timer and the
// `baseMtimeMs` its next write is checked against all live in a refcounted
// registry keyed by path, so they survive this component being unmounted. Which
// it is, constantly: `App.tsx` remounts the editor on every `openPath` change,
// so before the registry a tab switch discarded the document and everything
// CodeMirror keeps beside it. The undo stack was the visible casualty.
//
// What this component still owns is the VIEW: the DOM, the scroll position, the
// vim toggle, the language effect. Two panes on one note are two views of one
// buffer — they scroll independently, which is the point of having two, and
// they share a document, which is the point of it being one note.

import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { focusIsClaimed } from "../a11y.ts";
import { isNotPublishedError } from "../api.ts";
import { holdsLease, setLeaseListener, takeOver } from "../windows/lease.ts";
import { t, tf } from "../i18n.ts";
import { Lru } from "../lru.ts";
import { useStore } from "../state.ts";
import { paneAt, surfaceOf } from "../workspace.ts";
import { toast } from "../toast.ts";
import { buildEditorState, setEditorLanguage, setVim } from "../editor/setup.ts";
import {
  acquire,
  attach,
  detach,
  dispatchFrom,
  release,
  save as saveBuffer,
  setDirtyListener,
  setDivergeListener,
  setSaveErrorListener,
} from "../editor/buffers.ts";
import { attachVimStatus, detachVimStatus } from "../editor/vimStatus.ts";
import { languageChanged } from "../editor/langEffect.ts";
import { noteLayoutChanged } from "../editor/noteLayout.ts";
import { findHeadingLine } from "../editor/links.ts";
import { anchorLine } from "../../shared/anchors.ts";
import { isTexPath } from "../../shared/noteFormat.ts";
import { findTexFrontmatter } from "../../shared/tex.ts";
import { INSERT_TEMPLATE_EVENT, type InsertTemplateDetail } from "../templateActions.ts";
import { applyTemplate, splitFrontmatter } from "../templates.ts";

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

/** Scroll positions survive switching tabs; module-level so remounts keep them.
 *  Bounded (client/lru.ts): unbounded, its ceiling is "every note edited this
 *  session", i.e. the vault. */
const scrollPositions = new Lru<number>({ max: 256 });

function markDirty(path: string, dirty: boolean): void {
  useStore.setState((state) =>
    state.dirty[path] === dirty
      ? state
      : { dirty: { ...state.dirty, [path]: dirty } },
  );
}

// The registry reports dirtiness and divergence; the store and the toaster are
// how this app says those things. Wired once at module scope rather than per
// mount, because the registry outlives every mount.
setDirtyListener(markDirty);
setSaveErrorListener((path, err) => {
  console.error(`Failed to save ${path}`, err);
  toast(tf("saveFailed", { path }), "error");
});
setDivergeListener((path) => {
  // A save was refused because the file changed underneath. Nothing was lost
  // and nothing was written; the reader's text is still in the buffer, which
  // has stopped autosaving so the next keystroke cannot clobber the newer
  // version. Saying so is the minimum — the side-by-side resolution arrives
  // with the pane work, which is where there is room to show both.
  toast(tf("saveConflict", { path }), "error");
});

/** Paths whose caret has already been placed once. A buffer restored from the
 *  registry brings its own selection back, so re-running the frontmatter jump
 *  on every remount would drag the caret out of the reader's sentence and into
 *  the properties card every time they switched tabs and back. */
const caretPlaced = new Set<string>();

export default function Editor({ path, paneId = null }: { path: string; paneId?: string | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Whether THIS window may write this note. Recomputed rather than stored:
  // the lease is derived from facts both windows share, so asking is always
  // right and caching would let the two disagree.
  const [writable, setWritable] = useState(true);
  useEffect(() => {
    setWritable(holdsLease(path));
    return setLeaseListener((changed) => {
      if (changed === path) setWritable(holdsLease(path));
    });
  }, [path]);
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

    // The registry loads the note once and keeps it. `build` is handed in
    // rather than imported there, so buffers.ts stays ignorant of the
    // extension list — which is format-aware and reaches half the client.
    acquire(path, (doc) =>
      buildEditorState({
        doc,
        path,
        vimMode: useStore.getState().vimMode,
        // Dirty tracking and the autosave timer belong to the buffer now: a
        // save must survive the pane that started it being unmounted, and a
        // per-view timer cannot. `dispatchFrom` below is where they are driven.
        onDocChanged: () => {},
        onSave: () => void saveBuffer(path),
      }),
    )
      .then((buf) => {
        if (disposed || !hostRef.current) {
          // Acquired and immediately abandoned (a fast tab switch). Give the
          // reference back or the buffer is pinned open forever.
          release(path);
          return;
        }
        const view: EditorView = new EditorView({
          state: buf.state,
          parent: hostRef.current,
          // EVERY transaction goes through the registry: it keeps the canonical
          // state, mirrors document changes into the other panes showing this
          // note, and owns dirty + autosave.
          dispatchTransactions: (trs) => dispatchFrom(path, view, trs),
        });
        attach(path, view);
        viewRef.current = view;

        // Vim loads lazily; patch it into the fresh view once the module is in.
        if (useStore.getState().vimMode) setVim(view, true);
        // The module may already be cached, in which case buildEditorState()
        // brought the vim plugin up with the view and setVim's async path
        // never runs — the pill would then show VIM with no sub-mode.
        else attachVimStatus(view);

        // ONCE per note, not once per mount. A buffer restored from the
        // registry brings its own selection back with it, so re-running this
        // would drag the caret out of the reader's sentence and into the
        // properties card every time they switched tabs and came back.
        if (!caretPlaced.has(path)) {
          caretPlaced.add(path);
          const anchor = afterFrontmatter(path, view.state.doc.toString());
          if (anchor > 0 && anchor <= view.state.doc.length) {
            view.dispatch({ selection: { anchor } });
          }
        }

        // [[Note#Heading]] navigation: land on the requested heading.
        const pending = useStore.getState().pendingHeading;
        if (pending !== null) {
          useStore.getState().setPendingHeading(null);
          // Format-blind: a markdown heading and a LaTeX \label are the same
          // kind of anchor, so one lookup lands on either.
          const line = anchorLine(path, view.state.doc.toString(), pending);
          if (line !== null && line <= view.state.doc.lines) {
            const pos = view.state.doc.line(line).from;
            view.dispatch({
              selection: { anchor: pos },
              effects: EditorView.scrollIntoView(pos, {
                y: "start",
                yMargin: 24,
              }),
            });
            if (!focusIsClaimed()) view.focus();
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
        // Opening a note normally means "I want to write in it", so the caret
        // comes here — unless a chrome widget is mid-keystroke and said the
        // focus is its (the tab bar arrowing between notes; see a11y.ts).
        if (!focusIsClaimed()) view.focus();
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
      const view = viewRef.current;
      viewRef.current = null;
      if (!view) {
        // The load may still be in flight; the `disposed` branch above hands
        // the reference back when it lands.
        return;
      }
      scrollPositions.set(path, view.scrollDOM.scrollTop);
      // NO FLUSH HERE, and that is the change. The buffer keeps the document
      // and its dirty flag, so an unmount is no longer the last chance to save
      // — `release()` saves only when nothing holds the note any more, and even
      // then it keeps the buffer until the write lands. Flushing here as well
      // would race the registry's own timer and send the same text twice.
      detach(path, view);
      release(path);
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
    const view = viewRef.current;
    if (view) {
      view.dispatch({ effects: languageChanged.of(null) });
      // The find panel's phrases and the spellcheck `lang` are state facets
      // the registry caches with the buffer; the decoration rebuild above
      // cannot touch them. This writes the fresh language back into the
      // shared EditorState through the live view.
      setEditorLanguage(view);
    }
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
      // ONE editor answers. This listener predates panes, when "the editor"
      // was a singular; with a split open, every mounted editor applied the
      // template to its own note. The insert belongs to the pane that owns
      // the caret the command was aimed at: the focused pane when it is an
      // editor, else the pane `noteFocus` names (a book or graph can hold
      // `focus` while the note being worked on sits beside it) — the same
      // resolution `openPath`, which the command consulted, mirrors.
      if (detail.handled.value) return;
      if (paneId !== null) {
        const ws = useStore.getState().workspace;
        const focused = paneAt(ws, ws.focus);
        const target = focused !== null && surfaceOf(focused) === "edit" ? ws.focus : ws.noteFocus;
        if (paneId !== target) return;
      }
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
  }, [paneId]);

  // Outline (TOC) clicks: jump the editor to the heading's source line.
  useEffect(() => {
    const onGoto = (ev: Event): void => {
      const view = viewRef.current;
      if (!view) return;
      const detail =
        (ev as CustomEvent<{ line?: number; text?: string; path?: string }>).detail ?? {};
      // A goto that names a path is for THAT note. With two editor panes on
      // screen, an unscoped landing scrolled both — the one you clicked for
      // and the one you were reading.
      if (typeof detail.path === "string" && detail.path !== path) return;
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

  return (
    <div className="s-editor-wrap">
      {!writable && (
        // ANOTHER WINDOW HAS THE PEN. Not a lock and not a warning: the text
        // here is intact and stays intact, autosave is simply off so two
        // windows cannot race each other into a 409 every few minutes. One
        // button takes the note back, and the other window becomes the reader.
        //
        // The strip reserves its height rather than appearing into the flow —
        // prose that reflows under a live caret is how a reader loses their
        // place mid-sentence.
        <div className="s-editor-strip" role="status">
          <span className="s-editor-strip__text">{t("leaseElsewhere")}</span>
          <button
            type="button"
            className="s-editor-strip__act"
            onClick={() => takeOver(path)}
          >
            {t("leaseTakeOver")}
          </button>
        </div>
      )}
      <div className="s-editor" ref={hostRef} />
    </div>
  );
}
