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
import { countPhrase, getLang, t } from "../i18n.ts";
import { languageChanged } from "./langEffect.ts";

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
  // The chrome language is part of the widget's identity: CM reuses a widget's
  // DOM whenever eq() says it is the same, so a widget that renders t() copy
  // must go unequal when the language flips or a live settings change leaves
  // an Arabic tooltip on an English editor (and vice versa).
  readonly lang = getLang();
  constructor(
    readonly linePos: number, // line.from — stable identity for eq()
    readonly folded: boolean,
  ) {
    super();
  }
  override eq(other: ChevronWidget): boolean {
    return (
      other.linePos === this.linePos &&
      other.folded === this.folded &&
      other.lang === this.lang
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this.folded
      ? "cm-s-foldbtn cm-s-foldbtn--folded"
      : "cm-s-foldbtn";
    btn.title = t(this.folded ? "unfoldSection" : "foldSection");
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
      const langFlip = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(languageChanged)),
      );
      if (langFlip) queueMicrotask(refreshChips);
      if (
        update.docChanged ||
        update.viewportChanged ||
        langFlip ||
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

// A section folded BEFORE a live language flip keeps its widget (CM compares
// the prepared value, which is the line count — deliberately a number, so the
// chip's identity is language-free) and would otherwise keep its old-language
// text forever. Track the live chips and relabel them when the flip arrives.
const liveChips = new Set<HTMLElement>();

function labelChip(el: HTMLElement): void {
  const lines = Number(el.dataset.foldedLines);
  el.textContent = Number.isFinite(lines) ? countPhrase(lines, "foldedLines") : "…";
  el.title = t("unfoldSection");
}

/** Relabel every folded-section chip currently on screen (language flip). */
function refreshChips(): void {
  for (const el of [...liveChips]) {
    if (el.isConnected) labelChip(el);
    else liveChips.delete(el); // the fold was opened / the view was destroyed
  }
}

/** Placeholder shown for a folded section: "N folded lines" chip; click unfolds. */
function placeholder(view: EditorView, onclick: (event: Event) => void, prepared: unknown): HTMLElement {
  const el = document.createElement("span");
  el.className = "cm-s-foldmore";
  if (typeof prepared === "number") el.dataset.foldedLines = String(prepared);
  labelChip(el);
  el.onclick = onclick;
  liveChips.add(el);
  return el;
}

export function headingFolds(): Extension {
  return [
    codeFolding({
      // The prepared value is the LINE COUNT, not the finished label: CM's
      // fold widget compares prepared values for identity, so keeping it
      // language-free means a language flip does not have to rebuild folds —
      // placeholder()/refreshChips() render the label instead.
      preparePlaceholder: (state, range) =>
        state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
      placeholderDOM: placeholder,
    }),
    chevrons,
    keymap.of(foldKeymap),
  ];
}
