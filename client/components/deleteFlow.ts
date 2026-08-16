// The delete story, in one place.
//
// Three things delete — a note, an attachment, a folder — from two surfaces
// (the tree's context menu and the command palette), at two speeds each. That
// is twelve dialogs, and when each surface built its own the guarantees drifted
// apart: the palette's "Delete note" once said "irreversible" over an action
// the tree's identical menu item promised was recoverable. So every entry
// point calls the same four functions here, and there is exactly one copy of
// what each delete claims.
//
// The other half of this module is the part that was simply missing. Before a
// dialog opens it asks the server what the delete would ACTUALLY take
// (`/api/delete-preview`), because the folder dialog used to count markdown
// and nothing else: a folder holding four images and no notes said "0 notes
// will move", and the essay one folder over — which still embedded all four —
// went to the public site with four broken images and nothing anywhere said a
// word. That is the bug this module exists to make impossible.

import type { DeletePreview } from "../../shared/types.ts";
import { noteLabelOf } from "../../shared/noteFormat.ts";
import { deletePreview } from "../api.ts";
import { countPhrase, getLang, isolate, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { confirmModal, confirmModalEx } from "./Confirm.tsx";

/** Past this many referring notes the warning COUNTS them instead of naming
 *  them. Three names is a sentence a reader acts on ("‘Essay’ and ‘Notes on
 *  Ibn Sina’ embed these"); twelve is a wall they scroll past, and a wall is
 *  the same as saying nothing. The server samples five, so a count is always
 *  available even when the names are not all present. */
const NAME_LIMIT = 3;

/** A note path as the reader knows it — the same label the tree row and the
 *  palette entry wear (shared/noteFormat.ts `noteLabelOf`), so the dialog asks
 *  about the thing the reader just clicked rather than about a filename. It
 *  strips whichever note extension the file carries, `.tex` as well as `.md`. */
function titleOf(path: string): string {
  return noteLabelOf(path);
}

/** "“Essay” and “Notes”" or "12 notes" — who is still pointing at what is
 *  about to go. Each name is bidi-isolated on its own (tf() isolates the
 *  whole substitution, which is not enough when the substitution is itself a
 *  list of note titles in mixed scripts), and the joining is `Intl.ListFormat`
 *  in the instance's language rather than a hand-typed comma. */
function referrerPhrase(preview: DeletePreview): string {
  const named =
    preview.referrerCount <= NAME_LIMIT && preview.referrers.length === preview.referrerCount;
  if (!named) return countPhrase(preview.referrerCount, "notes");
  const names = preview.referrers.map((p) => `“${isolate(titleOf(p))}”`);
  return new Intl.ListFormat(getLang(), { style: "long", type: "conjunction" }).format(names);
}

/** The collateral line for a dialog, or undefined when there is none.
 *  Undefined matters: a warning that is always on screen is furniture, and a
 *  reader stops reading furniture long before the one time it is true. */
export function refsWarning(preview: DeletePreview | null): string | undefined {
  if (!preview || preview.referrerCount === 0) return undefined;
  const notes = referrerPhrase(preview);
  if (preview.kind === "note") return tf("noteRefsWarn", { notes });
  if (preview.kind === "attachment") return tf("attachmentRefsWarn", { notes });
  if (preview.referenced === 0) return undefined;
  return tf("folderRefsWarn", { count: countPhrase(preview.referenced, "files"), notes });
}

/** "0 notes and 4 files" — what a folder actually holds, in both currencies.
 *  Both halves go through countPhrase(), so Arabic agrees properly instead of
 *  gluing a numeral onto a singular. */
export function contentsPhrase(notes: number, attachments: number): string {
  return tf("deleteContents", {
    notes: countPhrase(notes, "notes"),
    attachments: countPhrase(attachments, "files"),
  });
}

/** Ask the server what this delete would take. A failure is NOT fatal — the
 *  dialog still opens, just without the collateral line — because refusing to
 *  let someone delete a file when a preview endpoint hiccuped would be a
 *  worse product than one that occasionally warns less. It is logged. */
async function preview(path: string): Promise<DeletePreview | null> {
  try {
    return await deletePreview(path);
  } catch (err) {
    console.error("vellum: delete preview failed", err);
    return null;
  }
}

/** The shape every delete in this product takes: one recoverable dialog whose
 *  quiet third route opens a second, `grave` dialog for the erase. Both carry
 *  the same collateral warning, because the harsher path does not do LESS
 *  damage to the notes pointing at this thing. */
async function twoSpeeds(opts: {
  name: string;
  body: string;
  permBody: string;
  warn?: string;
  run(permanent: boolean): void;
}): Promise<void> {
  const result = await confirmModalEx({
    title: tf("moveToTrashTitle", { name: opts.name }),
    body: opts.body,
    warn: opts.warn,
    confirmLabel: t("moveToTrash"),
    extraLabel: t("deletePermanently"),
  });
  if (result === "confirm") {
    opts.run(false);
    return;
  }
  if (result !== "extra") return;
  const ok = await confirmModal({
    title: tf("permDeleteTitle", { name: opts.name }),
    body: opts.permBody,
    warn: opts.warn,
    confirmLabel: t("deletePermanently"),
    // Nothing behind this one, so it must not look like the dialog that had
    // something behind it: red at rest, and Enter is not armed (Confirm.tsx).
    grave: true,
  });
  if (ok) opts.run(true);
}

/** Delete ONE note, from any surface. */
export async function confirmDeleteNote(path: string): Promise<void> {
  const name = path.split("/").pop() ?? path;
  const info = await preview(path);
  await twoSpeeds({
    name,
    body: tf("deleteFileTrashBody", { path }),
    permBody: tf("deleteFilePermBody", { path }),
    warn: refsWarning(info),
    // The store action never rejects: it logs and toasts its own localized
    // failure line (state.ts `guarded`), so a second catch here would only be
    // a second way for the two surfaces to disagree.
    run: (permanent) => void useStore.getState().deleteNote(path, { permanent }),
  });
}

/** Delete ONE attachment. The dialog looks like the note's and says a
 *  different thing, which is the entire point: this is the file a published
 *  note embeds, and its warning names the notes that will break. */
export async function confirmDeleteAttachment(path: string): Promise<void> {
  const name = path.split("/").pop() ?? path;
  const info = await preview(path);
  await twoSpeeds({
    name,
    body: tf("deleteFileTrashBody", { path }),
    permBody: tf("deleteFilePermBody", { path }),
    warn: refsWarning(info),
    run: (permanent) => void useStore.getState().deleteAttachment(path, { permanent }),
  });
}

/** Delete a folder and everything under it. The counts come from the SERVER's
 *  own walk of the same tree the delete will move, under the same ignore
 *  rules — not from the client's tree, which knew only about markdown and was
 *  where "0 notes" came from. */
export async function confirmDeleteFolder(path: string): Promise<void> {
  const name = path.split("/").pop() ?? path;
  const info = await preview(path);
  const contents = contentsPhrase(info?.notes ?? 0, info?.attachments ?? 0);
  await twoSpeeds({
    name,
    body: tf("deleteFolderTrashBody", { contents }),
    permBody: tf("deleteFolderPermBody", { contents }),
    warn: refsWarning(info),
    run: (permanent) => void useStore.getState().deleteFolder(path, { permanent }),
  });
}
