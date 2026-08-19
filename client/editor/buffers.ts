// THE DOCUMENT LIVES HERE, not in the component that draws it.
//
// `Editor.tsx` used to OWN the note: it fetched on mount, built an EditorState,
// and destroyed the view on unmount — and `App.tsx` remounts it on every
// `${openPath}#${reloadTick}` change. So a tab switch threw away the document
// and everything CodeMirror keeps beside it. The visible cost was the undo
// stack: leave a note, come back, and Ctrl+Z had nothing to undo, on a product
// whose autosave writes to disk every 600ms and whose trash catches deletes and
// not overwrites. The structural cost was larger — two panes on one note would
// have been two documents typed into independently, and the last one unmounted
// would win.
//
// A refcounted registry keyed by path fixes both, and four features fall out of
// the one change: undo survives a tab switch, two panes are one document typed
// into twice, the save path finally has somewhere to hold the mtime a write
// precondition needs, and a document can outlive the pane that showed it.
//
// WHAT A BUFFER OWNS, that the view used to:
//   · the EditorState — doc, history, selection, folds
//   · dirty, and the autosave timer (so a save in flight survives a tab switch)
//   · `baseMtimeMs`, the mtime the server last handed us for this file, which
//     is what `PUT /api/note` compares to refuse a stale write
//   · `diverged`, the disk version of a note whose save was refused
//
// WHAT A VIEW STILL OWNS: scroll position, and the DOM. Two panes on one note
// scroll independently, which is the whole point of having two.
//
// This module imports CodeMirror. Nothing in the first-paint closure may import
// it — see bufferBridge.ts.

