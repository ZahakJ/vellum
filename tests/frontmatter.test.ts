// Frontmatter surgery (server/publish.ts + client/publish.ts).
//
// The contract is byte-level: setFrontmatterLine() rewrites ONE line and every
// other byte of the note survives — ids, key order, odd indentation, CRLF, the
// body's own `---` rules. That is a property, not a handful of examples, so
// most of this file generates notes and checks the invariant directly.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPublishedContent } from "../client/publish.ts";
import {
  isPublished,
  publishFlag,
  readFrontmatter,
  setFrontmatterLine,
  setPublishFlag,
  yamlQuote,
} from "../server/publish.ts";
import { frontmatterKeyRefusal, setNoteProperty } from "../server/frontmatterEdit.ts";
import type { PropertyValue } from "../shared/types.ts";
import { readNoteFrontmatter } from "../server/noteFrontmatter.ts";
import { pick, rng } from "./helpers/vault.ts";

/** Split a string into lines that KEEP their terminators, so a comparison of
 *  the surviving lines is a comparison of bytes. */
function linesWithEndings(src: string): string[] {
  return src.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Every line of `src` except top-level `key:` lines — what a surgical edit
 *  of `key` must leave untouched, byte for byte. */
function otherLines(src: string, key: string): string[] {
  return linesWithEndings(src).filter((l) => !new RegExp(`^${key}:`).test(l));
}

// --------------------------------------------------------------- fixed cases

describe("setFrontmatterLine — the shapes a real vault contains", () => {
  it("replaces an existing key in place, keeping key order", () => {
    const src = "---\ntitle: A\npublish: false\ntags: [x]\n---\nbody\n";
    assert.equal(
      setPublishFlag(src, true),
      "---\ntitle: A\npublish: true\ntags: [x]\n---\nbody\n",
    );
  });

  it("appends the key as the last frontmatter line when absent", () => {
    const src = "---\ntitle: A\n---\nbody\n";
    assert.equal(setPublishFlag(src, true), "---\ntitle: A\npublish: true\n---\nbody\n");
  });

  it("creates a minimal block when the note has no frontmatter", () => {
    assert.equal(setPublishFlag("# Note\n\ntext\n", true), "---\npublish: true\n---\n# Note\n\ntext\n");
  });

  it("removes a line together with exactly one newline", () => {
    const src = "---\ntitle: A\nbanner: \"x.png\"\ntags: [x]\n---\nbody\n";
    assert.equal(
      setFrontmatterLine(src, "banner", null),
      "---\ntitle: A\ntags: [x]\n---\nbody\n",
    );
  });

  it("KNOWN BUG: removing the ONLY frontmatter line leaves a blank line behind", () => {
    // Neither the text before nor the text after the removed line carries the
    // newline that has to go with it, so the block keeps an empty line:
    // "---\n\n---\n". Harmless to every parser, visible in the raw file, and
    // stable (it does not accumulate over repeated toggles — asserted below).
    const src = "---\nbanner: \"x.png\"\n---\nbody\n";
    const once = setFrontmatterLine(src, "banner", null);
    assert.equal(once, "---\n\n---\nbody\n");
    const twice = setFrontmatterLine(
      setFrontmatterLine(once, "banner", 'banner: "y.png"'),
      "banner",
      null,
    );
    assert.equal(twice, once, "the artifact must not grow with each toggle");
  });

  it("is a no-op when removing a key that is not there", () => {
    const src = "---\ntitle: A\n---\nbody\n";
    assert.equal(setFrontmatterLine(src, "banner", null), src);
    assert.equal(setFrontmatterLine("no frontmatter\n", "banner", null), "no frontmatter\n");
  });

  it("preserves CRLF line endings", () => {
    const src = "---\r\ntitle: A\r\npublish: false\r\n---\r\nbody\r\n";
    assert.equal(setPublishFlag(src, true), "---\r\ntitle: A\r\npublish: true\r\n---\r\nbody\r\n");
    assert.equal(
      setFrontmatterLine(src, "banner", 'banner: "x.png"'),
      "---\r\ntitle: A\r\npublish: false\r\nbanner: \"x.png\"\r\n---\r\nbody\r\n",
    );
    assert.equal(
      setFrontmatterLine(src, "publish", null),
      "---\r\ntitle: A\r\n---\r\nbody\r\n",
    );
  });

  it("never touches a matching line in the BODY", () => {
    const src = "---\ntitle: A\n---\nNotes on publishing:\npublish: false\n";
    const out = setPublishFlag(src, true);
    assert.match(out, /^---\ntitle: A\npublish: true\n---\n/);
    assert.match(out, /\npublish: false\n$/, "the body's own line must survive verbatim");
  });

  it("never touches an INDENTED (nested) key of the same name", () => {
    const src = "---\nmeta:\n  publish: false\n---\nbody\n";
    assert.equal(setPublishFlag(src, true), "---\nmeta:\n  publish: false\npublish: true\n---\nbody\n");
  });

  it("survives malformed YAML — the edit is textual, never a re-serialization", () => {
    const src = "---\ntags: [unclosed\ntitle: 'mismatched\"\n---\nbody\n";
    const out = setPublishFlag(src, true);
    assert.equal(out, "---\ntags: [unclosed\ntitle: 'mismatched\"\npublish: true\n---\nbody\n");
  });

  it("keeps quoted values and escapes intact", () => {
    const src = '---\nbanner: "a \\"quoted\\" name.png"\npublish: false\n---\nbody\n';
    const out = setPublishFlag(src, true);
    assert.ok(out.includes('banner: "a \\"quoted\\" name.png"'));
  });

  it("does not let a $-bearing replacement line corrupt the output", () => {
    // String.replace treats $& / $1 / $$ in the replacement specially; the
    // setter escapes them. A banner named "$&.png" is the regression.
    const src = "---\nbanner: old.png\n---\nbody\n";
    const out = setFrontmatterLine(src, "banner", `banner: ${yamlQuote("$&$1$$.png")}`);
    assert.equal(out, '---\nbanner: "$&$1$$.png"\n---\nbody\n');
  });

  it("treats a note that OPENS with a --- rule as frontmatter (as gray-matter does)", () => {
    // Not a defect of the setter — every YAML-frontmatter parser reads a
    // leading `---` as an opening fence — but it is the sharpest edge in this
    // function: the "frontmatter" being edited is really the reader's prose.
    const src = "---\nAn epigraph.\n---\n\nThe note proper.\n";
    assert.equal(setPublishFlag(src, true), "---\nAn epigraph.\npublish: true\n---\n\nThe note proper.\n");
    // client/blog/postPreview.ts is the one place that guards against it
    // (it demands a `key:` line inside the block before believing it).
  });

  it("KNOWN BUG: an empty frontmatter block gets a second block prepended", () => {
    // "---\n---\nbody" is what Obsidian leaves behind when the last property
    // is deleted. `indexOf("\n---", open)` starts past the closing fence, so
    // the block is not recognised and a whole new one is prepended. The note
    // still parses as published (gray-matter reads the FIRST block), which is
    // why this has never been noticed — but the file now carries a stray
    // "---\n---" that renders as a thematic rule.
    const out = setPublishFlag("---\n---\nbody\n", true);
    assert.equal(out, "---\npublish: true\n---\n---\n---\nbody\n");
    assert.equal(isPublished(out), true, "at least the flag still reads back");
    // Update this test when the setter learns to see an empty block.
  });
});

// ------------------------------------------------------------------ property

describe("setFrontmatterLine — property: only the intended line changes", () => {
  const KEYS = ["publish", "banner"] as const;
  const FM_LINES = [
    "title: A note",
    "tags: [alpha, beta]",
    "created: 2026-01-02",
    "aliases:",
    "  - Second name",
    "id: 01JQ8Z",
    "banner: old.png",
    "publish: false",
    "  indented: value",
    "tags: [unclosed",
    "quoted: \"a: colon, and #hash\"",
    "arabic: مذكرة",
    "empty:",
  ];
  const BODY_LINES = [
    "# Heading",
    "",
    "Some prose with a [[wikilink]].",
    "---",
    "publish: true",
    "```",
    "code: block",
    "```",
    "> quote",
    "نص عربي",
  ];

  for (let seed = 1; seed <= 120; seed++) {
    it(`seed ${seed}`, () => {
      const next = rng(seed);
      const nl = next() < 0.3 ? "\r\n" : "\n";
      const key = pick(next, KEYS);
      const fmCount = Math.floor(next() * FM_LINES.length);
      const fm: string[] = [];
      for (let i = 0; i < fmCount; i++) {
        const candidate = pick(next, FM_LINES);
        // One line per key — a duplicate key is its own (documented) case.
        if (!fm.includes(candidate)) fm.push(candidate);
      }
      const bodyCount = Math.floor(next() * BODY_LINES.length);
      const body: string[] = [];
      for (let i = 0; i < bodyCount; i++) body.push(pick(next, BODY_LINES));
      const hasFm = next() < 0.85 && fm.length > 0;
      // A body that OPENS with `---` is frontmatter by every parser's rule
      // (gray-matter included) — see the dedicated case below. Keep it out of
      // the "no frontmatter" arm so the property stays about surgery.
      if (!hasFm && body[0]?.startsWith("---")) body.unshift("Intro.");
      const trailing = next() < 0.5 ? nl : "";
      const bodyText = `${body.join(nl)}${trailing}`;
      const src = hasFm ? `---${nl}${fm.join(nl)}${nl}---${nl}${bodyText}` : bodyText;

      const line = next() < 0.5 ? `${key}: true` : `${key}: ${yamlQuote("value with spaces")}`;
      const out = setFrontmatterLine(src, key, line);

      if (!hasFm) {
        // No block to operate on: exactly one is prepended, the file follows.
        assert.equal(out, `---\n${line}\n---\n${src}`);
        return;
      }

      // 1. The BODY is untouched, byte for byte — including its own `---`
      //    rules, its `publish:`-looking lines and its line endings.
      assert.ok(out.endsWith(bodyText), "the body was modified");
      assert.ok(out.startsWith(`---${nl}`), "the opening fence was modified");

      // 2. Every frontmatter line that is not a top-level `key:` line survives
      //    byte for byte, in order.
      assert.deepEqual(otherLines(out, key), otherLines(src, key), "collateral damage");

      // 3. The key appears exactly once IN THE BLOCK, spelled exactly as
      //    asked (a body line that merely looks like a key does not count).
      const outFm = out.slice(0, out.length - bodyText.length);
      const keyLines = linesWithEndings(outFm).filter((l) => l.startsWith(`${key}:`));
      assert.equal(keyLines.length, 1, `expected one ${key} line, got ${keyLines.length}`);
      assert.equal(keyLines[0].replace(/\r?\n$/, ""), line);

      // 4. Idempotent: applying the same edit again changes nothing.
      assert.equal(setFrontmatterLine(out, key, line), out);

      // 5. Removing it again leaves no such line, keeps the body, and keeps
      //    every other frontmatter line. (Blank lines are compared loosely:
      //    removing the last key leaves one behind — see the KNOWN BUG above.)
      const removed = setFrontmatterLine(out, key, null);
      assert.ok(removed.endsWith(bodyText), "removal damaged the body");
      const removedFm = removed.slice(0, removed.length - bodyText.length);
      assert.equal(linesWithEndings(removedFm).filter((l) => l.startsWith(`${key}:`)).length, 0);
      const solid = (lines: string[]): string[] => lines.filter((l) => l.trim() !== "");
      assert.deepEqual(solid(otherLines(removed, key)), solid(otherLines(src, key)));
    });
  }
});

describe("yamlQuote — round-trips through the YAML parser", () => {
  const VALUES = [
    "simple.png",
    "with spaces.png",
    'has "double" quotes.png',
    "has 'single' quotes.png",
    "back\\slash.png",
    "colon: and #hash.png",
    "{braces} [brackets].png",
    "- leading dash.png",
    "@at &amp *star.png",
    "غلاف الملاحظة.png",
    "emoji 🕯️.png",
    "https://example.com/a?b=c&d=e",
    "%25 percent.png",
    "…ellipsis….png",
  ];

  for (const value of VALUES) {
    it(JSON.stringify(value), () => {
      const src = setFrontmatterLine("---\ntitle: A\n---\nbody\n", "banner", `banner: ${yamlQuote(value)}`);
      assert.equal(readFrontmatter(src).banner, value);
      // …and the body is still exactly the body.
      assert.ok(src.endsWith("---\nbody\n"));
    });
  }
});

// ------------------------------------------------------------- publish flags

describe("publish flag", () => {
  const CASES: [string, boolean][] = [
    ["---\npublish: true\n---\n", true],
    ["---\npublish: True\n---\n", true],
    ["---\npublish: TRUE\n---\n", true],
    ['---\npublish: "true"\n---\n', true],
    ["---\npublish: false\n---\n", false],
    ['---\npublish: "True"\n---\n', false],
    ["---\npublish: yes\n---\n", false],
    ["---\npublish: 1\n---\n", false],
    ["---\ntitle: A\n---\n", false],
    ["no frontmatter at all\n", false],
    ["---\r\npublish: true\r\n---\r\nbody\r\n", true],
  ];

  for (const [src, expected] of CASES) {
    it(`server: ${JSON.stringify(src).slice(0, 46)} → ${expected}`, () => {
      assert.equal(isPublished(src), expected);
    });
  }

  it("the client mirror agrees with the server on every case", () => {
    for (const [src, expected] of CASES) {
      assert.equal(isPublishedContent(src), expected, `client disagrees on ${JSON.stringify(src)}`);
    }
  });

  it("publishFlag reads an already-parsed frontmatter object", () => {
    assert.equal(publishFlag({ publish: true }), true);
    assert.equal(publishFlag({ publish: "true" }), true);
    assert.equal(publishFlag({ publish: "TRUE" }), false);
    assert.equal(publishFlag({}), false);
  });

  it("KNOWN BUG: malformed YAML silently unpublishes on the server only", () => {
    // gray-matter throws on a broken block; readFrontmatter swallows it and
    // answers {} — so the note is NOT published. The client mirror is a line
    // scanner and never sees the breakage, so the status bar keeps showing
    // "Published" for a note the public site has dropped.
    const src = "---\npublish: true\ntags: [unclosed\n---\nbody\n";
    assert.equal(isPublished(src), false, "server: broken YAML ⇒ unpublished");
    assert.equal(isPublishedContent(src), true, "client: still reports published");
  });

  it("KNOWN BUG: a duplicate key splits server and client the same way", () => {
    const src = "---\npublish: true\npublish: true\n---\nbody\n";
    assert.equal(isPublished(src), false);
    assert.equal(isPublishedContent(src), true);
  });

  it("toggling is lossless in both directions", () => {
    const src = "---\ntitle: A\nid: 01JQ\n---\n# A\n\ntext\n";
    const on = setPublishFlag(src, true);
    assert.equal(isPublished(on), true);
    const off = setPublishFlag(on, false);
    assert.equal(isPublished(off), false);
    assert.equal(setPublishFlag(off, true), on);
    assert.equal(otherLines(off, "publish").join(""), otherLines(src, "publish").join(""));
  });
});

// ═══════════════════════════════════════ the properties editor (v1.8, K)
//
// setNoteProperty() is the write behind the editable properties card, and the
// release's story rests on it: "Obsidian's properties editor corrupts YAML
// round-trips; Vellum's frontmatter writer is byte-surgical and
// property-tested." These are the tests that make that a claim rather than a
// boast. The five rails are named in server/frontmatterEdit.ts's header; each
// one has cases here, and the property test at the bottom asserts the first
// of them — only the edited key's lines change — over generated notes.

describe("setNoteProperty — the shapes a real vault contains", () => {
  const NOTE = [
    "---",
    "title: A note        # the working title",
    "tags: [alpha, beta]",
    "aliases:",
    "  - Second name",
    '  - "Third, name"',
    "weight: 3",
    "created: 2026-01-02",
    "# a standalone comment",
    "odd:   'single quoted'",
    "---",
    "# Body",
    "",
    "text",
    "",
  ].join("\n");

  it("keeps a trailing YAML comment when the value under it changes", () => {
    const out = setNoteProperty("n.md", NOTE, "title", { kind: "text", text: "A new title" });
    assert.ok(out.includes("title: A new title        # the working title"));
    assert.equal(readFrontmatter(out).title, "A new title");
  });

  it("preserves quote style — plain stays plain, single stays single", () => {
    const plain = setNoteProperty("n.md", NOTE, "title", { kind: "text", text: "Plain again" });
    assert.ok(plain.includes("title: Plain again "), "a plain scalar must not acquire quotes");
    const single = setNoteProperty("n.md", NOTE, "odd", { kind: "text", text: "it's fine" });
    assert.ok(single.includes("odd:   'it''s fine'"), "single quotes and their spacing survive");
    assert.equal(readFrontmatter(single).odd, "it's fine");
  });

  it("quotes a plain value that would otherwise change YAML type", () => {
    const out = setNoteProperty("n.md", NOTE, "title", { kind: "text", text: "no" });
    assert.equal(readFrontmatter(out).title, "no", "a note titled 'no' is not `false`");
    assert.ok(out.includes('title: "no"'));
  });

  it("keeps a NUMBER plain when the value it replaces was already one", () => {
    const out = setNoteProperty("n.md", NOTE, "weight", { kind: "text", text: "4" });
    assert.ok(out.includes("weight: 4"), "an unquoted number must not acquire quotes");
    assert.equal(readFrontmatter(out).weight, 4);
  });

  it("writes booleans and dates unquoted, so YAML reads them back typed", () => {
    const bool = setNoteProperty("n.md", NOTE, "draft", { kind: "bool", bool: true });
    assert.ok(bool.includes("draft: true"));
    assert.equal(readFrontmatter(bool).draft, true);
    const date = setNoteProperty("n.md", NOTE, "created", { kind: "date", date: "2026-08-24" });
    assert.ok(date.includes("created: 2026-08-24"));
    assert.ok(readFrontmatter(date).created instanceof Date);
  });

  it("edits a BLOCK list by the line, leaving the survivors byte-identical", () => {
    const out = setNoteProperty("n.md", NOTE, "aliases", {
      kind: "list",
      items: ["Third, name", "Fourth"],
    });
    assert.ok(out.includes('  - "Third, name"\n  - Fourth\n'), out);
    assert.ok(!out.includes("Second name"), "the removed item's line is gone");
    assert.deepEqual(readFrontmatter(out).aliases, ["Third, name", "Fourth"]);
    // The block list did NOT collapse onto its key line — the failure that
    // orphans `- item` lines and takes `publish: true` down with the block.
    assert.ok(out.includes("aliases:\n"));
  });

  it("appends one block item and touches nothing else in the list", () => {
    const out = setNoteProperty("n.md", NOTE, "aliases", {
      kind: "list",
      items: ["Second name", "Third, name", "Fourth"],
    });
    assert.ok(out.includes('aliases:\n  - Second name\n  - "Third, name"\n  - Fourth\n'));
  });

  it("keeps a FLOW list flow, and keeps each surviving item's own spelling", () => {
    const out = setNoteProperty("n.md", NOTE, "tags", { kind: "list", items: ["alpha", "gamma"] });
    assert.ok(out.includes("tags: [alpha, gamma]"));
    assert.deepEqual(readFrontmatter(out).tags, ["alpha", "gamma"]);
  });

  it("an emptied list stays a list — removing the key is a different verb", () => {
    const emptied = setNoteProperty("n.md", NOTE, "tags", { kind: "list", items: [] });
    assert.ok(emptied.includes("tags: []"));
    const removed = setNoteProperty("n.md", NOTE, "tags", null);
    assert.ok(!removed.includes("tags:"));
  });

  it("never touches the standalone comment, the body, or any other key", () => {
    for (const key of ["title", "tags", "weight", "created", "odd"]) {
      const out = setNoteProperty("n.md", NOTE, key, { kind: "text", text: "x" });
      assert.ok(out.includes("# a standalone comment"), `${key} ate the comment`);
      assert.ok(out.endsWith("---\n# Body\n\ntext\n"), `${key} touched the body`);
    }
  });

  it("appends an unknown key rather than refusing it — the whole point", () => {
    const out = setNoteProperty("n.md", NOTE, "cssclasses", { kind: "list", items: ["wide"] });
    assert.ok(out.includes("cssclasses: [wide]"));
    assert.deepEqual(readFrontmatter(out).cssclasses, ["wide"]);
  });

  it("removing the last property removes the fence pair (rail 5)", () => {
    assert.equal(setNoteProperty("n.md", "---\nonly: x\n---\nbody\n", "only", null), "body\n");
    assert.equal(
      setNoteProperty("n.md", "---\r\nonly: x\r\n---\r\nbody\r\n", "only", null),
      "body\r\n",
    );
  });

  it("a block-list item's OWN trailing comment survives the list growing", () => {
    // The card's "add a value" hands the whole list back. Rail 4 keeps the
    // bytes of every item whose text is still in the array — comment and all
    // — so appending `gamma` must not rewrite the line `alpha` lives on.
    const src = "---\ntags:\n  - alpha            # a comment inside a block list\n  - beta\n---\nbody\n";
    const out = setNoteProperty("n.md", src, "tags", { kind: "list", items: ["alpha", "beta", "gamma"] });
    assert.ok(out.includes("  - alpha            # a comment inside a block list"), out);
    assert.ok(out.includes("  - gamma"), out);
    assert.deepEqual(readFrontmatter(out).tags, ["alpha", "beta", "gamma"]);
  });

  it("takes the blank line the fence was wearing with it", () => {
    // The shape every hand-written note actually has. Keeping the blank line
    // left the file opening on an empty line — found by the v1.8 browser
    // verification, where the card's × on the last property produced
    // "\n# Solo\n\nBody.\n".
    assert.equal(setNoteProperty("n.md", "---\nonly: x\n---\n\n# Solo\n\nBody.\n", "only", null), "# Solo\n\nBody.\n");
    assert.equal(
      setNoteProperty("n.md", "---\r\nonly: x\r\n---\r\n\r\n# Solo\r\n", "only", null),
      "# Solo\r\n",
    );
    // A SECOND blank line is the author's own spacing and stays.
    assert.equal(setNoteProperty("n.md", "---\nonly: x\n---\n\n\n# Solo\n", "only", null), "\n# Solo\n");
  });

  it("keeps the fences when a COMMENT is all that would be left", () => {
    const src = "---\n# why this note exists\nonly: x\n---\nbody\n";
    assert.equal(setNoteProperty("n.md", src, "only", null), "---\n# why this note exists\n---\nbody\n");
  });

  it("sees the EMPTY block another tool left behind instead of prepending a second", () => {
    // "---\n---\n" is what Obsidian leaves when its card deletes the last
    // property. setFrontmatterLine() cannot see it (a documented bug above);
    // this writer can, so the note never grows a stray `---` rule.
    assert.equal(
      setNoteProperty("n.md", "---\n---\nbody\n", "title", { kind: "text", text: "A" }),
      "---\ntitle: A\n---\nbody\n",
    );
  });

  it("creates a minimal block for a note that has no frontmatter", () => {
    assert.equal(
      setNoteProperty("n.md", "# Note\n", "status", { kind: "text", text: "draft" }),
      "---\nstatus: draft\n---\n# Note\n",
    );
    assert.equal(setNoteProperty("n.md", "# Note\n", "status", null), "# Note\n");
  });

  it("never touches an INDENTED key of the same name", () => {
    const src = "---\nmeta:\n  status: old\n---\nbody\n";
    assert.equal(
      setNoteProperty("n.md", src, "status", { kind: "text", text: "new" }),
      "---\nmeta:\n  status: old\nstatus: new\n---\nbody\n",
    );
  });

  it("survives malformed YAML — the edit is textual, never a re-serialization", () => {
    const src = "---\ntags: [unclosed\ntitle: 'mismatched\"\n---\nbody\n";
    assert.equal(
      setNoteProperty("n.md", src, "status", { kind: "text", text: "ok" }),
      "---\ntags: [unclosed\ntitle: 'mismatched\"\nstatus: ok\n---\nbody\n",
    );
  });

  it("writes a .tex note's COMMENT block, so the file still compiles", () => {
    const src = "%---\n% title: T\n%---%\n\\documentclass{article}\n";
    const out = setNoteProperty("n.tex", src, "tags", { kind: "list", items: ["a", "b"] });
    assert.equal(out, "%---\n% title: T\n% tags: [a, b]\n%---%\n\\documentclass{article}\n");
    assert.deepEqual(readNoteFrontmatter("n.tex", out).tags, ["a", "b"]);
    assert.equal(
      setNoteProperty("n.tex", out, "tags", null),
      src,
      "removal puts the block back exactly as it was",
    );
  });

  it("refuses a key whose SHAPE would break the block it is written into", () => {
    // A `.tex` frontmatter fence is recognised by shared/tex.ts only when every
    // line is an ASCII `key:` or `- item`. An Arabic key in a comment block
    // would make the whole block stop being frontmatter — the note would lose
    // every property it has, `publish:` included.
    assert.equal(frontmatterKeyRefusal("n.md", "عنوان"), null, "markdown takes Arabic keys");
    assert.notEqual(frontmatterKeyRefusal("n.tex", "عنوان"), null);
    assert.notEqual(frontmatterKeyRefusal("n.md", "two words"), null);
    assert.notEqual(frontmatterKeyRefusal("n.md", "a\nb: c"), null);
    assert.notEqual(frontmatterKeyRefusal("n.md", "-dash"), null);
    assert.throws(() => setNoteProperty("n.md", NOTE, "a: b", { kind: "text", text: "x" }));
  });

  it("round-trips an Arabic value without quoting it into a different string", () => {
    const out = setNoteProperty("n.md", NOTE, "المصدر", { kind: "text", text: "مقدمة ابن خلدون" });
    assert.equal(readFrontmatter(out)["المصدر"], "مقدمة ابن خلدون");
    assert.ok(out.includes("# a standalone comment"));
  });
});

describe("setNoteProperty — property: only the edited key's line changes", () => {
  // Single-line keys only: a multi-line value is its own set of cases above,
  // and `otherLines()` cannot express "the item lines under this key".
  const KEYS = ["title", "status", "weight", "banner"] as const;
  // Entries, not lines: a `- item` and an indented key belong to the key above
  // them, and a generator that scatters them loose makes notes whose YAML was
  // already broken — which tests the parser's opinion of garbage rather than
  // this writer's surgery.
  const FM_ENTRIES = [
    ["title: A note"],
    ["tags: [alpha, beta]"],
    ["created: 2026-01-02"],
    ["aliases:", "  - Second name", '  - "Third, name"'],
    ["id: 01JQ8Z"],
    ["banner: old.png"],
    ["publish: false"],
    ["meta:", "  indented: value"],
    ["# a comment line"],
    ['quoted: "a: colon, and #hash"'],
    ["arabic: مذكرة"],
    ["empty:"],
    ["weight: 3"],
    ["blurb: |", "  a folded", "  scalar"],
  ];
  const BODY_LINES = ["# Heading", "", "Prose with a [[wikilink]].", "---", "status: nope", "> quote"];
  const VALUES: PropertyValue[] = [
    { kind: "text", text: "a plain value" },
    { kind: "text", text: 'has "quotes" and: colons' },
    { kind: "text", text: "مذكرة جديدة" },
    { kind: "bool", bool: true },
    { kind: "date", date: "2026-08-24" },
    { kind: "list", items: ["one", "two, three"] },
  ];

  for (let seed = 1; seed <= 120; seed++) {
    it(`seed ${seed}`, () => {
      const next = rng(seed);
      const nl = next() < 0.3 ? "\r\n" : "\n";
      const key = pick(next, KEYS);
      const value = pick(next, VALUES);
      const fm: string[] = [];
      const used: string[][] = [];
      const fmCount = 1 + Math.floor(next() * (FM_ENTRIES.length - 1));
      for (let i = 0; i < fmCount; i++) {
        const candidate = pick(next, FM_ENTRIES);
        if (used.includes(candidate)) continue;
        used.push(candidate);
        fm.push(...candidate);
      }
      const body: string[] = [];
      const bodyCount = Math.floor(next() * BODY_LINES.length);
      for (let i = 0; i < bodyCount; i++) body.push(pick(next, BODY_LINES));
      if (body[0]?.startsWith("---")) body.unshift("Intro.");
      const bodyText = `${body.join(nl)}${next() < 0.5 ? nl : ""}`;
      const src = `---${nl}${fm.join(nl)}${nl}---${nl}${bodyText}`;

      const out = setNoteProperty("n.md", src, key, value);

      // 1. The body survives byte for byte — its own `---` rules and the line
      //    that merely LOOKS like the key included.
      assert.ok(out.endsWith(bodyText), "the body was modified");

      // 2. Every frontmatter line that is not this key's survives, in order.
      assert.deepEqual(otherLines(out, key), otherLines(src, key), "collateral damage");

      // 3. The key appears exactly once in the block…
      const outFm = out.slice(0, out.length - bodyText.length);
      const keyLines = linesWithEndings(outFm).filter((l) => l.startsWith(`${key}:`));
      assert.equal(keyLines.length, 1);

      // 4. …and YAML reads back exactly what was asked for — asserted only
      //    where the generated block was parseable to begin with. The corpus
      //    deliberately contains lines that break YAML (a stray indent, an
      //    empty key), because rails 1-3 above are exactly the promise that
      //    holds on a note whose frontmatter is already broken; what a parser
      //    says about such a note is not this writer's business.
      const plain = out.replace(/\r\n/g, "\n");
      if (Object.keys(readFrontmatter(src.replace(/\r\n/g, "\n"))).length > 0) {
        const read = readFrontmatter(plain)[key];
        if (value.kind === "text") assert.equal(read, value.text);
        else if (value.kind === "bool") assert.equal(read, value.bool);
        else if (value.kind === "list") assert.deepEqual(read, value.items);
        else assert.ok(read instanceof Date);
      }

      // 5. Idempotent, and removal is clean.
      assert.equal(setNoteProperty("n.md", out, key, value), out);
      const removed = setNoteProperty("n.md", out, key, null);
      assert.ok(removed.endsWith(bodyText), "removal damaged the body");
      const removedFm = removed.slice(0, removed.length - bodyText.length);
      assert.equal(linesWithEndings(removedFm).filter((l) => l.startsWith(`${key}:`)).length, 0);
    });
  }
});
