// WHERE THE CARET PARKS when a note is opened for the first time.
//
// Pure, and in its own module for that reason: `Editor.tsx` is a React
// component over CodeMirror and cannot be driven from `node --test`, while the
// rule itself is a string in and an offset out.
//
// The rule has two halves, and the second is the v1.8 audit's F9.
//
//   1. PAST THE FRONTMATTER. Landing inside it renders the properties card as
//      raw YAML — in BOTH formats: a `.tex` note's frontmatter is a `%--- …
//      %---%` comment block, and a caret in there opened every LaTeX note on
//      five lines of raw YAML-in-comments.
//   2. PAST THE BLANK LINE UNDER IT. The caret used to land on the phantom
//      line between the properties card and the H1 — a gap with nothing to
//      read and nothing to continue, which draws as a stray empty paragraph at
//      the top of every note. It goes to the END of the title line instead, so
//      the first keystroke extends the title rather than opening a second one
//      above it.
//
// A note whose body is only frontmatter is a note waiting to be written, so
// its caret goes to the document end. A HEADINGLESS note with prose in it gets
// the START of that prose and not the document end, which is where the
// finding's parenthetical pointed: a note opened onto its own last line is
// worse than the gap this fixes, and the reason for the gap rule — never park
// somewhere that is neither reading nor writing — argues for the first line
// here exactly as it argues for the heading's end above.

import { isTexPath } from "../../shared/noteFormat.ts";
import { findTexFrontmatter } from "../../shared/tex.ts";

/** Offset just past a leading frontmatter block, or 0 when there is none. */
export function afterFrontmatter(path: string, content: string): number {
  if (isTexPath(path)) return findTexFrontmatter(content)?.end ?? 0;
  if (!/^---\r?\n/.test(content)) return 0;
  const m = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
  return m ? m[0].length : 0;
}

/** The caret's home. 0 means "leave it where CodeMirror put it" — a note with
 *  no frontmatter has no card to protect and no gap under one. */
export function caretHome(path: string, content: string): number {
  const fm = afterFrontmatter(path, content);
  if (fm === 0) return 0;
  let at = fm;
  while (at < content.length) {
    const nl = content.indexOf("\n", at);
    const end = nl === -1 ? content.length : nl;
    const line = content.slice(at, end);
    if (line.trim() !== "") {
      // An ATX heading opens most notes: park at the end of its text.
      return /^\s{0,3}#{1,6}\s/.test(line) ? end : at;
    }
    if (nl === -1) break;
    at = nl + 1;
  }
  return content.length;
}
