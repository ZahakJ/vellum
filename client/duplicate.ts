// "Duplicate note" — the one command in the F19 list that had no gesture
// anywhere in the product, so it is built here rather than exposed.
//
// A module of its own, like noteName.ts, because it is the seam between three
// things that already exist and must not learn about each other: the note's
// live text (sectionActions::noteContent, which prefers the buffer over the
// disk), the tree (move.ts::nodeAt, which knows what names are taken), and the
// publish route (api::publishNote, the only byte-surgical writer of the flag).
//
// THE COPY IS NEVER PUBLISHED. Duplicating a published note through a plain
// file copy would carry `publish: true` across with it, and the vault would
// quietly grow a second public URL serving the same words — the classic
// duplicate-content mistake, made by a command whose whole promise is "the same
// note, over here". So the flag is cleared on the copy, through the same route
// the publish toggle uses rather than by editing YAML on the client: the
// frontmatter writer lives on the server for a reason, and this is not the
// place to grow a second one.

import * as api from "./api.ts";
import { t, tf } from "./i18n.ts";
import { nodeAt } from "./move.ts";
import { isPublishedContent } from "./publish.ts";
import { noteContent } from "./sectionActions.ts";
import { useStore } from "./state.ts";
import { toast } from "./toast.ts";
import { noteExtOf, stripNoteExt } from "../shared/noteFormat.ts";

/** The name the copy gets: `Note.md` → `Note copy.md`, then `Note copy 2.md`,
 *  `Note copy 3.md`… `taken` is asked about every candidate, so the answer is
 *  free whichever way the caller knows (the tree, a set, the server).
 *
 *  The suffix goes before the EXTENSION, not after the filename: `Paper.tex
 *  copy` is not a LaTeX note any more, and this product treats `.tex` as a
 *  first-class note format rather than an import. */
export function duplicatePathFor(path: string, taken: (p: string) => boolean): string {
  const ext = noteExtOf(path);
  const stem = stripNoteExt(path);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? `${stem} copy${ext}` : `${stem} copy ${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  // A thousand copies of one note is not a naming problem any more. Fall back
  // to a name nothing can already hold rather than looping forever.
  return `${stem} copy ${Date.now()}${ext}`;
}

/** Copy `path` to a free name beside it, open the copy, and say where it went.
 *
 *  Ordering matches extractSection's, for the same reason: the new note is
 *  created and filled BEFORE anything else happens, so a failure anywhere
 *  leaves the vault with either nothing new or one complete new note — never a
 *  named-but-empty file the reader has to go and clean up. */
export async function duplicateNote(path: string): Promise<void> {
  const store = useStore.getState();
  try {
    const content = await noteContent(path);
    const toPath = duplicatePathFor(path, (p) => nodeAt(store.tree, p) !== null);
    await api.createNote(toPath);
    await api.putNote(toPath, content);
    // See the header: the copy must not inherit the original's public URL.
    if (isPublishedContent(content)) await api.publishNote(toPath, false);
    await useStore.getState().loadTree();
    useStore.getState().openNote(toPath);
    // THE SHELL CLEARS TOASTS WHEN `openPath` CHANGES (App.tsx: "a message
    // about the previous interaction must not overlay unrelated content"), and
    // that effect runs after React commits the open we just asked for — so a
    // message raised on this line is swept away by the navigation it is
    // reporting. Measured: the copy opened and the toast never appeared. Two
    // frames puts it after the commit and its passive effects; the alternative
    // is not opening the copy, and a duplicate the reader cannot see is a
    // command that looks like it did nothing.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => toast(tf("noteDuplicated", { path: toPath }))),
    );
  } catch (err) {
    console.error("vellum: duplicating a note failed", err);
    toast(t("couldNotDuplicateNote"), "error");
  }
}
