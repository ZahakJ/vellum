// FROM A DOM SELECTION TO SOMETHING THAT CAN BE QUOTED.
//
// The DOM half of the citation. `window.getSelection()` gives a range over
// pdf.js's text layer; what a quote needs is the WORDS with their GEOMETRY,
// because the order the words are quoted in cannot be read off the DOM — see
// client/books/columns.ts, which is the whole argument and the bug it kills.
// So this file collects `{ text, x, y, w, h }` pieces and hands them over.
// Nothing here decides reading order, and nothing in columns.ts touches a
// node; that line is what makes the assembler testable without a browser.
//
// The geometry is taken per TEXT NODE rather than per span. pdf.js emits one
// absolutely-positioned span per text run and a run never wraps, so a node's
// bounding box is one line box — but a run may be only PARTLY selected, and
// the box of the selected PART is what has to be inked. A Range clipped to the
// selection answers both questions at once: `toString()` for the words,
// `getBoundingClientRect()` for the ribbon.
//
// Boxes come back in the page's own coordinates and UNROTATED (see
// annotations.ts), so a passage marked while the page was turned sideways is
// stored in the same place as one marked upright, and the column detector sees
// columns rather than rows.

import type { BookRect, BookRotation } from "../../shared/bookAnchor.ts";
import { rectWithin, unrotateRect } from "./annotations.ts";
import type { TextPiece } from "./columns.ts";

/** Everything selected on ONE page. */
export interface PageSelection {
  /** 1-based page number, off the slot's `data-page`. */
  page: number;
  pieces: TextPiece[];
}

/** True when there is a real, non-empty selection inside the reader. A caret
 *  is not a selection: pressing `c` with nothing chosen must say so rather
 *  than cite an empty string. */
export function hasSelection(scroller: HTMLElement | null): boolean {
  const sel = window.getSelection();
  if (!scroller || !sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  return sel.toString().trim() !== "" && scroller.contains(sel.getRangeAt(0).commonAncestorContainer);
}

/**
 * The selected text of every page it touches, in page order.
 *
 * A selection that crosses a page break is ordinary — a sentence runs over,
 * and someone wants to quote the sentence. It comes back as one entry PER
 * PAGE, because a highlight belongs to a page (a rectangle has to be on
 * something) while a quote does not, and the caller marks each page and joins
 * the text.
 */
export function selectionByPage(
  scroller: HTMLElement | null,
  rotation: BookRotation,
): PageSelection[] {
  const sel = window.getSelection();
  if (!scroller || !sel || sel.rangeCount === 0 || sel.isCollapsed) return [];
  const range = sel.getRangeAt(0);
  if (!scroller.contains(range.commonAncestorContainer)) return [];

  const out: PageSelection[] = [];
  for (const pageEl of scroller.querySelectorAll<HTMLElement>(".s-book__page")) {
    const page = Number(pageEl.dataset.page ?? "0");
    if (!Number.isFinite(page) || page < 1) continue;
    if (!range.intersectsNode(pageEl)) continue;
    const pieces = piecesIn(pageEl, range, rotation);
    if (pieces.length > 0) out.push({ page, pieces });
  }
  return out.sort((a, b) => a.page - b.page);
}

/** The selected pieces of one page's text layer. */
function piecesIn(pageEl: HTMLElement, range: Range, rotation: BookRotation): TextPiece[] {
  const host = pageEl.querySelector<HTMLElement>(".s-book__text");
  if (!host) return [];
  const pageBox = pageEl.getBoundingClientRect();
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const pieces: TextPiece[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.data.trim() === "") continue;
    const clipped = clipToRange(text, range);
    if (clipped === null) continue;
    const words = clipped.toString();
    if (words.trim() === "") continue;
    const box = clipped.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    const rect = rectWithin(box, pageBox);
    if (rect === null) continue;
    const inPage = unrotateRect(rect, rotation);
    pieces.push({ text: words, x: inPage.x, y: inPage.y, w: inPage.w, h: inPage.h });
  }
  return pieces;
}

/** A range over the part of `node` that the selection covers, or null when it
 *  covers none of it. The clip is the boundary comparison and not
 *  `Selection.containsNode`, because the first and last nodes of any selection
 *  are exactly the PARTLY covered ones — quoting a whole run because its first
 *  character was selected is how a quote acquires half a sentence nobody
 *  chose. */
function clipToRange(node: Text, range: Range): Range | null {
  const own = document.createRange();
  own.selectNodeContents(node);
  try {
    if (own.compareBoundaryPoints(Range.END_TO_START, range) >= 0) return null; // wholly after
    if (own.compareBoundaryPoints(Range.START_TO_END, range) <= 0) return null; // wholly before
    if (own.compareBoundaryPoints(Range.START_TO_START, range) < 0) {
      own.setStart(range.startContainer, range.startOffset);
    }
    if (own.compareBoundaryPoints(Range.END_TO_END, range) > 0) {
      own.setEnd(range.endContainer, range.endOffset);
    }
  } catch {
    // A boundary in another tree (the selection escaped the reader between the
    // keystroke and this frame). One unquotable run, not a failed citation.
    return null;
  }
  return own.collapsed ? null : own;
}

/** Drop the selection once it has been marked. The ribbon is now the record of
 *  it, and leaving the browser's own highlight on top of a fresh one paints
 *  the passage twice in two colours. */
export function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
}

/** Where a rectangle sits on a page, for a caller that has a rect and wants a
 *  DOM box — the pulse a citation arrives on. */
export function pageElement(scroller: HTMLElement | null, page: number): HTMLElement | null {
  return scroller?.querySelector<HTMLElement>(`.s-book__page[data-page="${page}"]`) ?? null;
}

/** The single box a set of stored rectangles occupies on the rotated page, for
 *  scrolling one into view. */
export function unionOf(rects: readonly BookRect[]): BookRect | null {
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
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
