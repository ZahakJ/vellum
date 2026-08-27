// PAINTING ONE PAGE.
//
// Everything that touches a canvas lives here so the component above stays a
// component. Three things in this file are not obvious and all three are
// load-bearing:
//
// 1. THE DEVICE-PIXEL SPLIT. The canvas is sized in DEVICE pixels and shown at
//    a CSS size — a page at 100% on a retina display is a 2× bitmap in a 1×
//    box. Without it every book is soft, which on a scanned manuscript is the
//    difference between reading it and squinting at it. `clampCanvasScale`
//    (layout.ts) puts a ceiling on the result, because a canvas over the
//    browser's ~16 megapixel limit does not throw: it silently paints nothing.
//
// 2. THE DARK COMPOSITE. See figures.ts for the argument. Briefly: `night`
//    inverts the page with `invert(1) hue-rotate(180deg)` — the second half is
//    what keeps a red heading red instead of turning it cyan — then LIFTS the
//    resulting black to the theme's own paper colour with a `screen` blend, so
//    a book in `sandstone` is dark sandstone rather than a black rectangle in
//    a warm room. Then every raster figure is drawn back over the top,
//    unfiltered, so the plates and the photographs survive. `flip` is the plain
//    negative for the reader who actually wants one, and skips both.
//
// 3. THE TEXT LAYER IS NOT DECORATION. It is what makes the text selectable,
//    what `/` searches through, and what the next stage will hang annotations
//    on. It is absolutely positioned over the canvas with transparent glyphs;
//    the CSS that makes that work lives in client/styles/books.css.

import type { BookInvert, BookRotation } from "../../shared/bookAnchor.ts";
import { IDENTITY, imageRects, multiply, unitSquareBox, type Matrix, type Rect } from "./figures.ts";
import { clampCanvasScale } from "./layout.ts";
import { loadPdfjs, type Pdfjs, type PdfDocument, type PdfPage, type PdfViewport } from "./pdfjs.ts";

export interface PageRender {
  /** CSS pixels — what the slot must reserve. */
  cssWidth: number;
  cssHeight: number;
}

export interface RenderOptions {
  doc: PdfDocument;
  pageNumber: number;
  /** CSS scale (1 = the page's own size at 72 dpi rendered at 96). */
  scale: number;
  rotation: BookRotation;
  invert: BookInvert;
  canvas: HTMLCanvasElement;
  /** Absolutely-positioned host for the selectable glyphs; omit for covers. */
  textLayer?: HTMLElement | null;
  /** The theme's ground, read from the live custom property by the caller —
   *  never a literal, so every theme gets its own night. */
  paper: string;
  signal?: AbortSignal;
}

/** Cached per document+page: an operator list costs about as much as a render,
 *  and the figure rectangles do not change when the reader zooms — only the
 *  transform does, so the RAW page-space boxes are what is worth keeping.
 *  Keyed by the document object, so closing a book frees the lot. */
const figureCache = new WeakMap<PdfDocument, Map<number, Rect[]>>();

/** True when the browser can do a filtered `drawImage`. Every current engine
 *  can; a browser that cannot gets the page un-inverted rather than a blank
 *  one, because a legible page in the wrong colours beats nothing. */
function canFilter(ctx: CanvasRenderingContext2D): boolean {
  return typeof ctx.filter === "string";
}

/** The measured size of a page at a given scale — what a slot reserves before
 *  anything is rendered into it, so the scrollbar is honest from the first
 *  frame and nothing jumps as pages arrive. */
export async function pageSize(
  doc: PdfDocument,
  pageNumber: number,
  scale: number,
  rotation: BookRotation,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation });
  return { width: viewport.width, height: viewport.height };
}

