// WHERE THE PICTURES ARE ON A PAGE — and why the reader needs to know.
//
// `i` turns a book dark. The tempting implementation is `filter: invert(1)` on
// the canvas, and it is wrong in a way that is obvious the moment you use it
// on a real book: black type on white paper becomes white type on black paper
// (good), and the plate on page 212 becomes a photographic NEGATIVE (a face in
// cyan, a night sky in white). An art-history PDF, a medical atlas, a scanned
// manuscript with colour plates — the documents most worth reading at night
// are the ones a naive inversion ruins.
//
// A filter cannot tell type from photograph, because by the time the page is a
// bitmap there is no difference. But pdf.js can: the page's operator list says
// where every image was painted, in page coordinates, before anything was
// rasterized. So the reader renders each page ONCE, then composites it:
//
//   1. draw the whole page through the dark filter, then
//   2. draw the image rectangles again, unfiltered, over the top.
//
// Type inverts, photographs do not, and it costs one extra `drawImage` per
// figure — see render.ts for that half.
//
// The one op deliberately NOT collected here is `paintImageMaskXObject`. A
// stencil mask is a 1-bit shape painted in the CURRENT FILL COLOUR — which is
// how a scanned page of text and how most vector-drawn glyph fallbacks arrive.
// Those are ink, not pictures, and exempting them from the inversion would
// leave a scanned book unreadable in the exact mode that exists to make it
// readable at night. That single line of judgement is the difference between
// this working and not.
//
// Pure geometry, no pdf.js import: the OPS numbers are passed in, so
// tests/books.test.ts can drive the interpreter with a synthetic operator list
// and assert the matrix maths without a browser or a PDF.

/** A rectangle in DEVICE space (canvas pixels), after the viewport transform. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A 2-D affine transform, in the [a, b, c, d, e, f] order both PDF and
 *  canvas use. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `first` then `second` — i.e. the matrix that applies `first` to a point and
 *  then `second` to the result. */
export function multiply(second: Matrix, first: Matrix): Matrix {
  return [
    second[0] * first[0] + second[2] * first[1],
    second[1] * first[0] + second[3] * first[1],
    second[0] * first[2] + second[2] * first[3],
    second[1] * first[2] + second[3] * first[3],
    second[0] * first[4] + second[2] * first[5] + second[4],
    second[1] * first[4] + second[3] * first[5] + second[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** The axis-aligned bounding box of the UNIT SQUARE under `m`. PDF images are
 *  always drawn into the unit square and placed by the current transform, so
 *  this is the whole of image placement — including the vertical flip every
 *  PDF image carries, which is why all four corners are measured rather than
 *  two. */
export function unitSquareBox(m: Matrix): Rect {
  const corners: [number, number][] = [
    applyMatrix(m, 0, 0),
    applyMatrix(m, 1, 0),
    applyMatrix(m, 0, 1),
    applyMatrix(m, 1, 1),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The subset of pdf.js's OPS table this interpreter needs. Passed in rather
 *  than imported so this module stays free of the 1 MB engine — and so a test
 *  can hand it any numbers it likes. */
export interface OpCodes {
  save: number;
  restore: number;
  transform: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  /** Tiled images. The CTM box is the FIRST tile, not the union of them, so a
   *  tiled background is only partly exempted from the inversion. That is a
   *  deliberate under-approximation: tiles are rare in books, and covering too
   *  little leaves a seam, while covering too much would exempt half a page of
   *  type from the mode the reader turned on. */
  paintImageXObjectRepeat: number;
}

/** The shape of a pdf.js operator list. */
export interface OperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

/** Rectangles below this many device pixels on a side are not figures. Bullet
 *  glyphs, rule dividers and the one-pixel spacer images a Word export leaves
 *  behind all arrive as `paintImageXObject`, and exempting them from the
 *  inversion leaves a dark page freckled with white dots. */
const MIN_FIGURE_PX = 16;

/**
 * Every image rectangle on a page, in device pixels.
 *
 * `base` is the viewport transform pdf.js hands the renderer — pass exactly
 * what was used to render, or the rectangles land somewhere else on a rotated
 * or zoomed page.
 *
 * The interpreter is deliberately minimal: a transform stack, and the three
 * ops that place an image. Every other operator is skipped, which is safe
 * because nothing else moves the CTM in a pdf.js operator list — `save`,
 * `restore` and `transform` are the whole of it.
 */
export function imageRects(list: OperatorList, ops: OpCodes, base: Matrix): Rect[] {
  const rects: Rect[] = [];
  let ctm: Matrix = base;
  const stack: Matrix[] = [];
  const { fnArray, argsArray } = list;
  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      // An unbalanced restore is a malformed document, not a crash: keep the
      // current transform rather than throwing in the middle of a page.
      ctm = stack.pop() ?? base;
    } else if (fn === ops.transform) {
      const args = argsArray[i];
      if (isMatrixArgs(args)) ctm = multiply(ctm, args);
    } else if (
      fn === ops.paintImageXObject ||
      fn === ops.paintInlineImageXObject ||
      fn === ops.paintImageXObjectRepeat
    ) {
      const box = unitSquareBox(ctm);
      if (box.w >= MIN_FIGURE_PX && box.h >= MIN_FIGURE_PX) rects.push(box);
    }
  }
  return rects;
}

function isMatrixArgs(args: unknown): args is Matrix {
  return (
    Array.isArray(args) &&
    args.length >= 6 &&
    args.slice(0, 6).every((n) => typeof n === "number" && Number.isFinite(n))
  );
}
