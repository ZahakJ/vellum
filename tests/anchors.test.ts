// Anchors: the "#" half of a wikilink.
//
// Vellum has ONE anchor space with TWO resolvers, and a [[Note#Anchor]] has to
// land in both:
//   • the editor jumps by heading TEXT       (client/editor/links.ts findHeadingLine)
//   • the reading view jumps by heading SLUG (client/reading/toc.ts Slugger,
//     with a textContent fallback in ReadingView)
// Every case below asks the same question of both, because a link that works
// in the editor and dies in the reading view is the bug this file exists for.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractHeadings as editorHeadings, findHeadingLine } from "../client/editor/links.ts";
import { extractHeadings, Slugger, stripInline } from "../client/reading/toc.ts";

/** What the reading view would scroll to for `anchor`: the heading whose slug
 *  matches, else (ReadingView's fallback) the one whose display text matches. */
function readingAnchor(md: string, anchor: string): string | null {
  const headings = extractHeadings(md);
  const wantSlug = new Slugger().slug(stripInline(anchor));
  const bySlug = headings.find((h) => h.slug === wantSlug);
  if (bySlug) return bySlug.text;
  const want = anchor.trim().toLowerCase();
  return headings.find((h) => h.text.trim().toLowerCase() === want)?.text ?? null;
}

describe("Slugger", () => {
  it("lowercases, drops punctuation and hyphenates spaces", () => {
    const s = new Slugger();
    assert.equal(s.slug("What's next? (draft)"), "whats-next-draft");
  });

  it("keeps unicode letters and digits", () => {
    const s = new Slugger();
    assert.equal(s.slug("مقدمة"), "مقدمة");
    assert.equal(s.slug("Étude № 3"), "étude-3");
  });

  it("numbers collisions deterministically", () => {
    const s = new Slugger();
    assert.equal(s.slug("Notes"), "notes");
    assert.equal(s.slug("notes"), "notes-1");
    assert.equal(s.slug("NOTES"), "notes-2");
  });

  it("falls back to 'section' when nothing survives", () => {
    const s = new Slugger();
    assert.equal(s.slug("†‡"), "section");
    assert.equal(s.slug("***"), "section-1");
  });

  it("is a pure function of the sequence, not of time", () => {
    const a = new Slugger();
    const b = new Slugger();
    for (const text of ["A", "A", "B", "A"]) assert.equal(a.slug(text), b.slug(text));
  });
});

describe("stripInline (heading display text)", () => {
  const CASES: [string, string][] = [
    ["Plain heading", "Plain heading"],
    ["**Bold** heading", "Bold heading"],
    ["`code` heading", "code heading"],
    ["A [[Wikilink]] here", "A Wikilink here"],
    ["A [[Target|Alias]] here", "A Alias here"],
    ["An ![[embed.png]]", "An embed.png"],
    ["A [link](https://example.com)", "A link"],
    ["==highlighted==", "highlighted"],
    ["Closed ATX ##", "Closed ATX"],
    ["مقدمة **قصيرة**", "مقدمة قصيرة"],
  ];
  for (const [input, expected] of CASES) {
    it(JSON.stringify(input), () => assert.equal(stripInline(input), expected));
  }
});

describe("extractHeadings", () => {
  it("skips frontmatter and reports 1-based source lines", () => {
    const md = "---\ntitle: A\n---\n# One\n\ntext\n\n## Two\n";
    assert.deepEqual(
      extractHeadings(md).map((h) => [h.level, h.text, h.line]),
      [
        [1, "One", 4],
        [2, "Two", 8],
      ],
    );
  });

  it("never reports a ### inside a fenced code block", () => {
    const md = "# Real\n\n```md\n### Not a heading\n```\n\n## Also real\n";
    assert.deepEqual(extractHeadings(md).map((h) => h.text), ["Real", "Also real"]);
  });

  it("handles nested levels and duplicate names", () => {
    const md = "# A\n## B\n### B\n## B\n";
    assert.deepEqual(
      extractHeadings(md).map((h) => `${h.level}:${h.slug}`),
      ["1:a", "2:b", "3:b-1", "2:b-2"],
    );
  });

  it("marks a link-list section as furniture (TOC noise, still anchorable)", () => {
    const md = "# Real\n\nProse here.\n\n## Related\n\n- [[A]]\n- [[B]]\n";
    const [real, related] = extractHeadings(md);
    assert.equal(real.furniture, undefined);
    assert.equal(related.furniture, true);
  });
});