export async function renderPage(opts: RenderOptions): Promise<PageRender> {
  const pdfjs = await loadPdfjs();
  const { doc, pageNumber, canvas, signal } = opts;
  const page = await doc.getPage(pageNumber);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const cssViewport = page.getViewport({ scale: opts.scale, rotation: opts.rotation });
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  const deviceScale = clampCanvasScale(
    opts.scale * dpr,
    cssViewport.width / opts.scale,
    cssViewport.height / opts.scale,
  );
  const viewport = page.getViewport({ scale: deviceScale, rotation: opts.rotation });

  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${Math.round(cssViewport.width)}px`;
  canvas.style.height = `${Math.round(cssViewport.height)}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("vellum: no 2d context for a book page");

  const plain = opts.invert === "off" || !canFilter(ctx);
  // Straight to the visible canvas when nothing has to be composited: one
  // fewer full-page bitmap in memory per rendered page, which at five spreads
  // of a large book is the difference between comfortable and not.
  const target = plain ? canvas : document.createElement("canvas");
  if (!plain) {
    target.width = width;
    target.height = height;
  }
  const targetCtx = plain ? ctx : target.getContext("2d");
  if (!targetCtx) throw new Error("vellum: no 2d context for a book page");

  const task = page.render({ canvasContext: targetCtx, viewport, canvas: target });
  if (signal) signal.addEventListener("abort", () => task.cancel(), { once: true });
  await task.promise;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  if (!plain) {
    ctx.save();
    ctx.filter = opts.invert === "night" ? "invert(1) hue-rotate(180deg)" : "invert(1)";
    ctx.drawImage(target, 0, 0);
    ctx.restore();
    if (opts.invert === "night") {
      // Lift the now-black ground to the theme's paper. `screen` leaves the
      // light pixels (the type) alone and raises the dark ones, which is
      // exactly the operation wanted and is one fill rather than a per-pixel
      // pass over 8 million pixels.
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = opts.paper;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      for (const rect of await figuresFor(pdfjs.OPS, doc, page, pageNumber, toMatrix(viewport.transform))) {
        // Clamped to the canvas: an image placed partly off the page is legal
        // PDF, and drawImage with a source rectangle outside the source canvas
        // draws nothing at all rather than the part that overlaps.
        const sx = Math.max(0, Math.floor(rect.x));
        const sy = Math.max(0, Math.floor(rect.y));
        const sw = Math.min(width - sx, Math.ceil(rect.w));
        const sh = Math.min(height - sy, Math.ceil(rect.h));
        if (sw > 0 && sh > 0) ctx.drawImage(target, sx, sy, sw, sh, sx, sy, sw, sh);
      }
    }
  }

  if (opts.textLayer) {
    await renderTextLayer(pdfjs, page, opts.textLayer, cssViewport, signal);
  }

  return { cssWidth: cssViewport.width, cssHeight: cssViewport.height };
}

/** The page's figure rectangles for THIS viewport transform, from a cached
 *  operator-list pass. The cache holds PAGE-space boxes, so a zoom or a
 *  rotation reuses the pass and only re-multiplies six numbers per figure.
 *  Failure is not fatal: a page whose operator list cannot be read simply has
 *  no exempt figures, which is the behaviour a plain inversion would give. */
async function figuresFor(
  OPS: Record<string, number>,
  doc: PdfDocument,
  page: PdfPage,
  pageNumber: number,
  transform: Matrix,
): Promise<Rect[]> {
  let perDoc = figureCache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    figureCache.set(doc, perDoc);
  }
  let raw = perDoc.get(pageNumber);
  if (!raw) {
    try {
      raw = imageRects(await page.getOperatorList(), opCodes(OPS), IDENTITY);
    } catch {
      raw = [];
    }
    perDoc.set(pageNumber, raw);
  }
  // A page-space box is the unit square under [w 0 0 h x y]; putting the
  // viewport transform in front of that maps it to device pixels.
  return raw.map((r) => unitSquareBox(multiply(transform, [r.w, 0, 0, r.h, r.x, r.y])));
}

/** pdf.js hands the viewport transform out as a plain `number[]`; the geometry
 *  in figures.ts wants a fixed six-tuple, and a cast would assert a length the
 *  array type does not carry. Six reads instead. */
function toMatrix(values: number[]): Matrix {
  return [values[0], values[1], values[2], values[3], values[4], values[5]];
}

function opCodes(OPS: Record<string, number>) {
  return {
    save: OPS.save,
    restore: OPS.restore,
    transform: OPS.transform,
    paintImageXObject: OPS.paintImageXObject,
    paintInlineImageXObject: OPS.paintInlineImageXObject,
    paintImageXObjectRepeat: OPS.paintImageXObjectRepeat,
  };
}

async function renderTextLayer(
  pdfjs: Pdfjs,
  page: PdfPage,
  host: HTMLElement,
  viewport: PdfViewport,
  signal?: AbortSignal,
): Promise<void> {
  host.replaceChildren();
  host.style.width = `${Math.round(viewport.width)}px`;
  host.style.height = `${Math.round(viewport.height)}px`;
  // pdf.js sizes every glyph with `calc(<pt>px * var(--total-scale-factor))`,
  // so the layer scales with one custom property instead of a re-layout.
  host.style.setProperty("--total-scale-factor", String(viewport.scale));
  host.style.setProperty("--scale-factor", String(viewport.scale));
  const layer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container: host,
    viewport,
  });
  if (signal) signal.addEventListener("abort", () => layer.cancel(), { once: true });
  try {
    await layer.render();
  } catch {
    // A cancelled or unreadable text layer costs selection and search on this
    // page. It must never cost the PAGE, which is already on screen.
  }
}
