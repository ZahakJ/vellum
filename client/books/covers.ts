// COVERS FOR THE SHELF — and the queue that stops them from stampeding.
//
// A cover is page 1, rendered small. That is four hundred `getDocument` calls
// on a four-hundred-book shelf, and the naive version of this file — one
// effect per card, fired on mount — is a browser that opens four hundred PDF
// documents at once, spawns a worker heap for each, saturates the connection
// pool with four hundred range requests, and leaves the shelf blank for
// twenty seconds before painting all of it. The reader's verdict on the
// feature is formed during those twenty seconds.
//
// So: at most `MAX_CONCURRENT` documents open at any moment, and every one of
// them is DESTROYED the instant its cover bitmap exists. A PDFDocumentProxy is
// not a handle — it is a worker-side heap of decoded fonts, images and page
// objects, and holding four hundred of them is how a tab reaches four
// gigabytes. Each cover costs one open, one page, one small canvas, one JPEG,
// one destroy.
//
// The queue is also PRIORITISED by the caller: the shelf enqueues covers as
// their cards scroll into view and cancels them when they scroll out, so a
// reader who jumps to the bottom of a long shelf gets the covers they are
// looking at rather than the ones they scrolled past. That is the whole reason
// `request()` returns a cancel function instead of a bare promise.

import { Lru } from "../lru.ts";
import { bookMetadata, closeDocument, openDocument, type PdfDocument } from "./pdfjs.ts";

/** Documents open at once. Three is not a round number: it is one being
 *  decoded, one being fetched and one being parsed, which keeps the pipeline
 *  full without letting the connection pool or the worker heap grow. */
const MAX_CONCURRENT = 3;

/** The cover's width in CSS pixels — matches the card in books.css. Rendered
 *  at 2× for a retina display and no more: a shelf is a wall of thumbnails and
 *  nobody reads the body text on one. */
const COVER_WIDTH = 240;
const COVER_DPR = 2;

export interface Cover {
  /** A JPEG data URL. Data, not a blob URL, because a blob URL has to be
   *  revoked by hand and a shelf that scrolls fast leaks every one it forgets
   *  — and because `img-src` already allows `data:`. */
  src: string;
  /** What the FILE says about itself, cached with the picture because the two
   *  come from the same one-shot document open. */
  pages: number;
  title: string;
  author: string;
}

/** Bounded, because a shelf is unbounded. A JPEG thumbnail is ~25 kB, so 200
 *  of them is ~5 MB — a scroll back up a long shelf repaints from memory,
 *  and a shelf ten times that size cannot grow the tab without limit. */
const cache = new Lru<Cover>({ max: 200 });

export function cachedCover(key: string): Cover | undefined {
  return cache.get(key);
}

interface Job {
  key: string;
  path: string;
  resolve(cover: Cover | null): void;
  cancelled: boolean;
}

const queue: Job[] = [];
let running = 0;

/**
 * Ask for a book's cover.
 *
 * Answers from cache synchronously where it can (via `cachedCover`), else
 * queues the render and calls back once. The returned function cancels: a job
 * still in the queue is dropped, a job already running is aborted at its next
 * checkpoint. Callers MUST call it on unmount — a callback into an unmounted
 * card is a React warning at best and a stale render at worst.
 */
export function requestCover(key: string, path: string, done: (cover: Cover | null) => void): () => void {
  const hit = cache.get(key);
  if (hit) {
    done(hit);
    return () => {};
  }
  const job: Job = { key, path, resolve: done, cancelled: false };
  queue.push(job);
  pump();
  return () => {
    job.cancelled = true;
  };
}

function pump(): void {
  while (running < MAX_CONCURRENT) {
    const job = queue.shift();
    if (!job) return;
    if (job.cancelled) continue;
    running += 1;
    void run(job).finally(() => {
      running -= 1;
      pump();
    });
  }
}

async function run(job: Job): Promise<void> {
  let doc: PdfDocument | null = null;
  try {
    doc = await openDocument(job.path);
    if (job.cancelled) return;
    const cover = await draw(doc);
    if (job.cancelled) return;
    cache.set(job.key, cover);
    job.resolve(cover);
  } catch {
    // A book that will not open is not an error state on the shelf: the card
    // keeps its typographic plate, which already says the title. Reporting
    // "failed" on forty cards because a network hiccup ate forty range
    // requests would be noise about nothing the reader can act on.
    if (!job.cancelled) job.resolve(null);
  } finally {
    // The destroy is the point of this whole module. It runs on every path,
    // including the cancelled one, including the thrown one.
    if (doc) closeDocument(doc);
  }
}

async function draw(doc: PdfDocument): Promise<Cover> {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = (COVER_WIDTH * COVER_DPR) / (base.width || 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("vellum: no 2d context for a cover");
  // A PDF page is transparent where it has no content; a cover drawn straight
  // onto a JPEG's default black is a black plate with a title on it. White is
  // correct here and is not a theme decision: it is the colour of the PAPER
  // the book was made on, and the card frames it rather than blending with it.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const meta = await bookMetadata(doc);
  return {
    src: canvas.toDataURL("image/jpeg", 0.72),
    pages: doc.numPages,
    title: meta.title,
    author: meta.author,
  };
}
