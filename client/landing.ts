// Landing: "open this note AND put the reader ON the line" — the line-based
// variant of the pendingHeading machinery, for surfaces that know a source
// LINE rather than a heading (a backlink's mention, a search match).
//
// It deliberately owns no scrolling of its own. The editor already answers
// `vellum:goto-heading` with a `detail.line` (client/components/Editor.tsx —
// the outline panel's wire), and the reading view answers the same event; this
// module's job is only the part neither surface can do for itself:
//
//   - WAITING. A cross-note landing dispatches into an editor that does not
//     exist yet — `openNote` swaps the pane and the CodeMirror view builds
//     asynchronously — so the goto is retried each frame until a view for the
//     note is attached (or the reader moves on, or ~4s pass and we stop
//     pestering a note that never mounted).
//   - THE PENDING SLOT for the reading view, which remounts per note exactly
//     as the editor does but renders asynchronously too; it consumes
//     `takePendingLine` after its own render, the same shape `pendingHeading`
//     has in the store. The slot lives HERE and not in state.ts because it is
//     a one-shot handshake between a click and the next mount, not app state
//     anything else may read.
//   - THE FLASH. Landing mid-note is invisible if nothing marks the line —
//     the scroll ends and the reader is somewhere, with no cue as to why.
//     `flashElement` wears `.s-landed` for FLASH_MS on whatever element the
//     surface landed on (a .cm-line, a rendered heading).
//
// The editor's view is reached through `bufferOf()` via a DYNAMIC import:
// buffers.ts is the module that owns CodeMirror, this one is imported by the
// sidebar in the first-paint closure, and a static import would put CodeMirror
// into the entry chunk (check-bundle names that failure). The import only
// happens once a landing actually needs an editor view — and never for a
// visitor, whose panes always read.

import type { EditorView } from "@codemirror/view";
import type { HoverCardConfig } from "./hovercard.ts"; // type-only: the engine itself stays out of first paint
import { isTexPath, noteTitleOf } from "../shared/noteFormat.ts";
import { getNote } from "./api.ts";
import { useStore } from "./state.ts";
import { paneAt, surfaceOf } from "./workspace.ts";
import "./styles/landing.css";

/** How long a landed-on line stays marked. Long enough to catch an eye that
 *  was still on the panel it clicked in; short enough that the mark is a cue,
 *  not a highlight the reader has to wonder how to clear. */
export const FLASH_MS = 1500;

/** Give up waiting for an editor view after this long — a note that has not
 *  mounted in 4s is not mounting (load error, palette detour), and a goto
 *  fired minutes later would yank a reader who has long since moved on. */
const LAND_TIMEOUT_MS = 4000;

/** Grace before "openPath is not our note" aborts the wait: openNote commits
 *  synchronously today, but the loop must not hinge on that staying true. */
const OPEN_GRACE_MS = 500;

let pendingLine: { path: string; line: number } | null = null;
/** Bumped per landing so a slow first landing cannot fire under a second. */
let seq = 0;

/** The reading view's half of the handshake: called once its content is
 *  rendered. Returns the 1-based FULL-SOURCE line to land on, or null when
 *  this mount owes no landing. One-shot — taking it clears it. */
export function takePendingLine(path: string): number | null {
  if (pendingLine === null || pendingLine.path !== path) return null;
  const line = pendingLine.line;
  pendingLine = null;
  return line;
}

function dispatchGoto(path: string, line: number): void {
  // The editor's existing handler reads `line` (1-based, full document); the
  // reading view's reads `line` + `path`. `path` rides along so a handler CAN
  // ignore a goto meant for a sibling pane's note — the pre-existing handlers
  // that ignore it behave exactly as they always did.
  window.dispatchEvent(new CustomEvent("vellum:goto-heading", { detail: { line, path } }));
}

/** True when the focused pane would mount an EDITOR for its active tab —
 *  the only case worth pulling the CodeMirror chunk in for. */
function focusedPaneEdits(): boolean {
  const st = useStore.getState();
  if (!st.admin) return false; // a visitor's panes always read
  const pane = paneAt(st.workspace, st.workspace.focus);
  return pane !== null && surfaceOf(pane) === "edit";
}

/** The connected editor view showing `path`, or null. Dynamic import — see
 *  the module comment. */
async function editorViewFor(path: string): Promise<EditorView | null> {
  let bufferOf: (p: string) => { views: Set<EditorView> } | null;
  try {
    ({ bufferOf } = await import("./editor/buffers.ts"));
  } catch {
    return null;
  }
  const buf = bufferOf(path);
  if (!buf) return null;
  for (const view of buf.views) {
    if (view.dom.isConnected) return view;
  }
  return null;
}

/** Land the reader on `line` (1-based, full source) of `path`, in whatever
 *  surface the note opens in, with the line marked for FLASH_MS. */
