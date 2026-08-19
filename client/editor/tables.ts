// GFM tables in live preview, on the editor's reveal-on-caret rule: caret
// outside a table block → the block is one rendered <table> widget; caret
// inside → the pipe source, line-marked so the columns can be read while
// they are being edited. The same rule callouts and $$ math already follow
// (callouts.ts, math.ts), because three block elements with two reveal
// behaviours would be two too many.
//
// The widget does not render cells itself: it hands the block's source to
// the reading renderer (reading/render.ts), which is what the reading view,
// the blog and the editor's own transclusion widget already draw tables
// with — alignment colons, `\|` escapes, per-table `dir="auto"` and the
// theme included. One renderer, four surfaces, zero drift.
//
// The editing verbs (Tab/Enter cell walking, Alt+arrow row/column moves,
// prettify-on-exit) live on a Prec.high keymap that answers ONLY when the
// caret sits in a top-level Table node — everywhere else every key falls
// through untouched, so the gate that guards "Tab indents" keeps holding
// outside tables. The string logic itself is in tableModel.ts (pure, node
// --test-loadable); this file is the CodeMirror skin over it.
//
// Tables nested in blockquotes/callouts or lists stay source in the editor
// (the reading view still renders them): replacing a range that includes
// `> ` markers would fight the callout field for the same lines.

import { EditorSelection, Prec, RangeSet, StateField, Transaction, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  Direction,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { completionStatus } from "@codemirror/autocomplete";
import "../styles/tables.css";
import { useStore } from "../state.ts";
import { renderMarkdown } from "../reading/render.ts";
import { notePathFacet } from "./livePreview.ts";
import {
  colIndexAt,
  emptyRowText,
  formatTable,
  moveTableColumn,
  moveTableRow,
  navRows,
  parseTable,
  rowIndexAt,
  splitRowCells,
  type TableCell,
  type TableShape,
} from "./tableModel.ts";

// ── Finding the table under the caret ───────────────────────────────────────

/** The top-level Table node containing `pos`, or null. Both resolve sides are
 *  tried because at a row's start/end one side resolves to the neighbouring
 *  node. Nested tables (blockquote, list) answer null on purpose — see the
 *  header. */
function tableNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    let n: SyntaxNode | null = tree.resolveInner(pos, side);
    while (n && n.name !== "Table") n = n.parent;
    if (n && n.parent?.name === "Document") return n;
  }
  return null;
}

interface TableCtx {
  blockFrom: number;
  blockTo: number;
  src: string;
  shape: TableShape;
}

/** Table context at the main head — null (fall through to the next keymap)
 *  unless there is exactly one selection range sitting in a top-level table
 *  whose source also parses as one. */
function tableContext(state: EditorState): TableCtx | null {
  if (state.selection.ranges.length !== 1) return null;
  const node = tableNodeAt(state, state.selection.main.head);
  if (!node) return null;
  const doc = state.doc;
  const blockFrom = doc.lineAt(node.from).from;
  const blockTo = doc.lineAt(node.to).to;
  const src = doc.sliceString(blockFrom, blockTo);
  const shape = parseTable(src, blockFrom);
  return shape ? { blockFrom, blockTo, src, shape } : null;
}

