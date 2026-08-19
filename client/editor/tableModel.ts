// The GFM pipe-table MODEL: split a row into cells, locate a cell around a
// document offset, move rows and columns, and prettify the pipes.
//
// Pure string/offset logic, deliberately apart from tables.ts, and for the
// same reason calloutDefs.ts sits apart from callouts.ts: tables.ts imports
// the reading renderer (whose import chain carries .css files) and CodeMirror,
// and `node --test` can load neither, so the logic the tests must exercise
// lives here with no imports at all. tables.ts is the only other consumer.
//
// Offsets are absolute when a `base` is passed in (the caller hands us the
// document offset of the block's first character), so a caller can dispatch a
// selection straight from a CellRange without re-adding anything.

/** One cell of one row. `from`/`to` bound the RAW segment between the pipes
 *  (spaces included, escapes intact); `trimFrom`/`trimTo` bound the content a
 *  caret should land on. For an all-whitespace cell the trimmed range
 *  collapses one character in from the pipe — `|  |` puts the caret between
 *  the pads, not against the wall. */
export interface TableCell {
  from: number;
  to: number;
  trimFrom: number;
  trimTo: number;
  /** Trimmed raw text — `\|` stays `\|` so widths and round-trips see the
   *  bytes the file actually holds. */
  text: string;
}

export interface TableLine {
  from: number;
  to: number;
  cells: TableCell[];
  /** Whether the source line carried a leading / trailing pipe — a column
   *  move must rebuild the line in the author's own style, not silently
   *  reformat it (prettifying is format-on-exit's job, on exit). */
  leadPipe: boolean;
  trailPipe: boolean;
}

/** `:---` is not `---`: both render left-aligned, but the colon is the
 *  author's explicit choice and formatting must not erase it. */
export interface TableAlign {
  left: boolean;
  right: boolean;
}

export interface TableShape {
  header: TableLine;
  delimiter: TableLine;
  aligns: TableAlign[];
  body: TableLine[];
  from: number;
  to: number;
}

const DELIM_CELL_RE = /^:?-+:?$/;

/** True at index `i` when text[i] === "|" is escaped. Counts the run of
 *  backslashes before it: `\|` is a literal pipe, `\\|` is a literal
 *  backslash and then a real separator — parity, not presence. */
function pipeEscaped(text: string, i: number): boolean {
  let k = i - 1;
  while (k >= 0 && text[k] === "\\") k--;
  return (i - 1 - k) % 2 === 1;
}

/** Split one row line into cells. GFM splits BEFORE inline parsing, so an
 *  unescaped pipe splits even inside backticks; only `\|` holds a cell
 *  together — which is exactly what the reading renderer's splitRow does,
 *  and the two must agree or a widget click lands in the wrong cell. */
export function splitRowCells(text: string, base = 0): TableCell[] {
  // Segment boundaries at every unescaped pipe.
  const bounds: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "|" && !pipeEscaped(text, i)) bounds.push(i);
  }
  const segs: { from: number; to: number }[] = [];
  let start = 0;
  for (const b of bounds) {
    segs.push({ from: start, to: b });
    start = b + 1;
  }
  segs.push({ from: start, to: text.length });

  // A leading pipe leaves an empty (all-space) first segment; a trailing pipe
  // an empty last one. Both are punctuation, not cells.
  const trimmed = text.trim();
  if (segs.length > 1 && trimmed.startsWith("|") && text.slice(segs[0].from, segs[0].to).trim() === "") {
    segs.shift();
  }
  const lastPipe = text.lastIndexOf("|");
  if (
    segs.length > 1 &&
    lastPipe !== -1 &&
    !pipeEscaped(text, lastPipe) &&
    text.slice(segs[segs.length - 1].from, segs[segs.length - 1].to).trim() === "" &&
    segs[segs.length - 1].from === lastPipe + 1
  ) {
    segs.pop();
  }

  return segs.map((seg) => {
    const raw = text.slice(seg.from, seg.to);
    const lead = raw.length - raw.trimStart().length;
    const content = raw.trim();
    let trimFrom: number;
    let trimTo: number;
    if (content === "") {
      const inset = Math.min(1, raw.length);
      trimFrom = trimTo = seg.from + inset;
    } else {
      trimFrom = seg.from + lead;
      trimTo = trimFrom + content.length;
    }
    return {
      from: base + seg.from,
      to: base + seg.to,
      trimFrom: base + trimFrom,
      trimTo: base + trimTo,
      text: content,
    };
  });
}

