// The LaTeX language for the editor: CodeMirror's `stex` stream mode, plus the
// two fold services a `.tex` note wants — one for `\begin{…}…\end{…}`, one for
// the `\section` hierarchy.
//
// The mode is loaded from `@codemirror/legacy-modes`, which is a real
// dependency here rather than a transitive one: importing it directly is what
// lets the editor come up with LaTeX highlighting on the FIRST paint instead of
// swapping it in a compartment a network round-trip later.

import {
  HighlightStyle,
  StreamLanguage,
  codeFolding,
  foldEffect,
  foldKeymap,
  foldService,
  foldable,
  foldedRanges,
  syntaxHighlighting,
  unfoldEffect,
} from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags as t } from "@lezer/highlight";
import { countPhrase, getLang, t as tr } from "../../i18n.ts";
import { languageChanged } from "../langEffect.ts";

/** The stex stream mode, wrapped as a CodeMirror 6 language. */
export const texLanguage = StreamLanguage.define(stex);

/** Sectioning commands, deepest number = deepest level. Mirrors the reader in
 *  shared/tex.ts, so the outline, the reading view and the editor's folding
 *  all agree about what a section IS. */
const SECTION_LEVEL: Record<string, number> = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4,
  paragraph: 5, subparagraph: 6,
};

const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[{[]/;

export function sectionLevelOf(lineText: string): number | null {
  const m = SECTION_RE.exec(lineText);
  return m ? SECTION_LEVEL[m[1]] : null;
}

const BEGIN_RE = /^\s*\\begin\s*\{([^}]*)\}/;
const END_RE = /^\s*\\end\s*\{([^}]*)\}/;

/** Fold a `\begin{env}` down to its matching `\end{env}`, honoring nesting.
 *  Returns null for an unclosed environment: a fold that swallowed the rest of
 *  the document because a `\end` was mistyped would look exactly like data
 *  loss. */
function environmentFold(state: EditorState, lineStart: number, lineEnd: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const open = BEGIN_RE.exec(line.text);
  if (!open) return null;
  const env = open[1];
  let depth = 0;
  for (let n = line.number; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text;
    const b = BEGIN_RE.exec(text);
    if (b && b[1] === env) {
      depth++;
      continue;
    }
    const e = END_RE.exec(text);
    if (e && e[1] === env) {
      depth--;
      if (depth === 0) {
        const close = state.doc.line(n);
        return n === line.number ? null : { from: lineEnd, to: close.to };
      }
    }
  }
  return null;
}

/** Fold a section down to the next heading at the same or a shallower level —
 *  the same span the markdown heading fold covers, so `Ctrl/Cmd` folding feels
 *  identical in both formats. */
function sectionFold(state: EditorState, lineStart: number, lineEnd: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const level = sectionLevelOf(line.text);
  if (level === null) return null;
  let end = state.doc.length;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text;
    const next = sectionLevelOf(text);
    if ((next !== null && next <= level) || /^\s*\\end\s*\{document\}/.test(text)) {
      end = state.doc.line(n - 1).to;
      break;
    }
  }
  return end > lineEnd ? { from: lineEnd, to: end } : null;
}

/** Both fold services. Environments are offered first: a `\begin{figure}` that
 *  happens to sit on a `\section` line is still a figure. */
export const texFolding: Extension = [
  foldService.of(environmentFold),
  foldService.of(sectionFold),
];

/** Highlighting for the LaTeX tags the stex mode emits, on top of the shared
 *  code-fence palette in editor/theme.ts. Every colour is a `--syn-*` token, so
 *  a `.tex` note follows every theme for free — and the contrast gate,
 *  which walks tokens.css, keeps covering it. */
