// The reader, tested where it is testable: the identity of a book, the state
// that survives a rename, the search fold, the `:` grammar, the page window
// and the figure geometry that keeps night mode from ruining photographs.
//
// Everything here is either pure logic or a real temp directory. The rendering
// half needs a browser and is not faked: a test that asserts pdf.js was called
// proves nothing about whether a page appeared.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  BOOK_KEY_RE,
  DEFAULT_BOOK_STATE,
  HIGHLIGHT_RECTS_MAX,
  MARKS_MAX,
  NAMES_MAX,
  bookCitationLink,
  bookRef,
  boundingRect,
  citationBlock,
  cleanBookState,
  cleanHighlight,
  cleanHighlights,
  formatBookAnchor,
  isBookKey,
  isHighlightId,
  isMarkName,
  newHighlightId,
  parseBookAnchor,
  parseBookRef,
  progressOf,
} from "../shared/bookAnchor.ts";
import { assembleSelection, columnCuts, joinFragments, orderLine } from "../client/books/columns.ts";
import { rotateRect, unrotateRect } from "../client/books/annotations.ts";
import { findMatches, foldQuery } from "../client/books/search.ts";
import { parseCommand, parseNumber } from "../client/books/commands.ts";
import {
  clampCanvasScale,
  fitPageScale,
  fitWidthScale,
  pageOfSpread,
  renderWindow,
  spreadOfPage,
  spreadsOf,
} from "../client/books/layout.ts";
import { IDENTITY, imageRects, multiply, unitSquareBox } from "../client/books/figures.ts";
import { detectRtl } from "../client/books/direction.ts";
import {
  allHighlights,
  bookKey,
  deleteHighlight,
  getBookState,
  getHighlights,
  forgetBook,
  listBooks,
  locateHighlight,
  putBookState,
  putHighlight,
} from "../server/books.ts";
import { initSite } from "../server/site.ts";
import { initVault, VaultError } from "../server/vault.ts";
import { makeDir, makeVault, removeVault } from "./helpers/vault.ts";

// ── Identity and state ─────────────────────────────────────────────────────

describe("book state", () => {
  it("keys are 64 lowercase hex characters and nothing else", () => {
    assert.ok(isBookKey("a".repeat(64)));
    assert.ok(!isBookKey("A".repeat(64)), "uppercase is not our spelling");
    assert.ok(!isBookKey("a".repeat(63)), "a short digest is a corrupt link");
    assert.ok(!isBookKey(""));
    assert.ok(!isBookKey(42 as unknown as string));
    assert.ok(BOOK_KEY_RE.test("0123456789abcdef".repeat(4)));
  });

  it("cleans a state without ever throwing, whatever it is handed", () => {
    for (const junk of [null, undefined, 7, "x", [], { page: "no" }, { marks: 3 }]) {
      const out = cleanBookState(junk);
      assert.equal(typeof out.page, "number");
      assert.ok(out.page >= 1);
    }
  });

  it("merges a PARTIAL patch over the previous state", () => {
    // The whole point of the merge: a scroll write carries page+offset and
    // must not undo the zoom the reader set a second earlier.
    const prev = cleanBookState({ zoom: 2.5, fit: "free", dual: true, rotation: 90, pages: 300 });
    const next = cleanBookState({ page: 42, offset: 0.5 }, prev);
    assert.equal(next.page, 42);
    assert.equal(next.zoom, 2.5);
    assert.equal(next.fit, "free");
    assert.equal(next.dual, true);
    assert.equal(next.rotation, 90);
  });

  it("clamps the page to the book only when the page count is known", () => {
    const known = cleanBookState({ page: 5000, pages: 300 });
    assert.equal(known.page, 300);
    // pages: 0 means "never opened" — clamping to it would send every reader
    // in the store back to page one.
    const unknown = cleanBookState({ page: 5000, pages: 0 });
    assert.equal(unknown.page, 5000);
  });

  it("clamps zoom and offset, and refuses a nonsense rotation", () => {
    assert.equal(cleanBookState({ zoom: 900 }).zoom, 8);
    assert.equal(cleanBookState({ zoom: -3 }).zoom, 0.1);
    assert.equal(cleanBookState({ offset: 4 }).offset, 1);
    assert.equal(cleanBookState({ offset: -1 }).offset, 0);
    assert.equal(cleanBookState({ rotation: 45 }).rotation, 0);
    assert.equal(cleanBookState({ rotation: 270 }).rotation, 270);
  });

  it("strips control characters out of PDF metadata and caps its length", () => {
    // /Title is attacker-controlled bytes off the internet.
    const state = cleanBookState({ title: "A\u0007book\nhere", author: "x".repeat(900) });
    assert.equal(state.title, "A book here");
    assert.equal(state.author.length, 300);
  });

  it("keeps single-character marks and drops everything else", () => {
    const state = cleanBookState({ marks: { a: 12, "ب": 40, "ab": 3, z: 0, q: "x" } });
    assert.deepEqual(Object.keys(state.marks).sort(), ["a", "ب"].sort());
    assert.equal(state.marks.a, 12);
    assert.ok(isMarkName("ب"), "an Arabic letter is a mark name like any other");
    assert.ok(!isMarkName("ab"));
    assert.ok(!isMarkName(""));
  });

  it("caps the number of marks a hand-edited file can carry", () => {
    const marks: Record<string, number> = {};
    for (let i = 0; i < MARKS_MAX * 3; i += 1) marks[String.fromCodePoint(0x100 + i)] = i + 1;
    assert.ok(Object.keys(cleanBookState({ marks }).marks).length <= MARKS_MAX);
  });

  it("reports progress only when the page count is known", () => {
    assert.equal(progressOf({ ...DEFAULT_BOOK_STATE, page: 1, pages: 0 }), 0);
    assert.equal(progressOf({ ...DEFAULT_BOOK_STATE, page: 51, offset: 0, pages: 100 }), 0.5);
    assert.equal(progressOf({ ...DEFAULT_BOOK_STATE, page: 100, offset: 1, pages: 100 }), 1);
  });

  it("round-trips a citable reference", () => {
    const key = "b".repeat(64);
    assert.equal(bookRef(key, 212), `book:${key}#p212`);
    assert.deepEqual(parseBookRef(bookRef(key, 212)), { key, page: 212 });
    assert.deepEqual(parseBookRef(`book:${key}`), { key, page: 1 });
    assert.equal(parseBookRef("book:short#p2"), null);
    assert.equal(parseBookRef("Books/x.pdf#p2"), null);
  });
});

