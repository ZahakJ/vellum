// Excerpts and search snippets (server/indexer.ts).
//
// These two strings are the only prose the site shows OUTSIDE the note, so
// they carry the whole "does this site look hand-made or machine-made"
// weight. The rules they keep breaking, each one a case below:
//   • no raw markdown ever reaches them (`**`, `[[…]]`, `![…](…)`, `$$`),
//   • a #tag must not shed its hash and walk into the prose as a word,
//   • template furniture (a bare timestamp, "Status: #draft") is not an
//     opening paragraph,
//   • truncation happens on a word boundary and says so with an ellipsis.
// Both are exercised through the public API (posts() / search()) so the test
// pins the behavior the blog actually renders, not an internal helper.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  initIndexer,
  posts as postsRaw,
  search as searchRaw,
} from "../server/indexer.ts";

// Both take an audience and a language scope. These cases are about EXCERPTS
// and SNIPPETS, so both are pinned: the admin view (`false`) and no language
// filtering (`null`), which is the widest collection and the one the fixtures
// below describe.
const posts = () => postsRaw(false, null);
const search = (query: string) => searchRaw(query, false, null);
import { initSite } from "../server/site.ts";
import { initVault } from "../server/vault.ts";
import type { PostMeta } from "../shared/types.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

const LONG =
  "The manuscript room is lit by a single candle, and the scribe works from " +
  "the outside in, laying gold before ink because the leaf will not take a " +
  "second chance once the surface is broken, which is the whole discipline " +
  "in one sentence and also the reason the work is slow.";

const files: Record<string, string> = {
  "Plain.md": note({ publish: "true" }, "# Plain\n\nA first paragraph of ordinary prose that runs long enough to count as real.\n\nA second one.\n"),
  "Tags first.md": note(
    { publish: "true" },
    "#daily #journal\n\nThe real opening paragraph begins here and carries the sentence forward.\n",
  ),
  "Furniture.md": note(
    { publish: "true" },
    "2026-03-07 19:28\nStatus: #adult\nTags: #software #statistics\n\nThere are generally three main factors that decide how a note begins.\n",
  ),
  "Markup.md": note(
    { publish: "true" },
    "## Heading\n\nA **bold** claim about [[Some Note|the alias]] and `inline code` with an ![img](a.png) and a [link](https://example.com) inside it, plus ==a highlight== and %%a comment%%.\n",
  ),
  "Fenced.md": note(
    { publish: "true" },
    "```js\nconst x = 1; // this must never be the excerpt\n```\n\nThe prose after the fence is what a reader should see in the list.\n",
  ),
  "Math.md": note(
    { publish: "true" },
    "$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$\n\nAfter the display math comes the sentence that belongs in the excerpt.\n",
  ),
  "Table.md": note(
    { publish: "true" },
    "| a | b |\n| - | - |\n| 1 | 2 |\n\nThe paragraph under the table is the first real prose in this note.\n",
  ),
  "Embed.md": note(
    { publish: "true" },
    "![[banner.png]]\n\nThe note opens with an embed, and then with this sentence of prose.\n",
  ),
  "Long.md": note({ publish: "true" }, `# Long\n\n${LONG}\n`),
  "Arabic.md": note(
    { publish: "true" },
    "# مذكرة\n\nهذه فقرة افتتاحية بالعربية مكتوبة لتكون طويلة بما يكفي كي تُحتسب نصًا حقيقيًا في المقتطف.\n",
  ),
  "Callout.md": note(
    { publish: "true" },
    "> [!note] Title\n> The callout body is prose and should be usable as an excerpt line.\n",
  ),
  "Empty.md": note({ publish: "true" }, "\n"),
  "Unbroken.md": note({ publish: "true" }, `# Unbroken\n\n${"a".repeat(400)}\n`),
  "Index.md": note({ publish: "true" }, "# Index\n\n- [[Alpha]]\n- [[Beta|Bee]]\n"),
  "Inline tags.md": note(
    { publish: "true" },
    "Tags: philosophy, software\n\nA sentence that is long enough to be chosen as the real opening paragraph.\n",
  ),
  // A SHELF NOTE: the whole body is fences, so there is no paragraph to cut.
  // These used to ship a post with a title, a date and nothing where the
  // sentence goes (UX audit F43).
  "Shelf.md": note(
    { publish: "true" },
    "```tracker\ntitle: Dune\nkind: book\ndone: 300\ntotal: 412\n```\n\n" +
      "```tracker\ntitle: Piranesi\nkind: book\ndone: 90\ntotal: 245\n```\n",
  ),
  "One thing.md": note(
    { publish: "true" },
    "```tracker\ntitle: Disco Elysium\nkind: game\npercent: 40\n```\n",
  ),
  "Board.md": note({ publish: "true" }, "```tracker-board\nkind: book\n```\n"),
  "Escaping.md": note(
    { publish: "true" },
    "A paragraph mentioning <script>alert(1)</script> and an ampersand & a bracket, written out at length.\n",
  ),
};

