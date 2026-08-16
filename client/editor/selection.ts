// WHAT A CLICK SELECTS — the units, not the pointer mapping.
//
// This file is one half of mouse selection; pointer.ts is the other. The split
// is the one the two bugs fell on:
//
//   pointer.ts answers WHICH DOCUMENT POSITION the pointer is over, through
//   the DOM rather than through the height map, with the bidi correction that
//   a mixed-script line needs.
//
//   this file answers WHAT TO SELECT once that position is known — the word
//   under a double click, the paragraph under a triple click — and it is here
//   because CodeMirror's stock answers are wrong in a live-preview editor for
//   two reasons of their own:
//
//  1. LIVE PREVIEW REFLOWS BETWEEN THE TWO CLICKS OF A DOUBLE-CLICK. Click one
//     moves the cursor, the cursor's line becomes "active", its hidden
//     markdown (and, inside a fence, the ``` marker lines above it) comes
//     back, and the paragraph the user is still pointing at has moved. Stock
//     CodeMirror re-resolves the second mousedown against that new layout, so
//     double-click on anything below a fence selected a word two lines away.
//     `sequenceAnchor` below is why clicks 2 and 3 reuse the position click 1
//     resolved, exactly as the user's eye does.
//
//  2. `state.wordAt` does not know what this editor RENDERS. A wikilink, a
//     #tag, an inline `$math$` span or a piece of inline code is one visual
//     object, so double-clicking one should select the whole object rather
//     than one word out of its source.