function parseLine(text: string, base: number): TableLine {
  const trimmed = text.trim();
  return {
    from: base,
    to: base + text.length,
    cells: splitRowCells(text, base),
    leadPipe: trimmed.startsWith("|"),
    trailPipe: trimmed.length > 1 && trimmed.endsWith("|") && !pipeEscaped(trimmed, trimmed.length - 1),
  };
}

/** Parse a table block (header, delimiter, body rows — the whole block, no
 *  surrounding prose). Null when the second line is not a delimiter row:
 *  every mutation below refuses rather than guessing, because a guessed
 *  "table" edit on a paragraph full of pipes eats prose. */
export function parseTable(src: string, base = 0): TableShape | null {
  const lines = src.split("\n");
  if (lines.length < 2) return null;
  if (!lines[0].includes("|")) return null;
  const delimCells = splitRowCells(lines[1]);
  if (delimCells.length === 0 || !lines[1].includes("|")) return null;
  if (!delimCells.every((c) => DELIM_CELL_RE.test(c.text))) return null;

  let offset = base;
  const header = parseLine(lines[0], offset);
  offset += lines[0].length + 1;
  const delimiter = parseLine(lines[1], offset);
  offset += lines[1].length + 1;
  const body: TableLine[] = [];
  for (let i = 2; i < lines.length; i++) {
    body.push(parseLine(lines[i], offset));
    offset += lines[i].length + 1;
  }
  return {
    header,
    delimiter,
    aligns: delimCells.map((c) => ({
      left: c.text.startsWith(":"),
      right: c.text.endsWith(":"),
    })),
    body,
    from: base,
    to: base + src.length,
  };
}

/** Navigable rows: the header, then the body — the delimiter is punctuation
 *  and never a stop. */
export function navRows(shape: TableShape): TableLine[] {
  return [shape.header, ...shape.body];
}

/** Which navigable row an offset sits on. The delimiter line answers as the
 *  header (row 0): Tab from `| --- |` should behave like Tab from the
 *  header, not throw. Null outside the block. */
export function rowIndexAt(shape: TableShape, pos: number): number | null {
  if (pos < shape.from || pos > shape.to) return null;
  const rows = navRows(shape);
  for (let i = 0; i < rows.length; i++) {
    if (pos >= rows[i].from && pos <= rows[i].to) return i;
  }
  if (pos >= shape.delimiter.from && pos <= shape.delimiter.to) return 0;
  return null;
}

/** Which cell of `row` an offset sits in. An offset on a pipe (or in the
 *  space beside one) belongs to the nearest cell whose raw segment has not
 *  ended yet — clicking a wall should not strand the caret cell-less. */
export function colIndexAt(row: TableLine, pos: number): number {
  for (let j = 0; j < row.cells.length; j++) {
    if (pos <= row.cells[j].to) return j;
  }
  return Math.max(0, row.cells.length - 1);
}

/** Grapheme display width, for pipe alignment: CJK and emoji occupy two
 *  monospace columns, combining marks ride their base for free. Counting
 *  UTF-16 units instead put every column after a Chinese cell one pipe off
 *  per character. Intl.Segmenter clusters; the wide test is the East-Asian
 *  Wide/Fullwidth blocks plus emoji. Arabic is width 1 — cursive, not wide. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const g of segment(text)) {
    const cp = g.codePointAt(0) ?? 0;
    // Zero-width joiners/marks standing alone (post-clustering this is rare).
    if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff) continue;
    width += isWideCodePoint(cp) ? 2 : 1;
  }
  return width;
}

function segment(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const out: string[] = [];
    for (const s of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
      out.push(s.segment);
    }
    return out;
  }
  return Array.from(text); // per code point — good enough where Segmenter is missing
}

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // kana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) || // unified ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Delimiter cell for a width: the colons keep their places, the dashes
 *  stretch. Width is never below 3 so `:-:` always fits. */
function delimCell(align: TableAlign | undefined, width: number): string {
  const w = Math.max(3, width);
  const left = align?.left ? ":" : "-";
  const right = align?.right ? ":" : "-";
  return left + "-".repeat(w - 2) + right;
}

function padCell(text: string, width: number, align: TableAlign | undefined): string {
  const pad = Math.max(0, width - displayWidth(text));
  if (align?.right && !align.left) return " ".repeat(pad) + text;
  if (align?.left && align.right) {
    const l = Math.floor(pad / 2);
    return " ".repeat(l) + text + " ".repeat(pad - l);
  }
  return text + " ".repeat(pad);
}

