// THE pointer → document mapping. One implementation, four consumers: caret
// placement (this file's `pointerSelection`), wikilink / footnote / url clicks
// and checkbox toggling (livePreview.ts::handleMousedown), the hover previews
// (hoverPreview.ts) and the selection menu.
//
// WHY THIS FILE EXISTS. CodeMirror resolves a pointer with `posAtCoords`,
// which walks the height map to a block and then binary-searches the block's
// client rects. A line carrying a REPLACED INLINE WIDGET breaks that search:
// the widget's source ($7.7\ \text{km/s}$, eighteen characters) and its
// rendered box (a KaTeX span seven glyphs wide, full of absolutely positioned
// struts and vlists whose rects do not describe a run of text) have neither
// the same length nor the same geometry, so the search gives up and returns
// the end of the line. Measured on the live vault's "Eppur si muove", the
// paragraph whose fifth wrapped row holds one inline formula:
//
//     x=500 → 606   x=527 → 606   x=620 → 606   x=700 → 606   x=804 → 606
//
// — every click on that row landing on doc position 606, the line's end, while
// the truth (this file's mapping, and the glyphs' own `coordsAtPos`) is
// 552 / 556 / 570 / 581 / 598. That is the owner's report: a click near the
// start of a line "places the caret roughly 25 words in", and the error scales
// with how much rendered math the row carries, because the error IS the
// distance from the click to the end of the line.
//
// The block case of the same bug was fixed once already, for the frontmatter
// card, and the fix stopped at the two READERS of a position — links and hover
// cards — while the caret itself kept going through `posAtCoords`, because
// CodeMirror places it from its own built-in mouse handler and nothing here
// had told it otherwise. `pointerSelection` is that instruction.
//
// The mapping itself asks the DOM, which cannot be wrong about which glyph is
// under a point: `caretPositionFromPoint` (WebKit: `caretRangeFromPoint`) →
// `posAtDOM`. Inside a widget's own DOM that resolves to the widget's start,
// which is exactly what "click the rendered math to edit its source" means.
// `posAtCoords` survives only as the last resort, for points the DOM refuses
// to answer for (outside the content, past the end of the document).
//
// ONE CORRECTION ON TOP OF IT, AND IT IS A BIDI CORRECTION.
// `caretPositionFromPoint` does not answer "which glyph is here"; it answers
// "which INSERTION POINT is nearest", and at a bidi seam those two questions
// have different answers that can be a hundred characters apart. A line whose
// base direction is LTR and whose body is one long Arabic run ends with a
// neutral — a full stop — and the bidi algorithm gives that neutral the
// PARAGRAPH's direction, so it is painted at the visual RIGHT edge of the last
// row: past the Arabic, on top of the leading edge of the row's FIRST logical
// Arabic glyph. Two document positions, 73 characters apart, sharing one x.
// Chromium hands back the later one, so clicking the first glyph of the row
// put the caret at the end of the note's sentence. Measured on the caret
// gate's own Arabic line (`==نص مظلَّل==` … `على الأقل.`): every click in the
// 946–955px band landed on the period.
//
// The fix keeps the file's thesis and sharpens it: the ELEMENT under the
// pointer is the thing that cannot be wrong. `elementFromPoint` names the span
// the reader is looking at; if the insertion point Chromium chose lies outside
// that span's own document range, it belongs to some other run and the nearest
// boundary INSIDE the span is taken instead. On every ordinary click the
// chosen position is already inside the element it was read from, so this
// costs one comparison and changes nothing.

import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  isWidgetTarget,
  mapSequenceAnchor,
  rangeForClick,
  sequenceAnchor,
} from "./selection.ts";

/** Document position under a mouse event, or null when nothing answers. */
export function posFromEvent(event: MouseEvent, view: EditorView): number | null {
  return posFromPoint(event.clientX, event.clientY, view, event.target);
}

// ── The bidi correction ─────────────────────────────────────────────────────

/** How many positions a re-scan will measure before giving up and keeping the
 *  browser's answer. The element under a pointer is a span of a few glyphs;
 *  the cap only exists so a pathological one — a whole line carrying no inner
 *  markup — cannot turn one click into a thousand layout reads. */
const RESCAN_LIMIT = 400;

/** The element the pointer is really over, inside the content. `contentDOM`
 *  itself is not an answer: a click in its padding is over no glyph at all. */
