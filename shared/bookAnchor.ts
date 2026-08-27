// WHAT A BOOK IS, AND WHERE THE READER LEFT OFF.
//
// The reading state of a PDF is keyed by a hash of its BYTES, never by its
// vault path, and that is the load-bearing decision in this file.
//
// The vault is the one directory this application does not own. Obsidian
// writes to it, Syncthing and Dropbox write to it, `git pull` writes to it,
// and the owner writes to it with `mv` in a terminal at two in the morning.
// A key that only our own rename handler maintains is therefore a key that
// goes stale the first time a book is filed by hand — and what is lost is not
// a cache: it is page 612 of a book someone has been reading since March, plus
// every highlight, every margin note and every citation into it. Renaming a
// file must not be able to do that, so the identity travels IN the file.
//
// The bytes are hashed as `sha256(size || head || tail)` — see server/books.ts
// for why a sample rather than the whole file — and the hex digest is the key
// this module validates. Both sides depend on it: the server writes
// VELLUM_DATA/books.json under these keys, and the client asks for state by
// the key the server computed for the path it opened.
//
// `bookRef()` was here before anything cited with it, for that reason. A
// citation into a book ("Ibn Khaldun, p. 212") has to survive the same renames
// the reading position does, so the reference form is `book:<key>#p212` and
// not a path. What a NOTE carries is the wikilink form at the end of this file
// — `[[Ibn Khaldun.pdf#page=212&rect=…&id=…]]` — which is the same idea
// wearing the vault's own syntax: the id resolves to the key, and the key is
// the bytes.
//
// Pure logic, no imports: server/books.ts, the client reader and
// tests/books.test.ts all run exactly this code.

/** A book key: the lowercase hex sha256 the byte sample hashes to. */
export const BOOK_KEY_RE = /^[0-9a-f]{64}$/;

export function isBookKey(value: unknown): value is string {
  return typeof value === "string" && BOOK_KEY_RE.test(value);
}

/** How the page is sized. "free" means the reader typed a zoom and meant it —
 *  a window resize must not silently undo their `+`. */
export type BookFit = "width" | "page" | "free";

/** What `i` cycles through. NOT a boolean, because "invert" is two different
 *  requests: see client/books/figures.ts for why a scanned plate and a page of
 *  type want opposite treatment. */
export type BookInvert = "off" | "night" | "flip";

/** Quarter turns, clockwise, as `r` applies them. */
export type BookRotation = 0 | 90 | 180 | 270;

export interface BookState {
  /** 1-based page number the reader was on. */
  page: number;
  /** How far into that page, 0..1 — a 900-page atlas at one page per screen
   *  would otherwise reopen at the top of a page the reader was halfway down. */
  offset: number;
  fit: BookFit;
  /** The scale in force when `fit` is "free" (1 = 100%). */
  zoom: number;
  /** Two pages side by side (`d`). */
  dual: boolean;
  rotation: BookRotation;
  invert: BookInvert;
  /** The book reads right-to-left: in dual mode page 2 sits LEFT of page 3.
   *  Detected from the text on first open (client/books/direction.ts) and then
   *  remembered, because detection is a guess and the reader's `:ltr` is not. */
  rtl: boolean;
  /** Zathura marks: one character → a page. `m<c>` sets, `'<c>` jumps. */
  marks: Record<string, number>;
  /** Total pages, 0 until a reader has actually opened the book. The shelf
   *  needs it to draw progress without opening 400 documents. */
  pages: number;
  /** From the PDF's own metadata, cached here so the shelf can print a title
   *  before it has re-parsed anything. Empty string when the file says nothing
   *  — and a great many PDFs say nothing, which is why the shelf falls back to
   *  the filename rather than printing "Untitled". */
  title: string;
  author: string;
  /** Where the book was last seen, for the shelf's subtitle only. Never used
   *  to FIND anything: that is the whole point of keying by bytes. */
  path: string;
  /** Every name these bytes have been filed under, most recent first.
   *
   *  The shelf has never needed this; a CITATION does. A note that says
   *  `[[Ihya.pdf#page=42&…]]` names the book the way the reader saw it, and
   *  three months later the file is `Sources/al-Ghazali - Ihya (ed. 1998).pdf`
   *  because that is what people do to a shelf. The bytes are the address, so
   *  the book is still findable — but "findable" has to mean something the
   *  reader can act on, and "this link points at a book that now lives under
   *  another name, shall I fix the link?" is only sayable if the OLD names
   *  were kept. Maintained by cleanBookState from the `path` each open sends;
   *  capped, because a book synced across five machines with five naming
   *  schemes must not grow an unbounded list. */
  names: string[];
  /** Epoch ms of the last write — the shelf's "continue reading" order, and
   *  the eviction order when the store hits its cap. */
  updatedAt: number;
}

