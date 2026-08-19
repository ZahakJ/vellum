// WHEN THE NAME IN A CITATION STOPS BEING THE BOOK'S NAME.
//
// A note says `[[Ihya.pdf#page=42&rect=…&id=k7f3q2a9|Ihya, p. 42]]`. Three
// months later the file is `Sources/al-Ghazali - Ihya (ed. 1998).pdf`, because
// that is what people do to a shelf, and because Obsidian, Syncthing, `git
// pull` and `mv` all write to this directory and none of them tells us. Every
// reader that stored a PATH now has a dead link, and the passage the note was
// arguing from is gone.
//
// It is not gone here, because the citation does not address the book by name.
// The `id` in the anchor names a highlight; the highlight is filed under a
// CONTENT KEY; and the key is a hash of the bytes (server/books.ts). So the
// server can answer "where are those bytes now" — from the names this book has
// been seen under, and failing that from a walk of the vault — and the book
// opens on the right page anyway.
//
// AND THEN IT OFFERS TO FIX THE NOTE. Opening the right book while leaving the
// link broken means the reader gets rescued once per click, forever, and the
// note stays wrong in git and in the published site. The offer is a toast with
// an action on it — the same shape every other reversible thing in this
// product uses — because a repair is an edit to the reader's own file and the
// reader decides whether their file gets edited.
//
// DYNAMICALLY IMPORTED by client/books/mount.ts, which is first-paint code.
// Everything in here is the rare path: a citation whose name still resolves
// never loads a byte of it.

import { ApiError } from "../api.ts";
import { t, tf } from "../i18n.ts";
import { applyNoteContent, noteContent } from "../sectionActions.ts";
import { toast } from "../toast.ts";
import { actionToast } from "../undoToast.ts";
import { linkSafe, type BookAnchor } from "../../shared/bookAnchor.ts";
import { locateCitation } from "./api.ts";
import { showBooks } from "./mount.ts";

/**
 * Open the book a citation names when its filename no longer resolves.
 *
 * `target` is the name the note used, `notePath` the note that used it — both
 * needed for the repair, which is a rename of exactly that link in exactly
 * that file.
 */
export async function recoverCitation(
  target: string,
  anchor: BookAnchor,
  notePath: string,
): Promise<void> {
  if (anchor.id === null) {
    // A citation with a page and no id: written by hand, or by a version of
    // this product that predates the id. There is nothing to resolve it by,
    // and saying so is more use than a spinner.
    toast(tf("linkMissing", { name: target }), "error");
    return;
  }
  try {
    const found = await locateCitation(anchor.id);
    if (found.path === null) {
      toast(tf("bookCitationLost", { name: target }), "error");
      return;
    }
    showBooks({ kind: "book", path: found.path, anchor }, true);
    const name = found.path.slice(found.path.lastIndexOf("/") + 1);
    if (name === target) return; // it moved folders but kept its name: nothing to repair
    actionToast(
      tf("bookCitationMoved", { name }),
      t("bookCitationRepair"),
      () => void repairCitations(notePath, target, name),
    );
  } catch (err) {
    // 404 from /api/books/locate is the honest "those bytes are not in this
    // vault any more" — a book deleted, or a note that arrived from somebody
    // else's vault. Anything else is a request that failed.
    const gone = err instanceof ApiError && err.status === 404;
    toast(tf("bookCitationLost", { name: target }), gone ? "info" : "error");
  }
}

/**
 * Rewrite every citation in one note that names `from` so that it names `to`.
 *
 * The match is `[[<name>#` and nothing looser. A citation is the only wikilink
 * shape that can carry a `.pdf` target followed by a `#`, so this cannot touch
 * an ordinary `[[Note#Heading]]`, cannot touch a link to a differently-named
 * book, and cannot touch the word "Ihya.pdf" written in a sentence. A repair
 * that edited one line too many would be a far worse bug than the broken link
 * it was fixing.
 *
 * The write goes through `applyNoteContent`, which claims the echo with
 * `markSelfWrite` BEFORE it sends and prefers the open editor when one holds
 * the note — so the repair is undoable with Ctrl+Z and is not reported back to
 * the reader as "changed on disk".
 */
export async function repairCitations(notePath: string, from: string, to: string): Promise<void> {
  const before = await noteContent(notePath).catch(() => null);
  if (before === null) {
    toast(tf("bookCitationRepairFailed", { name: from }), "error");
    return;
  }
  const after = before.split(`[[${linkSafe(from)}#`).join(`[[${linkSafe(to)}#`);
  if (after === before) {
    toast(tf("bookCitationRepairNothing", { name: from }));
    return;
  }
  try {
    await applyNoteContent(notePath, after);
    actionToast(tf("linkNotPublished", { name: to }), t("undo"), () => {
      void applyNoteContent(notePath, before).catch(() => {
        toast(t("bookCitationRepaired"), "error");
      });
    });
  } catch {
    toast(t("bookCitationRepairFailed"), "error");
  }
}