describe("[[Note#Anchor]] resolution, both resolvers", () => {
  const md = [
    "---",
    "title: Doc",
    "---",
    "# Doc",
    "",
    "## What's next? (draft)",
    "",
    "prose",
    "",
    "## مقدمة",
    "",
    "نص",
    "",
    "## **Bold** section",
    "",
    "## Repeat",
    "",
    "## Repeat",
    "",
    "```",
    "## Fenced not-a-heading",
    "```",
    "",
  ].join("\n");

  const RESOLVES = ["Doc", "What's next? (draft)", "مقدمة", "Repeat"];
  for (const anchor of RESOLVES) {
    it(`#${anchor} resolves in the editor AND the reading view`, () => {
      assert.notEqual(findHeadingLine(md, anchor), null, "editor cannot find it");
      assert.notEqual(readingAnchor(md, anchor), null, "reading view cannot find it");
    });
  }

  it("is case-insensitive in both", () => {
    assert.notEqual(findHeadingLine(md, "what's NEXT? (draft)"), null);
    assert.notEqual(readingAnchor(md, "what's NEXT? (draft)"), null);
  });

  it("never resolves to a heading inside a code fence", () => {
    assert.equal(findHeadingLine(md, "Fenced not-a-heading"), null);
    assert.equal(readingAnchor(md, "Fenced not-a-heading"), null);
  });

  it("resolves a duplicated heading to the FIRST one in both", () => {
    assert.equal(findHeadingLine(md, "Repeat"), 16);
    const headings = extractHeadings(md);
    const first = headings.find((h) => h.text === "Repeat");
    assert.equal(first?.line, 16);
    assert.equal(first?.slug, "repeat", "the first keeps the un-suffixed slug");
  });

  it("KNOWN BUG: the editor resolves emphasis differently from the reading view", () => {
    // The editor matches the RAW heading source; the reading view matches the
    // stripped display text. "## **Bold** section" is therefore reachable as
    // "**Bold** section" in the editor and as "Bold section" in the reading
    // view — and neither spelling works in both.
    assert.notEqual(findHeadingLine(md, "**Bold** section"), null);
    assert.equal(findHeadingLine(md, "Bold section"), null);
    assert.equal(readingAnchor(md, "**Bold** section"), "Bold section", "…via the slug");
    assert.notEqual(readingAnchor(md, "Bold section"), null);
  });

  it("KNOWN BUG: an indented heading exists for the editor and not for the reader", () => {
    // links.ts (and server/indexer.ts) allow up to three leading spaces, as
    // CommonMark does; reading/toc.ts and reading/render.ts anchor `#` to
    // column 0. So "   ## Indented" gets an anchor in the editor and no id in
    // the reading view — the link silently does nothing there.
    const indented = "# Top\n\n   ## Indented\n\ntext\n";
    assert.equal(findHeadingLine(indented, "Indented"), 3);
    assert.deepEqual(editorHeadings(indented), ["Top", "Indented"]);
    assert.deepEqual(extractHeadings(indented).map((h) => h.text), ["Top"]);
    assert.equal(readingAnchor(indented, "Indented"), null);
  });

  it("KNOWN BUG: a closed-ATX heading is unreachable from the editor", () => {
    // "## Notes ##" displays (and slugs) as "Notes", but findHeadingLine keeps
    // the trailing hashes in the text it compares, so [[Doc#Notes]] fails in
    // the editor while working in the reading view.
    const closed = "# Top\n\n## Notes ##\n\ntext\n";
    assert.equal(readingAnchor(closed, "Notes"), "Notes");
    assert.equal(findHeadingLine(closed, "Notes"), null);
    assert.equal(findHeadingLine(closed, "Notes ##"), 3, "only the raw spelling works");
  });

  it("an empty or whitespace anchor resolves to nothing", () => {
    assert.equal(findHeadingLine(md, ""), null);
    assert.equal(findHeadingLine(md, "   "), null);
  });
});