// ── Search ─────────────────────────────────────────────────────────────────

describe("in-book search", () => {
  it("finds a phrase and reports offsets into the ORIGINAL string", () => {
    const hay = "The quick brown fox";
    const [m] = findMatches(hay, "Quick");
    assert.deepEqual(hay.slice(m.start, m.end), "quick");
  });

  it("matches Arabic text that carries harakat the reader did not type", () => {
    // "المقدمة" written with vowel marks, searched for without them.
    const hay = "الْمُقَدِّمَة";
    const hits = findMatches(hay, "المقدمة");
    assert.equal(hits.length, 1, "harakat must not hide a word from its own reader");
    assert.equal(hits[0].start, 0);
    assert.equal(hits[0].end, hay.length);
  });

  it("folds the alef family, the yeh family and teh marbuta", () => {
    assert.equal(findMatches("إبن", "ابن").length, 1);
    assert.equal(findMatches("على", "علي").length, 1);
    assert.equal(findMatches("مكة", "مكه").length, 1);
  });

  it("ignores tatweel, which is a stretch and not a letter", () => {
    assert.equal(findMatches("كــتاب", "كتاب").length, 1);
  });

  it("matches one typed space across the line break extraction invents", () => {
    assert.equal(findMatches("hello\n   world", "hello world").length, 1);
    assert.equal(findMatches("hel-\nlo", "hel- lo").length, 1);
  });

  it("returns non-overlapping matches so n/N steps once per hit", () => {
    assert.equal(findMatches("aaaa", "aa").length, 2);
  });

  it("never starts a match on an invisible character", () => {
    const hay = "َ" + "abc";
    const [m] = findMatches(hay, "abc");
    assert.equal(m.start, 1, "the highlight must begin on the letter, not the vowel mark");
  });

  it("treats a query of nothing but marks as no query at all", () => {
    assert.equal(foldQuery("َُـ"), "");
    assert.deepEqual(findMatches("anything", "َ"), []);
  });

  it("keeps offsets right around astral characters", () => {
    const hay = "\u{1D400}\u{1D401} needle";
    const [m] = findMatches(hay, "needle");
    assert.equal(hay.slice(m.start, m.end), "needle");
  });
});

// ── The command line ───────────────────────────────────────────────────────

describe("reader commands", () => {
  it("reads a bare page number, absolute and relative", () => {
    assert.deepEqual(parseCommand("212"), { kind: "goto", page: 212, relative: false });
    assert.deepEqual(parseCommand("+3"), { kind: "goto", page: 3, relative: true });
    assert.deepEqual(parseCommand("-3"), { kind: "goto", page: -3, relative: true });
  });

  it("reads Eastern Arabic digits, which is what an Arabic instance PRINTS", () => {
    assert.equal(parseNumber("٢١٢"), 212);
    assert.equal(parseNumber("۱۲"), 12);
    assert.deepEqual(parseCommand("٢١٢"), { kind: "goto", page: 212, relative: false });
    assert.equal(parseNumber("12a"), null);
  });

  it("accepts every documented abbreviation and no ambiguous one", () => {
    assert.deepEqual(parseCommand("q"), { kind: "quit" });
    assert.deepEqual(parseCommand("quit"), { kind: "quit" });
    assert.deepEqual(parseCommand("lib"), { kind: "library" });
    assert.deepEqual(parseCommand("library"), { kind: "library" });
    assert.deepEqual(parseCommand("o"), { kind: "outline" });
    // One letter that is a prefix of two commands must not resolve: `l` could
    // be `library` or `ltr`, so it is refused rather than guessed.
    assert.deepEqual(parseCommand("l"), { kind: "unknown", word: "l" });
    assert.deepEqual(parseCommand("r"), { kind: "unknown", word: "r" });
    assert.deepEqual(parseCommand("d"), { kind: "unknown", word: "d" });
  });

  it("parses the stateful commands", () => {
    assert.deepEqual(parseCommand("zoom 150"), { kind: "zoom", percent: 150 });
    assert.deepEqual(parseCommand("zoom"), { kind: "zoom", percent: 100 });
    assert.deepEqual(parseCommand("fit page"), { kind: "fit", fit: "page" });
    assert.deepEqual(parseCommand("fit"), { kind: "fit", fit: "width" });
    assert.deepEqual(parseCommand("rotate"), { kind: "rotate", quarters: 1 });
    assert.deepEqual(parseCommand("rotate 180"), { kind: "rotate", quarters: 2 });
    assert.deepEqual(parseCommand("rotate 45"), { kind: "unknown", word: "rotate 45" });
    assert.deepEqual(parseCommand("dual on"), { kind: "dual", on: true });
    assert.deepEqual(parseCommand("dual"), { kind: "dual", on: null });
    assert.deepEqual(parseCommand("invert night"), { kind: "invert", mode: "night" });
    assert.deepEqual(parseCommand("rtl"), { kind: "direction", rtl: true });
    assert.deepEqual(parseCommand("ltr"), { kind: "direction", rtl: false });
    assert.deepEqual(parseCommand("search ibn"), { kind: "search", query: "ibn" });
  });

  it("takes a mark of exactly one character, in any script", () => {
    assert.deepEqual(parseCommand("mark a"), { kind: "mark", name: "a" });
    assert.deepEqual(parseCommand("jump ب"), { kind: "jump", name: "ب" });
    assert.deepEqual(parseCommand("mark ab"), { kind: "unknown", word: "mark ab" });
  });

  it("says nothing about an empty line and names an unknown word", () => {
    assert.equal(parseCommand("   "), null);
    assert.deepEqual(parseCommand("frobnicate"), { kind: "unknown", word: "frobnicate" });
  });

  it("has no abbreviation for the one command that discards something", () => {
    assert.deepEqual(parseCommand("forget"), { kind: "forget" });
    assert.deepEqual(parseCommand("forg"), { kind: "unknown", word: "forg" });
  });

  it("names the annotation commands, and `:h` still means help", () => {
    // The vi rule resolves the FIRST name whose abbreviation the typed word
    // satisfies, so order in NAMES is the contract: a reader with `:h` in
    // their fingers must not have it silently start inking their selection.
    assert.deepEqual(parseCommand("h"), { kind: "help" });
    assert.deepEqual(parseCommand("hi"), { kind: "highlight" });
    assert.deepEqual(parseCommand("highlight"), { kind: "highlight" });
    assert.deepEqual(parseCommand("no"), { kind: "note" });
    assert.deepEqual(parseCommand("an"), { kind: "annotations" });
  });

  it("keeps `:inv` meaning invert while `:ink` means ink", () => {
    assert.deepEqual(parseCommand("inv"), { kind: "invert", mode: null });
    assert.deepEqual(parseCommand("ink"), { kind: "ink", ink: null });
    assert.deepEqual(parseCommand("ink 3"), { kind: "ink", ink: 3 });
    // Eastern Arabic digits, like every other number this reader takes.
    assert.deepEqual(parseCommand("ink \u0664"), { kind: "ink", ink: 4 });
    assert.equal(parseCommand("ink half")?.kind, "unknown");
  });

  it("cites, and asks which note when told to", () => {
    assert.deepEqual(parseCommand("cite"), { kind: "cite", pick: false });
    assert.deepEqual(parseCommand("c"), { kind: "cite", pick: false });
    assert.deepEqual(parseCommand("cite pick"), { kind: "cite", pick: true });
    assert.equal(parseCommand("cite sideways")?.kind, "unknown");
  });
});