/** Prettify a table block: every cell padded to its column's width, the
 *  delimiter stretched to match, leading/trailing pipes normalized in, short
 *  rows squared off with empty cells. Cell CONTENT is copied verbatim —
 *  trimmed, never rewritten — so `\|` escapes and pipes hidden in inline
 *  code survive because splitting is the only thing that ever looks inside.
 *  Returns the input untouched when it does not parse as a table: formatting
 *  runs on exit, and "the caret left a block that stopped being a table
 *  mid-edit" must be a no-op, not a mangling. */
export function formatTable(src: string): string {
  const shape = parseTable(src);
  if (!shape) return src;
  const rows = [shape.header, ...shape.body];
  const cols = Math.max(shape.aligns.length, ...rows.map((r) => r.cells.length));
  const widths: number[] = [];
  for (let j = 0; j < cols; j++) {
    let w = 3;
    for (const r of rows) {
      const cell = r.cells[j];
      if (cell) w = Math.max(w, displayWidth(cell.text));
    }
    widths.push(w);
  }
  const rowText = (r: TableLine): string =>
    "| " +
    widths.map((w, j) => padCell(r.cells[j]?.text ?? "", w, shape.aligns[j])).join(" | ") +
    " |";
  const delimText =
    "| " + widths.map((w, j) => delimCell(shape.aligns[j], w)).join(" | ") + " |";
  return [rowText(shape.header), delimText, ...shape.body.map(rowText)].join("\n");
}

/** Raw segments of a line, padded with single-space cells out to `cols` —
 *  the shared bed for column moves, which must keep every line the same
 *  shape or the swap shears. */
function rawSegments(line: TableLine, srcBase: number, src: string, cols: number): string[] {
  const segs = line.cells.map((c) => src.slice(c.from - srcBase, c.to - srcBase));
  while (segs.length < cols) segs.push(" ");
  return segs;
}

function joinSegments(segs: string[], line: TableLine): string {
  // Padded-on cells force pipes on both sides — a row that gained a column
  // cannot express it without them.
  const lead = line.leadPipe || segs.length > line.cells.length ? "|" : "";
  const trail = line.trailPipe || segs.length > line.cells.length ? "|" : "";
  return lead + segs.join("|") + trail;
}

/** Move column `col` one step (`dir` ±1) in EVERY line of the block —
 *  header, delimiter and all body rows in the same transaction, because a
 *  column move that skips the delimiter walks each column's alignment into
 *  its neighbour's. Returns the new block and the column's new index, or
 *  null at the edges (the caller keeps the keystroke a no-op). */
export function moveTableColumn(
  src: string,
  col: number,
  dir: 1 | -1,
): { src: string; col: number } | null {
  const shape = parseTable(src);
  if (!shape) return null;
  const rows = [shape.header, shape.delimiter, ...shape.body];
  const cols = Math.max(shape.aligns.length, ...rows.map((r) => r.cells.length));
  const target = col + dir;
  if (col < 0 || col >= cols || target < 0 || target >= cols) return null;
  const out = rows.map((line) => {
    const segs = rawSegments(line, shape.from, src, cols);
    [segs[col], segs[target]] = [segs[target], segs[col]];
    return joinSegments(segs, line);
  });
  return { src: out.join("\n"), col: target };
}

/** Swap body row `row` (0-based within the body) with its neighbour.
 *  Header and delimiter never move — dragging the header into the body is
 *  the corruption this signature makes unrepresentable. */
export function moveTableRow(
  src: string,
  row: number,
  dir: 1 | -1,
): { src: string; row: number } | null {
  const shape = parseTable(src);
  if (!shape) return null;
  const target = row + dir;
  if (row < 0 || row >= shape.body.length || target < 0 || target >= shape.body.length) {
    return null;
  }
  const lines = src.split("\n");
  const a = 2 + row;
  const b = 2 + target;
  [lines[a], lines[b]] = [lines[b], lines[a]];
  return { src: lines.join("\n"), row: target };
}

/** An empty row matching the column count, for Tab-in-the-last-cell. Three
 *  spaces per cell so the caret has somewhere to sit; format-on-exit will
 *  restretch it. */
export function emptyRowText(cols: number): string {
  return "|" + "   |".repeat(Math.max(1, cols));
}
