// THE SECTION MODEL — the one answer to "what does this heading own".
//
// A markdown heading is not a line, it is a HANDLE on a subtree: the heading
// itself plus everything under it until the next heading at the same or a
// shallower level, nested headings included. Every affordance this file feeds
// — copy a section, extract a section into its own note, fold everything
// below it, drag it to a new place in the outline — is that one span read or
// rewritten, so none of them can disagree about where a section ends.
//
// PURE. No DOM, no fetch, no store: it takes markdown in and gives markdown
// back, which is what makes `scripts/check-sections.mjs` able to throw ten
// thousand random documents at it and assert the invariant that matters — a
// reorder may change the ORDER of a note's lines and the DEPTH of the moved
// subtree's own headings, and it may add blank lines at the seams. It may
// never lose a line and it may never duplicate one.
//
// The heading scan is `reading/toc.ts`'s `extractHeadings`, deliberately and
// not a second copy of the rule: the outline panel is the surface a reader
// DRAGS, so a section boundary the outline cannot see is a section boundary
// that would move content the reader never selected. Frontmatter and fenced
// code (a `### ` inside a ```` ``` ```` block is code, not structure) are
// skipped there, once, for both of us.

import { extractHeadings } from "./reading/toc.ts";

export interface Section {
  /** 1–6. */
  level: number;
  /** Display text, inline markdown stripped (what the outline shows). */
  text: string;
  /** The reading view's element id — also the key fold state persists under. */
  slug: string;
  /** 0-based index of the heading's own line. */
  headingLine: number;
  /** 0-based line index one PAST the section, exclusive. */
  endLine: number;
  /** Position in document order. */
  index: number;
}

/** A source line and the terminator that FOLLOWED it (`""` on the last one).
 *
 *  EVERY LINE CARRIES ITS OWN ENDING. This used to be one `nl` for the whole
 *  file, chosen as `md.includes("\r\n") ? "\r\n" : "\n"` — which is not "the
 *  document's flavour", it is "any CRLF anywhere wins": a note with ONE stray
 *  CRLF had every one of its endings converted by a single outline drag. No
 *  content is lost either way, but this file's own rule for the seams is that
 *  blank lines are only ever ADDED, and silently rewriting twelve hundred line
 *  endings is a far larger edit nobody asked for than removing one blank line
 *  — on a gitSync instance it lands as the whole file in the diff.
 *
 *  Keeping the terminator ON the line also fixes `sectionOffsets`, which used
 *  the single `nl` to accumulate character offsets and so drifted by one byte
 *  per LF line it walked past on a mixed-ending note. */
interface Line {
  text: string;
  nl: string;
}

/** Split into lines, each holding the terminator it was followed by. `nl` is
 *  the MAJORITY ending — used only for lines this module ADDS (a blank line at
 *  a seam), never to rewrite one that already exists. */
function splitLines(md: string): { lines: Line[]; nl: string } {
  const lines: Line[] = [];
  let crlf = 0;
  let lf = 0;
  let start = 0;
  for (let i = 0; i < md.length; i++) {
    if (md[i] !== "\n") continue;
    const cr = i > start && md[i - 1] === "\r";
    lines.push({ text: md.slice(start, cr ? i - 1 : i), nl: cr ? "\r\n" : "\n" });
    if (cr) crlf++;
    else lf++;
    start = i + 1;
  }
  lines.push({ text: md.slice(start), nl: "" });
  return { lines, nl: crlf > lf ? "\r\n" : "\n" };
}

/** Lines back to text, each with the terminator it arrived with.
 *
 *  A file that ends in a newline splits to a trailing EMPTY line whose own
 *  terminator is `""`, so "ends with a newline" is carried by the data and
 *  needs no special case here. The one substitution: a line whose terminator
 *  is `""` but which is no longer last — that same trailing empty line, once a
 *  section has been moved after it — takes the majority ending, because a line
 *  in the middle of a file must end somehow. */
function joinLines(lines: Line[], nl: string): string {
  return lines
    .map((l, i) => l.text + (l.nl || (i === lines.length - 1 ? "" : nl)))
    .join("");
}

