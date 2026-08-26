// The two vault-wide edits, said out loud: heading-link repair and tag rename.
//
// Both are the same shape — a server route rewrites many files at once, and the
// reader gets ONE sentence naming what changed and ONE button that takes it
// back. The shape lives here rather than in the two call sites because the
// promise is the same promise, and a bulk edit whose undo is spelled slightly
// differently in two places is a bulk edit somebody will eventually ship
// without one.
//
// NOTHING HERE RUNS WITHOUT AN OFFER. The heading repair is raised by the save
// that renamed the heading and waits for a press; the tag rename is raised by a
// menu row and shows its dry run before the button lights. That is the rule the
// v1.8 spec states as "never rewrite without the offer", and it is the whole
// difference between this and the find-and-replace people are afraid of.

import { repairHeadingLinks, undoBulk } from "./api.ts";
import { countPhrase, t, tf } from "./i18n.ts";
import { useStore } from "./state.ts";
import { toast } from "./toast.ts";
import { actionToast } from "./undoToast.ts";
import type { BulkResult, HeadingRepairOffer } from "../shared/types.ts";

/** Everything the vault has to re-read after N notes changed underneath it.
 *  A bulk rewrite touches links, tags and — through a `tags:` line — the topic
 *  lists a published site is grouped by, so the refresh is the same one a
 *  rename does rather than a narrower guess. */
function refreshAfterBulk(): void {
  const store = useStore.getState();
  void store.loadTree();
  void store.refreshBacklinks();
  void store.loadPublished();
}

/** "…and 3 notes were left alone" — the half of the answer a bulk tool is
 *  tempted to swallow. A file somebody else edited between our read and our
 *  write is SKIPPED by the server, and a reader who is not told that will find
 *  out by discovering one stale tag six weeks later. */
function skipNote(result: BulkResult): void {
  const conflicts = result.skipped.filter((s) => s.reason === "conflict").length;
  const failures = result.skipped.length - conflicts;
  if (conflicts > 0) toast(tf("bulkSkipped", { count: countPhrase(conflicts, "notes") }), "error");
  if (failures > 0) toast(tf("bulkFailed", { count: countPhrase(failures, "notes") }), "error");
}

/** Announce a finished bulk edit and offer the way back. `message` is already
 *  built by the caller, because only the caller knows whether it is naming
 *  headings or tags. */
export function bulkDoneToast(message: string, result: BulkResult): void {
  skipNote(result);
  if (result.undoId === null) {
    // Too large for an in-memory undo bundle. Saying so is not an apology —
    // it is the sentence that sends the reader to the snapshot in Backup &
    // sync, which is the real floor under an edit this size.
    toast(`${message} ${t("bulkNoUndo")}`);
    return;
  }
  const undoId = result.undoId;
  actionToast(message, t("undo"), () => {
    void undoBulk(undoId)
      .then((back) => {
        skipNote(back);
        refreshAfterBulk();
        toast(tf("bulkUndoneToast", { count: countPhrase(back.notes, "notes") }));
      })
      .catch((err: unknown) => {
        console.error("vellum: undoing a bulk rewrite failed", err);
        toast(t("bulkUndoFailed"), "error");
      });
  });
}

// ------------------------------------------------------ heading-link repair

/** The offer a save raises when the reader renames a heading other notes point
 *  into. It is an `actionToast` and not a modal on purpose: the reader is in
 *  the middle of typing a heading, and a dialog over the sentence they are
 *  writing would be an interruption to punish them for editing. Ignore it and
 *  it fades; the links are no more broken than they were a second ago.
 *
 *  A second offer replaces the first (undoToast.ts's own rule), which is
 *  exactly right here — the server keeps the rename as a CHAIN, so each save
 *  restates the same repair with the heading's latest name. */
export function offerHeadingRepair(offer: HeadingRepairOffer): void {
  actionToast(
    tf("headingRepairOffer", {
      count: countPhrase(offer.links, "links"),
      heading: offer.fromTitle,
      to: offer.toTitle,
    }),
    t("headingRepairAction"),
    () => {
      void repairHeadingLinks(offer.path, offer.from, offer.fromTitle, offer.to)
        .then((result) => {
          refreshAfterBulk();
          bulkDoneToast(
            tf("headingRepairedToast", {
              count: countPhrase(result.edits, "links"),
              heading: offer.toTitle,
            }),
            result,
          );
        })
        .catch((err: unknown) => {
          console.error("vellum: repairing heading links failed", err);
          toast(t("headingRepairFailed"), "error");
        });
    },
  );
}