// ── Layout ─────────────────────────────────────────────────────────────────

describe("page layout", () => {
  it("puts one page per spread in single mode", () => {
    const spreads = spreadsOf(5, false, false);
    assert.deepEqual(spreads.map((s) => s.pages), [[1], [2], [3], [4], [5]]);
  });

  it("leaves page one alone and pairs the rest, like a bound book", () => {
    assert.deepEqual(spreadsOf(6, true, false).map((s) => s.pages), [[1], [2, 3], [4, 5], [6]]);
  });

  it("reverses the PAIR, not the sequence, for a right-to-left binding", () => {
    const rtl = spreadsOf(6, true, true).map((s) => s.pages);
    assert.deepEqual(rtl, [[1], [3, 2], [5, 4], [6]]);
  });

  it("round-trips page ↔ spread in both modes", () => {
    for (const dual of [false, true]) {
      for (let page = 1; page <= 40; page += 1) {
        const index = spreadOfPage(page, dual);
        const back = pageOfSpread(index, dual);
        assert.ok(back <= page, `spread ${index} must not start after page ${page}`);
        assert.equal(spreadOfPage(back, dual), index);
      }
    }
  });

  it("renders a bounded window, never the whole book", () => {
    // The property that keeps a 900-page book from being 31 GB of canvas.
    for (const at of [0, 1, 5, 400, 899]) {
      const win = renderWindow(at, 900);
      assert.equal(win.length, 5);
      assert.ok(win.every((i) => i >= 0 && i < 900));
    }
    assert.deepEqual(renderWindow(0, 900), [0, 1, 2, 3, 4], "the first screen is not half empty");
    assert.deepEqual(renderWindow(899, 900), [895, 896, 897, 898, 899]);
    assert.deepEqual(renderWindow(0, 3), [0, 1, 2], "a short book renders whole");
    assert.deepEqual(renderWindow(0, 0), []);
  });

  it("fits width across one page or two, gaps included", () => {
    const base = { pageWidth: 600, pageHeight: 800, viewWidth: 1248, viewHeight: 900, gap: 24 };
    assert.equal(fitWidthScale({ ...base, across: 1 }), (1248 - 48) / 600);
    assert.equal(fitWidthScale({ ...base, across: 2 }), (1248 - 72) / 1200);
  });

  it("fits a whole page by the tighter of the two constraints", () => {
    const tall = fitPageScale({ pageWidth: 600, pageHeight: 2000, viewWidth: 1248, viewHeight: 900, across: 1, gap: 24 });
    assert.ok(tall < fitWidthScale({ pageWidth: 600, pageHeight: 2000, viewWidth: 1248, viewHeight: 900, across: 1, gap: 24 }));
  });

  it("caps the canvas below the size at which a browser paints nothing", () => {
    // An A0 poster page at 800% is ~90 megapixels; over the limit a canvas
    // does not throw, it comes back blank.
    const capped = clampCanvasScale(8, 3370, 4768);
    assert.ok(capped < 8);
    assert.ok(3370 * capped * 4768 * capped <= 16_000_000 + 1);
    assert.equal(clampCanvasScale(1, 600, 800), 1, "an ordinary page is untouched");
  });
});

// ── Figures ────────────────────────────────────────────────────────────────

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageXObjectRepeat: 88,
};

