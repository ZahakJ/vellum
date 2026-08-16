// Vim's SUB-MODE, published to the shell.
//
// The VIM pill in the status bar only ever said that the extension is loaded.
// That is not the trap. The trap is that in NORMAL mode the keys under the
// reader's fingers are commands rather than text — `dd` deletes a line, `i`
// types nothing — and nothing on screen distinguished that from INSERT. It is
// the same failure reading mode had before it grew three surfaces, and the
// owner named it: "same with vim mode".
//
// Two fixes ride together. `vim({ status: true })` in setup.ts mounts vim's
// own panel at the foot of the editor, which is what draws `-- INSERT --` and
// the `:` / `/` command line (a modal editor with no command line is not a
// vim). This module is the other half: it forwards every mode change into the
// store so the PILL can carry the sub-mode too, since the panel is inside the
// editor and the bar is where the reader already looks for mode.
//
// @replit/codemirror-vim is loaded on demand and must stay that way, so
// nothing here imports it: `getCM(view)` is literally `view.cm`, and the two
// event names are part of its public surface.

import type { EditorView } from "@codemirror/view";
import { useStore } from "../state.ts";

/** The vim sub-modes the pill distinguishes. `visual line`/`visual block`
 *  fold into `visual`: the pill has room for one word, and what the reader
 *  needs from it is "typing does not type". */
export type VimSubMode = "normal" | "insert" | "visual" | "replace";

interface VimCM {
  state: { vim?: { mode?: string } | null };
  on(type: string, f: (event: { mode?: string; subMode?: string }) => void): void;
  off(type: string, f: (event: { mode?: string; subMode?: string }) => void): void;
}

function cmOf(view: EditorView): VimCM | null {
  return (view as unknown as { cm?: VimCM }).cm ?? null;
}

function normalize(mode: string | undefined): VimSubMode {
  const m = (mode ?? "").toLowerCase();
  if (m.startsWith("insert")) return "insert";
  if (m.startsWith("visual")) return "visual";
  if (m.startsWith("replace")) return "replace";
  return "normal";
}

function publish(mode: VimSubMode | null): void {
  const store = useStore.getState();
  if (store.vimSubMode !== mode) store.setVimSubMode(mode);
}

const attached = new WeakMap<EditorView, (e: { mode?: string }) => void>();

/** Start (or refresh) mode reporting for a view whose vim extension is live.
 *  Safe to call repeatedly — the listener is registered once per view. */
export function attachVimStatus(view: EditorView): void {
  const cm = cmOf(view);
  if (!cm) {
    publish(null);
    return;
  }
  if (!attached.has(view)) {
    const handler = (event: { mode?: string }): void => {
      // The view can outlive the note (React keeps it during a save flush);
      // a disconnected editor must not keep repainting the bar.
      if (!view.dom.isConnected) return;
      publish(normalize(event.mode));
    };
    cm.on("vim-mode-change", handler);
    attached.set(view, handler);
  }
  // Entering vim fires no event — it simply IS normal mode — so seed it.
  publish(normalize(cm.state.vim?.mode));
}

/** Stop reporting: vim was switched off, or the editor is going away. */
export function detachVimStatus(view: EditorView | null): void {
  if (view) {
    const handler = attached.get(view);
    const cm = cmOf(view);
    if (handler && cm) cm.off("vim-mode-change", handler);
    attached.delete(view);
  }
  publish(null);
}