/** Line numbers currently touched by any selection range. Private in
 *  livePreview.ts, eight lines — re-stated rather than exported from a file
 *  this round must not touch. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let n = from; n <= to; n++) lines.add(n);
  }
  return lines;
}

// ── The widget ──────────────────────────────────────────────────────────────

class TableWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly blockFrom: number, // doc offset of the block's first character
    readonly notePath: string,
  ) {
    super();
  }
  override eq(other: TableWidget): boolean {
    // blockFrom is deliberately NOT compared: a widget whose table merely
    // slid down a line is the same widget, and comparing positions would
    // rebuild every table's DOM on every keystroke above it. Clicks read
    // positions from data-pos, refreshed on each build.
    return other.src === this.src && other.notePath === this.notePath;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-s-table";
    const rendered = renderMarkdown(this.src, {
      notePath: this.notePath,
      tree: useStore.getState().tree,
    });
    wrap.appendChild(rendered);

    // Every rendered cell learns where its source content sits, so a click
    // is "caret into that cell", not "caret at the table". The DOM rows are
    // walked against the same parse of the same source the renderer saw, so
    // the two agree row for row; a cell the renderer padded in (short row)
    // maps to its row's end.
    const shape = parseTable(this.src, this.blockFrom);
    if (shape) {
      const srcRows = navRows(shape);
      rendered.querySelectorAll("tr").forEach((tr, i) => {
        const srcRow = srcRows[i];
        if (!srcRow) return;
        tr.querySelectorAll("th,td").forEach((cellEl, j) => {
          const cell = srcRow.cells[j];
          (cellEl as HTMLElement).dataset.pos = String(cell ? cell.trimTo : srcRow.to);
        });
      });
    }
    wrap.addEventListener("mousedown", (ev) => {
      const cellEl = (ev.target as HTMLElement).closest?.("th,td") as HTMLElement | null;
      const pos = Number(cellEl?.dataset.pos ?? this.blockFrom);
      ev.preventDefault();
      view.dispatch({
        selection: { anchor: Math.min(pos, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true; // the mousedown above owns the click
  }
}

// ── Decorations (StateField: block decorations cannot come from a ViewPlugin)

function buildTableDecos(state: EditorState): DecorationSet {
  const doc = state.doc;
  const active = activeLines(state);
  const decos: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") return undefined;
      if (node.node.parent?.name !== "Document") return false; // nested: stays source
      const firstLine = doc.lineAt(node.from);
      const lastLine = doc.lineAt(node.to);
      let revealed = false;
      for (let n = firstLine.number; n <= lastLine.number; n++) {
        if (active.has(n)) {
          revealed = true;
          break;
        }
      }
      if (revealed) {
        for (let n = firstLine.number; n <= lastLine.number; n++) {
          decos.push(
            Decoration.line({ class: "cm-s-table-srcline" }).range(doc.line(n).from),
          );
        }
      } else {
        decos.push(
          Decoration.replace({
            widget: new TableWidget(
              doc.sliceString(firstLine.from, lastLine.to),
              firstLine.from,
              state.facet(notePathFacet),
            ),
            block: true,
          }).range(firstLine.from, lastLine.to),
        );
      }
      return false;
    },
  });
  return RangeSet.of(decos, true);
}

const tableField = StateField.define<DecorationSet>({
  create: buildTableDecos,
  update(deco, tr) {
    if (tr.docChanged || tr.selection || tr.effects.length > 0) {
      return buildTableDecos(tr.state);
    }
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ── Cell navigation (Tab / Shift+Tab / Enter) ───────────────────────────────

/** Select a cell's trimmed content (so typing replaces it); an empty cell is
 *  a caret between the pads. `collapse` lands a caret at the content's end
 *  instead — Enter walks rows, and walking must not arm an overwrite. */
function selectCell(
  view: EditorView,
  cell: TableCell | undefined,
  fallback: number,
  collapse = false,
): void {
  const sel = cell
    ? collapse
      ? EditorSelection.single(cell.trimTo)
      : EditorSelection.single(cell.trimFrom, cell.trimTo)
    : EditorSelection.single(fallback);
  view.dispatch({ selection: sel, scrollIntoView: true });
}