function hitElement(
  view: EditorView,
  x: number,
  y: number,
  target?: EventTarget | null,
): Element | null {
  const node =
    target instanceof Element ? target : view.contentDOM.ownerDocument.elementFromPoint(x, y);
  if (!(node instanceof Element)) return null;
  if (node === view.contentDOM || !view.contentDOM.contains(node)) return null;
  return node;
}

/** The document range an element covers, or null when it does not describe
 *  one. A REPLACING widget's own DOM collapses to a point here (from === to),
 *  which is the signal to leave the browser's answer alone: "click the
 *  rendered math to edit its source" is a widget-start answer by design. */
function rangeOfElement(view: EditorView, el: Element): { from: number; to: number } | null {
  try {
    const a = view.posAtDOM(el, 0);
    const b = view.posAtDOM(el, el.childNodes.length);
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  } catch {
    return null;
  }
}

/** The insertion point in `[from, to]` closest to the click.
 *
 *  A boundary on ANOTHER visual row loses to any boundary on this one whatever
 *  the horizontal distance — rows are ~30px apart and the click's own y has
 *  already said which one it meant — so the vertical miss is weighted far
 *  above the horizontal one rather than added to it. */
function nearestBoundary(
  view: EditorView,
  x: number,
  y: number,
  from: number,
  to: number,
): number | null {
  let best: number | null = null;
  let bestKey = Infinity;
  for (let pos = from; pos <= to; pos++) {
    for (const side of [1, -1] as const) {
      let c: { left: number; top: number; bottom: number } | null = null;
      try {
        c = view.coordsAtPos(pos, side);
      } catch {
        continue;
      }
      if (!c) continue;
      const dy = y < c.top ? c.top - y : y > c.bottom ? y - c.bottom : 0;
      const key = dy * 10000 + Math.abs(c.left - x);
      if (key < bestKey) {
        bestKey = key;
        best = pos;
      }
    }
  }
  return best;
}

/** Keep `pos` when it lies inside the element the pointer is over; otherwise
 *  take the nearest boundary that does. See the bidi note at the top of the
 *  file — this is the whole of that correction. */
function inHitElement(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null | undefined,
  pos: number,
): number {
  const el = hitElement(view, x, y, target);
  if (!el) return pos;
  const span = rangeOfElement(view, el);
  if (!span || span.to <= span.from) return pos;
  if (pos >= span.from && pos <= span.to) return pos;
  if (span.to - span.from > RESCAN_LIMIT) return pos;
  return nearestBoundary(view, x, y, span.from, span.to) ?? pos;
}

/** `posFromEvent` for a bare viewport point. The hover previews ask this of a
 *  remembered pointer position, with no event in hand, when deciding whether
 *  a card that MOVED under a motionless pointer should be dismissed. */
export function posFromPoint(
  x: number,
  y: number,
  view: EditorView,
  target?: EventTarget | null,
): number | null {
  const doc = view.contentDOM.ownerDocument;
  const within = (node: Node | null | undefined): node is Node =>
    node != null && view.contentDOM.contains(node);

  if (typeof doc.caretPositionFromPoint === "function") {
    const caret = doc.caretPositionFromPoint(x, y);
    if (caret && within(caret.offsetNode)) {
      try {
        return inHitElement(view, x, y, target, view.posAtDOM(caret.offsetNode, caret.offset));
      } catch {
        /* fall through */
      }
    }
  }
  // WebKit spells it caretRangeFromPoint.
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range && within(range.startContainer)) {
      try {
        return inHitElement(
          view,
          x,
          y,
          target,
          view.posAtDOM(range.startContainer, range.startOffset),
        );
      } catch {
        /* fall through */
      }
    }
  }
  const node = target instanceof Node ? target : doc.elementFromPoint(x, y);
  if (within(node)) {
    try {
      return view.posAtDOM(node);
    } catch {
      /* fall through */
    }
  }
  return view.posAtCoords({ x, y });
}

/** `posFromPoint` that always answers. A DRAG leaves the content — past the
 *  last line, into the gutter, off the window — and a selection that stops
 *  updating there is a selection that snaps back to where the pointer last
 *  crossed a glyph. `posAtCoords(…, false)` estimates from the height map,
 *  which is the right tool once the DOM has no glyph to offer. */
export function posFromPointOrNearest(
  x: number,
  y: number,
  view: EditorView,
  target?: EventTarget | null,
): number {
  const exact = posFromPoint(x, y, view, target);
  if (exact != null) return exact;
  return view.posAtCoords({ x, y }, false);
}

/** Which side of `pos` the click meant. It only matters at a soft wrap, where
 *  one document position sits at the end of one visual row AND the start of
 *  the next: the two rows are ~30px apart, so the click's own y says which. */