const data = makeDir();
const root = makeVault(files);
let byPath: Map<string, PostMeta>;

before(async () => {
  initSite({ VELLUM_DATA: data });
  initVault(root);
  await initIndexer();
  byPath = new Map(posts().map((p) => [p.path, p]));
});

after(() => {
  removeVault(root);
  removeVault(data);
});

const excerpt = (path: string): string => {
  const meta = byPath.get(path);
  assert.ok(meta, `${path} is not in posts()`);
  return meta.excerpt;
};

// ------------------------------------------------------------------ content

describe("excerpts", () => {
  it("uses the first real paragraph, not the heading", () => {
    assert.equal(
      excerpt("Plain.md"),
      "A first paragraph of ordinary prose that runs long enough to count as real.",
    );
  });

  it("skips a leading tag line without letting the tag words leak in", () => {
    const text = excerpt("Tags first.md");
    assert.equal(text, "The real opening paragraph begins here and carries the sentence forward.");
    assert.ok(!/daily|journal/.test(text), "a de-hashed tag word reached the prose");
  });

  it("skips template furniture (timestamp, Status:, Tags:)", () => {
    const text = excerpt("Furniture.md");
    assert.match(text, /^There are generally three main factors/);
    assert.ok(!/adult|software|statistics|2026-03-07/.test(text));
  });

  it("skips a fenced code block", () => {
    const text = excerpt("Fenced.md");
    assert.match(text, /^The prose after the fence/);
    assert.ok(!text.includes("const x"));
  });

  it("skips display math", () => {
    const text = excerpt("Math.md");
    assert.match(text, /^After the display math/);
    assert.ok(!text.includes("\\int"));
  });

  it("skips a table", () => {
    assert.match(excerpt("Table.md"), /^The paragraph under the table/);
  });

  it("skips a leading embed", () => {
    const text = excerpt("Embed.md");
    assert.match(text, /^The note opens with an embed/);
    assert.ok(!text.includes("banner.png"));
  });

  it("reads a callout as prose without its marker", () => {
    const text = excerpt("Callout.md");
    assert.ok(!text.includes("[!note]"));
    assert.match(text, /callout body/);
  });

  it("keeps a wikilink's ALIAS and drops the target and the brackets", () => {
    const text = excerpt("Markup.md");
    assert.ok(text.includes("the alias"), text);
    assert.ok(!text.includes("Some Note"), "the link target leaked into the prose");
  });

  it("is Arabic for an Arabic note", () => {
    assert.match(excerpt("Arabic.md"), /^هذه فقرة افتتاحية/);
  });

  // ── F43: a body that is only a fence ─────────────────────────────────────
  it("summarizes a shelf note instead of leaving the slot empty", () => {
    assert.equal(excerpt("Shelf.md"), "A shelf of 2 trackers.");
    assert.equal(excerpt("One thing.md"), "A shelf of one tracker.");
  });

  it("summarizes a tracker BOARD, which carries no trackers of its own", () => {
    assert.equal(excerpt("Board.md"), "A shelf of every tracker in the vault.");
  });

  it("is empty (not garbage) for a note with no prose", () => {
    assert.equal(excerpt("Empty.md"), "");
    assert.equal(byPath.get("Empty.md")?.words, 0);
    assert.equal(byPath.get("Empty.md")?.readingMinutes, 0);
  });

  it("carries no markdown syntax at all, for any note in the vault", () => {
    for (const [path, meta] of byPath) {
      const bad = [
        [/\[\[|\]\]/, "wikilink brackets"],
        [/\*\*|__/, "strong marks"],
        [/`/, "code ticks"],
        [/!\[/, "image syntax"],
        [/\]\(/, "link syntax"],
        [/==/, "highlight marks"],
        [/%%/, "comment marks"],
        [/\$\$/, "display math"],
        [/^#{1,6}\s/, "a heading marker"],
        [/^\s*[-*+]\s/, "a list bullet"],
        [/^>/, "a quote marker"],
        [/\r|\n/, "a line break"],
      ] as const;
      for (const [re, what] of bad) {
        assert.ok(!re.test(meta.excerpt), `${path}: excerpt contains ${what}: ${meta.excerpt}`);
      }
      assert.equal(meta.excerpt, meta.excerpt.trim(), `${path}: excerpt has loose whitespace`);
    }
  });
});

describe("excerpt truncation", () => {
  it("cuts on a word boundary and marks the cut", () => {
    const text = excerpt("Long.md");
    assert.ok(text.length <= 221, `excerpt is ${text.length} chars`);
    assert.ok(text.endsWith("…"), "a truncated excerpt must say so");
    const head = text.slice(0, -1);
    assert.ok(LONG.startsWith(head), "the excerpt is not a prefix of the paragraph");
    // The character right after the cut is a space — i.e. no half word.
    assert.equal(LONG[head.length], " ", `cut mid-word at ${JSON.stringify(LONG.slice(head.length - 8, head.length + 8))}`);
    assert.ok(!/[\s,;:.!?·—–-]$/.test(head), "dangling punctuation before the ellipsis");
  });

  it("does not add an ellipsis to a paragraph that fits", () => {
    assert.ok(!excerpt("Plain.md").endsWith("…"));
  });

  it("falls back to a hard cut when the paragraph has no word boundary", () => {
    // A pasted URL or a CJK paragraph offers nothing to cut on: the excerpt
    // takes exactly EXCERPT_MAX characters rather than running to the end.
    const text = excerpt("Unbroken.md");
    assert.equal(text, `${"a".repeat(220)}…`);
  });

  it("a link-list note excerpts as its link LABELS, never as [[syntax]]", () => {
    // An index/MOC note has no prose; showing the targets it gathers is the
    // least-bad card. What must never happen is brackets on the blog.
    assert.equal(excerpt("Index.md"), "Alpha Bee");
  });

  it("a 'Tags:' label line with plain words is not mistaken for the opening", () => {
    assert.match(excerpt("Inline tags.md"), /^A sentence that is long enough/);
  });
});

// ----------------------------------------------------------------- snippets

describe("search snippets", () => {
  const hit = (query: string, path: string): string => {
    const found = search(query).find((h) => h.path === path);
    assert.ok(found, `"${query}" did not find ${path}`);
    return found.snippet;
  };

  it("marks the matched term", () => {
    assert.match(hit("candle", "Long.md"), /<mark>candle<\/mark>/i);
  });

  it("escapes HTML before marking (an injection in a note stays text)", () => {
    const snippet = hit("ampersand", "Escaping.md");
    assert.ok(!snippet.includes("<script>"), snippet);
    assert.ok(snippet.includes("&lt;script&gt;") || !snippet.includes("script"), snippet);
    assert.ok(!/&(?!amp;|lt;|gt;)/.test(snippet.replace(/<\/?mark>/g, "")), "unescaped ampersand");
  });

  it("never shows raw markdown", () => {
    const snippet = hit("alias", "Markup.md");
    for (const re of [/\[\[/, /\]\]/, /\*\*/, /`/, /!\[/]) {
      assert.ok(!re.test(snippet), `snippet contains markdown: ${snippet}`);
    }
  });

  it("never shows code from a fence", () => {
    const snippet = hit("prose", "Fenced.md");
    assert.ok(!snippet.includes("const x"), snippet);
  });

  it("windows around the hit with ellipses marking real cuts", () => {
    const snippet = hit("discipline", "Long.md");
    assert.ok(snippet.startsWith("…"), snippet);
    assert.ok(snippet.includes("<mark>discipline</mark>"), snippet);
  });

  it("ranks an exact title match first", () => {
    const hits = search("Plain");
    assert.equal(hits[0].path, "Plain.md");
  });

  it("returns nothing for an empty query", () => {
    assert.deepEqual(search("   "), []);
  });
});