export const DEFAULT_BOOK_STATE: BookState = {
  page: 1,
  offset: 0,
  fit: "width",
  zoom: 1,
  dual: false,
  rotation: 0,
  invert: "off",
  rtl: false,
  marks: {},
  pages: 0,
  title: "",
  author: "",
  path: "",
  names: [],
  updatedAt: 0,
};

/** Zoom bounds. Below 0.1 a page is a postage stamp with no way back except
 *  the keyboard; above 8 a single fit-width canvas on a 4K display exceeds the
 *  16 megapixel ceiling browsers impose on a <canvas> and renders BLANK — a
 *  failure with no error attached to it, which is the kind this product spends
 *  its comments on. client/books/render.ts clamps the canvas independently;
 *  this is the state-level guard so a hand-edited books.json cannot do it. */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;

/** Metadata strings from a PDF are attacker-controlled bytes off the internet.
 *  Capped and stripped of control characters before they are ever stored, let
 *  alone painted into the shelf. */
export const BOOK_TEXT_MAX = 300;

/** How many marks one book may carry. `m` takes a single character, so the
 *  natural ceiling is the character set; this is the guard against a file
 *  edited by hand into a megabyte of marks. */
export const MARKS_MAX = 64;

/** How many past names one book remembers. Five machines with five naming
 *  schemes is a real vault; fifty is a loop somewhere. */
export const NAMES_MAX = 8;

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown): string {
  if (typeof value !== "string") return "";
  // Control characters out (a PDF /Title of "\u0007…" would otherwise ring a
  // terminal and confuse a screen reader), then capped.
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, BOOK_TEXT_MAX);
}

function isFit(value: unknown): value is BookFit {
  return value === "width" || value === "page" || value === "free";
}

function isInvert(value: unknown): value is BookInvert {
  return value === "off" || value === "night" || value === "flip";
}

function isRotation(value: unknown): value is BookRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/** A mark name: exactly one character, and not a control one. Zathura takes
 *  any key here and so do we — an Arabic reader marking a chapter with "ب" is
 *  the same gesture as marking it with "b". */
export function isMarkName(value: string): boolean {
  return [...value].length === 1 && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * THE validator. Total, never throws, and never returns a partial state.
 *
 * Both doors use it: the PUT handler (where the input is a request body) and
 * the read path (where the input is a JSON file that Syncthing, a text editor
 * or a half-finished write may have got to). A reader whose books.json was
 * corrupted loses their positions — nothing can be done about that — but the
 * reader must still OPEN, which is why nothing in this file throws.
 *
 * `prev` supplies the fields a partial patch omits, so the client can PUT just
 * `{ page, offset }` on a scroll without echoing the whole record back.
 */
export function cleanBookState(input: unknown, prev: BookState = DEFAULT_BOOK_STATE): BookState {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const pages = Math.max(0, Math.floor(num(raw.pages, prev.pages)));
  const page = Math.max(1, Math.floor(num(raw.page, prev.page)));
  const marksIn =
    typeof raw.marks === "object" && raw.marks !== null && !Array.isArray(raw.marks)
      ? (raw.marks as Record<string, unknown>)
      : prev.marks;
  const marks: Record<string, number> = {};
  for (const [name, target] of Object.entries(marksIn)) {
    if (!isMarkName(name)) continue;
    const at = Math.floor(num(target, 0));
    if (at >= 1) marks[name] = at;
    if (Object.keys(marks).length >= MARKS_MAX) break;
  }
  const path = raw.path === undefined ? prev.path : text(raw.path);
  return {
    // Clamped to the page count only when we KNOW it: a state written before
    // the document was parsed carries pages: 0, and clamping to that would
    // send every reader back to page 1.
    page: pages > 0 ? Math.min(page, pages) : page,
    offset: Math.min(1, Math.max(0, num(raw.offset, prev.offset))),
    fit: isFit(raw.fit) ? raw.fit : prev.fit,
    zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, num(raw.zoom, prev.zoom))),
    dual: typeof raw.dual === "boolean" ? raw.dual : prev.dual,
    rotation: isRotation(raw.rotation) ? raw.rotation : prev.rotation,
    invert: isInvert(raw.invert) ? raw.invert : prev.invert,
    rtl: typeof raw.rtl === "boolean" ? raw.rtl : prev.rtl,
    marks,
    pages,
    title: raw.title === undefined ? prev.title : text(raw.title),
    author: raw.author === undefined ? prev.author : text(raw.author),
    path,
    names: mergeNames(path, raw.names, prev.names),
    updatedAt: Math.max(0, Math.floor(num(raw.updatedAt, prev.updatedAt))),
  };
}

