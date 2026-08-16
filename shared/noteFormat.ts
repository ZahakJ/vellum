// What counts as a NOTE, and which language it is written in.
//
// Vellum used to answer both questions with one expression, `.endsWith(".md")`,
// spelled out about forty times across the server and the client. LaTeX support
// makes that expression wrong in two different ways at once — `.tex` is a note,
// and a note is no longer necessarily markdown — so both answers move here and
// every caller asks instead of testing a suffix.
//
// Deliberately dependency-free (no node:path, no DOM): the indexer, the vault
// walker, the router, the editor and the reading renderer all import it.

export type NoteFormat = "markdown" | "latex";

/** Every extension the product treats as a note, lowercase, dot included.
 *  ORDER IS LOAD-BEARING: `[[Fourier]]` with both `Fourier.md` and
 *  `Fourier.tex` in the vault resolves to the markdown one, because that is
 *  what every vault written before this feature meant by the name. */
export const NOTE_EXTENSIONS = [".md", ".tex", ".latex"] as const;

/** The LaTeX half of the list — the same two names TeXShop, Overleaf and
 *  `latexmk` accept for a source file. */
export const LATEX_EXTENSIONS = [".tex", ".latex"] as const;

/** The note extension a path carries (lowercase, dot included), or "" when the
 *  path is not a note at all. `.latex` is tested before `.tex` would matter —
 *  they are distinct suffixes, so no ordering trap here, but the longest match
 *  is returned regardless. */
export function noteExtOf(rel: string): string {
  const lower = rel.toLowerCase();
  let found = "";
  for (const ext of NOTE_EXTENSIONS) {
    if (lower.endsWith(ext) && ext.length > found.length) found = ext;
  }
  // A file called exactly ".md" is a dotfile, not a note named "" — and
  // dotfiles are invisible to this product anyway.
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  if (found !== "" && base.length === found.length) return "";
  return found;
}

/** True when this vault path names a note (any supported format). */
export function isNotePath(rel: string): boolean {
  return noteExtOf(rel) !== "";
}

/** True when this vault path names a LaTeX note. */
export function isTexPath(rel: string): boolean {
  const ext = noteExtOf(rel);
  return ext === ".tex" || ext === ".latex";
}

/** Which renderer/parser a note path wants. Non-notes answer "markdown" —
 *  callers that care whether it IS a note ask isNotePath() first. */
export function noteFormat(rel: string): NoteFormat {
  return isTexPath(rel) ? "latex" : "markdown";
}

/** A path or basename with its note extension removed ("a/b.tex" → "a/b").
 *  Non-notes come back unchanged, so this is safe to call on anything. */
export function stripNoteExt(rel: string): string {
  const ext = noteExtOf(rel);
  return ext === "" ? rel : rel.slice(0, rel.length - ext.length);
}

/** The reader's name for a note: its basename with the extension gone. Used
 *  wherever a note is being NAMED to a reader — post titles, RSS, og:title,
 *  search hits, backlink cards, graph labels, hover cards. */
export function noteTitleOf(rel: string): string {
  return stripNoteExt(rel.slice(rel.lastIndexOf("/") + 1));
}

/** The name a note wears in the FILE surfaces — the sidebar tree, the tab bar,
 *  the breadcrumb. `.md` comes off, as it always has; `.tex` and `.latex` stay
 *  on, because a vault holding both `Paper.md` and `Paper.tex` would otherwise
 *  show two rows reading "Paper" and clicking one would be a coin toss. The
 *  reader-facing surfaces keep using noteTitleOf() and show neither. */
export function noteLabelOf(rel: string): string {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  return noteExtOf(base) === ".md" ? stripNoteExt(base) : base;
}

/** The candidate vault paths a bare wikilink target could name, in resolution
 *  order — `[[Fourier Transform]]` → `Fourier Transform.md`, `.tex`, `.latex`.
 *  A target that already carries a note extension answers only itself, so an
 *  explicit `[[Paper.tex]]` never silently resolves to `Paper.md`. */
export function noteCandidates(target: string): string[] {
  if (isNotePath(target)) return [target];
  return NOTE_EXTENSIONS.map((ext) => `${target}${ext}`);
}