export function texHighlighting(): Extension {
  return syntaxHighlighting(
    HighlightStyle.define([
      // Control sequences: the structural ink of a LaTeX file.
      { tag: [t.tagName, t.keyword, t.controlKeyword], color: "var(--syn-keyword)" },
      // Environment names and \begin/\end arguments.
      { tag: [t.typeName, t.className, t.namespace], color: "var(--syn-type)" },
      // Braces and other delimiters stay quiet — they are scaffolding.
      { tag: [t.bracket, t.brace, t.punctuation], color: "var(--text-faint)" },
      { tag: [t.comment, t.lineComment], color: "var(--syn-comment)", fontStyle: "italic" },
      { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
      { tag: [t.number, t.atom], color: "var(--syn-number)" },
      { tag: [t.labelName, t.propertyName, t.attributeName], color: "var(--syn-prop)" },
      { tag: [t.emphasis], fontStyle: "italic" },
      { tag: [t.strong], fontWeight: "700" },
      { tag: [t.link, t.url], color: "var(--accent)" },
      { tag: [t.escape, t.operator], color: "var(--syn-operator)" },
    ]),
  );
}

// ── Fold UI ─────────────────────────────────────────────────────────────────
// The same affordance markdown headings get (editor/folding.ts): a chevron in
// the line's left padding, VISIBLE at rest — DESIGN.md's rule, and there is no
// hover on a phone — plus a gold "N folded lines" chip in place of the folded
// body. It lives here rather than being shared because the two formats fold
// different things: a `.tex` note folds environments as well as sections.

/** The folded range that starts at the end of this line, if any. */
function foldedAt(view: EditorView, lineTo: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(view.state).between(lineTo, lineTo, (from, to) => {
    if (from === lineTo) {
      found = { from, to };
      return false;
    }
    return undefined;
  });
  return found;
}

class TexChevron extends WidgetType {
  // The chrome language is part of the widget's identity: CM reuses widget DOM
  // whenever eq() says it is the same, so a tooltip written by t() must go
  // unequal when the instance language flips.
  readonly lang = getLang();
  constructor(
    readonly linePos: number,
    readonly folded: boolean,
  ) {
    super();
  }
  override eq(other: TexChevron): boolean {
    return (
      other.linePos === this.linePos &&
      other.folded === this.folded &&
      other.lang === this.lang
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this.folded ? "cm-s-foldbtn cm-s-foldbtn--folded" : "cm-s-foldbtn";
    btn.title = tr(this.folded ? "unfoldSection" : "foldSection");
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    btn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const line = view.state.doc.lineAt(Math.min(this.linePos, view.state.doc.length));
      const already = foldedAt(view, line.to);
      if (already) {
        view.dispatch({ effects: unfoldEffect.of(already) });
        return;
      }
      const range = foldable(view.state, line.from, line.to);
      if (range) view.dispatch({ effects: foldEffect.of(range) });
    });
    return btn;
  }
}

const FOLDABLE_LINE_RE = /^\s*\\(?:begin\s*\{|part|chapter|section|subsection|subsubsection|paragraph|subparagraph)/;

function buildChevrons(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (seen.has(line.from)) continue;
      seen.add(line.from);
      if (!FOLDABLE_LINE_RE.test(line.text)) continue;
      const folded = foldedAt(view, line.to) !== null;
      if (!folded && !foldable(view.state, line.from, line.to)) continue;
      decos.push(
        Decoration.widget({ widget: new TexChevron(line.from, folded), side: -1 }).range(line.from),
      );
    }
  }
  return Decoration.set(decos);
}

const texChevrons = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildChevrons(view);
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect) || e.is(languageChanged)),
        )
      ) {
        this.decorations = buildChevrons(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Placeholder for a folded environment or section: the same gold chip the
 *  markdown editor uses, so folding reads the same in both formats. */
function placeholderDOM(_view: EditorView, onclick: (event: Event) => void, prepared: unknown): HTMLElement {
  const el = document.createElement("span");
  el.className = "cm-s-foldmore";
  // The comparison is hoisted out of the assignment on purpose: the i18n gate
  // reads every string literal in a `textContent =` STATEMENT, and a `typeof`
  // check parked in the ternary reads to it as untranslated English copy.
  const lines = typeof prepared === "number" ? prepared : null;
  el.textContent = lines === null ? "…" : countPhrase(lines, "foldedLines");
  el.title = tr("unfoldSection");
  el.onclick = onclick;
  return el;
}

/** Folding, complete: the two services, the chevrons and the keymap. */
export const texFolds: Extension = [
  texFolding,
  codeFolding({
    preparePlaceholder: (state, range) =>
      state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
    placeholderDOM,
  }),
  texChevrons,
  keymap.of(foldKeymap),
];