/** The name list after a book has been seen at `path`.
 *
 *  Newest first and de-duplicated, so re-opening a book a hundred times does
 *  not write its own name a hundred times, and a book that moves back to where
 *  it started has one entry rather than two. An empty path contributes
 *  nothing: a patch that carries only `{ page, offset }` must not be able to
 *  push "" onto the front of a reader's history. */
function mergeNames(path: string, raw: unknown, prev: readonly string[]): string[] {
  const listed = Array.isArray(raw) ? raw.map((n) => text(n)) : [...prev];
  const out: string[] = [];
  for (const name of [path, ...listed]) {
    if (name === "" || out.includes(name)) continue;
    out.push(name);
    if (out.length >= NAMES_MAX) break;
  }
  return out;
}

/** How far through the book, 0..1 — the hairline under a shelf cover. Zero
 *  when the page count is unknown, which the shelf draws as "no line at all"
 *  rather than as "not started": they are different facts. */
export function progressOf(state: BookState): number {
  if (state.pages <= 0) return 0;
  return Math.min(1, Math.max(0, (state.page - 1 + state.offset) / state.pages));
}

// ── Citable references ──────────────────────────────────────────────────────

/** A reference to one page of one book, as a note will spell it:
 *  `book:<key>#p212`. Rename-proof by construction — the key is the bytes. */
export function bookRef(key: string, page: number): string {
  const at = Math.max(1, Math.floor(page));
  return `book:${key}#p${at}`;
}

export interface BookRef {
  key: string;
  page: number;
}

/** Parse a `book:` reference; null for anything that is not one. Strict about
 *  the key — a 63-character digest is a corrupted link, not a book we have
 *  not seen, and answering "not found" for it is the honest reply. */