const HEADING_PREFIX_RE = /^(\s{0,3})(#{1,6})(\s)/;

/** Every section in the note, in document order. */
export function sectionsOf(md: string): Section[] {
  const { lines } = splitLines(md);
  const heads = extractHeadings(md);
  return heads.map((h, i) => {
    const headingLine = h.line - 1; // extractHeadings counts from 1
    let endLine = lines.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) {
        endLine = heads[j].line - 1;
        break;
      }
    }
    return {
      level: h.level,
      text: h.text,
      slug: h.slug,
      headingLine,
      endLine,
      index: i,
    };
  });
}

/** The section a 0-based line sits inside — the DEEPEST one, which is the one
 *  a reader pointing at a line means. Null above the first heading. */
export function sectionAtLine(sections: Section[], line: number): Section | null {
  let best: Section | null = null;
  for (const s of sections) {
    if (line >= s.headingLine && line < s.endLine) {
      if (!best || s.level > best.level) best = s;
    }
  }
  return best;
}

/** The section whose heading is on `line`, if any. */
export function sectionAtHeading(sections: Section[], headingLine: number): Section | null {
  return sections.find((s) => s.headingLine === headingLine) ?? null;
}

/** Character offsets of a section inside the note. The editor works in
 *  offsets; everything else here works in lines. */
export function sectionOffsets(md: string, section: Section): { from: number; to: number } {
  const { lines } = splitLines(md);
  let from = 0;
  for (let i = 0; i < section.headingLine; i++) from += lines[i].text.length + lines[i].nl.length;
  let to = from;
  for (let i = section.headingLine; i < section.endLine && i < lines.length; i++) {
    to += lines[i].text.length + lines[i].nl.length;
  }
  return { from, to: Math.min(to, md.length) };
}

/** A section's own markdown, heading line included, trailing blank lines
 *  trimmed — what "copy section as markdown" puts on the clipboard and what
 *  "extract to a new note" carries out of the note. */
export function sectionMarkdown(md: string, section: Section): string {
  const { lines, nl } = splitLines(md);
  const block = lines.slice(section.headingLine, section.endLine);
  while (block.length > 1 && block[block.length - 1].text.trim() === "") block.pop();
  // A FRAGMENT, not a file: the block's own last terminator comes off, because
  // every caller (the clipboard, the extraction stub, the new note's body)
  // supplies its own ending.
  return joinLines(block, nl).replace(/\r?\n$/, "");
}

/** The note with `section` removed. Blank lines left behind at the seam are
 *  left alone: collapsing them would be an edit the reader did not ask for. */
export function withoutSection(md: string, section: Section): string {
  const { lines, nl } = splitLines(md);
  const rest = [...lines.slice(0, section.headingLine), ...lines.slice(section.endLine)];
  return joinLines(rest, nl);
}

/** Replace a section with arbitrary lines (extraction leaves a `[[link]]`). */
export function replaceSection(md: string, section: Section, replacement: string[]): string {
  const { lines, nl } = splitLines(md);
  const rest = [
    ...lines.slice(0, section.headingLine),
    ...replacement.map((text) => ({ text, nl })), // new lines take the majority ending
    ...lines.slice(section.endLine),
  ];
  return joinLines(rest, nl);
}

// ── Reordering ──────────────────────────────────────────────────────────────

/** Where a dragged section is going: BEFORE the section starting on
 *  `beforeLine` (0-based heading line), or at the end of the note when null,
 *  at heading depth `level`. */