function assocAt(view: EditorView, pos: number, y: number): number {
  let after, before;
  try {
    after = view.coordsAtPos(pos, 1);
    before = view.coordsAtPos(pos, -1);
  } catch {
    return 1;
  }
  if (!after || !before) return 1;
  const dAfter = Math.abs((after.top + after.bottom) / 2 - y);
  const dBefore = Math.abs((before.top + before.bottom) / 2 - y);
  return dBefore + 1 < dAfter ? -1 : 1;
}

function removeRangeAround(
  sel: ReturnType<EditorView["state"]["selection"]["map"]>,
  pos: number,
): typeof sel | null {
  for (let i = 0; i < sel.ranges.length; i++) {
    const { from, to } = sel.ranges[i];
    if (from <= pos && to >= pos) {
      return EditorSelection.create(
        sel.ranges.slice(0, i).concat(sel.ranges.slice(i + 1)),
        sel.mainIndex === i ? 0 : sel.mainIndex - (sel.mainIndex > i ? 1 : 0),
      );
    }
  }
  return null;
}

/** Caret placement and drag-selection resolved through `posFromPoint` instead
 *  of `posAtCoords`. Shift extends, Mod adds or removes a range (this said
 *  "Alt" for as long as it existed, and Alt is `rectangularSelection`'s key —
 *  `get()`'s third argument is CodeMirror's `multiple`, which resolves to
 *  Ctrl on Linux/Windows and Cmd on macOS), double/triple click take
 *  a rendered unit / a word / a paragraph (selection.ts) — the whole of
 *  CodeMirror's `basicMouseSelection` contract, which this replaces rather
 *  than wraps (the facet takes the first style that answers, and the built-in
 *  is only consulted when none does). */
export const pointerSelection: Extension = EditorView.mouseSelectionStyle.of(
  (view, startEvent) => {
    if (startEvent.button !== 0) return null;
    const type = Math.min(startEvent.detail || 1, 3);
    // CLICKS 2 AND 3 MUST NOT BE RE-RESOLVED. Live preview reflows between the
    // clicks of a double-click — click one reveals the cursor line's hidden
    // markdown and everything below it moves — so re-measuring the second
    // mousedown selects a word on a different row. selection.ts remembers what
    // click one resolved; this is where that memory is read and written.
    const anchor = sequenceAnchor(
      startEvent,
      {
        pos: posFromPointOrNearest(
          startEvent.clientX,
          startEvent.clientY,
          view,
          startEvent.target,
        ),
        // Widget DOM resolves to the widget's START, so a unit match there has
        // to go by edges rather than containment.
        widget: isWidgetTarget(startEvent.target, view.contentDOM),
      },
      view.state.doc.length,
    );
    let start = anchor.pos;
    const startWidget = anchor.widget;
    let startAssoc = assocAt(view, start, startEvent.clientY);
    let startSel = view.state.selection;

    return {
      update(update) {
        if (update.docChanged) {
          start = update.changes.mapPos(start);
          startSel = startSel.map(update.changes);
          mapSequenceAnchor((pos) => update.changes.mapPos(pos));
        }
      },
      get(event, extend, multiple) {
        // The initiating mousedown keeps the anchor above; only a later
        // move/up re-measures, which is what makes a drag track the pointer.
        const pos =
          event === startEvent
            ? start
            : posFromPointOrNearest(event.clientX, event.clientY, view, event.target);
        const assoc = event === startEvent ? startAssoc : assocAt(view, pos, event.clientY);
        const widget =
          event === startEvent ? startWidget : isWidgetTarget(event.target, view.contentDOM);
        let range = rangeForClick(view.state, pos, assoc, type, widget);
        if (start !== pos && !extend) {
          const from0 = rangeForClick(view.state, start, startAssoc, type, startWidget);
          const from = Math.min(from0.from, range.from);
          const to = Math.max(from0.to, range.to);
          range =
            from < range.from
              ? EditorSelection.range(from, to, range.assoc)
              : EditorSelection.range(to, from, range.assoc);
        }
        if (extend) {
          return startSel.replaceRange(
            startSel.main.extend(range.from, range.to, range.assoc),
          );
        }
        if (multiple && type === 1 && startSel.ranges.length > 1) {
          const removed = removeRangeAround(startSel, pos);
          if (removed) return removed;
        }
        if (multiple) return startSel.addRange(range);
        return EditorSelection.create([range]);
      },
    };
  },
);
