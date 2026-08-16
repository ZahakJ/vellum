// Sections: cutting a note at its headings and putting it back.
//
// Every "move this section", "fold this section" and "preview this section"
// feature is a partition of the note's lines at the line numbers
// client/reading/toc.ts reports. The invariant that keeps those features from
// eating a reader's words is simple and absolute: the partition is EXACT —
// concatenating the pieces returns the original bytes, no line lost, none
// duplicated — and it holds with frontmatter, nested headings, CRLF and a
// fenced code block full of ### lines.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractHeadings } from "../client/reading/toc.ts";
import { pick, rng } from "./helpers/vault.ts";

interface Section {
  /** Heading text, or null for the preamble (frontmatter + opening prose). */
  title: string | null;
  level: number; // 0 for the preamble
  lines: string[];
}

/** Partition a note at its headings. The model every section feature uses. */
function splitSections(md: string): Section[] {
  const lines = md.split("\n");
  const headings = extractHeadings(md);
  const out: Section[] = [];
  const firstLine = headings.length > 0 ? headings[0].line - 1 : lines.length;
  out.push({ title: null, level: 0, lines: lines.slice(0, firstLine) });
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].line - 1;
    const end = i + 1 < headings.length ? headings[i + 1].line - 1 : lines.length;
    out.push({ title: headings[i].text, level: headings[i].level, lines: lines.slice(start, end) });
  }
  return out;
}

function joinSections(sections: Section[]): string {
  return sections.flatMap((s) => s.lines).join("\n");
}

/** A heading's section INCLUDING its sub-sections — what "extract section"
 *  has to take with it, or the children are orphaned under the wrong parent. */
function withChildren(sections: Section[], index: number): Section[] {
  const level = sections[index].level;
  let end = index + 1;
  while (end < sections.length && sections[end].level > level) end++;
  return sections.slice(index, end);
}

const DOC = [
  "---",
  "title: Doc",
  "tags: [a, b]",
  "---",
  "",
  "Opening prose before any heading.",
  "",
  "# One",
  "",
  "First section.",
  "",
  "## One.a",
  "",
  "Nested prose.",
  "",
  "```md",
  "### This is code, not a heading",
  "## Neither is this",
  "```",
  "",
  "### One.a.i",
  "",
  "Deep prose.",
  "",
  "# Two",
  "",
  "Second section.",
  "",
].join("\n");