describe("figure detection (night mode)", () => {
  it("multiplies transforms in the order they are applied", () => {
    const translate = [1, 0, 0, 1, 10, 20] as const;
    const scale = [2, 0, 0, 2, 0, 0] as const;
    assert.deepEqual(unitSquareBox(multiply(translate, scale)), { x: 10, y: 20, w: 2, h: 2 });
  });

  it("measures the unit square through a flipped transform", () => {
    // PDF images are drawn into the unit square with a vertical flip; all four
    // corners have to be measured or the box lands above the page.
    assert.deepEqual(unitSquareBox([100, 0, 0, -50, 20, 300]), { x: 20, y: 250, w: 100, h: 50 });
  });

  it("finds the rectangle an image was painted into", () => {
    const rects = imageRects(
      {
        fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
        argsArray: [null, [200, 0, 0, 100, 50, 400], ["img_1", 200, 100], null],
      },
      OPS,
      IDENTITY,
    );
    assert.deepEqual(rects, [{ x: 50, y: 400, w: 200, h: 100 }]);
  });

  it("restores the transform, so a second image is not misplaced", () => {
    const rects = imageRects(
      {
        fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintInlineImageXObject],
        argsArray: [null, [200, 0, 0, 100, 50, 400], [], null, []],
      },
      OPS,
      [300, 0, 0, 300, 0, 0],
    );
    assert.equal(rects.length, 2);
    assert.deepEqual(rects[1], { x: 0, y: 0, w: 300, h: 300 }, "the second image is back on the page transform");
  });

  it("survives an unbalanced restore in a malformed document", () => {
    const rects = imageRects(
      { fnArray: [OPS.restore, OPS.paintImageXObject], argsArray: [null, []] },
      OPS,
      [100, 0, 0, 100, 0, 0],
    );
    assert.equal(rects.length, 1);
  });

  it("ignores the tiny images that are rules and bullets", () => {
    // Exempting these from the inversion freckles a dark page with white dots.
    const rects = imageRects(
      {
        fnArray: [OPS.transform, OPS.paintImageXObject],
        argsArray: [[4, 0, 0, 4, 10, 10], []],
      },
      OPS,
      IDENTITY,
    );
    assert.deepEqual(rects, []);
  });

  it("collects nothing from a page of pure type", () => {
    assert.deepEqual(imageRects({ fnArray: [1, 2, 3, 4], argsArray: [[], [], [], []] }, OPS, IDENTITY), []);
  });
});

// ── Binding direction ──────────────────────────────────────────────────────

describe("binding direction", () => {
  it("calls an Arabic book right-to-left", () => {
    assert.equal(detectRtl("مقدمة ابن خلدون ".repeat(4)), true);
  });

  it("is not fooled by the Latin page numbers on an Arabic page", () => {
    const page = "الفصل الأول ".repeat(6) + " 123 456 789 doi:10.1000/xyz";
    assert.equal(detectRtl(page), true);
  });

  it("calls an English book left-to-right, quoted Arabic and all", () => {
    assert.equal(
      detectRtl("The Muqaddimah is a work of history ".repeat(6) + " المقدمة"),
      false,
    );
  });

  it("says left-to-right about a scanned book with no text layer", () => {
    assert.equal(detectRtl(""), false);
    assert.equal(detectRtl("  \n \n "), false);
  });
});

// ── Assembling a quote (client/books/columns.ts) ───────────────────────────
//
// THE FIXTURE IS THE POINT OF THIS BLOCK. A two-column paper, measured as
// fractions of the page: two text blocks 36% wide with an 8% gutter between
// them, three lines each. The ORDER the pieces are declared in is the order
// pdf.js hands them over on a TeX-set two-column page — line 1 left, line 1
// right, line 2 left, line 2 right — because the content stream was written
// that way and a PDF carries no reading order at all.
//
// Read in that order the passage is fluent nonsense the author never wrote.
// Read by geometry it is one sentence, hyphen and all.

/** x of the left column's text block, and of the right. Real proportions off a
 *  two-column A4 paper: 36% columns, an 8% gutter, 10% margins. */
const LEFT = 0.1;
const RIGHT = 0.54;
const COL_W = 0.36;
const LINE_H = 0.018;

function line(x: number, row: number, text: string) {
  return { text, x, y: 0.2 + row * 0.035, w: COL_W, h: LINE_H };
}

/** pdf.js's own order: the two columns interleaved, line by line. */
const TWO_COLUMN_PAGE = [
  line(LEFT, 0, "The argument rests on a premise that"),
  line(RIGHT, 0, "ficantly harder to accept than it first"),
  line(LEFT, 1, "the reader may already suspect, and"),
  line(RIGHT, 1, "appears, though the evidence remains"),
  line(LEFT, 2, "which the following section makes signi-"),
  line(RIGHT, 2, "thin."),
];

const TWO_COLUMN_TRUTH =
  "The argument rests on a premise that the reader may already suspect, and " +
  "which the following section makes significantly harder to accept than it " +
  "first appears, though the evidence remains thin.";

