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

import {
  Annotation,
  EditorState,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { flushNoteBeacon, getNote, getNoteStates, isStaleWriteError, putNote } from "../api.ts";
import type { HeadingRepairOffer, NoteData } from "../../shared/types.ts";
import { markSelfWrite, recentSelfWrite } from "../state.ts";
import { revalidationFor } from "./revalidate.ts";
import { staleRetryStep } from "./saveRetry.ts";
import { DOC_STATS_EVENT, registerBufferBridge, type DocStats } from "./bufferBridge.ts";
import { countWords, noteProse } from "../../shared/wordCount.ts";
import { announceWrite } from "../windows/coherence.ts";
import { claim, holdsLease, unclaim } from "../windows/lease.ts";

/** The autosave debounce. Unchanged from the value Editor.tsx carried; it is
 *  quoted in CONTRACTS and in the durability chapter's argument. */
export const AUTOSAVE_MS = 600;

/** How long after one of THIS client's own writes a wake-up probe still treats
 *  a moved file as ours. Generous on purpose: erring long costs one delayed
 *  revalidation (the next wake, or the save precondition, catches it anyway),
 *  while erring short offers the reader a conflict with themselves — which is
 *  the failure `client/state.ts::markSelfWrite` was written to end. */
const SELF_WRITE_MS = 5_000;

/** Marks a transaction as the echo of a sibling view's edit. Forwarding a
 *  change into the other panes showing one note is how they stay one document;
 *  this is what stops the echo being forwarded back and the two panes typing
 *  at each other forever.
 *
 *  It was defined, exported and NEVER CONSULTED — the review's first finding.
 *  The mirror dispatch below goes through the sibling view's own
 *  `dispatchTransactions`, which is `dispatchFrom` again, which mirrored it
 *  back: with one note in two panes every keystroke re-entered until the
 *  ChangeSet no longer fit the document and CodeMirror threw a RangeError. */
const sibling = Annotation.define<boolean>();

/** Marks an ADOPTED external change — the watcher said the file moved and no
 *  buffer here was dirty. It must reach the other views like a sibling echo,
 *  but unlike typing it must NOT mark the buffer dirty: dirtying it schedules
 *  an autosave that writes the adopted text straight back at the file, and the
 *  echo of THAT write comes back through the watcher — a loop whose only
 *  visible symptom is a vault where mtimes never settle. */
const external = Annotation.define<boolean>();

/** Marks a transaction whose EFFECTS belong to the NOTE, not to one view.
 *
 *  Mirroring used to carry `changes` and nothing else, which is right for
 *  typing — a selection is per-caret, a scroll is per-pane — but wrong for the
 *  one thing that is neither: an in-flight upload's placeholder. That decoration
 *  is a fact about the document ("a picture is arriving HERE"), and leaving it
 *  in one view's state made two failures at once. The visible one is the audit's
 *  (v1.8 B3): the pill showed in the pane that pasted and nowhere else. The
 *  worse one is that `buf.state` is whichever view dispatched last, so the
 *  sibling merely FOCUSING the note replaced the canonical state with one that
 *  had never heard of the upload — and the answer that then landed had nowhere
 *  to land. Annotated transactions forward their effects to every other view,
 *  and are mirrored even when they change no text. */
export const bufferWide = Annotation.define<boolean>();

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
  /** A write is in flight right now. The wake-up probe reads it: our own save
   *  moves the file's mtime, and the probe can see the NEW one before the
   *  response that re-bases us has come back — which would read as somebody
   *  else's edit and offer the reader a conflict with themselves. */
  saving: boolean;
  /** How many times in a row a REFUSED write could not be re-based, because
   *  the re-read of the file failed too. Zero is the healthy state and the
   *  only one in which the autosave timer runs at its normal cadence; above
   *  zero the buffer is on the backoff in `saveRetry.ts` and something has
   *  already been said to the reader. See `save()`. */
  staleRetries: number;
}

/** A refused write whose file we could not then read. Typed, because the
 *  reader is told about it through the same listener a disk-full or a dropped
 *  server goes through, and that listener keys its wording off `ApiError.code`
 *  — an untyped `null` reached it as "Failed to save", which is true and says
 *  nothing about the one thing that matters here: the text is still safe. */
