// Revalidate-on-wake (client/editor/revalidate.ts).
//
// THE INCIDENT: one vault, two servers — the desktop app's child server and a
// systemd instance behind the web admin. A note was published from the web;
// the desktop app had been running for days with that note's buffer loaded
// from BEFORE the publish. Each server's watcher announces to its own
// subscribers, and the desktop client's stream had long since dropped, so the
// "changed" frame that would have refreshed its buffer reached nobody —
// EventSource replays nothing it missed.
//
// The write precondition still refused the stale save (see durability.test.ts,
// "the write precondition"), so nothing was overwritten. What was missing was
// any way for a long-idle client to LEARN it was holding a stale copy before
// it tried to write — which is why the answer is a probe on wake, and why the
// decision it takes is a pure function with a test rather than four `if`s
// buried in an async loop.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { revalidationFor, type RevalidationInput } from "../client/editor/revalidate.ts";

/** A buffer that is clean, in step with the disk, and nobody's business. */
function held(over: Partial<RevalidationInput> = {}): RevalidationInput {
  return {
    baseMtimeMs: 1_000,
    diskMtimeMs: 1_000,
    dirty: false,
    diverged: false,
    selfWriting: false,
    ...over,
  };
}

describe("revalidate on wake", () => {
  it("leaves a buffer alone when the file is still the one it was loaded from", () => {
    assert.equal(revalidationFor(held()), "skip");
    assert.equal(revalidationFor(held({ dirty: true })), "skip");
  });

  it("silently reloads a CLEAN buffer whose file moved on", () => {
    // The incident's own shape: publish written by the other server, buffer
    // clean, reader has nothing at stake. There is no question to ask them.
    assert.equal(revalidationFor(held({ diskMtimeMs: 2_000 })), "adopt");
  });

  it("raises the conflict strip for a DIRTY buffer whose file moved on", () => {
    // The point of doing this on wake instead of at the next autosave: the
    // reader chooses while they are looking at the note, not mid-sentence
    // several paragraphs later.
    assert.equal(revalidationFor(held({ diskMtimeMs: 2_000, dirty: true })), "diverge");
  });

  it("treats an OLDER file as stale too, not just a newer one", () => {
    // A vault restored from a backup, a `git checkout` of an earlier revision,
    // a filesystem clock that stepped back. The question is "is this still the
    // file I loaded", which is the same strict comparison the server's own
    // precondition makes.
    assert.equal(revalidationFor(held({ diskMtimeMs: 1 })), "adopt");
    assert.equal(revalidationFor(held({ diskMtimeMs: 1, dirty: true })), "diverge");
  });

  it("says nothing about a note that is GONE", () => {
    // Deleted is the watcher's story (the shell closes the tab on `deleted`),
    // and a visitor-scoped session is told `null` for a note it may not know
    // exists. Adopting would blank the reader's document; diverging would
    // offer them "the disk version" of nothing.
    assert.equal(revalidationFor(held({ diskMtimeMs: null })), "skip");
    assert.equal(revalidationFor(held({ diskMtimeMs: null, dirty: true })), "skip");
  });

  it("never re-opens a divergence the reader is already being asked about", () => {
    // The strip is showing the disk version they are choosing against.
    // Replacing it underneath them would change the question mid-answer.
    assert.equal(revalidationFor(held({ diskMtimeMs: 2_000, diverged: true })), "skip");
    assert.equal(
      revalidationFor(held({ diskMtimeMs: 2_000, dirty: true, diverged: true })),
      "skip",
    );
  });

  it("does not report this client to itself", () => {
    // Our own save moves the mtime, and the probe can observe the new one
    // before the response that re-bases us has landed. Without this the
    // feature's first act would be offering every writer a conflict with
    // themselves — the exact failure client/state.ts::markSelfWrite ended once.
    assert.equal(revalidationFor(held({ diskMtimeMs: 2_000, selfWriting: true })), "skip");
    assert.equal(
      revalidationFor(held({ diskMtimeMs: 2_000, dirty: true, selfWriting: true })),
      "skip",
    );
  });
});