describe("assembling a quote", () => {
  it("reads a two-column page by COLUMN, not by the order the PDF wrote it", () => {
    const { text } = assembleSelection(TWO_COLUMN_PAGE, false);
    assert.equal(text, TWO_COLUMN_TRUTH);

    // And the failure it exists to prevent, spelled out: joining the pieces in
    // the order pdf.js supplied them is grammatical, plausible and wrong.
    const naive = TWO_COLUMN_PAGE.map((p) => p.text).join(" ");
    assert.notEqual(naive, TWO_COLUMN_TRUTH);
    assert.ok(naive.includes("premise that ficantly"), "the interleaving is real");
  });

  it("finds the gutter, and finds only the gutter", () => {
    const cuts = columnCuts(TWO_COLUMN_PAGE);
    assert.equal(cuts.length, 1);
    assert.ok(cuts[0] > 0.46 && cuts[0] < 0.54, `cut at ${cuts[0]} is inside the gutter`);
  });

  it("never splits a SINGLE line into columns, however wide its word spaces", () => {
    // A line is a line. Reading the spaces in one as columns would reorder a
    // sentence into nonsense — the same bug, pointed the other way.
    const oneLine = [
      { text: "Chapter", x: 0.1, y: 0.2, w: 0.12, h: 0.02 },
      { text: "Seven", x: 0.7, y: 0.2, w: 0.1, h: 0.02 },
    ];
    assert.deepEqual(columnCuts(oneLine), []);
    assert.equal(assembleSelection(oneLine, false).text, "Chapter Seven");
  });

  it("gives one ribbon per line, not one box around the lot", () => {
    const { rects } = assembleSelection(TWO_COLUMN_PAGE, false);
    assert.equal(rects.length, 6, "three lines in each of two columns");
    // None of them crosses the gutter: a single bounding box would have.
    assert.ok(rects.every((r) => r.x + r.w <= 0.47 || r.x >= 0.53));
  });

  it("reads an Arabic line from the right", () => {
    // The pieces arrive in x order; the sentence does not. Sorting by
    // ascending x is how a reader silently reverses every Arabic quotation.
    const pieces = [
      { text: "التاريخ", x: 0.1, y: 0.3, w: 0.15, h: 0.02 },
      { text: "في", x: 0.3, y: 0.3, w: 0.06, h: 0.02 },
      { text: "المقدمة", x: 0.42, y: 0.3, w: 0.16, h: 0.02 },
    ];
    assert.equal(assembleSelection(pieces, true).text, "المقدمة في التاريخ");
    assert.equal(assembleSelection(pieces, false).text, "التاريخ في المقدمة");
    assert.deepEqual(
      orderLine(pieces, true).map((p) => p.text),
      ["المقدمة", "في", "التاريخ"],
    );
  });

  it("puts the right-hand column first in a right-to-left paper", () => {
    const pieces = [
      { text: "ثانيا", x: 0.1, y: 0.2, w: 0.3, h: 0.02 },
      { text: "أولا", x: 0.6, y: 0.2, w: 0.3, h: 0.02 },
      { text: "رابعا", x: 0.1, y: 0.24, w: 0.3, h: 0.02 },
      { text: "ثالثا", x: 0.6, y: 0.24, w: 0.3, h: 0.02 },
    ];
    assert.equal(assembleSelection(pieces, true).text, "أولا ثالثا ثانيا رابعا");
  });
});

describe("hyphenation", () => {
  it("puts a word back together across a line break", () => {
    assert.equal(joinFragments("sig-", "nificant"), "significant");
    assert.equal(joinFragments("through-", "out"), "throughout");
  });

  it("leaves a compound alone", () => {
    // A capital on the right is a name, not a break a typesetter made.
    assert.equal(joinFragments("Anglo-", "Saxon"), "Anglo- Saxon");
    // A digit is never a hyphenation.
    assert.equal(joinFragments("1990-", "1995"), "1990- 1995");
    // One letter before the break is "x-ray", not a word broken after one
    // character — which typesetters do not do.
    assert.equal(joinFragments("x-", "ray"), "x- ray");
  });

  it("leaves an Arabic dash alone, because Arabic does not hyphenate", () => {
    assert.equal(joinFragments("ما-", "بعد"), "ما- بعد");
  });

  it("kills the gap pdf.js leaves in the middle of a broken word", () => {
    // The embarrassing one: "sig- nificant" arriving as two runs on one line,
    // a font change apart, with a space-sized gap between them.
    const pieces = [
      { text: "This is sig-", x: 0.1, y: 0.2, w: 0.2, h: 0.02 },
      { text: "nificant work", x: 0.34, y: 0.2, w: 0.2, h: 0.02 },
    ];
    assert.equal(assembleSelection(pieces, false).text, "This is significant work");
  });

  it("butts together two runs that are halves of one word", () => {
    // No gap at all: pdf.js split the run where the PDF changed font.
    const pieces = [
      { text: "recon", x: 0.1, y: 0.2, w: 0.08, h: 0.02 },
      { text: "figure", x: 0.18, y: 0.2, w: 0.08, h: 0.02 },
    ];
    assert.equal(assembleSelection(pieces, false).text, "reconfigure");
  });

  it("drops the soft hyphen a typesetter left behind", () => {
    const soft = String.fromCharCode(0x00ad);
    const pieces = [{ text: `un${soft}likely`, x: 0.1, y: 0.2, w: 0.2, h: 0.02 }];
    assert.equal(assembleSelection(pieces, false).text, "unlikely");
  });

  it("keeps a Persian zero-width non-joiner, which is spelling and not noise", () => {
    const word = `می${String.fromCharCode(0x200c)}رود`;
    const pieces = [{ text: word, x: 0.1, y: 0.2, w: 0.2, h: 0.02 }];
    assert.equal(assembleSelection(pieces, false).text, word);
  });
});

// ── Highlights and the citation anchor ─────────────────────────────────────

