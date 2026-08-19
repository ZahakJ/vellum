// A PASSAGE, AND THE NOTE IT LANDS IN.
//
// This is the point of the whole reader. Everything else — the shelf, the
// virtualization, the night composite — is a good PDF viewer, and there are
// several of those. What a vault can do that a viewer cannot is put the
// sentence you just read into the note you are writing, with a link back to
// the page it came off, and have that link still work after the shelf has been
// reorganised twice.
//
// THIS IS THE ONE MODULE OF THE READER THAT TOUCHES THE APP. `BooksSurface`
// takes a route and two callbacks and owns no global state on purpose, so that
// it can become a pane by being handed the same three props. That contract is
// about the SURFACE; "the note beside you" is not a fact a surface can hold —
// it is a fact about the workspace — so the coupling is put in a module of its
// own, named, rather than smuggled into the component. When the reader becomes
// a pane, this file is what a pane hands it.
//
// THE WRITE CLAIMS THE ECHO BEFORE IT SENDS. Every write this client makes
// comes back to it as an SSE "changed" frame, and the frame overtakes the
// response — measured at two milliseconds ahead. Without `markSelfWrite(path)`
// FIRST, App's handler reports the reader's own citation to them as "changed
// on disk", which is the alarm that exists for a conflict firing about
// nothing. `applyNoteContent` already does this, and using it is also what
// routes the write through the OPEN EDITOR when one holds the note — so the
// citation is one undoable transaction and the existing autosave carries it to
// disk, instead of a PUT that fights whatever is in the buffer.

import { applyNoteContent, noteContent } from "../sectionActions.ts";
import { useStore } from "../state.ts";
import { isNotePath, noteTitleOf } from "../../shared/noteFormat.ts";
import {
  bookCitationLink,
  citationBlock,
  type BookAnchor,
} from "../../shared/bookAnchor.ts";

/** A note a citation can be filed in. */
export interface CiteTarget {
  path: string;
  /** The name a person calls it — the tab's own label. */
  title: string;
}

/**
 * The note beside you.
 *
 * The active tab when it is a note, which is the answer in nearly every
 * session: someone is reading a book and writing a note about it, and the note
 * is the one they had open when they opened the book. Null when nothing is
 * open, and the reader is then asked where to put it rather than being made to
 * guess — `c` never invents a file.
 */
export function currentCiteTarget(): CiteTarget | null {
  const { openPath } = useStore.getState();
  if (openPath === null || !isNotePath(openPath)) return null;
  return { path: openPath, title: noteTitleOf(openPath) };
}

/** Every note that is open, for `Shift+C`'s picker. The tabs and not the whole
 *  vault: a citation goes into something you are working on, and a list of
 *  nine hundred notes is a list nobody reads. The active note comes first. */
export function citeTargets(): CiteTarget[] {
  const { openTabs, openPath } = useStore.getState();
  const notes = openTabs.filter(isNotePath);
  const ordered = openPath !== null && notes.includes(openPath)
    ? [openPath, ...notes.filter((p) => p !== openPath)]
    : notes;
  return ordered.map((path) => ({ path, title: noteTitleOf(path) }));
}

/** How a quote is dressed on the page. `> [!quote]` is the vault's own callout
 *  syntax — it renders in the editor's live preview, in the reading view and
 *  on a published page, because it is not a syntax this feature invented. */
export interface CitationParts {
  /** The passage, as assembled by client/books/columns.ts. */
  quote: string;
  /** What the attribution link reads as: "Ihya, p. 42". */
  label: string;
  /** The book's file name, for the wikilink's target. */
  target: string;
  anchor: BookAnchor;
}

/** The markdown one citation adds to a note. The shape of the block —
 *  including why every line of the quote is prefixed — is
 *  shared/bookAnchor.ts::citationBlock, beside the link it carries. */
export function citationMarkdown(parts: CitationParts): string {
  return citationBlock(parts.quote, bookCitationLink(parts.target, parts.anchor, parts.label));
}

/**
 * Append a citation to a note, and hand back the way to take it back.
 *
 * APPENDED, not inserted at a cursor, and that is a decision rather than a
 * shortcut: the reader is full-screen over the app while this happens, so
 * there is no caret anyone is looking at, and a block that lands somewhere
 * invisible in the middle of a note is a block they have to go and find. The
 * end of the note is where the reader will look, and it is where the last
 * thing they wrote already is.
 *
 * The returned function restores the note to exactly what it was — the Undo on
 * the toast, and the reason the whole content is captured first.
 */
export async function citeIntoNote(path: string, markdown: string): Promise<() => Promise<void>> {
  const before = await noteContent(path);
  const separator = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  await applyNoteContent(path, `${before}${separator}${markdown}`);
  return async () => {
    await applyNoteContent(path, before);
  };
}
