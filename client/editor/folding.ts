// Heading folding. @codemirror/lang-markdown already registers a foldService
// for heading sections; this module adds the UI: a chevron floating in the
// left padding of every heading line (visible on hover, always visible while
// folded) that folds/unfolds the section, plus a gold "N lines ⌄" placeholder.
// The gutter would sit at the viewport edge — far from the centered 760px
// column — so the chevron rides the heading line itself, Obsidian-style.

import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  codeFolding,
  foldEffect,
  foldKeymap,
  foldable,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import { keymap } from "@codemirror/view";

const HEADING_LINE_RE = /^\s{0,3}#{1,6}\s/;

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

class ChevronWidget extends WidgetType {
  constructor(
    readonly linePos: number, // line.from — stable identity for eq()
    readonly folded: boolean,
  ) {
    super();
  }
  override eq(other: ChevronWidget): boolean {
    return other.linePos === this.linePos && other.folded === this.folded;
  }
  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this.folded
      ? "cm-s-foldbtn cm-s-foldbtn--folded"
      : "cm-s-foldbtn";
    btn.title = this.folded ? "Unfold section" : "Fold section";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    btn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const line = view.state.doc.lineAt(
        Math.min(this.linePos, view.state.doc.length),
      );
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
  // default ignoreEvent() → true: the button's own listener handles clicks
}

function buildChevrons(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (seen.has(line.from)) continue;
      seen.add(line.from);
      if (!HEADING_LINE_RE.test(line.text)) continue;
      const folded = foldedAt(view, line.to) !== null;
      if (!folded && !foldable(view.state, line.from, line.to)) continue;
      decos.push(
        Decoration.widget({
          widget: new ChevronWidget(line.from, folded),
          side: -1,
        }).range(line.from),
      );
    }
  }
  return Decoration.set(decos);
}

const chevrons = ViewPlugin.fromClass(
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
          tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
        )
      ) {
        this.decorations = buildChevrons(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Placeholder shown for a folded section: "N lines" chip; click unfolds. */
function placeholder(view: EditorView, onclick: (event: Event) => void, prepared: unknown): HTMLElement {
  const el = document.createElement("span");
  el.className = "cm-s-foldmore";
  el.textContent = typeof prepared === "string" ? prepared : "…";
  el.title = "Unfold section";
  el.onclick = onclick;
  return el;
}

export function headingFolds(): Extension {
  return [
    codeFolding({
      preparePlaceholder: (state, range) => {
        const lines =
          state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number;
        return `${lines} folded line${lines === 1 ? "" : "s"}`;
      },
      placeholderDOM: placeholder,
    }),
    chevrons,
    keymap.of(foldKeymap),
  ];
}