export function parseBookRef(value: string): BookRef | null {
  const m = /^book:([0-9a-f]{64})(?:#p([0-9]{1,7}))?$/.exec(value.trim());
  if (!m) return null;
  return { key: m[1], page: m[2] ? Math.max(1, Number(m[2])) : 1 };
}

// ── Annotations ─────────────────────────────────────────────────────────────
//
// A highlight is a rectangle on a page and the words under it, and it is
// stored HERE — VELLUM_DATA, against the content key — because the alternative
// is writing into the PDF, and the PDF belongs to the reader. A vault is
// ordinary files someone syncs, greps and backs up; a reader who marks a
// passage must not discover afterwards that Vellum rewrote a 400 MB scan and
// that every one of their machines now has to pull it down again. The rule is
// absolute and it is asserted: `scripts/check-books.mjs` enumerates every
// write call in server/books.ts, and tests/books.test.ts checks the PDF's
// bytes and its mtime after a page has been annotated.
//
// The cost of storing it beside the file rather than in it is that a highlight
// does not travel to a different reader of the same PDF. That is the correct
// trade for a single-owner vault, and it is the same one the reading position
// already makes.

/** A rectangle on a page, in FRACTIONS of the unrotated page box (0..1).
 *
 *  Never in CSS pixels and never in PDF points. A reader annotates at 140% on
 *  a laptop and reopens the book at fit-width on a 4K display rotated ninety
 *  degrees; the only coordinate space that survives all of that is the page's
 *  own, expressed as a proportion of it. `client/books/annotations.ts` maps
 *  these onto whatever the page is currently being painted at. */
export interface BookRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How many inks a highlight may be. The six are PAGE inks, not chrome — see
 *  `--book-ink-1..6` in client/styles/tokens.css for why they are the same six
 *  in every theme. */
export const INK_COUNT = 6;

/** Caps. A quote is a passage, not a chapter; a margin note is a note, not an
 *  essay; and a selection running the length of a page is about sixty line
 *  rectangles, so two hundred is generous and a thousand is a hand-edited
 *  file. None of these is a policy about how anyone should read — they are the
 *  bound that keeps one book from turning books.json into a heap. */
export const HIGHLIGHT_TEXT_MAX = 4000;
export const HIGHLIGHT_NOTE_MAX = 2000;
export const HIGHLIGHT_RECTS_MAX = 200;
export const HIGHLIGHTS_MAX = 2000;

/** A highlight id, as it appears inside a citation's wikilink. Short enough to
 *  read in the source of a note, long enough that two of them never collide in
 *  one vault. Lowercase alphanumeric only, so it can never need escaping
 *  inside `[[…]]`. */
export const HIGHLIGHT_ID_RE = /^[a-z0-9]{4,16}$/;

export function isHighlightId(value: unknown): value is string {
  return typeof value === "string" && HIGHLIGHT_ID_RE.test(value);
}

export interface BookHighlight {
  id: string;
  /** 1-based page. */
  page: number;
  /** One rectangle per LINE of the selection, not one box around the lot: a
   *  passage running from halfway down one line to halfway along the third is
   *  three ribbons, and a single bounding box would ink two margins and half a
   *  paragraph nobody selected. */
  rects: BookRect[];
  /** 1..INK_COUNT. */
  ink: number;
  /** The passage, assembled by COLUMN GEOMETRY — see client/books/columns.ts,
   *  which is where the two-column bug lives and is killed. */
  text: string;
  /** The margin note, "" when the reader has not written one. */
  note: string;
  createdAt: number;
  updatedAt: number;
}

function frac(value: unknown, fallback = 0): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, n));
}

/** Round to four places — about a third of a millimetre on an A4 page, and the
 *  difference between a books.json a person can read and one full of
 *  0.30000000000000004. */
export function roundFrac(value: number): number {
  return Math.round(frac(value) * 10000) / 10000;
}

export function cleanRect(input: unknown): BookRect | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const x = roundFrac(frac(raw.x));
  const y = roundFrac(frac(raw.y));
  // Clamped so a rectangle can never run off the page it belongs to: a stored
  // box wider than its page would paint over the next one in dual mode.
  const w = roundFrac(Math.min(frac(raw.w), 1 - x));
  const h = roundFrac(Math.min(frac(raw.h), 1 - y));
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** The one box that contains them all — what a citation carries, because a
 *  link has room for four numbers and not for sixty. Null for no rectangles. */
export function boundingRect(rects: readonly BookRect[]): BookRect | null {
  if (rects.length === 0) return null;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return cleanRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

/** The control range, minus the newline. Built from a string rather than
 *  written as a literal for one reason: the newline is the character this
 *  regex must NOT match, and a range with a hole in it is a great deal easier
 *  to read spelled out than picked out of a run of escapes. */
const CONTROL_BUT_NEWLINE = new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f]+", "g");

/** Quote and margin-note text, cleaned. Newlines SURVIVE — a quote from a poem
 *  or a table is not one paragraph, and flattening it would silently reflow
 *  what somebody copied. Everything else in the control range goes, for the
 *  same reason a PDF /Title is stripped: this text came out of a document off
 *  the internet and is about to be painted into a panel and written into the
 *  reader's own note. */
