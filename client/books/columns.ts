// ASSEMBLING A QUOTE FROM A PAGE, AND THE BUG THAT MAKES THIS FILE NECESSARY.
//
// pdf.js returns text items IN THE ORDER THE CONTENT STREAM WROTE THEM. That
// is not a defect in pdf.js — it is what a PDF is. A page has no paragraphs,
// no columns and no reading order; it has a sequence of "put these glyphs at
// this matrix" instructions, and a typesetter is free to emit them in any
// order that paints the same page.
//
// TeX does. On a two-column paper it commonly interleaves the columns, so the
// stream reads: line 1 of the left column, line 1 of the right column, line 2
// of the left, line 2 of the right. Join those in stream order and the quote
// is alternating half-sentences:
//
//   "the argument rests on a premise which we now note in passing that the
//    reader may already suspect that this is not the case"
//
// It is grammatical. It is fluent. It is not what the book says, and nothing
// on screen tells anyone — the reader selected the right passage, saw the
// right passage highlighted, pressed `c`, and a sentence the author never
// wrote went silently into their notes and from there into their own writing.
// A wrong quotation that LOOKS right is the worst failure this reader can
// produce, which is why the assembler is a module with its own tests rather
// than three lines inside a keystroke handler.
//
// SO: GEOMETRY, NOT STREAM ORDER. Nothing here reads the order the pieces
// arrive in. Columns are found by projecting every piece onto the x axis and
// looking for a vertical corridor no piece crosses; lines are found by
// grouping on y; the order inside a line follows the SCRIPT (an Arabic line
// runs right to left, and sorting it by ascending x reverses every sentence).
//
// AND HYPHENS. A book breaks "significant" across a line as "sig-" / "nificant",
// and a naive line join produces "sig- nificant" — which is embarrassing every
// single time, in every quote, forever. Undoing it needs care: "Anglo-Saxon"
// and "1990-1995" are not hyphenations, and Arabic does not hyphenate at all,
// so a `-` at the end of an Arabic line is a dash and must survive.
//
// Pure geometry and strings: no DOM, no pdf.js. client/books/selection.ts does
// the DOM half and hands the pieces over; tests/books.test.ts drives exactly
// this code against a fixture measured off a real two-column paper.

/** One run of text with the box it occupies. The units are the caller's —
 *  everything here is scale-free, and selection.ts passes fractions of the
 *  page so the result can be stored (shared/bookAnchor.ts::BookRect). */
