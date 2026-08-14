// Per-line RTL support. Every visible line gets dir="auto", so the browser
// derives each line's base direction from its first strong character — Arabic
// or Hebrew paragraphs align right while the rest of the note stays LTR.
// EditorView.perLineTextDirection (enabled in setup.ts) makes CodeMirror read
// that computed per-line direction back for cursor movement and selection.

import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";

const autoDirLine = Decoration.line({ attributes: { dir: "auto" } });

function buildDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      builder.add(line.from, line.from, autoDirLine);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const autoLineDirection = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecos(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecos(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
