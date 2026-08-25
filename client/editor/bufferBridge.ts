// The shell's door to the open documents — and it is deliberately EMPTY of
// CodeMirror.
//
// `client/editor/buffers.ts` holds every open note's live `EditorState`, which
// means it imports `@codemirror/state`. `client/App.tsx` needs two things from
// it (flush everything before the tab closes; ask whether anything is unsaved)
// and App.tsx is in the FIRST PAINT closure. A direct import would therefore
// pull CodeMirror into the entry chunk, and `npm run check-bundle` would fail
// with a message about CodeMirror appearing in first paint — a message whose
// stated cause has nothing to do with the line that caused it, in the file
// nobody would think to look at.
//
// So the registry registers itself here when it loads, and the shell calls
// through this module. Written BEFORE buffers.ts, and named in the bundle gate,
// because the failure it prevents is one that misreports itself.

/** What the status bar is told about the open document, and how.
 *
 *  A CustomEvent rather than a store field: the numbers change on every
 *  keystroke and the store is not a per-keystroke channel. The name and the
 *  payload live HERE rather than beside the code that fills them in, for this
 *  module's whole reason — the status bar is inside the admin's first-paint
 *  closure, and importing `buffers.ts` there would pull CodeMirror in with it. */
export const DOC_STATS_EVENT = "vellum:doc";

export interface DocStats {
  path: string;
  words: number;
  chars: number;
  /** Non-null only while something is selected — the bar then reports the
   *  SELECTION, which is the number a writer trimming a paragraph wants. */
  selWords: number | null;
  selChars: number | null;
  /** How many carets. Shown only past one, where it stops being noise and
   *  becomes the answer to "why is it typing in four places at once". */
  ranges: number;
}

/** What the shell may ask of the open documents. Registered by buffers.ts on
 *  load; every method is a no-op until the editor chunk has arrived, which is
 *  correct — before then nothing is open and nothing can be unsaved. */
export interface BufferBridge {
  /** Paths with unsaved edits right now. */
  unsaved(): string[];
  /** Last-gasp save of everything unsaved, by `sendBeacon`. Returns how many
   *  it handed to the browser. Called from `beforeunload`, where a `fetch`
   *  would be cancelled along with the document. */
  flushAll(): number;
  /** The file changed on disk and we did not do it. Re-reads it into the open
   *  buffer, returning true when it was adopted.
   *
   *  False means "not mine to adopt" — no buffer is open on that path (the
   *  reading view is showing it), or the buffer is DIRTY, which is a real
   *  conflict and belongs to the save path's precondition rather than to a
   *  silent overwrite of the reader's text. The shell falls back to its remount
   *  in that case. */
  adoptExternal(path: string): Promise<boolean>;
  /** A note was renamed: the open document follows its file, keeping its undo
   *  history. Without this a rename dropped the history of the note being
   *  renamed — the one moment a reader is most likely to want it back. */
  remap(from: string, to: string): void;
  /** Publish the stats for `path` now, so the bar is right BEFORE the first
   *  keystroke rather than after it. */
  requestStats(path: string): void;
  /** THIS CLIENT HAS BEEN AWAY — its SSE stream dropped and came back, or its
   *  window was hidden and is visible again. Re-ask the disk about the open
   *  notes, because nothing replays the events it missed, and with two servers
   *  over one vault a client can miss them without ever going away: each
   *  watcher announces to its own subscribers only. Clean buffers that are
   *  stale reload silently; a dirty one raises the conflict strip now rather
   *  than at the next autosave. */
  revalidate(): Promise<void>;
  /** A PEER window saved this note. Re-base our precondition to the mtime the
   *  server handed them, so our next save is not refused for a change we
   *  already know about — and so a 409 keeps meaning "somebody we have not
   *  heard from", which is the only kind worth interrupting a writer for. */
  rebase(path: string, mtimeMs: number): void;
  /** Whether THIS window may write the note. False turns autosave off without
   *  discarding a byte: the text stays in the buffer and the pane offers to
   *  take the note back. */
  setWritable(path: string, writable: boolean): void;
  /** Write ONE note's unsaved text now and resolve when it has landed. The
   *  rename path needs this: a rename moves the file the server has, and a
   *  note typed into seconds ago is not that file yet — the autosave timer
   *  then wrote the text to the OLD name, resurrecting it, while the new name
   *  carried the empty file the move had picked up. */
  flush(path: string): Promise<void>;
  /** The live text of an open note, or null when no editor holds it. The
   *  reading view prefers this to the server's copy: the reader who just
   *  pressed Ctrl+E on a note they were typing into wants the words they
   *  typed, not the autosave the disk is still waiting for. */
  liveText(path: string): string | null;
}

const IDLE: BufferBridge = {
  unsaved: () => [],
  flushAll: () => 0,
  adoptExternal: () => Promise.resolve(false),
  remap: () => {},
  requestStats: () => {},
  revalidate: () => Promise.resolve(),
  rebase: () => {},
  setWritable: () => {},
  flush: () => Promise.resolve(),
  liveText: () => null,
};

let bridge: BufferBridge = IDLE;

export function registerBufferBridge(next: BufferBridge): void {
  bridge = next;
}

export function unsavedPaths(): string[] {
  return bridge.unsaved();
}

export function flushAllBuffers(): number {
  return bridge.flushAll();
}

export function adoptExternalChange(path: string): Promise<boolean> {
  return bridge.adoptExternal(path);
}

export function remapBufferPath(from: string, to: string): void {
  bridge.remap(from, to);
}

export function requestDocStats(path: string): void {
  bridge.requestStats(path);
}

/** Re-check the open notes against the disk. A no-op until the editor chunk
 *  has arrived, which is correct: nothing is open, so nothing can be stale. */
export function revalidateBuffers(): Promise<void> {
  return bridge.revalidate();
}

export function rebaseFromPeer(path: string, mtimeMs: number): void {
  bridge.rebase(path, mtimeMs);
}

export function setBufferWritable(path: string, writable: boolean): void {
  bridge.setWritable(path, writable);
}

export function flushBufferPath(path: string): Promise<void> {
  return bridge.flush(path);
}

export function liveNoteText(path: string): string | null {
  return bridge.liveText(path);
}