export function landOnLine(path: string, line: number): void {
  const mySeq = ++seq;
  const st = useStore.getState();
  const alreadyOpen = st.openPath === path;
  if (alreadyOpen) {
    // No remount is coming, so nothing would ever consume a pending slot —
    // the live surfaces answer the event directly instead.
    pendingLine = null;
    dispatchGoto(path, line);
    if (focusedPaneEdits()) {
      void editorViewFor(path).then((view) => {
        if (view && seq === mySeq) flashEditorLine(view, line);
      });
    }
    return;
  }

  pendingLine = { path, line };
  st.openNote(path);
  const start = Date.now();
  const tick = (): void => {
    if (seq !== mySeq) return; // a newer landing took over
    if (pendingLine === null || pendingLine.path !== path) return; // reading view landed it
    const now = useStore.getState();
    if (
      now.openPath !== path && Date.now() - start > OPEN_GRACE_MS ||
      Date.now() - start > LAND_TIMEOUT_MS
    ) {
      pendingLine = null; // the reader moved on; stop carrying the debt
      return;
    }
    if (!focusedPaneEdits()) {
      // A reading pane: its own mount consumes the pending slot. Keep
      // watching only so a mode flip mid-landing still gets the editor case.
      requestAnimationFrame(tick);
      return;
    }
    void editorViewFor(path).then((view) => {
      if (seq !== mySeq || pendingLine === null || pendingLine.path !== path) return;
      if (view === null) {
        requestAnimationFrame(tick);
        return;
      }
      pendingLine = null;
      dispatchGoto(path, line);
      flashEditorLine(view, line);
    });
  };
  requestAnimationFrame(tick);
}

/** Mark an element as "you landed here" for FLASH_MS. Re-landing on the same
 *  element restarts the mark instead of stacking timers into a flicker. */
export function flashElement(el: HTMLElement): void {
  el.classList.remove("s-landed");
  // Force a style flush so removing+re-adding restarts the CSS animation.
  void el.offsetWidth;
  el.classList.add("s-landed");
  window.setTimeout(() => el.classList.remove("s-landed"), FLASH_MS);
}

/** Find and mark the editor's rendered line element. The view scrolls first
 *  (the goto handler's scrollIntoView) and CodeMirror only renders lines near
 *  the viewport, so the lookup retries across a few frames. Missing the flash
 *  is acceptable; flashing the wrong line is not — every path here resolves
 *  through the view's own coordinates, never a child index. */
function flashEditorLine(view: EditorView, line: number): void {
  let tries = 12;
  const attempt = (): void => {
    if (!view.dom.isConnected) return;
    const doc = view.state.doc;
    const n = Math.min(Math.max(1, Math.floor(line)), doc.lines);
    let el: HTMLElement | null = null;
    try {
      const at = view.domAtPos(doc.line(n).from);
      const base = at.node instanceof HTMLElement ? at.node : at.node.parentElement;
      el = base?.closest<HTMLElement>(".cm-line") ?? null;
    } catch {
      el = null;
    }
    if (el !== null) {
      flashElement(el);
      return;
    }
    if (--tries > 0) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

// ---------------------------------------------------------------------------
// Hover previews for the ADMIN app's note-row surfaces (backlink cards, search
// hits). The ENGINE is client/hovercard.ts, unchanged — same LRU, same card;
// this is only the admin wiring of its three callbacks, shared by the two
// panels so they cannot drift: resolve reads the `data-preview-path` a row
// already wears (the blog's own convention for button rows), and render is the
// blog card's recipe — excerpt, not whole note — behind DYNAMIC imports,
// because the reading renderer must not enter the first-paint chunk for the
// sake of a hover (check-bundle stands over that door).

/** Install note hover previews over `root`. Returns a disposer — callers
 *  re-install on language change, exactly as the blog shell does. The engine
 *  itself arrives via dynamic import (it lived only in the blog chunk before
 *  this feature, and a hover affordance is not worth first-paint bytes); a
 *  dispose that beats the import simply means nothing was ever installed. */
export function installNotePreviews(root: HTMLElement, scroller?: HTMLElement | null): () => void {
  let dispose: (() => void) | null = null;
  let dead = false;
  void import("./hovercard.ts").then(({ installHoverCards }) => {
    if (dead) return;
    dispose = installHoverCards(previewConfig(root, scroller ?? null));
  });
  return () => {
    dead = true;
    dispose?.();
  };
}

function previewConfig(root: HTMLElement, scroller: HTMLElement | null): HoverCardConfig {
  return {
    root,
    scroller,
    resolve: (el) => el.closest<HTMLElement>("[data-preview-path]")?.dataset.previewPath || null,
    title: noteTitleOf,
    render: async (path) => {
      let content: string;
      try {
        content = (await getNote(path)).content;
      } catch {
        return null; // a note this session may not read never gets a card
      }
      const title = noteTitleOf(path);
      const { renderNoteContent } = await import("./reading/renderNote.ts");
      let md: string;
      if (isTexPath(path)) {
        const { texPreviewSource } = await import("./reading/texRender.ts");
        md = texPreviewSource(content, null);
      } else {
        const { previewExcerpt } = await import("./blog/postPreview.ts");
        md = previewExcerpt(content, title);
      }
      if (!md) return null;
      return renderNoteContent(md, {
        notePath: path,
        tree: useStore.getState().tree,
        embedded: true,
      });
    },
  };
}
