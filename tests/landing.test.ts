// Landing on the line: the wire numbers a click stakes everything on.
//
// Backlinks and search matches now carry a 1-based line in the note's FULL
// source — frontmatter included — because that is the coordinate the editor
// counts in. The indexer parses `body`, which LOST the frontmatter block, so
// the offset arithmetic here is the whole feature: off by the size of a
// properties block, every landing sits above the mention it promised.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { backlinks, initIndexer, searchMatches } from "../server/indexer.ts";
import { initSite } from "../server/site.ts";
import { initVault } from "../server/vault.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

const data = makeDir();

// `note(fm, body)` writes `---\n<one line per key>\n---\n<body>`, so a block
// with K keys costs K + 2 file lines and body line N is file line N + K + 2.
const fmLines = (keys: number): number => keys + 2;

const root = makeVault({
  "Target.md": "# Target\n",
  // Frontmatter + the mention on the 4th BODY line = file line 7.
  "WithFm.md": note(
    { publish: "true", tags: "x" },
    "intro line\n\nmore prose here\nA mention of [[Target]] mid-note.\n",
  ),
  // No frontmatter: body lines ARE file lines. Two mentions, one per line.
  "Bare.md": "First [[Target]] here.\nplain\nSecond [[Target]] here.\n",
  "Findable.md": note(
    { publish: "true" },
    [
      "# Heading about tulips",
      "",
      "The tulip season starts in March.",
      "Nothing relevant on this line.",
      "TULIPS again, uppercased.",
      // One very long hard-wrapped line: the quote must window, not ship it.
      `${"pad ".repeat(120)}a tulip buried mid-paragraph ${"pad ".repeat(120)}`,
    ].join("\n") + "\n",
  ),
  // A TABLE, which is fields and not a sentence. The link and the search term
  // each sit in a cell that is not the first one (UX audit F44: the context
  // line used to be every cell of the row joined with " · ").
  "Shelf.md": [
    "# Shelf",
    "",
    "| Title | Author | Note |",
    "| --- | --- | --- |",
    "| Dune | Herbert | see [[Target]] for the reread |",
    "| Piranesi | Clarke | a tulip in the vestibule |",
  ].join("\n") + "\n",
  "Unpublished.md": "secret tulip\n",
  // 150 matching lines: the cap must hold at 100.
  "Many.md": Array.from({ length: 150 }, (_, i) => `tulip row ${i}`).join("\n") + "\n",
});

before(async () => {
  initSite({ VELLUM_DATA: data });
  initVault(root);
  await initIndexer();
});

after(() => {
  removeVault(root);
  removeVault(data);
});

describe("backlink lines", () => {
  it("counts frontmatter back in: the wire line is a FULL-file line", () => {
    const hits = backlinks("Target.md", false, null);
    const fromFm = hits.find((h) => h.path === "WithFm.md");
    assert.ok(fromFm, "WithFm.md links to Target and must appear");
    // body line 4 ("A mention of…") + the 2-key frontmatter block.
    assert.equal(fromFm.line, 4 + fmLines(2));
  });

  it("is 1-based and unshifted when there is no frontmatter", () => {
    const lines = backlinks("Target.md", false, null)
      .filter((h) => h.path === "Bare.md")
      .map((h) => h.line)
      .sort((a, b) => a - b);
    assert.deepEqual(lines, [1, 3]);
  });
});

describe("context lines out of a table", () => {
  it("quotes the CELL the link is in, not a join of the whole row", () => {
    const hit = backlinks("Target.md", false, null).find((h) => h.path === "Shelf.md");
    assert.ok(hit, "the table row links to Target and must appear");
    assert.ok(hit.context.includes("[[Target]]"), hit.context);
    assert.ok(!hit.context.includes("Herbert"), `a neighbouring cell leaked: ${hit.context}`);
    assert.ok(!hit.context.includes("|"), `a raw table pipe reached the reader: ${hit.context}`);
    // The separator this replaced. A `·` between two runs of text is banned
    // everywhere in this product — the Eastern Arabic zero is a raised dot.
    assert.ok(!hit.context.includes("·"), `the cell join came back: ${hit.context}`);
  });

  it("quotes the cell the SEARCH TERM is in, and never the alignment row", () => {
    const out = searchMatches("Shelf.md", "tulip", false, null);
    assert.equal(out.length, 1);
    assert.match(out[0].text, /<mark>tulip<\/mark>/);
    assert.ok(!out[0].text.includes("Clarke"), `a neighbouring cell leaked: ${out[0].text}`);
    // The `---` row matches nothing, but it must not be quotable for anything
    // either: it is punctuation, not a line of the note.
    assert.deepEqual(searchMatches("Shelf.md", "---", false, null), []);
  });
});

describe("searchMatches", () => {
  it("quotes every matching line with its full-file line number", () => {
    const out = searchMatches("Findable.md", "tulips", false, null);
    // Heading (body line 1 → file 4), "TULIPS again" (body 5 → file 8):
    // substring semantics, case-insensitive. "tulip season"/"a tulip" do NOT
    // contain "tulips" and must not be quoted for it.
    assert.deepEqual(out.map((m) => m.line), [1 + fmLines(1), 5 + fmLines(1)]);
    for (const m of out) assert.match(m.text, /<mark>tulips<\/mark>/i);
  });

  it("matches any term of a multi-word query, `#` stripped", () => {
    const out = searchMatches("Findable.md", "#march nothing", false, null);
    assert.deepEqual(out.map((m) => m.line), [3 + fmLines(1), 4 + fmLines(1)]);
  });

  it("windows a long line around the match instead of shipping it", () => {
    const out = searchMatches("Findable.md", "buried", false, null);
    assert.equal(out.length, 1);
    const text = out[0].text;
    assert.ok(text.length < 400, `windowed quote still ${text.length} chars`);
    assert.match(text, /<mark>buried<\/mark>/);
    assert.match(text, /…/); // a cut is marked as a cut
  });

  it("caps at 100 matches", () => {
    const out = searchMatches("Many.md", "tulip", false, null);
    assert.equal(out.length, 100);
    assert.equal(out[0].line, 1);
    assert.equal(out.at(-1)?.line, 100);
  });

  it("answers a visitor asking about an unpublished note with [], never 404", () => {
    // The same refusal shape backlinks() makes: [] for hidden and for missing
    // alike, so the response cannot confirm the path exists.
    assert.deepEqual(searchMatches("Unpublished.md", "tulip", true, null), []);
    assert.deepEqual(searchMatches("Nope.md", "tulip", false, null), []);
    assert.equal(searchMatches("Unpublished.md", "tulip", false, null).length, 1);
  });

  it("escapes note text: a line is data, never markup", () => {
    // The <mark> wrapper is the ONLY markup in `text` — anything the note
    // itself spells in angle brackets must arrive escaped (the client renders
    // through the same escape-aware snippet renderer search hits use).
    const out = searchMatches("Findable.md", "relevant", false, null);
    assert.equal(out.length, 1);
    assert.ok(!/<(?!\/?mark>)/.test(out[0].text), "unescaped markup leaked");
  });

  it("an empty or whitespace query matches nothing", () => {
    assert.deepEqual(searchMatches("Findable.md", "   ", false, null), []);
  });
});
