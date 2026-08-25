// WHAT A WOKEN CLIENT SHOULD DO ABOUT ONE OPEN NOTE.
//
// THE INCIDENT: one vault, two servers — the desktop app's child server and a
// systemd instance behind the web admin. A note was published from the web;
// the desktop app had been running for days with that note's buffer loaded
// from BEFORE the publish. Each server's watcher announces to its OWN
// subscribers, and the desktop client's stream had long since dropped, so the
// "changed" frame that would have refreshed its buffer went to nobody —
// EventSource replays nothing it missed. The buffer sat there describing a
// file that had moved on, and the first thing that would have told anyone was
// the write precondition refusing a save, which is the worst possible moment
// to learn it: mid-sentence, with a choice to make.
//
// So a client that WAKES — its stream reconnects, or its window becomes
// visible again after being hidden — re-asks the disk about what it holds
// (`GET /api/note/state`, mtimes only) and acts before the reader types
// anything. Nothing here reaches the disk or the network; it is the one
// decision, taken apart from the machinery that carries it out, so it can be
// read in one screen and tested without a browser.
//
// This module imports NOTHING. `buffers.ts` (which imports CodeMirror) calls
// it; `tests/revalidate.test.ts` calls it too.

/** What to do about one open note whose disk state has just been re-read. */
export type Revalidation =
  /** Leave it exactly as it is. */
  | "skip"
  /** Clean and stale: reload it silently, through the document's own history.
   *  There is nothing of the reader's to lose and nothing to ask them. */
  | "adopt"
  /** Dirty and stale: a real conflict. Raise the resolution strip NOW rather
   *  than at the next autosave — the reader gets to choose while they are
   *  looking at the note, instead of being interrupted mid-sentence later. */
  | "diverge";

export interface RevalidationInput {
  /** The mtime this client's buffer was loaded from / last wrote. */
  baseMtimeMs: number;
  /** What the server says the file's mtime is NOW; null when it is not there
   *  (deleted, or never visible to this session). */
  diskMtimeMs: number | null;
  /** Unsaved text in the buffer. */
  dirty: boolean;
  /** The buffer is already showing a resolution strip. */
  diverged: boolean;
  /** THIS CLIENT wrote the note a moment ago, or is writing it right now.
   *  Our own write moves the mtime, and the probe can observe the new one
   *  before the response that would have re-based us has landed — so without
   *  this, every save would look like somebody else's edit. It is the same
   *  discrimination `client/state.ts::markSelfWrite` exists for, asked one
   *  layer down. */
  selfWriting: boolean;
}

export function revalidationFor(input: RevalidationInput): Revalidation {
  // Already asking the reader which version wins. A second opinion arriving
  // from a wake-up probe cannot improve that question and must not replace the
  // disk version they are being shown.
  if (input.diverged) return "skip";
  if (input.selfWriting) return "skip";
  // GONE IS NOT STALE. A deleted note is the watcher's story to tell (the
  // shell closes the tab on a `deleted` event), and a visitor-scoped session
  // is told `null` for a note it may not know exists at all. Adopting an
  // absent file would mean blanking the reader's document; diverging over one
  // would mean offering them "the disk version" of nothing.
  if (input.diskMtimeMs === null) return "skip";
  // STRICT INEQUALITY, matching the server's own precondition rather than
  // asking whether the file is NEWER: a vault restored from a backup, a `git
  // checkout` of an older revision, or a filesystem whose clock stepped back
  // all leave a file that differs from what we hold, and "not what I loaded"
  // is the whole question.
  if (input.diskMtimeMs === input.baseMtimeMs) return "skip";
  return input.dirty ? "diverge" : "adopt";
}
