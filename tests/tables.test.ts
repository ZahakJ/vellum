// Tables: the string model under the live-preview table editor.
//
// Everything here exercises client/editor/tableModel.ts — the pure half of
// the table feature, split from tables.ts precisely so this file can load it
// under `node --test` (the CodeMirror/renderer half drags .css through its
// import chain, which node cannot parse).
//
// The invariants that matter, in order of how expensive their violation is:
//   1. A structural edit (column move, prettify) NEVER rewrites cell content —
//      `\|` escapes and pipes inside inline code included. Splitting is the
//      only operation allowed to look inside a cell.
//   2. A column move carries the alignment row with it. A move that shears
//      the delimiter walks every column's alignment into its neighbour's,
//      which corrupts silently — the table still parses, it just lies.
//   3. Formatting is idempotent and refuses non-tables: it runs unattended on
//      every caret exit, so "almost a table" must round-trip untouched.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  colIndexAt,
  displayWidth,
  emptyRowText,
  formatTable,
  moveTableColumn,
  moveTableRow,
  parseTable,
  rowIndexAt,
  splitRowCells,
} from "../client/editor/tableModel.ts";

const TABLE = ["| Name | Qty | Price |", "| :--- | :-: | ----: |", "| Apple | 3 | $1.20 |", "| Pear | 12 | $0.90 |"].join("\n");

describe("splitRowCells", () => {
  it("splits a piped row into trimmed cells with source offsets", () => {
    const cells = splitRowCells("| a | bc |", 100);
    assert.equal(cells.length, 2);
    assert.deepEqual(cells.map((c) => c.text), ["a", "bc"]);
    // "| a | bc |" — 'a' at index 2, 'bc' at 6.
    assert.equal(cells[0].trimFrom, 102);
    assert.equal(cells[0].trimTo, 103);
    assert.equal(cells[1].trimFrom, 106);
    assert.equal(cells[1].trimTo, 108);
  });

  it("handles rows without leading/trailing pipes", () => {
    assert.deepEqual(splitRowCells("a | b").map((c) => c.text), ["a", "b"]);
    assert.deepEqual(splitRowCells("| a | b").map((c) => c.text), ["a", "b"]);
    assert.deepEqual(splitRowCells("a | b |").map((c) => c.text), ["a", "b"]);
  });

  it("keeps \\| inside a cell and lets \\\\| split (parity, not presence)", () => {
    assert.deepEqual(splitRowCells("| a \\| b | c |").map((c) => c.text), ["a \\| b", "c"]);
    // Backslash-backslash is a literal backslash; the pipe after it is real.
    assert.deepEqual(splitRowCells("| a \\\\| b |").map((c) => c.text), ["a \\\\", "b"]);
  });

  it("collapses an empty cell's caret target one character in from the pipe", () => {
    const cells = splitRowCells("|  |  |");
    assert.equal(cells.length, 2);
    // `|  |` — raw segment starts at 1; the caret goes to 2, between the
    // pads, not flush against the wall.
    assert.equal(cells[0].trimFrom, 2);
    assert.equal(cells[0].trimTo, 2);
  });

  it("keeps a trailing escaped pipe as content, not punctuation", () => {
    assert.deepEqual(splitRowCells("| a | b \\|").map((c) => c.text), ["a", "b \\|"]);
  });
});

describe("parseTable", () => {
  it("reads header, delimiter, alignment and body", () => {
    const shape = parseTable(TABLE);
    assert.ok(shape);
    assert.deepEqual(shape.header.cells.map((c) => c.text), ["Name", "Qty", "Price"]);
    assert.equal(shape.body.length, 2);
    assert.deepEqual(shape.aligns, [
      { left: true, right: false },
      { left: true, right: true },
      { left: false, right: true },
    ]);
  });

  it("refuses when the second line is not a delimiter row", () => {
    assert.equal(parseTable("| a | b |\n| c | d |"), null);
    assert.equal(parseTable("just prose"), null);
    assert.equal(parseTable("| lone header |"), null);
  });

  it("maps the delimiter line to the header for navigation", () => {
    const shape = parseTable(TABLE)!;
    assert.equal(rowIndexAt(shape, shape.delimiter.from + 3), 0);
    assert.equal(rowIndexAt(shape, shape.body[1].from + 2), 2);
    assert.equal(rowIndexAt(shape, shape.to + 5), null);
  });

  it("assigns an offset on a pipe to the nearest unfinished cell", () => {
    const shape = parseTable(TABLE)!;
    // Offset 0 is the leading pipe of the header — cell 0's problem.
    assert.equal(colIndexAt(shape.header, shape.from), 0);
    assert.equal(colIndexAt(shape.header, shape.header.to), 2);
  });
});

