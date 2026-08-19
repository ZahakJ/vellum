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
import { spellcheckLang } from "../../shared/script.ts";
import { noteLayout } from "../textLayout.ts";
import { layoutSignal, sourceLines } from "./noteLayout.ts";

/** Frontmatter opens on line 1, so this is the only slice that can decide the
 *  direction — and it keeps the per-change cost off the length of the note. */
const FRONTMATTER_SCAN = 4000;

// ── The line also says which language to SPELLCHECK it in ───────────────────
//
// The browser picks its dictionary from the nearest `lang`, and this file is
// already the one place that decides, per line, what script a line is written
// in. So the same scan answers both questions, and an Arabic paragraph inside
// an English note is spellchecked in Arabic instead of arriving as one long
// red underline. Obsidian spellchecks a note as a single language; a bilingual
// vault is precisely where that fails, and it is the case this product exists
// to get right.
//
// `.cm-content` carries the instance's own language (see setup.ts), so a Latin
// line needs no attribute at all and inherits it — only a line that DISAGREES
// with the document is worth marking, which also keeps the attribute off the
// overwhelming majority of lines.
/** `dir|lang|source` → the one Decoration that spells it. CodeMirror diffs a
 *  range set by decoration IDENTITY, so these are memoized rather than rebuilt
 *  per line per frame — which is what the four module constants here used to
 *  buy before the language made the set open-ended. The map is bounded by the
 *  handful of combinations that can exist (three directions × four languages). */
const lineDecos = new Map<string, Decoration>();

function lineDeco(dir: string, lang: string | null, source: boolean): Decoration {
  const key = `${dir}|${lang ?? ""}|${source ? "s" : ""}`;
  const cached = lineDecos.get(key);
  if (cached) return cached;
  const attributes: Record<string, string> = { dir };
  if (lang !== null) attributes.lang = lang;
  // A code fence is not written in any language, and underlining every
  // identifier in it in red is how a reader learns to turn spellcheck off.
  if (source) attributes.spellcheck = "false";
  const deco = Decoration.line(source ? { attributes, class: "cm-s-noalign" } : { attributes });
  lineDecos.set(key, deco);
  return deco;
}

function buildDecos(view: EditorView): DecorationSet {
  const pinned = noteLayout(view.state.doc.sliceString(0, FRONTMATTER_SCAN)).dir;
  const dir = pinned === "ltr" || pinned === "rtl" ? pinned : "auto";
  const source = sourceLines(view);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      // A SOURCE line keeps `dir="auto"` whatever the note pinned, and carries
      // the class the alignment stylesheet keys off. `const x = 1;` under
      // `dir="rtl"` renders as `;const x = 1` — the semicolon swept to the far
      // end, in the one place on screen where the position of punctuation IS
      // the meaning. Same for a `|---|---|` table rule, which stops lining up
      // with its own header.
      const isSource = source.has(line.number);
      builder.add(
        line.from,
        line.from,
        lineDeco(isSource ? "auto" : dir, isSource ? null : spellcheckLang(line.text), isSource),
      );
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
