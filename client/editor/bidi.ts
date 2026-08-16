// Per-line RTL support. Every visible line gets dir="auto", so the browser
// derives each line's base direction from its first strong character — Arabic
// or Hebrew paragraphs align right while the rest of the note stays LTR.
// EditorView.perLineTextDirection (enabled in setup.ts) makes CodeMirror read
// that computed per-line direction back for cursor movement and selection.

//
// `dir="auto"` is the DEFAULT, not the only answer: `settings.textDirection`
// (and a note's own frontmatter `dir:`) can pin the whole document to ltr or
// rtl — an Arabic notebook whose English quotations should not each swing the
// paragraph around. When one of those is set, the SAME per-line decoration
// carries the pinned value instead of "auto", because a line attribute
// outranks anything on `.cm-content`: two plugins writing one attribute is a
// coin toss, so this file stays the only writer of `dir` in the editor.

import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { noteLayout } from "../textLayout.ts";
import { layoutSignal, sourceLines } from "./noteLayout.ts";

/** Frontmatter opens on line 1, so this is the only slice that can decide the
 *  direction — and it keeps the per-change cost off the length of the note. */
const FRONTMATTER_SCAN = 4000;

const autoDirLine = Decoration.line({ attributes: { dir: "auto" } });
const ltrLine = Decoration.line({ attributes: { dir: "ltr" } });
const rtlLine = Decoration.line({ attributes: { dir: "rtl" } });
// A SOURCE line keeps `dir="auto"` whatever the note pinned, and carries the
// class the alignment stylesheet keys off. `const x = 1;` under `dir="rtl"`
// renders as `;const x = 1` — the semicolon swept to the far end, in the one
// place on screen where the position of punctuation IS the meaning. Same for
// a `|---|---|` table rule, which stops lining up with its own header.
const sourceLine = Decoration.line({ attributes: { dir: "auto" }, class: "cm-s-noalign" });

function buildDecos(view: EditorView): DecorationSet {
  const dir = noteLayout(view.state.doc.sliceString(0, FRONTMATTER_SCAN)).dir;
  const deco = dir === "ltr" ? ltrLine : dir === "rtl" ? rtlLine : autoDirLine;
  const source = sourceLines(view);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      builder.add(line.from, line.from, source.has(line.number) ? sourceLine : deco);
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
      // A settings save moves the SITE default, which is half of what
      // `noteLayout()` resolves — so the pinned direction has to be rebuilt on
      // that signal too, not only on a document or viewport change.
      if (update.docChanged || update.viewportChanged || layoutSignal(update)) {
        this.decorations = buildDecos(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
