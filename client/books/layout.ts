// PAGE VIRTUALIZATION, AND WHAT "DUAL PAGE" MEANS IN AN ARABIC BOOK.
//
// THE WINDOW. A 900-page book gets 900 page SLOTS — cheap empty boxes that
// hold the scrollbar honest and let the browser do the layout — and at most
// `WINDOW_RADIUS` spreads either side of the reader's position ever hold a
// canvas. The radius is 2, and the number comes from arithmetic rather than
// taste: a fit-width A4 page on a 4K display at devicePixelRatio 2 rasterizes
// to roughly 2500 × 3500 pixels, which is 35 MB of canvas backing store. Five
// spreads is 175 MB in single-page mode and 350 MB in dual — already the point
// where a laptop starts swapping — and two spreads of lookahead is enough that
// a fast `j` scroll or a Page-Down never shows an empty box. Render everything
// and a 900-page book is 31 GB of canvas, which is not a slow reader: it is a
// tab the browser kills.
//
// THE SPREAD ORDER. In dual-page mode a left-to-right book shows [2,3], [4,5]
// — page 1 alone, because page 1 of a printed book is a RIGHT-hand page and
// pairing it with page 2 puts every subsequent spread on the wrong side of the
// gutter. An Arabic book is bound the other way: the spine is on the right, so
// the same pair renders as [3,2] and the reader's eye travels right to left
// across it. That is not the UI mirroring — the chrome mirrors with the
// interface language, which is a different question with a different answer,
// and a bilingual owner reading an English book in an Arabic interface must
// get an Arabic panel around a left-to-right book.
//
// Pure arithmetic: tests/books.test.ts drives all of it.

/** Spreads of lookahead kept rendered either side of the reader. */
export const WINDOW_RADIUS = 2;

/** One row of the scroller: the page or pages shown side by side, already in
 *  VISUAL order (leading edge first), so the renderer never asks about
 *  direction again. */
export interface Spread {
  /** 0-based index into the spread list — the scroll position's unit. */
  index: number;
  /** 1-based page numbers, in the order they are painted left to right. */
  pages: number[];
}

/**
 * Every spread in a book.
 *
 * Single-page mode is one page per spread and the direction is irrelevant.
 * Dual mode pairs 2+3, 4+5, … and leaves 1 alone; an odd last page is alone
 * too. `rtl` reverses the pair, never the sequence: spread 4 still comes after
 * spread 3 in a right-to-left book, because the reader is still scrolling
 * downwards through it.
 */
export function spreadsOf(pages: number, dual: boolean): Spread[] {
  const total = Math.max(0, Math.floor(pages));
  const out: Spread[] = [];
  if (total === 0) return out;
  if (!dual) {
    for (let p = 1; p <= total; p += 1) out.push({ index: out.length, pages: [p] });
    return out;
  }
  out.push({ index: 0, pages: [1] });
  for (let p = 2; p <= total; p += 2) {
    const pair = p + 1 <= total ? [p, p + 1] : [p];
    // LOGICAL order, always — page 2 then page 3 — and never reversed here.
    // The spread container carries dir="rtl" for an RTL book, and a flex row
    // under that direction lays its children right-to-left BY ITSELF; the
    // reversal this line used to do on top of that cancelled it, so an Arabic
    // book's spreads rendered in Latin order — two corrections making a wrong.
    // Same rule as the pane grid: the model speaks reading order, direction is
    // presentation, exactly one layer owns it.
    out.push({ index: out.length, pages: pair });
  }
  return out;
}

/** Which spread a page lives in. Linear because the mapping is arithmetic, not
 *  a search: in dual mode page 1 is spread 0 and page n is spread ⌈(n−1)/2⌉. */
export function spreadOfPage(page: number, dual: boolean): number {
  const p = Math.max(1, Math.floor(page));
  if (!dual) return p - 1;
  return p === 1 ? 0 : Math.ceil((p - 1) / 2);
}

/** The first page of a spread, in READING order — i.e. the lower page number,
 *  whatever side of the gutter it is painted on. What the status line prints
 *  and what gets stored as the reading position. */
export function pageOfSpread(index: number, dual: boolean): number {
  const i = Math.max(0, Math.floor(index));
  if (!dual) return i + 1;
  return i === 0 ? 1 : i * 2;
}

/** The spread indices that may hold a canvas right now. Clamped to the book,
 *  so the first and last screens are not a half-empty window: a reader who
 *  opens at page 1 gets 1..5 rendered, not 1..3. */
export function renderWindow(current: number, spreads: number, radius = WINDOW_RADIUS): number[] {
  if (spreads <= 0) return [];
  const span = radius * 2 + 1;
  if (spreads <= span) return Array.from({ length: spreads }, (_, i) => i);
  let start = Math.max(0, Math.min(current, spreads - 1) - radius);
  start = Math.min(start, spreads - span);
  return Array.from({ length: span }, (_, i) => start + i);
}

// ── Scale ──────────────────────────────────────────────────────────────────

export interface FitInput {
  /** Page size at scale 1, already rotated. */
  pageWidth: number;
  pageHeight: number;
  /** The scroller's usable box. */
  viewWidth: number;
  viewHeight: number;
  /** Pages painted side by side in this spread (1 or 2). */
  across: number;
  /** Space between and around the pages, in CSS pixels. */
  gap: number;
}

/** The scale that makes a spread fill the width. */
export function fitWidthScale(i: FitInput): number {
  const usable = i.viewWidth - i.gap * (i.across + 1);
  if (usable <= 0 || i.pageWidth <= 0) return 1;
  return usable / (i.pageWidth * i.across);
}

/** The scale that makes a whole spread visible at once — the smaller of the
 *  two constraints, which is what "fit page" has to mean or the bottom of the
 *  page is off screen and the mode is a lie. */
export function fitPageScale(i: FitInput): number {
  const byHeight = (i.viewHeight - i.gap * 2) / (i.pageHeight || 1);
  return Math.min(fitWidthScale(i), byHeight > 0 ? byHeight : 1);
}

/** The largest render scale a canvas of this page may use.
 *
 *  Browsers cap a canvas at roughly 16 megapixels (Safari on iOS is stricter
 *  still) and a canvas over the cap does not throw — it silently paints
 *  NOTHING. A reader who zooms to 800% on an A0 poster page would hit it, and
 *  what they would see is a blank rectangle with no error anywhere. So the
 *  device-pixel scale is capped and the page is allowed to be slightly soft
 *  instead, which is a thing a reader can see and understand. */
export function clampCanvasScale(
  scale: number,
  pageWidth: number,
  pageHeight: number,
  maxPixels = 16_000_000,
  maxSide = 8192,
): number {
  if (pageWidth <= 0 || pageHeight <= 0) return scale;
  const byArea = Math.sqrt(maxPixels / (pageWidth * pageHeight));
  const bySide = Math.min(maxSide / pageWidth, maxSide / pageHeight);
  return Math.max(0.05, Math.min(scale, byArea, bySide));
}