export interface DropTarget {
  beforeLine: number | null;
  level: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** The depths a drop between two sections may legally take.
 *
 *  `hi` is one deeper than the section above the seam — you may always become
 *  its first child — and `lo` is the depth of the section below it, so a drop
 *  can also land as ITS sibling. Anything outside that range would silently
 *  re-parent headings the reader never touched. */
export function levelRange(
  sections: Section[],
  beforeLine: number | null,
  moving: Section | null,
): { lo: number; hi: number } {
  const visible = sections.filter(
    (s) => !moving || s.headingLine < moving.headingLine || s.headingLine >= moving.endLine,
  );
  const nextIdx = beforeLine === null ? -1 : visible.findIndex((s) => s.headingLine === beforeLine);
  const next = nextIdx === -1 ? null : visible[nextIdx];
  const prev =
    nextIdx === -1 ? (visible.length ? visible[visible.length - 1] : null) : visible[nextIdx - 1] ?? null;
  const hi = prev ? clamp(prev.level + 1, 1, 6) : 1;
  const lo = clamp(next ? Math.min(next.level, hi) : 1, 1, hi);
  return { lo, hi };
}

/** Every heading line inside a block of lines, with its depth — the same scan
 *  the whole file uses, run on the block alone so a `###` inside a fence
 *  travelling with the section is still code when it lands. */
function headingsIn(block: Line[], nl: string): { line: number; level: number }[] {
  return extractHeadings(joinLines(block, nl)).map((h) => ({ line: h.line - 1, level: h.level }));
}

/**
 * Move a section (heading + body + subheadings) so it lands at `target`.
 *
 * Returns the rewritten note, or null when the move is a no-op or illegal (a
 * section cannot be dropped inside itself — the outline never offers it, and
 * this is the second lock).
 *
 * The whole operation is one splice of a LINE ARRAY: the block leaves and
 * arrives whole, so the note's lines are a permutation of what they were,
 * plus at most two blank lines added at the seams to keep a heading off the
 * end of the paragraph above it. Depth changes rewrite the `#` prefix of the
 * moved block's own headings and nothing else, by one shared delta, clamped so
 * the shallowest never rises above `#` and the deepest never falls past
 * `######`.
 */
export function moveSection(md: string, headingLine: number, target: DropTarget): string | null {
  const sections = sectionsOf(md);
  const moving = sectionAtHeading(sections, headingLine);
  if (!moving) return null;
  // Dropping a section inside itself would delete it into its own body.
  if (
    target.beforeLine !== null &&
    target.beforeLine > moving.headingLine &&
    target.beforeLine < moving.endLine
  ) {
    return null;
  }

  const { lines, nl } = splitLines(md);
  const block = lines.slice(moving.headingLine, moving.endLine);

  // Re-level the block as one rigid body: the subtree keeps its own shape.
  const inner = headingsIn(block, nl);
  const levels = inner.map((h) => h.level);
  const minLevel = levels.length ? Math.min(...levels) : moving.level;
  const maxLevel = levels.length ? Math.max(...levels) : moving.level;
  const delta = clamp(target.level - moving.level, 1 - minLevel, 6 - maxLevel);
  const moved =
    delta === 0
      ? block
      : block.map((line, i) => {
          const h = inner.find((x) => x.line === i);
          if (!h) return line;
          const m = HEADING_PREFIX_RE.exec(line.text);
          if (!m) return line;
          // The `#` prefix changes; the line's own terminator rides along.
          return {
            text: `${m[1]}${"#".repeat(clamp(h.level + delta, 1, 6))}${line.text.slice(
              m[1].length + m[2].length,
            )}`,
            nl: line.nl,
          };
        });

  const rest = [...lines.slice(0, moving.headingLine), ...lines.slice(moving.endLine)];
  const removed = moving.endLine - moving.headingLine;

  let insertAt: number;
  if (target.beforeLine === null) {
    insertAt = rest.length;
  } else {
    insertAt =
      target.beforeLine > moving.headingLine ? target.beforeLine - removed : target.beforeLine;
  }
  insertAt = clamp(insertAt, 0, rest.length);
  if (insertAt === moving.headingLine && delta === 0) return null; // it did not move

  // A heading must not land welded to the paragraph above it, and the section
  // that follows must not be welded to this one's last line. Only ever ADD a
  // blank line — removing one would be an edit nobody asked for.
  const blank: Line[] = [{ text: "", nl }];
  const head = insertAt > 0 && rest[insertAt - 1].text.trim() !== "" ? blank : [];
  const tail =
    insertAt < rest.length &&
    rest[insertAt].text.trim() !== "" &&
    moved[moved.length - 1].text.trim() !== ""
      ? blank
      : [];
  const out = [...rest.slice(0, insertAt), ...head, ...moved, ...tail, ...rest.slice(insertAt)];
  const next = joinLines(out, nl);
  return next === md ? null : next;
}
