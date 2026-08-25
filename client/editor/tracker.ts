// TRACKERS IN LIVE PREVIEW — the block widget, and the one interactive thing
// the reading renderer will ever be asked to draw.
//
// The reveal-on-caret rule, unchanged from callouts, $$ math and tables: caret
// outside the fence → the whole block (markers included) is ONE block widget
// carrying the rendered card; caret inside → the source, styled as the code
// block it is, so the fields can be edited. Nothing here re-implements the
// card: toDOM calls the READING renderer (tables.ts:125-162 precedent), which
// is what keeps the card in the editor identical to the card on the blog.
//
// THE STEPPER IS A DOCUMENT EDIT. The − / + buttons dispatch one change over
// the fence body — `setTrackerProgress`, a pure text transform — and nothing
// else: one dispatch, one undo step, exactly like toggleTask
// (livePreview.ts:655-662). Widget-local state would be wrong twice over,
// because the StateField rebuilds these decorations on every doc change and
// selection move, and because the document is the only place a reader's
// progress may live.
//
// It is admin-only. A visitor reading a published shelf has no write path at
// all (PUT /api/note is 401 for them), so offering buttons that cannot work
// would be furniture that lies.

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";
import { parseTracker, setTrackerProgress, trackerFenceKind } from "../../shared/tracker.ts";
import { renderTrackerFence } from "../reading/render.ts";
import { useStore } from "../state.ts";

/** Where a tracker fence's parts sit in the document. `bodyFrom`/`bodyTo`
 *  bracket the lines BETWEEN the markers — the range the stepper rewrites. */
interface FenceSpan {
  kind: "tracker" | "tracker-board";
  from: number; // start of the opening ``` line
  to: number; // end of the closing line (or of the block, unterminated)
  bodyFrom: number;
  bodyTo: number;
}

/** Read a fenced block's shape, or null when it is not a tracker fence. */
export function trackerFenceSpan(
  state: EditorState,
  firstLine: number,
  lastLine: number,
): FenceSpan | null {
  const doc = state.doc;
  const open = doc.line(firstLine);
  const kind = trackerFenceKind(open.text);
  if (kind === null) return null;
  const close = doc.line(lastLine);
  // An unterminated fence (the author is still typing it) has no closing line
  // to exclude — its body runs to the end of the block.
  const closed = lastLine > firstLine && /^\s*(```|~~~)\s*$/.test(close.text);
  const bodyFrom = lastLine > firstLine ? doc.line(firstLine + 1).from : open.to;
  const bodyLast = closed ? lastLine - 1 : lastLine;
  const bodyTo = bodyLast > firstLine ? doc.line(bodyLast).to : bodyFrom;
  return { kind, from: open.from, to: close.to, bodyFrom, bodyTo };
}

class TrackerWidget extends WidgetType {
  constructor(
    readonly kind: "tracker" | "tracker-board",
    readonly src: string,
    readonly notePath: string,
    /** Doc offsets of the body, refreshed on every build — the stepper reads
     *  them at CLICK time from the widget it is mounted in, and a widget that
     *  merely slid down a line is still the same widget (see eq). */
    readonly bodyFrom: number,
    readonly bodyTo: number,
    readonly admin: boolean,
  ) {
    super();
  }

  override eq(other: TrackerWidget): boolean {
    // Positions are deliberately NOT compared, for TableWidget's reason: a
    // card that moved down a line has not changed, and comparing offsets
    // would rebuild every tracker's DOM (and re-run its bar animation) on
    // every keystroke above it.
    return (
      other.kind === this.kind &&
      other.src === this.src &&
      other.notePath === this.notePath &&
      other.admin === this.admin
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-s-tracker";
    const step =
      this.admin && this.kind === "tracker"
        ? (delta: number): void => {
            const body = view.state.doc.sliceString(this.bodyFrom, this.bodyTo);
            const next = setTrackerProgress(body, delta);
            if (next === body) return;
            view.dispatch({
              changes: { from: this.bodyFrom, to: this.bodyTo, insert: next },
              userEvent: "input.tracker",
            });
          }
        : undefined;
    const card = renderTrackerFence(
      this.kind,
      this.src,
      { notePath: this.notePath, tree: useStore.getState().tree },
      {
        onStep: step,
        // A COVER AND A BOARD BOTH ARRIVE LATE, and CodeMirror recorded this
        // widget's height when it was mounted — before either. Without this
        // every document position below the card is off by the difference:
        // the caret lands lines away from the pointer and hover previews open
        // on the wrong link (livePreview.ts:971-988, widgets.ts:70).
        onResize: () => view.requestMeasure(),
      },
    );
    if (card) wrap.appendChild(card);
    return wrap;
  }

  override ignoreEvent(event: Event): boolean {
    // The stepper's own clicks must reach it; everything else falls through to
    // the editor so clicking the card puts the caret near it.
    return event.type === "mousedown" || event.type === "click";
  }
}

/** The block decoration for a tracker fence, or null when the body parses to
 *  nothing — in which case the caller keeps the ordinary marker-hiding path
 *  and the block reads as its own source (the $$-math rule). */
export function trackerBlockDeco(
  state: EditorState,
  span: FenceSpan,
  notePath: string,
): Range<Decoration> | null {
  const src = state.doc.sliceString(span.bodyFrom, span.bodyTo);
  // A board always draws (an empty shelf is an invitation, not a failure); a
  // card draws only when its body says something — an unparseable one stays
  // source, which is the rule an unparseable $$ block already follows.
  if (span.kind === "tracker" && parseTracker(src) === null) return null;
  const widget = new TrackerWidget(
    span.kind,
    src,
    notePath,
    span.bodyFrom,
    span.bodyTo,
    useStore.getState().admin,
  );
  return Decoration.replace({ widget, block: true }).range(span.from, span.to);
}
