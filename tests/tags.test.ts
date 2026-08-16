// Tag extraction and the EXCLUDE_TAGS curation layer (server/indexer.ts +
// server/site.ts). Tags are the blog's topic navigation, so a false positive
// does not stay quiet: it becomes a heading, a pill and a /topic/ page.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { initIndexer, tags } from "../server/indexer.ts";
import { initSite } from "../server/site.ts";
import { initVault } from "../server/vault.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

const data = makeDir();
const root = makeVault({
  "Inline.md": note(
    { publish: "true" },
    [
      "Prose with #draft and #zettel/seed and (#paren) tags.",
      "A repeat of #draft counts once.",
      "Case folds: #Draft #DRAFT.",
      "Arabic tags work: #مسودة and #كتب_عربية.",
      "Digits are fine: #2026 and #v2.",
      "",
      "Not tags: https://example.com/#anchor, C#, a#b, # heading-ish, #.",
    ].join("\n"),
  ),
  "Flow list.md": note({ publish: "true", tags: "[alpha, beta]" }, "body\n"),
  "Scalar.md": note({ publish: "true", tags: "gamma" }, "body\n"),
  "Quoted.md": note({ publish: "true", tags: '["#delta", \'epsilon\']' }, "body\n"),
  "Block list.md": `---\npublish: true\ntags:\n  - zeta\n  - eta\nother: x\n---\nbody\n`,
  "Private.md": note({ tags: "[secret]" }, "unpublished #hidden\n"),
  "Fence.md": note({ publish: "true" }, "```sh\n#define MACRO 1\n```\n"),
  "Color.md": note({ publish: "true" }, "The accent is #c9a227 in the dark themes.\n"),
});

const count = new Map<string, number>();

before(async () => {
  initSite({ VELLUM_DATA: data });
  initVault(root);
  await initIndexer();
  for (const entry of tags()) count.set(entry.tag, entry.count);
});

after(() => {
  removeVault(root);
  removeVault(data);
});

describe("inline #tags", () => {
  it("finds them at a word start, after whitespace or after '('", () => {
    for (const tag of ["draft", "zettel/seed", "paren"]) {
      assert.ok(count.has(tag), `missing #${tag}`);
    }
  });

  it("folds case and counts a note once per tag", () => {
    assert.equal(count.get("draft"), 1, "one note, one count, however often it appears");
    assert.ok(!count.has("Draft"));
  });

  it("accepts unicode letters, underscores and digits", () => {
    for (const tag of ["مسودة", "كتب_عربية", "2026", "v2"]) {
      assert.ok(count.has(tag), `missing #${tag}`);
    }
  });

  it("does not invent tags from URLs, C#, mid-word # or a bare #", () => {
    for (const notTag of ["anchor", "b", "heading-ish"]) {
      assert.ok(!count.has(notTag), `#${notTag} should not be a tag`);
    }
  });

  it("KNOWN BUG: a fenced code block and a hex color still mint tags", () => {
    // parseTags scans the whole body, fences included, and cannot tell a CSS
    // color from a tag. Both end up on the public topic list unless the admin
    // adds them to EXCLUDE_TAGS.
    assert.ok(count.has("define"), "a #define inside a shell fence became a topic");
    assert.ok(count.has("c9a227"), "a hex color became a topic");
  });
});

describe("frontmatter tags:", () => {
  it("reads a [flow, list]", () => {
    assert.ok(count.has("alpha") && count.has("beta"));
  });

  it("reads a bare scalar", () => {
    assert.ok(count.has("gamma"));
  });

  it("strips quotes and a leading #", () => {
    assert.ok(count.has("delta"), 'a "#delta" entry must become "delta"');
    assert.ok(count.has("epsilon"));
  });

  it("reads a block list and stops at the next key", () => {
    assert.ok(count.has("zeta") && count.has("eta"));
    assert.ok(!count.has("x"), "the next frontmatter key was swallowed as a tag");
  });
});

describe("visitor scoping", () => {
  it("an unpublished note's tags are invisible to visitors", () => {
    const visitor = new Set(tags(true).map((entry) => entry.tag));
    assert.ok(visitor.has("draft"));
    assert.ok(!visitor.has("secret"), "an unpublished note leaked a topic");
    assert.ok(!visitor.has("hidden"));
    // …while the admin list sees them.
    assert.ok(count.has("secret") && count.has("hidden"));
  });

  it("EXCLUDE_TAGS removes a topic from the visitor list only", () => {
    initSite({ VELLUM_DATA: data, EXCLUDE_TAGS: "#Draft, zettel/seed" });
    const visitor = new Set(tags(true).map((entry) => entry.tag));
    assert.ok(!visitor.has("draft"), "EXCLUDE_TAGS is case-insensitive and #-tolerant");
    assert.ok(!visitor.has("zettel/seed"));
    assert.ok(visitor.has("alpha"), "unrelated topics stay");
    assert.ok(new Set(tags().map((e) => e.tag)).has("draft"), "the admin view is never filtered");
    initSite({ VELLUM_DATA: data });
  });
});

describe("ordering", () => {
  it("sorts by count, then alphabetically", () => {
    const list = tags();
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      assert.ok(
        prev.count > cur.count || (prev.count === cur.count && prev.tag.localeCompare(cur.tag) <= 0),
        `out of order: ${prev.tag}(${prev.count}) before ${cur.tag}(${cur.count})`,
      );
    }
  });
});