export function cleanAnnotationText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_BUT_NEWLINE, " ")
    // A stripped control character leaves a space where there may already have
    // been one, so INTERIOR runs collapse. The lookbehind is what keeps the
    // indentation of a quoted stanza or a code listing intact: a run at the
    // START of a line is the shape of the thing, not extraction debris.
    .replace(/(?<=[^\n \t])[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, max);
}

/** THE highlight validator. Total, never throws — same contract as
 *  `cleanBookState` and for the same reason: a books.json that Syncthing tore
 *  in half costs annotations, and it must not also cost the ability to open
 *  the book. Returns null for anything that is not a highlight at all, which
 *  the store drops rather than repairs. */
export function cleanHighlight(input: unknown): BookHighlight | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (!isHighlightId(raw.id)) return null;
  const rects: BookRect[] = [];
  for (const r of Array.isArray(raw.rects) ? raw.rects : []) {
    const clean = cleanRect(r);
    if (clean) rects.push(clean);
    if (rects.length >= HIGHLIGHT_RECTS_MAX) break;
  }
  if (rects.length === 0) return null; // a highlight with no shape is not one
  const now = Date.now();
  const stamp = (value: unknown, fallback: number): number =>
    Math.max(0, Math.floor(num(value, fallback)));
  return {
    id: raw.id,
    page: Math.max(1, Math.floor(num(raw.page, 1))),
    rects,
    ink: Math.min(INK_COUNT, Math.max(1, Math.floor(num(raw.ink, 1)))),
    text: cleanAnnotationText(raw.text, HIGHLIGHT_TEXT_MAX),
    note: cleanAnnotationText(raw.note, HIGHLIGHT_NOTE_MAX),
    createdAt: stamp(raw.createdAt, now),
    updatedAt: stamp(raw.updatedAt, now),
  };
}

/** Reading order: down the book, down the page, then oldest first. Decided
 *  HERE rather than at each of the four places that list highlights — the
 *  panel, the shelf search, the store and the tests cannot then disagree. */
export function sortHighlights(list: BookHighlight[]): BookHighlight[] {
  return list.sort(
    (a, b) =>
      a.page - b.page ||
      (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0) ||
      a.createdAt - b.createdAt,
  );
}

/** A whole book's highlights, cleaned, de-duplicated by id and ordered. */
export function cleanHighlights(input: unknown): BookHighlight[] {
  if (!Array.isArray(input)) return [];
  const out: BookHighlight[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const clean = cleanHighlight(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
    if (out.length >= HIGHLIGHTS_MAX) break;
  }
  return sortHighlights(out);
}

/** A fresh id. Crypto where there is one — a Math.random id would be fine for
 *  uniqueness and this is not a secret, but two highlights made in the same
 *  millisecond in two tabs is a real thing and getRandomValues is free. */
export function newHighlightId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = new Uint8Array(8);
  const webcrypto = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
  if (typeof webcrypto?.getRandomValues === "function") webcrypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

// ── The citation anchor ─────────────────────────────────────────────────────
//
// A citation into a book is a WIKILINK, not a new syntax:
//
//   [[Ihya.pdf#page=42&rect=0.118,0.313,0.742,0.081&id=k7f3q2a9|Ihya, p. 42]]
//
// It rides `client/editor/links.ts::parseWikilink()` exactly as it stands —
// target, `#heading`, `|alias` — so the live preview, the reading view, the
// backlink index, the hover card and the autocomplete all keep working without
// being taught anything. A `book:` scheme or a `%%vellum-cite%%` fence would
// each have needed every one of those to learn a second language, and a note
// full of a syntax only this program understands has stopped being ordinary
// markdown — which is the promise the whole vault rests on.
//
// THREE THINGS RIDE IN THE ANCHOR AND EACH ONE IS LOAD-BEARING.
//   · `page` — where to open. Enough on its own for a link that still resolves.
//   · `rect` — what to pulse, so a citation lands on the sentence rather than
//     on a page of nine hundred words. Carried in the LINK and not only in the
//     store, so a citation into a book whose annotations were later deleted —
//     or whose store is on the other laptop — still points at the passage.
//   · `id`  — the handle the store knows. It is what makes the link survive a
//     rename: the id resolves to a CONTENT KEY, and the key is the bytes
//     (server/books.ts::locateHighlight). The filename in the target is a
//     courtesy to whoever reads the note's source, not the address.

export interface BookAnchor {
  page: number;
  rect: BookRect | null;
  id: string | null;
}

/** Format an anchor as the `#…` half of a wikilink. Ordered page, rect, id and
 *  never otherwise: a citation is a thing people diff and read in a git log. */
export function formatBookAnchor(anchor: BookAnchor): string {
  const parts = [`page=${Math.max(1, Math.floor(anchor.page))}`];
  if (anchor.rect) {
    const r = anchor.rect;
    parts.push(`rect=${roundFrac(r.x)},${roundFrac(r.y)},${roundFrac(r.w)},${roundFrac(r.h)}`);
  }
  if (anchor.id !== null && isHighlightId(anchor.id)) parts.push(`id=${anchor.id}`);
  return parts.join("&");
}

/**
 * Parse the `#…` half of a wikilink as a book anchor, or null when it is an
 * ordinary heading.
 *
 * STRICT ABOUT `page=`, because that is the whole of what tells a citation
 * apart from a heading somebody wrote. `[[Notes#page=one]]` is a link to a
 * heading called "page=one" and has to stay one; only a real page NUMBER makes
 * this a citation.
 */
export function parseBookAnchor(value: string): BookAnchor | null {
  const text = value.trim();
  if (text === "") return null;
  let page: number | null = null;
  let rect: BookRect | null = null;
  let id: string | null = null;
  for (const part of text.split("&")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    const arg = part.slice(at + 1).trim();
    if (name === "page") {
      if (!/^[0-9]{1,7}$/.test(arg)) return null;
      page = Math.max(1, Number(arg));
    } else if (name === "rect") {
      const nums = arg.split(",").map((n) => Number(n));
      if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
        rect = cleanRect({ x: nums[0], y: nums[1], w: nums[2], h: nums[3] });
      }
    } else if (name === "id" && isHighlightId(arg)) {
      id = arg;
    }
  }
  return page === null ? null : { page, rect, id };
}