describe("highlights", () => {
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.04 };
  const mark = (over: Record<string, unknown> = {}) => ({
    id: "k7f3q2a9",
    page: 42,
    rects: [rect],
    ink: 2,
    text: "a passage",
    note: "",
    createdAt: 1,
    updatedAt: 2,
    ...over,
  });

  it("cleans a highlight without ever throwing, whatever it is handed", () => {
    for (const junk of [null, undefined, 7, "x", [], {}, { id: "x" }]) {
      assert.equal(cleanHighlight(junk), null);
    }
  });

  it("refuses a highlight with no shape — a rectangle is what one IS", () => {
    assert.equal(cleanHighlight(mark({ rects: [] })), null);
    assert.equal(cleanHighlight(mark({ rects: [{ x: 0.5, y: 0.5, w: 0, h: 0.1 }] })), null);
  });

  it("clamps a rectangle to its own page", () => {
    const out = cleanHighlight(mark({ rects: [{ x: 0.9, y: 0.9, w: 5, h: 5 }] }));
    assert.ok(out);
    assert.equal(out.rects[0].w, 0.1);
    assert.equal(out.rects[0].h, 0.1);
  });

  it("clamps the ink to the six that exist", () => {
    assert.equal(cleanHighlight(mark({ ink: 99 }))?.ink, 6);
    assert.equal(cleanHighlight(mark({ ink: 0 }))?.ink, 1);
    assert.equal(cleanHighlight(mark({ ink: "red" }))?.ink, 1);
  });

  it("keeps the newlines in a quote and strips the control range around them", () => {
    // A quotation from a poem or a table is not one paragraph, and flattening
    // it would silently reflow what somebody copied.
    const bell = String.fromCharCode(7);
    const out = cleanHighlight(mark({ text: `line ${bell}one\nline two` }));
    assert.equal(out?.text, "line one\nline two");
  });

  it("caps the rectangles a hand-edited file can carry", () => {
    const many = Array.from({ length: HIGHLIGHT_RECTS_MAX * 3 }, () => rect);
    assert.equal(cleanHighlight(mark({ rects: many }))?.rects.length, HIGHLIGHT_RECTS_MAX);
  });

  it("sorts a book's highlights into reading order and drops duplicate ids", () => {
    const list = cleanHighlights([
      mark({ id: "bbbb", page: 9 }),
      mark({ id: "aaaa", page: 2 }),
      mark({ id: "aaaa", page: 400 }),
    ]);
    assert.deepEqual(list.map((h) => h.page), [2, 9]);
  });

  it("mints ids that are spellable inside a wikilink", () => {
    for (let i = 0; i < 50; i += 1) assert.ok(isHighlightId(newHighlightId()));
    assert.ok(!isHighlightId("has space"));
    assert.ok(!isHighlightId("UPPER"));
    assert.ok(!isHighlightId("ab"));
  });

  it("bounds a set of ribbons with one box", () => {
    assert.deepEqual(
      boundingRect([
        { x: 0.4, y: 0.1, w: 0.2, h: 0.02 },
        { x: 0.1, y: 0.14, w: 0.3, h: 0.02 },
      ]),
      { x: 0.1, y: 0.1, w: 0.5, h: 0.06 },
    );
    assert.equal(boundingRect([]), null);
  });
});

describe("the citation anchor", () => {
  const anchor = { page: 42, rect: { x: 0.118, y: 0.313, w: 0.742, h: 0.081 }, id: "k7f3q2a9" };

  it("round-trips through the `#…` half of a wikilink", () => {
    const text = formatBookAnchor(anchor);
    assert.equal(text, "page=42&rect=0.118,0.313,0.742,0.081&id=k7f3q2a9");
    assert.deepEqual(parseBookAnchor(text), anchor);
  });

  it("is not a heading, and a heading is not it", () => {
    // `page=` carrying a NUMBER is the whole of what tells the two apart, and
    // it has to be strict: a note may well have a heading called "page=one".
    assert.equal(parseBookAnchor("Chapter Seven"), null);
    assert.equal(parseBookAnchor("page=one"), null);
    assert.equal(parseBookAnchor(""), null);
    assert.deepEqual(parseBookAnchor("page=7"), { page: 7, rect: null, id: null });
  });

  it("drops a corrupted rect or id rather than the whole citation", () => {
    // The page is what the link is FOR. A truncated rect costs the pulse; it
    // must not cost the reader the page.
    const out = parseBookAnchor("page=9&rect=0.1,0.2&id=NOPE");
    assert.deepEqual(out, { page: 9, rect: null, id: null });
  });

  it("builds a wikilink the vault's own parser can read back", () => {
    const link = bookCitationLink("Ihya.pdf", anchor, "Ihya, p. 42");
    assert.equal(
      link,
      "[[Ihya.pdf#page=42&rect=0.118,0.313,0.742,0.081&id=k7f3q2a9|Ihya, p. 42]]",
    );
    const inner = /^\[\[(.*)\]\]$/.exec(link)?.[1] ?? "";
    const hash = inner.indexOf("#");
    const [anchorText, alias] = inner.slice(hash + 1).split("|");
    assert.equal(inner.slice(0, hash), "Ihya.pdf");
    assert.equal(alias, "Ihya, p. 42");
    assert.deepEqual(parseBookAnchor(anchorText), anchor);
  });

  it("scrubs the characters a wikilink cannot carry out of a book's own name", () => {
    // A PDF is a file somebody ELSE named, and `]]` in a filename would end
    // the link early — producing not a broken link but a DIFFERENT one.
    const link = bookCitationLink("we[i]rd|name#1.pdf", { page: 2, rect: null, id: null }, "x]y");
    assert.equal(link, "[[we i rd name 1.pdf#page=2|x y]]");
  });

  it("prefixes every line of a quote, blank ones included", () => {
    // A callout whose body has an unprefixed blank line ENDS there, which puts
    // the second paragraph outside the box and the attribution somewhere else.
    const block = citationBlock("one\n\ntwo", "[[B.pdf#page=1]]");
    assert.equal(block, "> [!quote]\n> one\n>\n> two\n>\n> — [[B.pdf#page=1]]\n");
    assert.ok(block.split("\n").every((l) => l === "" || l.startsWith(">")));
  });
});

describe("a rectangle on a turned page", () => {
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };

  it("turns clockwise, sending the top-left corner to the top-right", () => {
    assert.deepEqual(rotateRect(rect, 90), { x: 0.75, y: 0.1, w: 0.05, h: 0.3 });
    assert.deepEqual(rotateRect(rect, 180), { x: 0.6, y: 0.75, w: 0.3, h: 0.05 });
  });

  it("un-turns exactly, so a passage marked sideways lands where it was", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      assert.deepEqual(unrotateRect(rotateRect(rect, rotation), rotation), rect);
    }
  });
});

