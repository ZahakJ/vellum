// The editor's half of note direction & alignment.
//
// The reading view and the blog article each get one element from the renderer
// and stamp it (`client/textLayout.ts`). The editor has no such element: its
// prose is a live document whose frontmatter the reader is editing, so the
// same two values have to be re-derived on every change and applied to
// `.cm-content`.
//
// It also answers ONE question for `bidi.ts`: which lines are SOURCE rather
// than sentences. In the editor a table and a code fence are just LINES, and
// a centred — or right-to-left — code fence is not a style choice, it is a
// broken code fence. bidi.ts does the decorating, because it already owns the
// per-line `dir` attribute and must stay the only writer of it: two plugins
// writing one attribute is a coin toss. Nothing here decorates a range, so
// nothing here competes with livePreview.

import { syntaxTree } from "@codemirror/language";
import { StateEffect } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { isTexPath } from "../../shared/noteFormat.ts";
import { isHardWrapped, noteLayout } from "../textLayout.ts";

/** How much of the document is read to find the frontmatter block. It opens on
 *  line 1 in both formats, so this is generous by an order of magnitude and
 *  keeps the per-change cost off the length of the note. */
const FRONTMATTER_SCAN = 4000;

/** Enough source to tell a hand-wrapped vault from a soft-wrapped one — the
 *  same bounded question `isHardWrapped` answers, asked in characters because
 *  that is what a CodeMirror document slices in. */
const HARDWRAP_CHARS = 40000;

/** Markdown nodes whose lines are SOURCE, not sentences. `Table` covers the
 *  pipe grid (a centred — or right-to-left — `|---|---|` stops lining up at
 *  all); the two code nodes cover indented and fenced blocks. Display math
 *  carries its own class from livePreview and is handled in the stylesheet
 *  instead: it is a widget, not a run of lines. */
const SOURCE_NODES = new Set(["FencedCode", "CodeBlock", "Table"]);

/** The SITE default moved while a note was open — the `languageChanged`
 *  pattern one file over, for the same reason: the editor is not a React tree,
 *  so it can only learn about a settings save through a transaction. A rebuild
 *  of the whole EditorState would answer too, and would throw away the undo
 *  history to repaint two attributes. */
export const noteLayoutChanged = StateEffect.define<null>();

/** True when a transaction carries that signal. */
export function layoutSignal(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.effects.some((e) => e.is(noteLayoutChanged)));
}

/** The 1-based line numbers inside those nodes, across the visible ranges.
 *
 *  Exported because `bidi.ts` needs the SAME answer: a pinned direction must
 *  not reach a code fence either, and `const x = 1;` under `dir="rtl"` renders
 *  as `;const x = 1` — the semicolon swept to the far end, in the one place on
 *  screen where punctuation position is the meaning. bidi.ts is the only
 *  writer of the `dir` attribute (two plugins writing one attribute is a coin
 *  toss), so it asks this rather than the other way round, and the walk
 *  happens once per update. */
export function sourceLines(view: EditorView): Set<number> {
  const marked = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (!SOURCE_NODES.has(node.name)) return;
        const first = view.state.doc.lineAt(node.from).number;
        const last = view.state.doc.lineAt(node.to).number;
        for (let n = first; n <= last; n++) marked.add(n);
      },
    });
  }
  return marked;
}

/** Apply the resolved pair to `.cm-content`. The alignment is a data attribute
 *  rather than an inline style for the reason `client/textLayout.ts` gives:
 *  an inline `text-align` is inherited by the code fences and tables the
 *  stylesheet has to carve back out. */
function paint(view: EditorView, texNote: boolean): void {
  const layout = noteLayout(view.state.doc.sliceString(0, FRONTMATTER_SCAN));
  const el = view.contentDOM;
  if (layout.dir === "auto") el.removeAttribute("dir");
  else el.dir = layout.dir;
  if (layout.align === "start") delete el.dataset.noteAlign;
  else el.dataset.noteAlign = layout.align;
  // The same source test the reading view and the blog run, so a hard-wrapped
  // note is set the same way in all three (client/textLayout.ts::isHardWrapped).
  // Only asked when the answer can matter, and it reads a bounded prefix — the
  // whole document is not walked on every keystroke.
  if (
    layout.align === "justify" &&
    isHardWrapped(view.state.doc.sliceString(0, HARDWRAP_CHARS))
  ) {
    el.dataset.noteHardwrap = "";
  } else {
    delete el.dataset.noteHardwrap;
  }
  // A `.tex` note's source is markup end to end; it takes the direction (an
  // Arabic paper is written right to left) but never a centred or justified
  // measure, which would move `\begin{…}` around under the reader's caret.
  if (texNote) el.dataset.noteSource = "tex";
}

/** The extension: one plugin per editor, rebuilt on document and viewport
 *  changes exactly as `bidi.ts` is. */
export function noteLayoutExtension(notePath: string) {
  const texNote = isTexPath(notePath);
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        paint(view, texNote);
      }
      update(update: ViewUpdate): void {
        // The frontmatter is what decides both values, so ANY document change
        // may have moved them — including one made in another tab and pushed
        // in by the SSE reload. A settings save moves the other half of the
        // resolution and arrives as an effect.
        if (update.docChanged || layoutSignal(update)) paint(update.view, texNote);
      }
    },
  );
}