/** Characters a wikilink cannot carry: `]` ends the link, `|` starts the
 *  alias, `[` and `#` re-open the two halves the parser splits on. The same
 *  rule client/sectionActions.ts states about a heading, restated here because
 *  a PDF is a file somebody ELSE named — and the id in the anchor is what
 *  finds the book when a scrubbed filename no longer does. */
const UNSPELLABLE_IN_LINK = /[[\]|#]/g;

export function linkSafe(value: string): string {
  return value.replace(UNSPELLABLE_IN_LINK, " ").replace(/\s+/g, " ").trim();
}

/**
 * The citation wikilink for one passage.
 *
 * `target` is the book's FILE NAME, the way a wikilink names a note: it is
 * what a person reads in the source of their own note, and it is how the link
 * resolves on the happy path. When it stops resolving — the book renamed,
 * moved, or arrived from another machine under a different name — the `id`
 * takes over (client/books/mount.ts asks the store, opens the book anyway and
 * offers to repair the name).
 */
export function bookCitationLink(target: string, anchor: BookAnchor, label: string): string {
  const name = linkSafe(target);
  const shown = linkSafe(label);
  return `[[${name}#${formatBookAnchor(anchor)}${shown === "" ? "" : `|${shown}`}]]`;
}

/**
 * The markdown one citation adds to a note.
 *
 * `> [!quote]` is the VAULT'S OWN callout syntax, not a syntax this feature
 * invented: it already renders in the editor's live preview, in the reading
 * view and on a published page, and it already survives being opened in
 * Obsidian. A citation that needed a renderer of its own would be a citation
 * that only exists inside this program.
 *
 * EVERY line of the quote is prefixed, blank lines included. A callout whose
 * body contains an unprefixed blank line ENDS at that line — so a two-paragraph
 * quotation would put its second paragraph outside the box and its attribution
 * somewhere else again, which is the sort of thing nobody notices until it is
 * in forty notes.
 */
export function citationBlock(quote: string, link: string): string {
  const body = quote
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line.trim()}`))
    .join("\n");
  return `> [!quote]\n${body}\n>\n> — ${link}\n`;
}