// ── The store on disk ──────────────────────────────────────────────────────

const data = makeDir();
const vault = makeVault({
  "Notes.md": "# hi\n",
  "Books/Muqaddimah.pdf": `%PDF-1.7\n${"a".repeat(400)}\ntrailer<</ID[<AAAA><BBBB>]>>\n%%EOF\n`,
  "Books/Other.pdf": `%PDF-1.7\n${"b".repeat(400)}\ntrailer<</ID[<CCCC><DDDD>]>>\n%%EOF\n`,
  "Books/notes.txt": "not a book",
});

before(() => {
  initSite({ VELLUM_DATA: data });
  initVault(vault);
});

after(() => {
  removeVault(vault);
  removeVault(data);
});

describe("the book store", () => {
  it("keys a book by its bytes, so a rename does not lose the position", async () => {
    const before = await bookKey("Books/Muqaddimah.pdf");
    assert.ok(isBookKey(before));
    // The same bytes at a different path — what `mv` in a terminal, Obsidian's
    // file explorer, Syncthing and `git pull` all do to a vault.
    mkdirSync(path.join(vault, "Shelf"), { recursive: true });
    writeFileSync(
      path.join(vault, "Shelf", "Ibn Khaldun.pdf"),
      `%PDF-1.7\n${"a".repeat(400)}\ntrailer<</ID[<AAAA><BBBB>]>>\n%%EOF\n`,
    );
    assert.equal(await bookKey("Shelf/Ibn Khaldun.pdf"), before);
  });

  it("gives different books different keys", async () => {
    assert.notEqual(await bookKey("Books/Muqaddimah.pdf"), await bookKey("Books/Other.pdf"));
  });

  it("refuses anything that is not a PDF, and anything that is not there", async () => {
    await assert.rejects(() => bookKey("Books/notes.txt"), (err: unknown) => {
      assert.ok(err instanceof VaultError);
      assert.equal(err.status, 400);
      return true;
    });
    await assert.rejects(() => bookKey("Books/Missing.pdf"), (err: unknown) => {
      assert.ok(err instanceof VaultError);
      assert.equal(err.status, 404);
      return true;
    });
  });

  it("remembers a position, merges partial writes and forgets on request", async () => {
    const key = await bookKey("Books/Muqaddimah.pdf");
    assert.equal(getBookState(key), null, "a book nobody opened has no state, which is not page 1");

    putBookState(key, { page: 612, offset: 0.25, pages: 900, fit: "page", title: "Muqaddimah" });
    const stored = getBookState(key);
    assert.ok(stored);
    assert.equal(stored.page, 612);
    assert.equal(stored.fit, "page");
    assert.ok(stored.updatedAt > 0);

    putBookState(key, { page: 613 });
    const merged = getBookState(key);
    assert.equal(merged?.page, 613);
    assert.equal(merged?.fit, "page", "a scroll write must not undo a fit mode");
    assert.equal(merged?.title, "Muqaddimah");

    forgetBook(key);
    assert.equal(getBookState(key), null);
    forgetBook(key); // forgetting twice is not an error
  });

  it("refuses a key that is not a key", () => {
    assert.throws(() => putBookState("nope", { page: 1 }), VaultError);
    assert.throws(() => getBookState("nope"), VaultError);
  });

  it("writes into VELLUM_DATA and NEVER into the vault", async () => {
    const key = await bookKey("Books/Other.pdf");
    const bookPath = path.join(vault, "Books", "Other.pdf");
    const bytesBefore = statSync(bookPath).size;
    const mtimeBefore = statSync(bookPath).mtimeMs;
    const vaultBefore = listTree(vault);

    putBookState(key, { page: 40, pages: 100 });

    assert.deepEqual(listTree(vault), vaultBefore, "the reader left nothing behind in the vault");
    assert.equal(statSync(bookPath).size, bytesBefore, "the PDF itself is never written to");
    assert.equal(statSync(bookPath).mtimeMs, mtimeBefore);
    assert.ok(readdirSync(data).includes("books.json"), "the position lives in VELLUM_DATA");
  });

  it("lists the vault's PDFs and nothing else, most recently read first", async () => {
    const other = await bookKey("Books/Other.pdf");
    putBookState(other, { page: 12, pages: 100 });
    const { books, truncated } = await listBooks();
    assert.equal(truncated, false);
    const paths = books.map((b) => b.path).sort();
    assert.deepEqual(paths, ["Books/Muqaddimah.pdf", "Books/Other.pdf", "Shelf/Ibn Khaldun.pdf"]);
    assert.equal(books[0].path, "Books/Other.pdf", "the book you were just reading comes first");
    assert.ok(books.every((b) => isBookKey(b.key)));
    assert.ok(!paths.includes("Books/notes.txt"));
    assert.ok(!paths.includes("Notes.md"));
  });
});