import { Annotation, EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { flushNoteBeacon, getNote, isStaleWriteError, putNote } from "../api.ts";
import type { NoteData } from "../../shared/types.ts";
import { markSelfWrite } from "../state.ts";
import { DOC_STATS_EVENT, registerBufferBridge, type DocStats } from "./bufferBridge.ts";
import { countWords, noteProse } from "../../shared/wordCount.ts";
import { announceWrite } from "../windows/coherence.ts";
import { claim, holdsLease, unclaim } from "../windows/lease.ts";

/** The autosave debounce. Unchanged from the value Editor.tsx carried; it is
 *  quoted in CONTRACTS and in the durability chapter's argument. */
export const AUTOSAVE_MS = 600;

/** Marks a transaction as the echo of a sibling view's edit. Forwarding a
 *  change into the other panes showing one note is how they stay one document;
 *  this is what stops the echo being forwarded back and the two panes typing
 *  at each other forever. */
const sibling = Annotation.define<boolean>();

/** Counting is O(document) and typing is not, so it trails the keystrokes
 *  rather than riding them. Long enough to skip most of a burst, short enough
 *  that the number is never visibly stale. */
const STATS_MS = 250;
const statsTimers = new Map<string, number>();

function publishStats(path: string): void {
  const buf = buffers.get(path);
  if (!buf) return;
  const doc = buf.state.doc.toString();
  const sel = buf.state.selection;
  let selText = "";
  for (const range of sel.ranges) {
    if (!range.empty) selText += `${doc.slice(range.from, range.to)}\n`;
  }
  const detail: DocStats = {
    path,
    words: countWords(noteProse(doc)),
    chars: doc.length,
    selWords: selText === "" ? null : countWords(noteProse(selText)),
    selChars: selText === "" ? null : selText.length - selText.split("\n").length + 1,
    ranges: sel.ranges.length,
  };
  window.dispatchEvent(new CustomEvent(DOC_STATS_EVENT, { detail }));
}

function scheduleStats(path: string): void {
  window.clearTimeout(statsTimers.get(path));
  statsTimers.set(path, window.setTimeout(() => publishStats(path), STATS_MS));
}

export interface Buffer {
  path: string;
  /** The canonical document. A view is built from this and writes back to it. */
  state: EditorState;
  /** The mtime the server last gave us for this file. The write precondition. */
  baseMtimeMs: number;
  dirty: boolean;
  /** The disk version of a note whose save was REFUSED as stale. Set on a 409
   *  and never cleared by anything but a resolution: the reader's text is not
   *  discarded, and the buffer stops autosaving so it cannot be clobbered by
   *  the next keystroke's timer. */
  diverged: NoteData | null;
  /** False while ANOTHER WINDOW holds the write lease on this note. Autosave
   *  stops; nothing is discarded. The pane says so and offers to take it back
   *  (client/windows/lease.ts). */
  writable: boolean;
  /** Views currently showing this buffer. More than one once panes land. */
  views: Set<EditorView>;
  refs: number;
  saveTimer: number;
}

const buffers = new Map<string, Buffer>();
/** In-flight loads, so two panes opening one note make one request. */
const loading = new Map<string, Promise<Buffer>>();

type DirtyListener = (path: string, dirty: boolean) => void;
let onDirty: DirtyListener = () => {};
/** The store's channel. Set by Editor.tsx rather than imported, so this module
 *  keeps no opinion about which store exists. */
export function setDirtyListener(fn: DirtyListener): void {
  onDirty = fn;
}

type DivergeListener = (path: string, disk: NoteData) => void;
let onDiverge: DivergeListener = () => {};
export function setDivergeListener(fn: DivergeListener): void {
  onDiverge = fn;
}

type SaveErrorListener = (path: string, err: unknown) => void;
let onSaveError: SaveErrorListener = () => {};
/** A save that failed for a reason that is NOT a conflict — the disk is full,
 *  the server is gone, the session expired. It must be said: the buffer stays
 *  dirty and the note is still only in this tab, which is exactly the state a
 *  reader must not be left in silently. */
export function setSaveErrorListener(fn: SaveErrorListener): void {
  onSaveError = fn;
}

export function bufferOf(path: string): Buffer | null {
  return buffers.get(path) ?? null;
}

function setDirty(buf: Buffer, dirty: boolean): void {
  if (buf.dirty === dirty) return;
  buf.dirty = dirty;
  onDirty(buf.path, dirty);
}

/** Load a note into a buffer, or hand back the one already open.
 *
 *  `build` turns the fetched text into an EditorState; it is passed in rather
 *  than imported so this module does not depend on the editor's extension list
 *  (which is format-aware and reaches half the client). */
export function acquire(
  path: string,
  build: (doc: string) => EditorState,
): Promise<Buffer> {
  const open = buffers.get(path);
  if (open) {
    open.refs += 1;
    return Promise.resolve(open);
  }
  const already = loading.get(path);
  if (already) {
    return already.then((buf) => {
      buf.refs += 1;
      return buf;
    });
  }
  const p = getNote(path).then((note) => {
    // Two callers can arrive while one fetch is in flight; the first to finish
    // creates the buffer and the second adopts it.
    const existing = buffers.get(path);
    if (existing) return existing;
    const buf: Buffer = {
      path,
      state: build(note.content),
      baseMtimeMs: note.mtimeMs,
      dirty: false,
      diverged: null,
      writable: true,
      views: new Set(),
      refs: 1,
      saveTimer: 0,
    };
    buffers.set(path, buf);
    loading.delete(path);
    // Announce that this window is now the one typing into this note. Another
    // window already holding it wins on age, and `setWritable` arrives a tick
    // later to turn our autosave off.
    claim(path);
    buf.writable = holdsLease(path);
    return buf;
  });
  loading.set(path, p);
  p.catch(() => loading.delete(path));
  return p;
}

/** One fewer holder. The buffer is kept while anything still holds it AND for
 *  as long as it is dirty — an unsaved document is not a cache entry, and
 *  dropping it because the last pane closed is the data loss this registry
 *  exists to prevent. A clean, unheld buffer is released. */
export function release(path: string): void {
  const buf = buffers.get(path);
  if (!buf) return;
  buf.refs = Math.max(0, buf.refs - 1);
  if (buf.refs > 0) return;
  if (buf.dirty) {
    // Save now rather than on a timer nobody is left to wait for.
    void save(path);
    return;
  }
  window.clearTimeout(buf.saveTimer);
  buffers.delete(path);
  // Hand the note back, so a peer showing it as a read-only mirror becomes
  // editable again the moment we close it.
  unclaim(path);
}

/** A view is now showing this buffer. */
export function attach(path: string, view: EditorView): void {
  buffers.get(path)?.views.add(view);
}

export function detach(path: string, view: EditorView): void {
  const buf = buffers.get(path);
  if (!buf) return;
  buf.views.delete(view);
  // The canonical state is whatever the last view to leave was showing, so a
  // remount picks the document up mid-sentence — caret, selection, folds and
  // the whole undo history included.
  buf.state = view.state;
}

/** Apply a transaction from one view, then mirror its CHANGES into every other
 *  view of the same buffer.
 *
 *  Changes only, never the selection: two panes on one note are one document
 *  with two carets, and copying the selection across would drag the reader's
 *  cursor in the pane they are not typing in. */
export function dispatchFrom(path: string, origin: EditorView, trs: readonly Transaction[]): void {
  const buf = buffers.get(path);
  origin.update(trs as Transaction[]);
  if (!buf) return;
  buf.state = origin.state;
  let changed = false;
  for (const tr of trs) if (tr.docChanged) changed = true;
  if (changed) {
    for (const view of buf.views) {
      if (view === origin) continue;
      for (const tr of trs) {
        if (!tr.docChanged) continue;
        view.dispatch({ changes: tr.changes, annotations: sibling.of(true) });
      }
    }
    if (buf.diverged === null) {
      setDirty(buf, true);
      window.clearTimeout(buf.saveTimer);
      buf.saveTimer = window.setTimeout(() => void save(path), AUTOSAVE_MS);
    }
  }
  // Selection changes matter too: the bar reports the SELECTION's length the
  // moment there is one, and the caret count the moment there is more than one.
  let moved = changed;
  for (const tr of trs) if (tr.selection !== undefined) moved = true;
  if (moved) scheduleStats(path);
}

/** True when a transaction is the echo of a sibling pane's edit rather than
 *  something the reader typed here. */
export function isSiblingEcho(tr: Transaction): boolean {
  return tr.annotation(sibling) === true;
}

export async function save(path: string): Promise<void> {
  const buf = buffers.get(path);
  if (!buf || !buf.dirty || buf.diverged !== null) return;
  // Another window has the pen. Keeping the text and refusing to write it is
  // the whole point — the alternative is two windows racing the precondition
  // and one of them losing a paragraph to a 409 every few minutes.
  if (!buf.writable) return;
  window.clearTimeout(buf.saveTimer);
  const content = buf.state.doc.toString();
  // Claimed BEFORE the request, so the watcher's echo of our own write is not
  // read as somebody editing the file in Obsidian.
  markSelfWrite(path);
  try {
    const written = await putNote(path, content, buf.baseMtimeMs);
    buf.baseMtimeMs = written.mtimeMs;
    // Tell the other windows, so their own precondition moves with the file
    // rather than tripping over a change they could have been told about.
    announceWrite(path, written.mtimeMs);
    // Only clean if nothing was typed while the request was in flight.
    if (buf.state.doc.toString() === content) setDirty(buf, false);
  } catch (err) {
    if (isStaleWriteError(err)) {
      // THE FILE MOVED UNDER US. The reader's text is not discarded and not
      // written: the buffer stops autosaving (so the next keystroke's timer
      // cannot clobber the newer version) and the pane is told, with the disk
      // version in hand, so a resolution can show both.
      const disk = await getNote(path).catch(() => null);
      if (disk !== null) {
        buf.diverged = disk;
        onDiverge(path, disk);
      }
      return;
    }
    // Not a conflict: the write simply did not land. The buffer stays DIRTY on
    // purpose — the text is still here, the tab still shows its dot, and the
    // next edit reschedules the save. Rethrowing instead would leave an
    // unhandled rejection and tell the reader nothing.
    onSaveError(path, err);
  }
}

/** Take the reader's side of a divergence: their text wins, and the write is
 *  re-based onto the version now on disk so it is not refused again. */
export function keepMine(path: string): void {
  const buf = buffers.get(path);
  if (!buf || buf.diverged === null) return;
  buf.baseMtimeMs = buf.diverged.mtimeMs;
  buf.diverged = null;
  void save(path);
}

/** Take the disk's side: replace the document with what is on disk. Undoable,
 *  because it goes through the history like any other edit — a resolution the
 *  reader cannot take back is not a resolution. */
export function takeDisk(path: string): void {
  const buf = buffers.get(path);
  if (!buf || buf.diverged === null) return;
  const disk = buf.diverged;
  buf.diverged = null;
  buf.baseMtimeMs = disk.mtimeMs;
  const view = [...buf.views][0];
  const tr = { changes: { from: 0, to: buf.state.doc.length, insert: disk.content } };
  if (view) view.dispatch(tr);
  else buf.state = buf.state.update(tr).state;
  setDirty(buf, false);
}

/** The note changed on disk and nothing here is unsaved — adopt it silently.
 *  Called by the shell's SSE handler in place of the remount it used to do. */
export function adoptExternal(path: string, note: NoteData): boolean {
  const buf = buffers.get(path);
  if (!buf) return false;
  if (buf.dirty) return false; // a real conflict; the save path will find it
  buf.baseMtimeMs = note.mtimeMs;
  const view = [...buf.views][0];
  const tr = { changes: { from: 0, to: buf.state.doc.length, insert: note.content } };
  if (view) view.dispatch(tr);
  else buf.state = buf.state.update(tr).state;
  return true;
}

/** Rename: the buffer follows its file, keeping the document and its history.
 *  Without this a rename dropped the undo stack of the note being renamed —
 *  the one moment a reader is most likely to want it back. */
export function remapBuffer(from: string, to: string): void {
  const buf = buffers.get(from);
  if (!buf || from === to) return;
  buffers.delete(from);
  buf.path = to;
  buffers.set(to, buf);
}

registerBufferBridge({
  remap: remapBuffer,
  rebase: (path, mtimeMs) => {
    const buf = buffers.get(path);
    if (buf) buf.baseMtimeMs = mtimeMs;
  },
  setWritable: (path, writable) => {
    const buf = buffers.get(path);
    if (!buf || buf.writable === writable) return;
    buf.writable = writable;
    // Regaining the pen with unsaved text means saving it now, not at the next
    // keystroke: the reader pressed "Edit here" precisely to commit it.
    if (writable && buf.dirty) void save(path);
  },
  requestStats: publishStats,
  adoptExternal: async (path) => {
    const buf = buffers.get(path);
    // Dirty means a genuine conflict, and it is the save path's precondition
    // that must resolve it — not a silent overwrite of the reader's text.
    if (!buf || buf.dirty) return false;
    const note = await getNote(path).catch(() => null);
    return note === null ? false : adoptExternal(path, note);
  },
  unsaved: () => [...buffers.values()].filter((b) => b.dirty).map((b) => b.path),
  flushAll: () => {
    let sent = 0;
    for (const buf of buffers.values()) {
      if (!buf.dirty || buf.diverged !== null) continue;
      if (flushNoteBeacon(buf.path, buf.state.doc.toString(), buf.baseMtimeMs)) sent += 1;
    }
    return sent;
  },
});
