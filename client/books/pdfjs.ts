// Lazy pdf.js — the one door to the engine, and the one place its worker is
// configured. Modelled on client/katex.ts, for the same reason and at eight
// times the stakes: the library is ~1.1 MB and the worker another ~1.3 MB, and
// `scripts/check-bundle.mjs` fails the build if either lands in a first paint.
// Nothing outside this file imports "pdfjs-dist" (`npm run check-books`
// asserts that), so there is exactly one module rollup has to keep behind the
// dynamic boundary.
//
// THE WORKER IS AN ASSET, NOT A BLOB. The recipe every pdf.js tutorial gives —
// fetch the worker's source, wrap it in a Blob, hand pdf.js the object URL —
// works perfectly in `npm run dev` and is DEAD in production, because the vite
// dev server sends no Content-Security-Policy and the real server sends
// `default-src 'self'` with no `blob:` anywhere in it. A feature that works for
// its author and for nobody else is the worst failure mode available here, so
// the worker is imported with `?url`: the build emits it as an ordinary hashed
// asset served from our own origin, and `workerSrc` is that path. In dev vite
// serves the same file over its own origin, so the two agree.
//
// The four side-data directories (cmaps, standard fonts, the JBIG2/JPEG-2000
// wasm decoders, the CMYK profile) are copied to /pdfjs/ by a small plugin in
// vite.config.ts — see the comment there for what each one is for and what
// breaks without it.

import type * as PdfjsNamespace from "pdfjs-dist";
// Before anything of pdf.js evaluates: the engine may lack Map upsert (see
// mapUpsert.ts — Electron's V8 vs the browser's). The worker gets its own copy
// through pdfWorkerEntry.ts, because a worker is its own global scope.
import "./mapUpsert.ts";
import workerUrl from "./pdfWorkerEntry.ts?worker&url";

export type Pdfjs = typeof PdfjsNamespace;
export type PdfDocument = PdfjsNamespace.PDFDocumentProxy;
export type PdfPage = PdfjsNamespace.PDFPageProxy;
export type PdfViewport = PdfjsNamespace.PageViewport;

/** Where vite.config.ts's pdfjsAssets() plugin puts pdf.js's side data. The
 *  literal is spelled in both files (a client module cannot import the vite
 *  config); scripts/check-books.mjs asserts the two agree. */
const PDFJS_BASE = "/pdfjs/";

let mod: Pdfjs | null = null;
let pending: Promise<Pdfjs> | null = null;

/** The module when it is already here, else null. The shelf uses this to
 *  decide whether it may start rendering covers this frame. */
export function getPdfjs(): Pdfjs | null {
  return mod;
}

export function loadPdfjs(): Promise<Pdfjs> {
  if (mod) return Promise.resolve(mod);
  pending ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    mod = m;
    return m;
  });
  return pending;
}

/** How a book's bytes are addressed. The same publish-gated route every embed
 *  uses — the reader can show exactly what the server was already willing to
 *  serve, and not one file more. */
export function bookFileUrl(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

export interface OpenOptions {
  /** Aborts the load when the reader closes the book (or the shelf scrolls a
   *  cover out of view) before it finished. */
  signal?: AbortSignal;
  onProgress?(loaded: number, total: number): void;
}

/**
 * Open one PDF.
 *
 * `rangeChunkSize` + `disableAutoFetch` are what make a 900-page book usable:
 * pdf.js then asks /api/file for byte RANGES as pages are reached (that route
 * has answered `Accept-Ranges: bytes` since it was written) instead of pulling
 * 400 MB down before the first page paints. The trade is one extra request per
 * region of the file, which is exactly the right trade for a reader who is
 * going to look at eleven pages of it.
 *
 * The caller OWNS the returned document and must `destroy()` it. That is not
 * bookkeeping pedantry: each open document holds a worker-side heap of decoded
 * fonts and images, and the shelf opens up to three at once, forty times, while
 * it renders covers.
 */
export async function openDocument(path: string, opts: OpenOptions = {}): Promise<PdfDocument> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    url: bookFileUrl(path),
    // Side data. Absent, a Japanese book is boxes, a document that references
    // Helvetica without embedding it renders in a substitute with the wrong
    // metrics, and a scanned book is blank pages.
    cMapUrl: `${PDFJS_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_BASE}wasm/`,
    iccUrl: `${PDFJS_BASE}iccs/`,
    rangeChunkSize: 256 * 1024,
    disableAutoFetch: true,
    // The session cookie has to ride along: /api/file is publish-gated, and a
    // book in an unpublished folder is exactly the case this feature is for.
    withCredentials: true,
  });
  if (opts.onProgress) {
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      opts.onProgress?.(loaded, total);
    };
  }
  if (opts.signal) {
    if (opts.signal.aborted) {
      void task.destroy();
      throw new DOMException("Aborted", "AbortError");
    }
    opts.signal.addEventListener("abort", () => void task.destroy(), { once: true });
  }
  return task.promise;
}

/** Close a document and release its worker-side heap.
 *
 *  Spelled through `loadingTask` because that is where pdf.js puts the typed
 *  door: `PDFDocumentProxy.destroy()` exists at runtime but is not in the
 *  published types, and reaching for it under `tsc --strict` means a cast,
 *  which is a worse way to say the same thing. Every caller must reach this —
 *  a document that is merely dropped keeps its decoded fonts and images alive
 *  in the worker until the tab closes. */
export function closeDocument(doc: PdfDocument): void {
  void doc.loadingTask.destroy();
}

/** Title and author as the FILE states them, cleaned of the surprises a
 *  metadata field can carry. Empty strings when the document says nothing,
 *  which is the common case — most PDFs in the world have a /Title left over
 *  from a LaTeX run or no /Title at all, so the shelf falls back to the
 *  filename rather than printing whatever this returns. */
export async function bookMetadata(doc: PdfDocument): Promise<{ title: string; author: string }> {
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: unknown; Author?: unknown } | undefined;
    const str = (value: unknown): string =>
      typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const title = str(info?.Title);
    // "untitled" and "Microsoft Word - draft3.doc" are what a producer writes
    // when nobody set a title; both are worse than the filename the reader
    // chose, so they are treated as no title at all.
    const useless = /^(untitled|unknown|document\d*|microsoft word -|\(anonymous\))/i.test(title);
    return { title: useless ? "" : title, author: str(info?.Author) };
  } catch {
    return { title: "", author: "" };
  }
}