describe("annotations on disk", () => {
  const rects = [{ x: 0.118, y: 0.313, w: 0.742, h: 0.081 }];
  const mark = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    page: 42,
    rects,
    ink: 3,
    text: "a passage worth keeping",
    note: "",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });

  it("NEVER writes to the PDF — not one byte, not the mtime", async () => {
    // The promise the whole vault rests on. A reader who marks a sentence must
    // not thereby rewrite a 400 MB scan that five machines then have to pull
    // down again — which is exactly what a /Annots entry in the file would do.
    const key = await bookKey("Books/Muqaddimah.pdf");
    const book = path.join(vault, "Books", "Muqaddimah.pdf");
    const bytesBefore = readFileSync(book);
    const mtimeBefore = statSync(book).mtimeMs;
    const vaultBefore = listTree(vault);

    putHighlight(key, mark("hl000001"));
    putHighlight(key, mark("hl000002", { page: 7, note: "and a note in the margin" }));

    assert.deepEqual(listTree(vault), vaultBefore, "nothing was left in the vault");
    assert.ok(readFileSync(book).equals(bytesBefore), "the PDF's bytes are untouched");
    assert.equal(statSync(book).mtimeMs, mtimeBefore, "and so is its mtime");
    assert.ok(readdirSync(data).includes("books.json"), "the passages live in VELLUM_DATA");
  });

  it("keeps them in reading order and upserts by id", async () => {
    const key = await bookKey("Books/Muqaddimah.pdf");
    assert.deepEqual(getHighlights(key).map((h) => h.page), [7, 42]);

    // Changing the ink, writing a margin note and correcting a quote are the
    // same request with the same id — three appends would leave the old ribbon
    // painted underneath the new one.
    putHighlight(key, mark("hl000001", { ink: 5, note: "second thoughts" }));
    const list = getHighlights(key);
    assert.equal(list.length, 2);
    const changed = list.find((h) => h.id === "hl000001");
    assert.equal(changed?.ink, 5);
    assert.equal(changed?.note, "second thoughts");
  });

  it("refuses a body that is not a highlight, and a key that is not a key", () => {
    assert.throws(() => putHighlight("nope", mark("hl000003")), VaultError);
    assert.throws(() => putHighlight("a".repeat(64), { id: "hl000003" }), VaultError);
    assert.throws(() => getHighlights("nope"), VaultError);
  });

  it("survives the store being read back from disk", async () => {
    // The store is mtime-cached, so this is the path a second process (or the
    // next boot) takes: parse, validate, and hand back the same passages.
    const key = await bookKey("Books/Muqaddimah.pdf");
    const onDisk: unknown = JSON.parse(readFileSync(path.join(data, "books.json"), "utf8"));
    const stored = (onDisk as { highlights: Record<string, unknown[]> }).highlights[key];
    assert.equal(stored.length, 2);
    assert.deepEqual(cleanHighlights(stored).map((h) => h.id), ["hl000002", "hl000001"]);
  });

  it("does not lose annotations when a reading position is forgotten", async () => {
    // `:forget` means "stop resuming this book" — a sentence about a scroll
    // offset. The passages someone marked are their work, and a command that
    // reads as tidying up must never be the command that throws work away.
    const key = await bookKey("Books/Muqaddimah.pdf");
    putBookState(key, { page: 42, pages: 900 });
    forgetBook(key);
    assert.equal(getBookState(key), null);
    assert.equal(getHighlights(key).length, 2);
  });

  it("deletes one, twice, without complaining the second time", async () => {
    const key = await bookKey("Books/Muqaddimah.pdf");
    deleteHighlight(key, "hl000002");
    assert.deepEqual(getHighlights(key).map((h) => h.id), ["hl000001"]);
    deleteHighlight(key, "hl000002"); // the Undo and a second `x` are the same request
    assert.equal(getHighlights(key).length, 1);
  });

  it("lists every passage in the vault for the shelf's search", async () => {
    const { hits, truncated } = allHighlights();
    assert.equal(truncated, false);
    assert.ok(hits.some((h) => h.highlight.id === "hl000001"));
    assert.ok(hits.every((h) => isBookKey(h.key)));
  });

  it("finds the book a citation names AFTER it has been renamed", async () => {
    // THE WHOLE POINT OF A CITATION. A note says `[[Other.pdf#page=42&…]]` and
    // then the file is filed by hand under another name — which is what people
    // do to a shelf, and what `mv`, Obsidian, Syncthing and `git pull` all do
    // to this directory without telling us. The id names a content key, the
    // key is the bytes, so the passage is still findable.
    const key = await bookKey("Books/Other.pdf");
    putBookState(key, { path: "Books/Other.pdf", pages: 900 });
    putHighlight(key, mark("hl000009", { text: "the passage that was cited" }));

    mkdirSync(path.join(vault, "Sources"), { recursive: true });
    const moved = "Sources/Ibn Khaldun - al-Muqaddimah (ed. 2005).pdf";
    renameSync(path.join(vault, "Books", "Other.pdf"), path.join(vault, moved));

    const found = await locateHighlight("hl000009");
    assert.ok(found, "the citation still resolves");
    assert.equal(found.key, key);
    assert.equal(found.path, moved, "found by its bytes, under a name it has never worn");
    assert.equal(found.highlight.page, 42);
    // …and the names it HAS worn, which is what the "repair this link?" offer
    // is built from.
    assert.ok(found.names.includes("Books/Other.pdf"));

    // Put it back, so what follows sees the vault the fixture built.
    renameSync(path.join(vault, moved), path.join(vault, "Books", "Other.pdf"));
  });

  it("answers null for a citation whose bytes have left the vault", async () => {
    assert.equal(await locateHighlight("zzzzzzzz"), null);
    await assert.rejects(async () => locateHighlight("NOT AN ID"), VaultError);
  });

  it("remembers the names a book has been filed under, newest first and capped", async () => {
    const key = await bookKey("Books/Other.pdf");
    for (let i = 0; i < NAMES_MAX * 2; i += 1) putBookState(key, { path: `Shelf/name-${i}.pdf` });
    const state = getBookState(key);
    assert.ok(state);
    assert.equal(state.names.length, NAMES_MAX);
    assert.equal(state.names[0], `Shelf/name-${NAMES_MAX * 2 - 1}.pdf`);
    // Re-seeing a book where it already was does not write its name twice.
    putBookState(key, { path: state.names[0] });
    assert.equal(getBookState(key)?.names.length, NAMES_MAX);
    assert.equal(new Set(getBookState(key)?.names).size, NAMES_MAX);
  });
});

/** Every file under `root`, relative and sorted — the fixture for "nothing was
 *  added to the vault". */
function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}