export interface TextPiece {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box, in whatever units the pieces came in. */
export interface PieceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AssembledSelection {
  /** The passage, in reading order, dehyphenated. */
  text: string;
  /** One box per LINE — what gets inked. A single bounding box around the
   *  whole selection would cover two margins and half a paragraph nobody
   *  chose, and on a two-column selection it would cover the gutter as well. */
  rects: PieceBox[];
}

/** How wide a corridor has to be before it counts as a column gutter, as a
 *  fraction of the selection's own width. A two-column paper's gutter is 4-6%
 *  of the text block; the widest word space in a justified line is under 1.5%.
 *  3.5% sits between them with room on both sides. */
const GUTTER_MIN_FRACTION = 0.035;

/** …and it must also be wider than about one line height, so that a single
 *  ragged paragraph with a big indent is never read as two columns. */
const GUTTER_MIN_HEIGHTS = 1.1;

/** Buckets the x axis is projected into. 2000 over a page is a quarter of a
 *  millimetre — finer than any gutter and coarser than floating-point noise. */
const PROJECTION_BUCKETS = 2000;

/** Two pieces are on the same line when their centres are within this much of
 *  each other, measured in line heights. Superscripts and inline math sit a
 *  little high; 0.55 takes them and still refuses the next line down. */
const LINE_TOLERANCE = 0.55;

/** A horizontal gap wider than this many line heights is a word space. Below
 *  it the two runs are halves of one word — pdf.js splits a word wherever the
 *  PDF changed font, and "ﬁ" in a ligature-poor font is its own text item. */
const SPACE_GAP_HEIGHTS = 0.16;

/** Invisible characters that are noise in a quote. Deliberately NOT the
 *  harakat, and deliberately NOT the zero-width joiners: a diacritic is what
 *  the book printed and a ZWNJ is Persian orthography, so removing either
 *  would mean the quote is not what the page says. Only the genuinely absent
 *  go — the soft hyphen a typesetter left at a line break, the zero-width
 *  space, and the byte-order mark some extractors sprinkle in. */
const INVISIBLE = new RegExp("[\\u00ad\\u200b\\ufeff]", "g");

// ── Columns ────────────────────────────────────────────────────────────────

/**
 * The x boundaries that split these pieces into columns, left to right.
 *
 * Returns the CUT positions — an empty array means one column. Found by
 * projecting every piece's x interval onto the axis and looking for interior
 * runs that nothing covers: a real gutter is empty on EVERY line, whereas the
 * space between two words is covered by the line above or below it.
 *
 * A selection that is only one line long never splits. A line is a line; the
 * gaps in it are word spaces, and reading them as columns would reorder a
 * sentence into nonsense — which is the same class of bug this file exists to
 * prevent, just pointed the other way.
 */
export function columnCuts(pieces: readonly TextPiece[]): number[] {
  if (pieces.length < 2) return [];
  const box = boxOf(pieces);
  if (box === null || box.w <= 0) return [];
  if (lineGroups(pieces).length < 2) return [];

  const heights = pieces.map((p) => p.h).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 0;
  const minGutter = Math.max(box.w * GUTTER_MIN_FRACTION, medianHeight * GUTTER_MIN_HEIGHTS);

  const covered = new Array<boolean>(PROJECTION_BUCKETS).fill(false);
  const bucket = (x: number): number =>
    Math.min(PROJECTION_BUCKETS - 1, Math.max(0, Math.floor(((x - box.x) / box.w) * PROJECTION_BUCKETS)));
  for (const piece of pieces) {
    const from = bucket(piece.x);
    const to = bucket(piece.x + piece.w);
    for (let i = from; i <= to; i += 1) covered[i] = true;
  }

  const cuts: number[] = [];
  let runStart = -1;
  for (let i = 0; i <= PROJECTION_BUCKETS; i += 1) {
    const empty = i < PROJECTION_BUCKETS && !covered[i];
    if (empty && runStart === -1) runStart = i;
    if (!empty && runStart !== -1) {
      // Interior only: the whitespace before the first piece and after the
      // last is a margin, not a gutter.
      if (runStart > 0 && i < PROJECTION_BUCKETS) {
        const width = ((i - runStart) / PROJECTION_BUCKETS) * box.w;
        if (width >= minGutter) cuts.push(box.x + ((runStart + i) / 2 / PROJECTION_BUCKETS) * box.w);
      }
      runStart = -1;
    }
  }
  return cuts;
}

/** Split pieces into columns in READING order — left to right for a Latin
 *  paper, right to left for an Arabic one, because the first column of an
 *  Arabic two-column page is the one on the right. */
export function columnsOf(pieces: readonly TextPiece[], rtl: boolean): TextPiece[][] {
  const cuts = columnCuts(pieces);
  if (cuts.length === 0) return pieces.length === 0 ? [] : [[...pieces]];
  const columns: TextPiece[][] = Array.from({ length: cuts.length + 1 }, () => []);
  for (const piece of pieces) {
    const centre = piece.x + piece.w / 2;
    let index = 0;
    while (index < cuts.length && centre > cuts[index]) index += 1;
    columns[index].push(piece);
  }
  const filled = columns.filter((c) => c.length > 0);
  return rtl ? filled.reverse() : filled;
}

// ── Lines ──────────────────────────────────────────────────────────────────

/** Group pieces into lines by vertical position, top to bottom. Order within
 *  a group is not decided here — `orderLine` does that, and it needs to know
 *  the direction. */
export function lineGroups(pieces: readonly TextPiece[]): TextPiece[][] {
  const sorted = [...pieces].sort((a, b) => centreY(a) - centreY(b));
  const lines: TextPiece[][] = [];
  for (const piece of sorted) {
    const line = lines[lines.length - 1];
    if (line !== undefined) {
      const last = line[line.length - 1];
      const tolerance = Math.max(piece.h, last.h) * LINE_TOLERANCE;
      if (Math.abs(centreY(piece) - centreY(last)) <= tolerance) {
        line.push(piece);
        continue;
      }
    }
    lines.push([piece]);
  }
  return lines;
}

/** One line's pieces in reading order. Ascending x for a left-to-right line,
 *  DESCENDING for a right-to-left one: an Arabic line's first word is its
 *  rightmost, and sorting it the Latin way silently reverses every sentence
 *  in the quote. */
export function orderLine(line: readonly TextPiece[], rtl: boolean): TextPiece[] {
  return [...line].sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
}

// ── Hyphens ────────────────────────────────────────────────────────────────

/** Scripts that hyphenate. Arabic, Hebrew, Syriac and the rest do not break
 *  words with a hyphen at all, so a `-` at the end of an Arabic line is a dash
 *  the author typed, and eating it would change the text. */
const HYPHENATING_LETTER = new RegExp("[A-Za-z\\u00c0-\\u024f\\u0370-\\u03ff\\u0400-\\u04ff]");

/** The characters a line break leaves behind. The soft hyphen is stripped
 *  outright elsewhere; these two are real glyphs on the page. */
const LINE_END_HYPHEN = new RegExp("[-\\u2010]$");

/**
 * Join two fragments the way the page meant them to read.
 *
 * The hyphenation rule, and every clause of it is a bug someone would
 * otherwise paste into a note:
 *
 *   · "sig-" + "nificant" -> "significant". The reason this file exists.
 *   · "Anglo-" + "Saxon"  -> "Anglo-Saxon". A capital on the right means a
 *     compound the author wrote, not a break the typesetter made.
 *   · "1990-" + "1995"    -> "1990-1995". A digit is never a hyphenation.
 *   · "ما-" + "بعد" keeps its dash: Arabic does not hyphenate, so the
 *     character before the hyphen has to belong to a script that does.
 *   · "a-" + "part" keeps its hyphen: a single letter before the break is
 *     nearly always a real compound ("x-ray", "e-mail") and nearly never a
 *     word broken after one character, which typesetters do not do.
 */
export function joinFragments(left: string, right: string): string {
  if (left === "") return right;
  if (right === "") return left;
  if (!LINE_END_HYPHEN.test(left)) return `${left} ${right}`;
  const stem = left.slice(0, -1);
  const before = stem.slice(-1);
  const beforeThat = stem.slice(-2, -1);
  const after = right.slice(0, 1);
  const joins =
    HYPHENATING_LETTER.test(before) &&
    HYPHENATING_LETTER.test(beforeThat) &&
    HYPHENATING_LETTER.test(after) &&
    after === after.toLowerCase();
  return joins ? stem + right : `${left} ${right}`;
}

// ── The whole job ──────────────────────────────────────────────────────────

/**
 * The passage these pieces spell, and the ribbons to ink it with.
 *
 * `rtl` is the BOOK's direction, not the interface's — an Arabic volume read
 * in an English panel is still an Arabic volume (client/books/direction.ts
 * makes the same distinction for the same reason).
 */
export function assembleSelection(
  pieces: readonly TextPiece[],
  rtl: boolean,
): AssembledSelection {
  const usable = pieces.filter((p) => p.text.trim() !== "" && p.w > 0 && p.h > 0);
  const rects: PieceBox[] = [];
  let text = "";
  for (const column of columnsOf(usable, rtl)) {
    for (const line of lineGroups(column)) {
      const ordered = orderLine(line, rtl);
      let lineText = "";
      let previous: TextPiece | null = null;
      for (const piece of ordered) {
        const clean = piece.text.replace(INVISIBLE, "");
        if (clean.trim() === "") {
          previous = piece;
          continue;
        }
        if (previous === null) {
          lineText = clean;
        } else {
          // A gap narrower than a space means pdf.js split one WORD — a font
          // change mid-word, a ligature emitted on its own — so the two halves
          // are butted together rather than spaced apart.
          const gap = gapBetween(previous, piece);
          const tall = Math.max(previous.h, piece.h);
          lineText =
            gap > tall * SPACE_GAP_HEIGHTS
              ? joinFragments(lineText, clean)
              : lineText + clean;
        }
        previous = piece;
      }
      if (lineText.trim() === "") continue;
      text = joinFragments(text, lineText.trim());
      const box = boxOf(line);
      if (box) rects.push(box);
    }
  }
  return { text: text.replace(/[ \t]{2,}/g, " ").trim(), rects };
}

// ── Small geometry ─────────────────────────────────────────────────────────

function centreY(piece: TextPiece): number {
  return piece.y + piece.h / 2;
}

/** The horizontal space between two boxes; 0 when they overlap. Direction-free
 *  on purpose — an RTL line hands them over in the other order. */
function gapBetween(a: TextPiece, b: TextPiece): number {
  const left = Math.min(a.x + a.w, b.x + b.w);
  const right = Math.max(a.x, b.x);
  return Math.max(0, right - left);
}

/** The box around a set of pieces, or null when there are none. */
export function boxOf(pieces: readonly TextPiece[]): PieceBox | null {
  if (pieces.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pieces) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.w);
    y1 = Math.max(y1, p.y + p.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
