// The word count (shared/wordCount.ts) — one rule for the author's status bar
// and the visitor's "N min read", because two would drift and the first anyone
// would notice is a published article claiming a reading time its author never
// saw.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countNoteWords, countWords, noteProse, readingMinutes } from "../shared/wordCount.ts";

describe("noteProse", () => {
  it("drops frontmatter in both formats", () => {
    assert.equal(noteProse("---\ntitle: A\ntags: [x]\n---\nhello there\n").trim(), "hello there");
    // A .tex note's frontmatter is a comment block that still compiles.
    assert.equal(noteProse("%---\n%title: A\n%---%\nhello there\n").trim(), "hello there");
  });

  it("drops code, not the prose around it", () => {
    const md = "before\n\n```js\nconst x = 1;\nlet y = 2;\n```\n\nafter\n";
    const prose = noteProse(md);
    assert.ok(prose.includes("before") && prose.includes("after"));
    assert.ok(!prose.includes("const"), "code fence survived the strip");
  });

  it("drops math but keeps the sentence it sits in", () => {
    const prose = noteProse("The identity $e^{i\\pi}+1=0$ closes the argument.");
    assert.ok(prose.includes("identity") && prose.includes("closes"));
    assert.ok(!prose.includes("pi"));
  });

  it("keeps a link's label and loses its target", () => {
    assert.match(noteProse("see [the paper](https://example.com/a/b) now"), /see the paper now/);
    assert.match(noteProse("see [[Notes/Heat|the paper]] now"), /see the paper now/);
    assert.match(noteProse("see [[Heat Equation]] now"), /see Heat Equation now/);
  });

  it("keeps the words on a heading or list line, losing only the marks", () => {
    const prose = noteProse("## A Real Heading\n\n- first item\n- second item\n");
    assert.ok(prose.includes("A Real Heading"));
    assert.ok(prose.includes("first item"));
    assert.ok(!prose.includes("##") && !prose.includes("- first"));
  });

  it("drops %%comments%% — the syntax this product actually hides", () => {
    assert.ok(!noteProse("visible %%hidden note to self%% visible").includes("hidden"));
  });
});

describe("countWords", () => {
  it("counts English", () => {
    assert.equal(countWords("one two three"), 3);
    assert.equal(countWords("   "), 0);
    assert.equal(countWords(""), 0);
  });

  it("does not count punctuation as words", () => {
    // The old whitespace split counted "—" and "·" as words; the segmenter
    // knows they are not word-like.
    assert.equal(countWords("one — two · three"), 3);
  });

  it("counts Arabic by word, not by whitespace run", () => {
    assert.equal(countWords("الحمد لله رب العالمين"), 4);
  });

  it("counts CJK, where whitespace splitting says 1", () => {
    // The clearest case for the segmenter: this has no spaces at all.
    assert.ok(countWords("这是一个测试") > 1, "CJK counted as a single word");
  });
});

describe("the whole note", () => {
  it("counts prose and ignores the furniture around it", () => {
    const note = [
      "---",
      "title: Test",
      "publish: true",
      "---",
      "# Heading",
      "",
      "One two three four five.",
      "",
      "```sh",
      "echo this is not prose",
      "```",
    ].join("\n");
    // "Heading" + the five words of the sentence.
    assert.equal(countNoteWords(note), 6);
  });

  it("floors at one minute for a note with prose, and zero for one without", () => {
    // Zero is a different fact from "very short", and the blog relies on it:
    // an empty note has an empty excerpt and no reading time.
    assert.equal(readingMinutes(0), 0);
    assert.equal(readingMinutes(1), 1);
    assert.equal(readingMinutes(200), 1);
    assert.equal(readingMinutes(201), 2);
  });
});