import {
  CharCategory,
  EditorSelection,
  findClusterBreak,
  type EditorState,
  type Line,
  type SelectionRange,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

// ── The click sequence ──────────────────────────────────────────────────────

/** How long a click stays eligible to become click 2 or 3 of a sequence.
 *  Comfortably above every platform double-click threshold (Windows tops out
 *  at 500ms) — the `detail` counter, not this timer, decides the click type;
 *  the window only guards against reusing a stale position. */
const SEQUENCE_MS = 900;
/** How far the pointer may travel and still count as the same spot. */
const SEQUENCE_SLOP = 8;

/** What one mousedown remembers for the next one. Module-level because
 *  CodeMirror builds a fresh MouseSelectionStyle for every mousedown, so there
 *  is nowhere else for one click to leave a note for the next. */
interface Anchor {
  pos: number;
  /** The pointer was over a REPLACED WIDGET when this position was resolved.
   *
   *  Remembered rather than re-read, and that is the whole point: click one
   *  moves the cursor onto the line, live preview reveals the line's source,
   *  and by click two the widget the reader is still looking at NO LONGER
   *  EXISTS in the DOM. Re-reading it there answers "not a widget" and the
   *  double-click falls back to word boundaries, which on `$E = mc^2$` selects
   *  the lone `$` the pointer happens to sit on. */
  widget: boolean;
}

let lastClick: (Anchor & { x: number; y: number; time: number }) | null = null;

/**
 * The anchor clicks 2 and 3 of a sequence should use: the one click 1
 * resolved, when this event continues that sequence, and `fresh` otherwise.
 * Always records, so the next click in the sequence can find it.
 */
export function sequenceAnchor(event: MouseEvent, fresh: Anchor, docLength: number): Anchor {
  const now = Date.now();
  const continues =
    event.detail > 1 &&
    lastClick != null &&
    now - lastClick.time < SEQUENCE_MS &&
    Math.abs(event.clientX - lastClick.x) <= SEQUENCE_SLOP &&
    Math.abs(event.clientY - lastClick.y) <= SEQUENCE_SLOP &&
    lastClick.pos <= docLength;
  const anchor: Anchor =
    continues && lastClick ? { pos: lastClick.pos, widget: lastClick.widget } : fresh;
  lastClick = { ...anchor, x: event.clientX, y: event.clientY, time: now };
  return anchor;
}

/** Keep the remembered anchor pointing at the same text after an edit. */
export function mapSequenceAnchor(map: (pos: number) => number): void {
  if (lastClick) lastClick.pos = map(lastClick.pos);
}

/** The pointer was inside a rendered widget rather than on editable text.
 *  CodeMirror marks every widget's DOM `contenteditable="false"`, and a
 *  position resolved from inside one is the widget's START, not somewhere in
 *  the middle of its source — so a double-click on the KaTeX rendering of
 *  `$E = mc^2$` must match that span by its edge, not by containment. */
export function isWidgetTarget(target: EventTarget | null, content: Element): boolean {
  return (
    target instanceof Element &&
    content.contains(target) &&
    target.closest('[contenteditable="false"]') != null
  );
}

// ── Word boundaries ─────────────────────────────────────────────────────────

/** Apostrophes that live INSIDE a word rather than between two: "don't",
 *  "l'école", Arabic/Hebrew transliteration. Only joins when a word character
 *  sits on both sides, so a quoted 'word' still selects without its quotes. */
const CONNECTOR = /^['’ʼ׳‐]$/;

/** Characters that belong to an identifier in code but not in prose. `$`
 *  covers jQuery/shell/Perl/PHP names and template literals; `-` covers Lisp
 *  and CSS custom properties. */
const CODE_WORD = /^[$-]$/;

/** True when `pos` sits inside a fenced or indented code block. Word
 *  boundaries there follow the identifier, not the sentence. */
export function inCode(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    const { name } = node;
    if (name === "FencedCode" || name === "CodeBlock" || name === "CodeText") {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/** CodeMirror's `groupAt` with Vellum's extras. Grapheme-cluster stepping is
 *  what makes this correct for Arabic (a letter plus its harakat is one
 *  cluster), Persian (ZWNJ is Extend, so it stays inside the word), Devanagari
 *  matras and emoji — the same reason CodeMirror does it that way. */
export function wordAt(state: EditorState, line: Line, pos: number): SelectionRange {
  if (line.length === 0) return EditorSelection.cursor(pos);
  const text = line.text;
  const code = inCode(state, pos);
  const categorize = state.charCategorizer(pos);
  const isWord = (chunk: string): boolean => {
    if (categorize(chunk) === CharCategory.Word) return true;
    return code && CODE_WORD.test(chunk);
  };

  let at = pos - line.from;
  if (at >= line.length) at = line.length;
  // Land on a character: at the very start of a line look right, otherwise
  // prefer the cluster the pointer is sitting on.
  let from = at;
  let to = at;
  if (at === line.length) from = findClusterBreak(text, at, false);
  else to = findClusterBreak(text, at, true);
  const seed = text.slice(from, to);
  const wordSeed = isWord(seed);
  // A double-click that lands on punctuation or space keeps CodeMirror's
  // behavior: select the run of like characters.
  const same = (chunk: string): boolean =>
    wordSeed ? isWord(chunk) : categorize(chunk) === categorize(seed);

  while (from > 0) {
    const prev = findClusterBreak(text, from, false);
    const chunk = text.slice(prev, from);
    if (same(chunk)) {
      from = prev;
      continue;
    }
    // "don't": step over the apostrophe only if a word character follows it
    // on the far side.
    if (wordSeed && CONNECTOR.test(chunk) && prev > 0) {
      const before = findClusterBreak(text, prev, false);
      if (isWord(text.slice(before, prev))) {
        from = before;
        continue;
      }
    }
    break;
  }
  while (to < line.length) {
    const next = findClusterBreak(text, to, true);
    const chunk = text.slice(to, next);
    if (same(chunk)) {
      to = next;
      continue;
    }
    if (wordSeed && CONNECTOR.test(chunk) && next < line.length) {
      const after = findClusterBreak(text, next, true);
      if (isWord(text.slice(next, after))) {
        to = after;
        continue;
      }
    }
    break;
  }
  return EditorSelection.range(from + line.from, to + line.from);
}

// ── Rendered units ──────────────────────────────────────────────────────────

/** One inline object as the reader sees it. Every pattern is the same one the
 *  live-preview decorators use, so what gets selected is exactly what got
 *  rendered. Ordered widest-first is unnecessary: the smallest span that
 *  strictly contains the pointer wins. */
const UNIT_RES: RegExp[] = [
  /!?\[\[[^[\]]+?\]\]/g, // wikilink and note/image embed
  /(?:^|[\s([{])(#[\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu, // #tag (group 1)
  /\$\$[^$\n]+?\$\$/g, // display math flowing inline
  /\$[^$\n]+?\$/g, // inline math
  /`[^`\n]+?`/g, // inline code
  /\[\^[^\]\s]+\]/g, // footnote reference
];

/** The rendered object containing `pos`, if any. `edges` is for a pointer that
 *  landed inside a replaced widget, where the resolved position is the span's
 *  own start rather than a point in the middle of its source. */
export function unitAt(
  line: Line,
  pos: number,
  edges = false,
): { from: number; to: number } | null {
  const text = line.text;
  const at = pos - line.from;
  let best: { from: number; to: number } | null = null;
  for (const re of UNIT_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      // Tag patterns capture the tag itself past a leading separator.
      const body = m[1] ?? m[0];
      const start = m.index + m[0].indexOf(body);
      const end = start + body.length;
      const inside = edges ? at >= start && at <= end : at > start && at < end;
      if (!inside) continue;
      if (!best || end - start < best.to - best.from) {
        best = { from: line.from + start, to: line.from + end };
      }
    }
  }
  return best;
}

// ── Click ranges ────────────────────────────────────────────────────────────

/**
 * Single click → caret, double → the rendered unit or the word, triple → the
 * paragraph. `widget` says the pointer was inside replaced widget DOM, which
 * changes unit matching from containment to edges (see `isWidgetTarget`).
 */
export function rangeForClick(
  state: EditorState,
  pos: number,
  assoc: number,
  type: number,
  widget = false,
): SelectionRange {
  if (type === 1) return EditorSelection.cursor(pos, assoc);
  const line = state.doc.lineAt(pos);
  if (type === 2) {
    // Inside code the markdown units do not exist — `$x$` is a shell variable
    // there, not math — so identifier boundaries are the only sensible answer.
    const unit = inCode(state, pos) ? null : unitAt(line, pos, widget);
    if (unit) return EditorSelection.range(unit.from, unit.to);
    return wordAt(state, line, pos);
  }
  // Triple click: the paragraph, i.e. the whole logical line plus the newline
  // that ends it (matching CodeMirror, so a triple-click-then-type replaces
  // the paragraph rather than leaving an empty line behind).
  const to = line.to < state.doc.length ? line.to + 1 : line.to;
  return EditorSelection.undirectionalRange(line.from, to);
}