function nextCell(view: EditorView): boolean {
  const ctx = tableContext(view.state);
  if (!ctx) return false;
  if (completionStatus(view.state) !== null) return false; // Enter/Tab belong to the tooltip
  const head = view.state.selection.main.head;
  const rows = navRows(ctx.shape);
  const row = rowIndexAt(ctx.shape, head);
  if (row === null) return false;
  const col = colIndexAt(rows[row], head);
  if (col + 1 < rows[row].cells.length) {
    selectCell(view, rows[row].cells[col + 1], rows[row].to);
    return true;
  }
  if (row + 1 < rows.length) {
    selectCell(view, rows[row + 1].cells[0], rows[row + 1].to);
    return true;
  }
  // Tab in the last cell: the table grows a row.
  const rowText = emptyRowText(ctx.shape.header.cells.length);
  const first = splitRowCells(rowText, ctx.blockTo + 1)[0];
  view.dispatch({
    changes: { from: ctx.blockTo, insert: "\n" + rowText },
    selection: { anchor: first.trimFrom },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

function prevCell(view: EditorView): boolean {
  const ctx = tableContext(view.state);
  if (!ctx) return false;
  if (completionStatus(view.state) !== null) return false;
  const head = view.state.selection.main.head;
  const rows = navRows(ctx.shape);
  const row = rowIndexAt(ctx.shape, head);
  if (row === null) return false;
  const col = colIndexAt(rows[row], head);
  if (col > 0) {
    selectCell(view, rows[row].cells[col - 1], rows[row].to);
  } else if (row > 0) {
    const prev = rows[row - 1];
    selectCell(view, prev.cells[prev.cells.length - 1], prev.to);
  }
  // First cell: consumed with no move — falling through would hand Shift+Tab
  // to the indent keymap, which dedents the table's own line.
  return true;
}

function rowDown(view: EditorView): boolean {
  const ctx = tableContext(view.state);
  if (!ctx) return false;
  if (completionStatus(view.state) !== null) return false; // Enter accepts the completion
  const head = view.state.selection.main.head;
  const rows = navRows(ctx.shape);
  const row = rowIndexAt(ctx.shape, head);
  if (row === null) return false;
  const col = colIndexAt(rows[row], head);
  if (row + 1 < rows.length) {
    const target = rows[row + 1];
    selectCell(view, target.cells[Math.min(col, target.cells.length - 1)], target.to, true);
    return true;
  }
  // Last row: Enter leaves the table downward instead of splitting a row —
  // a newline inside a row is not a taller cell, it is two broken tables.
  if (ctx.blockTo >= view.state.doc.length) {
    view.dispatch({
      changes: { from: ctx.blockTo, insert: "\n" },
      selection: { anchor: ctx.blockTo + 1 },
      scrollIntoView: true,
      userEvent: "input",
    });
  } else {
    view.dispatch({ selection: { anchor: ctx.blockTo + 1 }, scrollIntoView: true });
  }
  return true;
}

// ── Row / column moves (Alt+arrows) ─────────────────────────────────────────

function moveRowCmd(dir: 1 | -1) {
  return (view: EditorView): boolean => {
    const ctx = tableContext(view.state);
    if (!ctx) return false;
    const head = view.state.selection.main.head;
    const bodyIdx = ctx.shape.body.findIndex((l) => head >= l.from && head <= l.to);
    // Header/delimiter: consume without moving. Falling through would hand
    // Alt+arrow to moveLineUp/Down, which drags the header line out of the
    // block — the exact corruption this keymap exists to prevent.
    if (bodyIdx === -1) return true;
    const res = moveTableRow(ctx.src, bodyIdx, dir);
    if (!res) return true;
    const offset = head - ctx.shape.body[bodyIdx].from; // caret rides its row
    const newShape = parseTable(res.src, ctx.blockFrom);
    const newLine = newShape?.body[res.row];
    const anchor = newLine ? Math.min(newLine.from + offset, newLine.to) : ctx.blockFrom;
    view.dispatch({
      changes: { from: ctx.blockFrom, to: ctx.blockTo, insert: res.src },
      selection: { anchor },
      scrollIntoView: true,
      userEvent: "move",
    });
    return true;
  };
}

function moveColCmd(arrow: "left" | "right") {
  return (view: EditorView): boolean => {
    const ctx = tableContext(view.state);
    if (!ctx) return false;
    const head = view.state.selection.main.head;
    const rows = navRows(ctx.shape);
    const row = rowIndexAt(ctx.shape, head);
    if (row === null) return false;
    const col = colIndexAt(rows[row], head);
    // Arrows are VISUAL: in an RTL table (Arabic header) the column to the
    // caret's right is the logically previous one. The header's own
    // direction decides, same as the rendered table's dir="auto" does.
    const rtl = view.textDirectionAt(ctx.shape.header.from) === Direction.RTL;
    const dir = ((arrow === "right" ? 1 : -1) * (rtl ? -1 : 1)) as 1 | -1;
    const res = moveTableColumn(ctx.src, col, dir);
    if (!res) return true; // edge: consumed, nothing sheared
    const newShape = parseTable(res.src, ctx.blockFrom);
    const newCell = newShape ? navRows(newShape)[row]?.cells[res.col] : undefined;
    view.dispatch({
      changes: { from: ctx.blockFrom, to: ctx.blockTo, insert: res.src },
      selection: { anchor: newCell ? newCell.trimFrom : ctx.blockFrom },
      scrollIntoView: true,
      userEvent: "move",
    });
    return true;
  };
}

// ── Format on exit ──────────────────────────────────────────────────────────

/** The table block (full lines) around the main head, or null. */
function blockRangeAt(state: EditorState): { from: number; to: number } | null {
  const node = tableNodeAt(state, state.selection.main.head);
  if (!node) return null;
  const doc = state.doc;
  return { from: doc.lineAt(node.from).from, to: doc.lineAt(node.to).to };
}

/** Prettify the block that WAS under the caret, off the update cycle (a
 *  dispatch inside update() is illegal). Re-resolved from scratch when the
 *  microtask runs: the block may have moved, shrunk, or stopped being a
 *  table, and formatTable refusing to parse is the no-op safety net. */
function scheduleFormat(view: EditorView, pos: number): void {
  queueMicrotask(() => {
    if (!view.dom.isConnected) return;
    const state = view.state;
    const node = tableNodeAt(state, Math.min(pos, state.doc.length));
    if (!node) return;
    const doc = state.doc;
    const from = doc.lineAt(node.from).from;
    const to = doc.lineAt(node.to).to;
    // Re-entered (or a second selection range still touches it): not an exit.
    if (state.selection.ranges.some((r) => r.from <= to && r.to >= from)) return;
    const src = doc.sliceString(from, to);
    const pretty = formatTable(src);
    if (pretty === src) return;
    view.dispatch({ changes: { from, to, insert: pretty }, userEvent: "format.table" });
  });
}

const tableFormatOnExit = ViewPlugin.fromClass(
  class {
    prev: { from: number; to: number } | null;
    constructor(readonly view: EditorView) {
      this.prev = blockRangeAt(view.state);
    }
    update(u: ViewUpdate): void {
      if (!u.selectionSet && !u.docChanged) return;
      const cur = blockRangeAt(u.state);
      let prev = this.prev;
      if (prev && u.docChanged) {
        prev = { from: u.changes.mapPos(prev.from, 1), to: u.changes.mapPos(prev.to, -1) };
      }
      this.prev = cur;
      if (!prev || (cur && cur.from === prev.from)) return; // never left
      // An undo that lands the caret outside must not be answered with a
      // fresh format edit — it would fork the history the user is walking.
      const history = u.transactions.some((tr) => {
        const e = tr.annotation(Transaction.userEvent);
        return e !== undefined && (e.startsWith("undo") || e.startsWith("redo"));
      });
      if (history) return;
      scheduleFormat(this.view, prev.from);
    }
  },
);

// ── Assembly ────────────────────────────────────────────────────────────────

export function markdownTables(): Extension {
  return [
    tableField,
    // Prec.high: inside a table these keys outrank indentWithTab, the
    // default Enter and Alt+arrow moveLine; outside, every command returns
    // false before touching anything, so the rest of the stack is exactly
    // as it was.
    Prec.high(
      keymap.of([
        { key: "Tab", run: nextCell, shift: prevCell },
        { key: "Enter", run: rowDown },
        { key: "Alt-ArrowUp", run: moveRowCmd(-1) },
        { key: "Alt-ArrowDown", run: moveRowCmd(1) },
        { key: "Alt-ArrowLeft", run: moveColCmd("left") },
        { key: "Alt-ArrowRight", run: moveColCmd("right") },
      ]),
    ),
    tableFormatOnExit,
  ];
}