describe("splitting a note into sections", () => {
  it("reconstructs the original byte for byte", () => {
    assert.equal(joinSections(splitSections(DOC)), DOC);
  });

  it("puts frontmatter and the opening prose in the preamble", () => {
    const [preamble] = splitSections(DOC);
    assert.equal(preamble.title, null);
    assert.ok(preamble.lines.includes("title: Doc"));
    assert.ok(preamble.lines.includes("Opening prose before any heading."));
  });

  it("does not split inside a fenced code block", () => {
    const titles = splitSections(DOC).map((s) => s.title);
    assert.deepEqual(titles, [null, "One", "One.a", "One.a.i", "Two"]);
    const oneA = splitSections(DOC).find((s) => s.title === "One.a");
    assert.ok(oneA);
    assert.ok(oneA.lines.includes("### This is code, not a heading"), "the fence stayed put");
    assert.ok(oneA.lines.includes("## Neither is this"));
  });

  it("carries sub-sections with their parent", () => {
    const sections = splitSections(DOC);
    const oneIndex = sections.findIndex((s) => s.title === "One");
    const block = withChildren(sections, oneIndex);
    assert.deepEqual(block.map((s) => s.title), ["One", "One.a", "One.a.i"]);
  });

  it("extract + reinsert is the identity", () => {
    const sections = splitSections(DOC);
    const index = sections.findIndex((s) => s.title === "One.a");
    const block = withChildren(sections, index);
    const rest = [...sections.slice(0, index), ...sections.slice(index + block.length)];
    assert.notEqual(joinSections(rest), DOC, "…the cut really removed something");
    const back = [...rest.slice(0, index), ...block, ...rest.slice(index)];
    assert.equal(joinSections(back), DOC);
  });

  it("reordering top-level sections loses and duplicates nothing", () => {
    const sections = splitSections(DOC);
    const one = withChildren(sections, sections.findIndex((s) => s.title === "One"));
    const two = withChildren(sections, sections.findIndex((s) => s.title === "Two"));
    const preamble = sections[0];
    const swapped = joinSections([preamble, ...two, ...one]);
    const bag = (text: string): string[] => text.split("\n").slice().sort();
    assert.deepEqual(bag(swapped), bag(DOC), "same lines, different order");
    assert.equal(swapped.length, DOC.length, "same byte count");
    assert.ok(swapped.indexOf("# Two") < swapped.indexOf("# One"), "…and they really swapped");
  });

  it("handles CRLF without dropping the carriage returns", () => {
    const crlf = DOC.replace(/\n/g, "\r\n");
    assert.equal(joinSections(splitSections(crlf)), crlf);
    assert.deepEqual(
      splitSections(crlf).map((s) => s.title),
      [null, "One", "One.a", "One.a.i", "Two"],
    );
  });

  it("handles a note with no headings at all", () => {
    const md = "Just prose.\n\nMore prose.\n";
    const sections = splitSections(md);
    assert.equal(sections.length, 1);
    assert.equal(joinSections(sections), md);
  });

  it("handles a note that is nothing but headings", () => {
    const md = "# A\n## B\n### C\n";
    assert.equal(joinSections(splitSections(md)), md);
    assert.deepEqual(splitSections(md).map((s) => s.lines.length), [0, 1, 1, 2]);
  });

  it("treats an UNTERMINATED frontmatter fence as body (headings inside count)", () => {
    const md = "---\ntitle: A\n# Heading inside a broken block\n";
    assert.deepEqual(extractHeadings(md).map((h) => h.text), ["Heading inside a broken block"]);
    assert.equal(joinSections(splitSections(md)), md);
  });
});

describe("property: the partition is exact for any document", () => {
  const LINES = [
    "# H1",
    "## H2",
    "### H3",
    "#### H4",
    "###### H6",
    "####### not a heading (7 hashes)",
    "#NoSpace",
    "   ## indented heading",
    "",
    "prose line",
    "- list item",
    "> quote",
    "```",
    "### fenced",
    "```",
    "~~~python",
    "# fenced too",
    "~~~",
    "---",
    "| a | b |",
    "نص عربي",
    "$$",
    "\\int_0^1 x\\,dx",
    "$$",
  ];

  for (let seed = 1; seed <= 100; seed++) {
    it(`seed ${seed}`, () => {
      const next = rng(seed);
      const count = 2 + Math.floor(next() * 24);
      const body: string[] = [];
      for (let i = 0; i < count; i++) body.push(pick(next, LINES));
      const md = (next() < 0.4 ? "---\ntitle: T\n---\n" : "") + body.join("\n");

      const sections = splitSections(md);
      // 1. Exact reconstruction — the whole point.
      assert.equal(joinSections(sections), md);
      // 2. No line is claimed twice, and none is dropped.
      const total = sections.reduce((n, s) => n + s.lines.length, 0);
      assert.equal(total, md.split("\n").length);
      // 3. Every section after the preamble starts with its own heading line.
      for (const section of sections.slice(1)) {
        assert.match(section.lines[0], /^#{1,6}\s/, `section "${section.title}" lost its heading`);
      }
      // 4. Line numbers are strictly increasing.
      const lineNumbers = extractHeadings(md).map((h) => h.line);
      for (let i = 1; i < lineNumbers.length; i++) {
        assert.ok(lineNumbers[i] > lineNumbers[i - 1], "heading lines out of order");
      }
    });
  }
});
