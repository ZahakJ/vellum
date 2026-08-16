// FENCED CODE, SCANNED ONCE, FOR EVERY SURFACE THAT WALKS A NOTE'S LINES.
//
// Three places used to answer "am I inside a code block?" with the same four
// characters of regex and the same wrong idea:
//
//     const FENCE_RE = /^\s*(```|~~~)/;   ...   inFence = !inFence;
//
// A toggle is blind to WHICH marker opened the block and how long its run was.
// CommonMark closes a fence only on a run of the SAME character, AT LEAST AS
// LONG as the opener, with nothing but whitespace after it; every other
// fence-shaped line inside the block is content. The toggle got that wrong on
// the one shape documentation is made of — a ```markdown block showing a `~~~`
// block — and there the consequences were not cosmetic:
//
//   · `client/reading/toc.ts` feeds the OUTLINE, and the outline REWRITES THE
//     FILE. A `### ` inside such a fence became a section the document does not
//     have, and one drag of that phantom row swallowed the note's next heading
//     and its body INTO the code block and dropped a paragraph out of the
//     document entirely.
//   · `shared/anchors.ts` feeds `[[Note#anchor]]`, transclusion and the
//     backlink previews. Its ids have to agree with the ones the reading view
//     assigns, or an anchor silently misses.
//
// So the rule lives here, once, and both of them read it. A note is one
// document; it cannot have two opinions about where its code is.

/** An open fence: the character it was opened with and how long its run was. */
export interface Fence {
  char: string;
  len: number;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/** The fence `line` opens, or null when it opens none. A backtick fence's info
 *  string may not itself contain a backtick — that is what keeps a line of
 *  inline code from opening a block. */
export function fenceOpener(line: string): Fence | null {
  const m = FENCE_RE.exec(line);
  if (!m) return null;
  const char = m[2][0];
  if (char === "`" && m[3].includes("`")) return null;
  return { char, len: m[2].length };
}

/** True when `line` closes `fence`: same character, run at least as long, and
 *  no info string. */
export function closesFence(line: string, fence: Fence): boolean {
  const m = FENCE_RE.exec(line);
  if (!m) return false;
  return m[2][0] === fence.char && m[2].length >= fence.len && m[3].trim() === "";
}

/** A note split into lines with each line's carriage return dropped.
 *
 *  `md.replace(/\r\n/g, "\n").split("\n")` was not the same thing: a CRLF note
 *  whose final newline has been trimmed ends in a DANGLING `\r`, and that line
 *  then failed both the fence and the heading regex — `.` and `$` do not cross
 *  a carriage return — so the last fence of such a file never closed. */
export function sourceLines(md: string): string[] {
  return md.split("\n").map((l) => l.replace(/\r+$/, ""));
}