export class SaveStuckError extends Error {
  readonly code = "saveStuck";
  constructor(readonly cause: unknown) {
    super("The note changed on disk and could not be re-read");
    this.name = "SaveStuckError";
  }
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

/** A save that noticed the reader had just renamed a heading other notes link
 *  INTO. It rides on the write's own response (server/headingRepair.ts argues
 *  the seam) and is announced rather than acted on: the repair is an OFFER, and
 *  nothing in this module is allowed to rewrite files the reader did not name. */
type HeadingRepairListener = (offer: HeadingRepairOffer) => void;
let onHeadingRepair: HeadingRepairListener = () => {};
export function setHeadingRepairListener(fn: HeadingRepairListener): void {
  onHeadingRepair = fn;
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
  // EVERY caller takes its reference in its own continuation, and the creator
  // takes none. The old shape — creator starts at refs 1, later arrivals add
  // one in a chained .then — interleaved wrongly with an immediate release:
  // React StrictMode mounts, unmounts and remounts every editor, so acquire /
  // release / acquire against one in-flight load was the COMMON path, and the
  // second acquire could chain onto a promise whose buffer the first release
  // had already deleted. The orphan still rendered; its dirty flag, autosave
  // and stats spoke to a registry entry that no longer existed.
  const open = buffers.get(path);
  if (open) {
    open.refs += 1;
    return Promise.resolve(open);
  }
  let p = loading.get(path);
  if (p === undefined) {
    p = getNote(path).then((note) => {
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
        refs: 0,
        saveTimer: 0,
        saving: false,
        staleRetries: 0,
      };
      buffers.set(path, buf);
      loading.delete(path);
      // Announce that this window is now the one typing into this note.
      // Another window already holding it wins on age, and `setWritable`
      // arrives a tick later to turn our autosave off.
      claim(path);
      buf.writable = holdsLease(path);
      return buf;
    });
    loading.set(path, p);
    p.catch(() => loading.delete(path));
  }
  return p.then((buf) => {
    buf.refs += 1;
    return buf;
  });
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
    // Save now rather than on a timer nobody is left to wait for. `save()`
    // finishes the release when the write lands — the early return here used
    // to be the whole story, which parked the buffer AND ITS LEASE forever: a
    // closed dirty tab kept the note claimed, and a second window's editor
    // stayed a read-only mirror of a tab that no longer existed.
    void save(path);
    return;
  }
  dispose(path, buf);
}

/** The actual teardown, shared by the clean release above and the save that
 *  completes a dirty one. Only ever with refs at zero. */