describe("displayWidth", () => {
  it("counts CJK and emoji as two columns, Latin and Arabic as one", () => {
    assert.equal(displayWidth("abc"), 3);
    assert.equal(displayWidth("表格"), 4);
    assert.equal(displayWidth("表a"), 3);
    assert.equal(displayWidth("🙂"), 2);
    assert.equal(displayWidth("جدول"), 4); // Arabic is cursive, not wide
  });

  it("clusters combining marks with their base", () => {
    // e + combining acute is one grapheme, one column.
    assert.equal(displayWidth("é"), 1);
  });
});

describe("formatTable", () => {
  it("pads every column to its widest cell and stretches the delimiter", () => {
    const pretty = formatTable("| a | bbbb |\n| - | - |\n| cc | d |");
    assert.equal(pretty, ["| a   | bbbb |", "| --- | ---- |", "| cc  | d    |"].join("\n"));
  });

  it("is idempotent", () => {
    const once = formatTable(TABLE);
    assert.equal(formatTable(once), once);
  });

  it("keeps explicit alignment colons where the author put them", () => {
    const pretty = formatTable(TABLE);
    const delim = pretty.split("\n")[1];
    assert.match(delim, /^\| :-+ \| :-+: \| -+: \|$/);
  });

  it("pads right- and center-aligned cells on the correct side", () => {
    const pretty = formatTable("| head | mid |\n| ---: | :-: |\n| x | y |");
    const row = pretty.split("\n")[2];
    assert.equal(row, "|    x |  y  |");
  });

  it("never rewrites cell content: escapes and code-span pipes survive", () => {
    const src = "| a \\| b | `x` |\n| - | - |\n| `c \\| d` | e |";
    const before = parseTable(src)!;
    const after = parseTable(formatTable(src))!;
    assert.deepEqual(
      after.header.cells.map((c) => c.text),
      before.header.cells.map((c) => c.text),
    );
    assert.deepEqual(
      after.body[0].cells.map((c) => c.text),
      before.body[0].cells.map((c) => c.text),
    );
  });

  it("squares off short rows and adopts stray extra columns", () => {
    const pretty = formatTable("| a | b |\n| - | - |\n| only |\n| x | y | extra |");
    const lines = pretty.split("\n");
    // Every line ends with the same number of cells.
    for (const line of lines) {
      assert.equal(splitRowCells(line).length, 3);
    }
  });

  it("lines the pipes up even when a column holds CJK", () => {
    const pretty = formatTable("| 表格 | b |\n| - | - |\n| x | 说明文字 |");
    const widths = pretty.split("\n").map((l) => displayWidth(l));
    assert.equal(new Set(widths).size, 1);
  });

  it("returns a non-table untouched", () => {
    const notATable = "prose with | a pipe\nand another line";
    assert.equal(formatTable(notATable), notATable);
  });
});

describe("moveTableColumn", () => {
  it("moves header, alignment row and every body row together", () => {
    const res = moveTableColumn(TABLE, 0, 1);
    assert.ok(res);
    assert.equal(res.col, 1);
    const shape = parseTable(res.src)!;
    assert.deepEqual(shape.header.cells.map((c) => c.text), ["Qty", "Name", "Price"]);
    assert.deepEqual(shape.body[0].cells.map((c) => c.text), ["3", "Apple", "$1.20"]);
    // The alignment travelled with its column — Name is still :---, Qty :-:.
    assert.deepEqual(shape.aligns[0], { left: true, right: true });
    assert.deepEqual(shape.aligns[1], { left: true, right: false });
  });

  it("refuses at the edges instead of wrapping", () => {
    assert.equal(moveTableColumn(TABLE, 0, -1), null);
    assert.equal(moveTableColumn(TABLE, 2, 1), null);
  });

  it("pads a short row rather than shearing it", () => {
    const src = "| a | b |\n| - | - |\n| only |";
    const res = moveTableColumn(src, 0, 1)!;
    const shape = parseTable(res.src)!;
    assert.deepEqual(shape.body[0].cells.map((c) => c.text), ["", "only"]);
  });
});

describe("moveTableRow", () => {
  it("swaps adjacent body rows and reports the new index", () => {
    const res = moveTableRow(TABLE, 0, 1);
    assert.ok(res);
    assert.equal(res.row, 1);
    const shape = parseTable(res.src)!;
    assert.deepEqual(shape.body.map((r) => r.cells[0].text), ["Pear", "Apple"]);
  });

  it("refuses at the edges — the header is not a destination", () => {
    assert.equal(moveTableRow(TABLE, 0, -1), null);
    assert.equal(moveTableRow(TABLE, 1, 1), null);
  });
});

describe("emptyRowText", () => {
  it("matches the column count Tab-in-the-last-cell needs", () => {
    assert.equal(splitRowCells(emptyRowText(3)).length, 3);
    assert.equal(splitRowCells(emptyRowText(1)).length, 1);
  });
});
