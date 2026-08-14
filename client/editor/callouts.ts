// Obsidian callouts in live preview: `> [!type] Title` blockquotes render as
// tinted, iconed blocks; `[!type]-` starts folded and the title bar toggles.
//
// Split of responsibilities (block decorations must come from a StateField):
//   - findCallouts()      — detection against the syntax tree + doc text
//   - calloutLineDecos()  — line classes + title-bar widget (ViewPlugin side)
//   - calloutFoldDecos()  — hides folded bodies (StateField side)
//   - calloutFoldField    — explicit user fold overrides, position-mapped

import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

// ── Types + detection ───────────────────────────────────────────────────────
// (pure definitions live in calloutDefs.ts so the reading view can use them
// without the CodeMirror bundle; re-exported here for existing imports)

import {
  CALLOUT_TITLE_RE as TITLE_RE,
  calloutGroup,
  calloutIconSvg,
} from "./calloutDefs.ts";
export { TITLE_RE as CALLOUT_TITLE_RE, calloutGroup, calloutIconSvg };

export interface Callout {
  from: number; // blockquote start
  to: number; // blockquote end
  type: string; // raw type text as typed
  group: string; // color/icon group
  marker: "" | "+" | "-";
  title: string; // explicit title or capitalized type
  titleLineFrom: number;
  titleLineTo: number;
  /** Start of "[!type]..." — just past the "> " marker, so the title widget
   *  never shares a start position with the QuoteMark hide decoration. */
  contentFrom: number;
}

/** Find top-level callout blockquotes intersecting [from, to] (whole doc when
 *  omitted). Nested blockquotes keep default quote styling. */
export function findCallouts(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): Callout[] {
  const out: Callout[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "Blockquote") return undefined;
      const line = state.doc.lineAt(node.from);
      const m = TITLE_RE.exec(line.text);
      if (!m) return false; // plain quote; skip nested blockquotes too
      const type = m[2].toLowerCase();
      const group = calloutGroup(type);
      out.push({
        from: node.from,
        to: node.to,
        type,
        group,
        marker: (m[3] as Callout["marker"]) ?? "",
        title: m[4].trim() || m[2][0].toUpperCase() + type.slice(1),
        titleLineFrom: line.from,
        titleLineTo: line.to,
        contentFrom: line.from + m[1].length,
      });
      return false;
    },
  });
  return out;
}

// ── Fold state (explicit user toggles, keyed by title-line start) ───────────

export const setCalloutFold = StateEffect.define<{ pos: number; open: boolean }>({
  map: (value, mapping) => ({ pos: mapping.mapPos(value.pos), open: value.open }),
});

export const calloutFoldField = StateField.define<Map<number, boolean>>({
  create: () => new Map(),
  update(map, tr) {
    let next = map;
    if (tr.docChanged) {
      next = new Map();
      for (const [pos, open] of map) next.set(tr.changes.mapPos(pos), open);
    }
    for (const effect of tr.effects) {
      if (effect.is(setCalloutFold)) {
        if (next === map) next = new Map(map);
        next.set(effect.value.pos, effect.value.open);
      }
    }
    return next;
  },
});

export function calloutIsOpen(state: EditorState, callout: Callout): boolean {
  const override = state.field(calloutFoldField, false)?.get(callout.titleLineFrom);
  return override ?? callout.marker !== "-";
}

// ── Title-bar widget ────────────────────────────────────────────────────────

class CalloutTitleWidget extends WidgetType {
  constructor(
    readonly group: string,
    readonly title: string,
    readonly foldable: boolean,
    readonly open: boolean,
    readonly pos: number, // title line start (fold key)
  ) {
    super();
  }
  override eq(other: CalloutTitleWidget): boolean {
    return (
      other.group === this.group &&
      other.title === this.title &&
      other.foldable === this.foldable &&
      other.open === this.open &&
      other.pos === this.pos
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement("span");
    bar.className = `cm-s-callout__title cm-s-callout--${this.group}`;
    const icon = document.createElement("span");
    icon.className = "cm-s-callout__icon";
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${calloutIconSvg(this.group)}</svg>`;
    const text = document.createElement("span");
    text.className = "cm-s-callout__text";
    text.textContent = this.title;
    bar.append(icon, text);
    if (this.foldable) {
      const chevron = document.createElement("span");
      chevron.className = `cm-s-callout__chevron${this.open ? " cm-s-callout__chevron--open" : ""}`;
      chevron.innerHTML =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
      bar.appendChild(chevron);
      bar.classList.add("cm-s-callout__title--foldable");
      const pos = this.pos;
      const open = this.open;
      bar.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // Deferred: dispatching mid-mousedown while this widget's DOM is being
        // torn down confuses the view's pointer handling.
        window.setTimeout(() => {
          view.dispatch({ effects: setCalloutFold.of({ pos, open: !open }) });
        }, 0);
      });
    }
    return bar;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

// ── Decoration contributions ────────────────────────────────────────────────

/** Line classes + title widget for callouts in [from, to]. `activeLines` are
 *  1-based line numbers touched by the selection (raw syntax stays visible on
 *  those). Returns callout title-line ranges so other scans skip them. */
export function calloutLineDecos(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  activeLines: Set<number>,
  decos: Range<Decoration>[],
): { from: number; to: number }[] {
  const doc = state.doc;
  const claimed: { from: number; to: number }[] = [];
  // Collect once across all visible ranges, deduped by position — a folded
  // callout splits the visible ranges, so a per-range scan would find it
  // twice and emit duplicate widget decorations.
  const seen = new Set<number>();
  const callouts: Callout[] = [];
  for (const { from, to } of ranges) {
    for (const c of findCallouts(state, from, to)) {
      if (!seen.has(c.from)) {
        seen.add(c.from);
        callouts.push(c);
      }
    }
  }
  for (const callout of callouts) {
    const open = calloutIsOpen(state, callout);
    const firstLine = doc.lineAt(callout.from).number;
    const lastLine = doc.lineAt(callout.to).number;
    for (let n = firstLine; n <= lastLine; n++) {
      const cls = [
        "cm-s-callout",
        `cm-s-callout--${callout.group}`,
        n === firstLine ? "cm-s-callout--first" : "",
        n === lastLine || (!open && n === firstLine) ? "cm-s-callout--last" : "",
      ]
        .filter(Boolean)
        .join(" ");
      decos.push(Decoration.line({ class: cls }).range(doc.line(n).from));
      if (!open && n === firstLine) break; // folded: body lines are hidden
    }
    const titleActive = activeLines.has(firstLine);
    if (!titleActive) {
      decos.push(
        Decoration.replace({
          widget: new CalloutTitleWidget(
            callout.group,
            callout.title,
            callout.marker !== "",
            open,
            callout.titleLineFrom,
          ),
        }).range(callout.contentFrom, callout.titleLineTo),
      );
      claimed.push({ from: callout.titleLineFrom, to: callout.titleLineTo });
    }
  }
  return claimed;
}

/** Inline (fold-style) replace decorations hiding the bodies of folded
 *  callouts. Cross-line replaces must come from a StateField, so this is
 *  called from the block-decoration builder, not the ViewPlugin. */
export function calloutFoldDecos(
  state: EditorState,
  decos: Range<Decoration>[],
): void {
  for (const callout of findCallouts(state)) {
    if (calloutIsOpen(state, callout)) continue;
    if (callout.titleLineTo >= callout.to) continue; // title-only callout
    decos.push(
      Decoration.replace({}).range(callout.titleLineTo, callout.to),
    );
  }
}