function dispose(path: string, buf: Buffer): void {
  window.clearTimeout(buf.saveTimer);
  statsTimers.delete(path);
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
  // Which lane is this? Typing mirrors AND dirties; a sibling echo does
  // neither (it IS the mirror, arriving); an adopted external change mirrors
  // and does not dirty. One annotation check, consulted where it matters
  // rather than exported for someone else to remember.
  let changed = false;
  let echoed = false;
  let adopted = false;
  let wide = false;
  for (const tr of trs) {
    if (tr.annotation(bufferWide) === true && tr.effects.length > 0) wide = true;
    if (!tr.docChanged) continue;
    changed = true;
    if (tr.annotation(sibling) === true) echoed = true;
    if (tr.annotation(external) === true) adopted = true;
  }
  if ((changed || wide) && !echoed) {
    for (const view of buf.views) {
      if (view === origin) continue;
      for (const tr of trs) {
        const spec: TransactionSpec = { annotations: sibling.of(true) };
        if (tr.docChanged) spec.changes = tr.changes;
        // Buffer-wide effects ride along. Positions inside them need no
        // remapping: the sibling is showing the SAME document, one transaction
        // behind at most, and this is that transaction.
        if (tr.annotation(bufferWide) === true && tr.effects.length > 0) {
          spec.effects = tr.effects;
        }
        if (spec.changes !== undefined || spec.effects !== undefined) view.dispatch(spec);
      }
    }
  }
  if (changed && !echoed && !adopted && buf.diverged === null) {
    setDirty(buf, true);
    // A buffer on the stale-retry backoff keeps ITS timer. Rescheduling here
    // would let a reader who is still typing reset the wait to 600ms on every
    // keystroke, which is the request storm the backoff exists to avoid — and
    // the pending retry is going to write this same text anyway.
    if (buf.staleRetries === 0) {
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

/** Whether this buffer still has a view on screen, and which one. A view that
 *  was detached and destroyed is not in `views` at all; one that is in `views`
 *  but off the document is a pane React has unmounted this frame. */
function liveViewOf(buf: Buffer): EditorView | null {
  for (const view of buf.views) if (view.dom.isConnected) return view;
  return null;
}

/** The buffer a view belongs to, while it is still attached to one. */
export function pathForView(view: EditorView): string | null {
  for (const buf of buffers.values()) if (buf.views.has(view)) return buf.path;
  return null;
}

/** APPLY AN EDIT TO A NOTE WITHOUT HOLDING ONE OF ITS VIEWS.
 *
 *  The upload path is why this exists (v1.8 client-solidity audit, B3): an
 *  attachment upload is an async round trip that outlives the pane it started
 *  in, and `uploads.ts` used to answer that by checking `view.dom.isConnected`
 *  and giving up. The document, though, is not the view's — the placeholder
 *  decoration lives in the EditorState this registry PRESERVES, so a reader
 *  who switched tabs mid-upload came back to a note wearing an "Uploading…"
 *  pill that nothing could ever remove, and their picture nowhere in the text.
 *
 *  A live view is still the right target when there is one — it goes through
 *  `dispatchFrom`, so mirroring, dirtying and the autosave timer all happen as
 *  they do for typing. With no view, the same three things are done here by
 *  hand against the stored state; a spec with no `changes` (the upload FAILED,
 *  we are only removing the pill) is not an edit and does not dirty the note. */
export function applyToBuffer(path: string, spec: TransactionSpec): boolean {
  const buf = buffers.get(path);
  if (!buf) return false;
  const live = liveViewOf(buf);
  if (live) {
    live.dispatch(spec);
    return true;
  }
  buf.state = buf.state.update(spec).state;
  if (spec.changes === undefined) return true;
  setDirty(buf, true);
  if (buf.staleRetries === 0 && buf.diverged === null) {
    window.clearTimeout(buf.saveTimer);
    buf.saveTimer = window.setTimeout(() => void save(path), AUTOSAVE_MS);
  }
  return true;
}

/** A write was refused as stale AND the file could not be re-read. Schedule
 *  another attempt on the backoff, and say so when the plan says to.
 *
 *  The whole save is retried, not the re-read: the write is the thing that has
 *  to happen, a 409 that answers it re-enters this path with a fresher error,
 *  and a re-read that succeeds next time lands the reader in the ordinary
 *  conflict strip — which is the state they can actually resolve. */
function retryStale(buf: Buffer, err: unknown): void {
  const attempt = buf.staleRetries;
  buf.staleRetries = attempt + 1;
  const step = staleRetryStep(attempt);
  if (step.announce) onSaveError(buf.path, new SaveStuckError(err));
  window.clearTimeout(buf.saveTimer);
  buf.saveTimer = window.setTimeout(() => void save(buf.path), step.waitMs);
}

export async function save(path: string, explicit = false): Promise<void> {
  const buf = buffers.get(path);
  if (!buf || !buf.dirty) return;
  if (buf.diverged !== null) {
    // Diverged: nothing is written until the reader chooses a side. A timer
    // arriving here stays silent; Ctrl+S does not — "I pressed save and
    // nothing happened" was how a reader learned about this state, once, and
    // then not again. Re-announcing puts the resolution back in front of them.
    if (explicit) onDiverge(path, buf.diverged);
    return;
  }
  // Another window has the pen. Keeping the text and refusing to write it is
  // the whole point — the alternative is two windows racing the precondition
  // and one of them losing a paragraph to a 409 every few minutes.
  if (!buf.writable) return;
  window.clearTimeout(buf.saveTimer);
  const content = buf.state.doc.toString();
  // Claimed BEFORE the request, so the watcher's echo of our own write is not
  // read as somebody editing the file in Obsidian.
  markSelfWrite(path);
  buf.saving = true;
  try {
    const written = await putNote(path, content, buf.baseMtimeMs);
    buf.baseMtimeMs = written.mtimeMs;
    // "N links point at this heading" — see setHeadingRepairListener. Announced
    // after the write has landed, so the offer can never be taken against a
    // save that did not happen.
    if (written.headingRepair) onHeadingRepair(written.headingRepair);
    buf.staleRetries = 0; // the write landed; whatever was wrong is over
    // Tell the other windows, so their own precondition moves with the file
    // rather than tripping over a change they could have been told about.
    announceWrite(path, written.mtimeMs);
    // Only clean if nothing was typed while the request was in flight.
    if (buf.state.doc.toString() === content) setDirty(buf, false);
    // The write that a dirty last-release was waiting on: nothing holds the
    // buffer any more and it is clean, so it goes now — lease included.
    if (buf.refs <= 0 && !buf.dirty) dispose(path, buf);
  } catch (err) {
    if (isStaleWriteError(err)) {
      // THE FILE MOVED UNDER US. The reader's text is not discarded and not
      // written: the buffer stops autosaving (so the next keystroke's timer
      // cannot clobber the newer version) and the pane is told, with the disk
      // version in hand, so a resolution can show both.
      let disk: NoteData | null = null;
      let readErr: unknown = null;
      try {
        disk = await getNote(path);
      } catch (e) {
        readErr = e;
      }
      if (disk !== null) {
        buf.staleRetries = 0;
        buf.diverged = disk;
        onDiverge(path, disk);
        return;
      }
      // AND THE RE-READ FAILED. This branch used to `return` here, which is
      // how a save loop died in silence: no listener fired, `baseMtimeMs`
      // stayed stale, and every autosave from then on took this same path and
      // said nothing while the reader kept typing into a buffer that would
      // never reach the disk (v1.8 audit B1 — the whole argument is in
      // saveRetry.ts). Now it backs off and tries again, and the reader is
      // told the first time it happens rather than the next morning.
      retryStale(buf, readErr);
      return;
    }
    // Not a conflict: the write simply did not land. The buffer stays DIRTY on
    // purpose — the text is still here, the tab still shows its dot, and the
    // next edit reschedules the save. Rethrowing instead would leave an
    // unhandled rejection and tell the reader nothing.
    onSaveError(path, err);
  } finally {
    buf.saving = false;
  }
}

/** RE-ASK THE DISK ABOUT EVERY OPEN NOTE. Called when this client WAKES — its
 *  SSE stream reconnected, or its window became visible again — because both
 *  mean it has been out of the room, and neither the browser nor the server
 *  replays what it missed. With two servers over one vault it can also have
 *  been awake the whole time and still missed the news: each watcher announces
 *  to its own subscribers only.
 *
 *  Scoped to the OPEN buffers, never the vault: this is "is what I am holding
 *  still the file?", and a client with three tabs must not walk 1,400 notes to
 *  answer it. Clean buffers reload silently; a dirty one gets the conflict
 *  strip here and now, rather than at the next autosave, when the reader is
 *  mid-sentence.
 *
 *  Every failure is a NON-EVENT. The probe is a courtesy — the write
 *  precondition is still the thing that actually stops a clobber — so a
 *  network error, an expired session or a note that vanished between the two
 *  requests leaves the buffer exactly as it was. */
export async function revalidateOpen(): Promise<void> {
  const paths = [...buffers.keys()];
  if (paths.length === 0) return;
  const states = await getNoteStates(paths).catch(() => null);
  if (states === null) return;
  await Promise.all(
    states.map(async (state) => {
      const buf = buffers.get(state.path);
      if (!buf) return;
      const verdict = revalidationFor({
        baseMtimeMs: buf.baseMtimeMs,
        diskMtimeMs: state.mtimeMs,
        dirty: buf.dirty,
        diverged: buf.diverged !== null,
        // BOTH halves of "we did this". `saving` catches the request in
        // flight; `recentSelfWrite` catches the publish toggle, the banner
        // setter and the section writer, which move the file through routes
        // this registry never hears about (client/state.ts).
        selfWriting: buf.saving || recentSelfWrite(state.path, SELF_WRITE_MS),
      });
      if (verdict === "skip") return;
      const disk = await getNote(state.path).catch(() => null);
      if (disk === null) return;
      // Re-read the buffer: the two fetches above are awaits, and the reader
      // may have typed, closed the tab or hit a 409 of their own meanwhile.
      const now = buffers.get(state.path);
      if (!now || now.diverged !== null) return;
      if (verdict === "adopt") {
        // `adoptExternal` refuses a dirty buffer itself, which is the right
        // answer if a keystroke landed while we were asking.
        adoptExternal(state.path, disk);
        return;
      }
      if (!now.dirty) {
        // It went clean while we asked (the autosave landed). Nothing to
        // resolve; take the new text instead of manufacturing a choice.
        adoptExternal(state.path, disk);
        return;
      }
      now.diverged = disk;
      onDiverge(state.path, disk);
    }),
  );
}

/** Take the reader's side of a divergence: their text wins, and the write is
 *  re-based onto the version now on disk so it is not refused again. */
export function keepMine(path: string): void {
  const buf = buffers.get(path);
  if (!buf || buf.diverged === null) return;
  buf.baseMtimeMs = buf.diverged.mtimeMs;
  buf.diverged = null;
  buf.staleRetries = 0; // a resolution is a fresh start for the backoff
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
  buf.staleRetries = 0;
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
  // Annotated as EXTERNAL: dispatchFrom mirrors it into the other views but
  // must not dirty the buffer — dirtying schedules an autosave that writes the
  // adopted text straight back at the file it just came from.
  const tr = {
    changes: { from: 0, to: buf.state.doc.length, insert: note.content },
    annotations: external.of(true),
  };
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
  revalidate: revalidateOpen,
  flush: (path) => save(path),
  liveText: (path) => buffers.get(path)?.state.doc.toString() ?? null,
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
      // `writable` too: a window the lease demoted holds text it is not the
      // one saving, and its unload must not manufacture the very 409 the
      // lease exists to prevent — the winner is saving that note already.
      if (!buf.dirty || buf.diverged !== null || !buf.writable) continue;
      if (flushNoteBeacon(buf.path, buf.state.doc.toString(), buf.baseMtimeMs)) sent += 1;
    }
    return sent;
  },
});
