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

import { EditorSelection, type Extension, type SelectionRange } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Document position under a mouse event, or null when nothing answers. */
export function posFromEvent(event: MouseEvent, view: EditorView): number | null {
  return posFromPoint(event.clientX, event.clientY, view, event.target);
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
        return view.posAtDOM(caret.offsetNode, caret.offset);
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
        return view.posAtDOM(range.startContainer, range.startOffset);
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

/** Single click → caret, double → word, triple → line. Mirrors CodeMirror's
 *  own `rangeForClick`, over a position this file resolved. */
function rangeForClick(
  view: EditorView,
  pos: number,
  assoc: number,
  type: number,
): SelectionRange {
  if (type === 1) return EditorSelection.cursor(pos, assoc);
  if (type === 2) {
    return view.state.wordAt(pos) ?? EditorSelection.cursor(pos, assoc);
  }
  const line = view.state.doc.lineAt(pos);
  const to = line.to < view.state.doc.length ? line.to + 1 : line.to;
  return EditorSelection.range(line.from, to);
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
 *  of `posAtCoords`. Shift extends, Alt adds a range, double/triple click take
 *  a word / a line — the whole of CodeMirror's `basicMouseSelection` contract,
 *  which this replaces rather than wraps (the facet takes the first style that
 *  answers, and the built-in is only consulted when none does). */
export const pointerSelection: Extension = EditorView.mouseSelectionStyle.of(
  (view, startEvent) => {
    if (startEvent.button !== 0) return null;
    const type = startEvent.detail || 1;
    let start = posFromPointOrNearest(
      startEvent.clientX,
      startEvent.clientY,
      view,
      startEvent.target,
    );
    let startAssoc = assocAt(view, start, startEvent.clientY);
    let startSel = view.state.selection;

    return {
      update(update) {
        if (update.docChanged) {
          start = update.changes.mapPos(start);
          startSel = startSel.map(update.changes);
        }
      },
      get(event, extend, multiple) {
        const pos = posFromPointOrNearest(
          event.clientX,
          event.clientY,
          view,
          event.target,
        );
        const assoc = assocAt(view, pos, event.clientY);
        let range = rangeForClick(view, pos, assoc, type);
        if (start !== pos && !extend) {
          const from0 = rangeForClick(view, start, startAssoc, type);
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
