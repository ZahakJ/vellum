// Frontmatter `aliases:` — the OTHER names a note answers to.
//
// The README invites the reader to point Vellum at an existing Obsidian vault.
// In one of those, notes carry `aliases: [ML, machine-learning]` and are linked
// as `[[ML]]`: before this table existed, every one of those links rendered
// dashed and offered to create a duplicate note — in the first hour, to exactly
// the reader the product is pitched at.
//
// Four surfaces have to agree or the feature is worse than its absence (a note
// reachable by a name in one place and invisible by it in three others), so
// this file covers all four from one vault: resolution, search, the completion
// list's data source, and backlinks. The write half — keeping a renamed note's
// old title as an alias — is at the bottom, over strings alone.

import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  aliasEntries,
  backlinks,
  indexFile,
  initIndexer,
  resolveLink as resolveLinkRaw,
  search as searchRaw,
} from "../server/indexer.ts";
import { addNoteAlias, parseAliases, readNoteFrontmatter } from "../server/noteFrontmatter.ts";
import { resolveLink as clientResolve, setAliasTable } from "../client/editor/links.ts";
import { initSite } from "../server/site.ts";
import { buildTree, initVault } from "../server/vault.ts";
import type { TreeNode } from "../shared/types.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

// Every case below pins the language scope to `null` ("no scoping"): the
// filter has its own tests, and none of these is about it.
const resolveLink = (name: string, publishedOnly = false): string | null =>
  resolveLinkRaw(name, publishedOnly, null);
const search = (q: string, publishedOnly = false): ReturnType<typeof searchRaw> =>
  searchRaw(q, publishedOnly, null);

const data = makeDir();
const root = makeVault({
  // The three spellings a real vault contains, one per note.
  "Notes/Machine Learning.md": note({ aliases: "[ML, machine-learning]" }, "# Machine Learning\n"),
  "Notes/Deep Learning.md": note({ aliases: "DL, deep learning" }, "# Deep Learning\n"),
  "Notes/Solo.md": note({ aliases: "Alone" }, "# Solo\n"),
  // A block list, plus Obsidian's older singular key.
  "Notes/Blocks.md": "---\naliases:\n  - Bee\n  - Cee\n---\n# Blocks\n",
  "Notes/Singular.md": note({ alias: "Older" }, "# Singular\n"),
  // Precedence: a note whose FILENAME is what another note claims as an alias.
  "DL.md": "# The real DL\n",
  "Notes/Claims DL.md": note({ aliases: "[DL]" }, "# Claims DL\n"),
  // The tie: two notes claiming one alias. `zzzz/Beta.md` has FEWER segments
  // and a LONGER string than `x/y/Alpha.md` — the same shape links.test.ts
  // pins for duplicate basenames, so the two rules can be compared directly.
  "x/y/Alpha.md": note({ aliases: "[AI]" }, "# Alpha\n"),
  "zzzz/Beta.md": note({ aliases: "[AI]" }, "# Beta\n"),
  // A `.tex` note keeps its frontmatter in a comment block that still compiles.
  "papers/Fourier.tex": "%---\n% aliases: [Heat, heat equation]\n%---%\n\\documentclass{article}\n\\begin{document}\nOn heat.\n\\end{document}\n",
  // Visibility: an alias must never make a private note reachable, and a
  // private note's FILENAME must not shadow a published note's alias for a
  // visitor who cannot see either the file or its name.
  "Private.md": note({ aliases: "[Secret]" }, "# Private\n"),
  "Pub.md": note({ publish: "true", aliases: "[Pubby, Ghost]" }, "# Pub\n"),
  "Ghost.md": "# Ghost\n",
  // The linker: one note pointing at another THROUGH an alias.
  "Notes/Reading.md": "# Reading\n\nToday I read about [[ML]] and took notes.\n",
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

// ------------------------------------------------------------------ parsing

describe("parseAliases — the three shapes YAML hands over", () => {
  it("reads a flow list", () => {
    assert.deepEqual(parseAliases({ aliases: ["ML", "machine-learning"] }), ["ML", "machine-learning"]);
  });

  it("splits a comma-separated scalar", () => {
    assert.deepEqual(parseAliases({ aliases: "DL, deep learning" }), ["DL", "deep learning"]);
  });

  it("takes a bare scalar as one name", () => {
    assert.deepEqual(parseAliases({ aliases: "Alone" }), ["Alone"]);
  });

  it("never splits a LIST ITEM on its commas", () => {
    // `aliases: ["Smith, John"]` is already one item to YAML. Splitting it too
    // would leave no way to spell an alias that contains a comma.
    assert.deepEqual(parseAliases({ aliases: ["Smith, John"] }), ["Smith, John"]);
  });

  it("reads the singular `alias:` too, and a numeric one", () => {
    assert.deepEqual(parseAliases({ alias: "Older" }), ["Older"]);
    assert.deepEqual(parseAliases({ aliases: [2024] }), ["2024"]);
  });

  it("drops what is not a name, and collapses duplicates case-insensitively", () => {
    assert.deepEqual(parseAliases({ aliases: [{ nested: 1 }, true, "  ", "ML", "ml"] }), ["ML"]);
    assert.deepEqual(parseAliases({}), []);
  });
});

// --------------------------------------------------------------- resolution

describe("resolveLink through the alias table", () => {
  const cases: [string, string | null][] = [
    ["ML", "Notes/Machine Learning.md"],
    ["machine-learning", "Notes/Machine Learning.md"],
    ["ml", "Notes/Machine Learning.md"], // case-insensitive, like every name
    ["deep learning", "Notes/Deep Learning.md"],
    ["Alone", "Notes/Solo.md"],
    ["Bee", "Notes/Blocks.md"],
    ["Cee", "Notes/Blocks.md"],
    ["Older", "Notes/Singular.md"],
    ["Heat", "papers/Fourier.tex"],
    ["heat equation", "papers/Fourier.tex"],
    ["nobody's alias", null],
  ];
  for (const [name, expected] of cases) {
    it(`[[${name}]] → ${expected ?? "null"}`, () => {
      assert.equal(resolveLink(name), expected);
    });
  }

  it("a real FILENAME beats someone else's alias", () => {
    // Both exist: `DL.md` at the root, and `Notes/Claims DL.md` declaring
    // `aliases: [DL]`. The file's own name wins, whatever the paths look like.
    assert.equal(resolveLink("DL"), "DL.md");
    assert.equal(resolveLink("Claims DL"), "Notes/Claims DL.md");
  });

  it("two notes claiming one alias tie by the basename rule: fewest segments, then shortest, then alpha", () => {
    assert.equal(resolveLink("AI"), "zzzz/Beta.md");
  });
});

describe("aliases and the visitor", () => {
  it("an alias never makes a private note reachable", () => {
    assert.equal(resolveLink("Secret"), "Private.md");
    assert.equal(resolveLink("Secret", true), null);
  });

  it("a published note's alias resolves for a visitor", () => {
    assert.equal(resolveLink("Pubby", true), "Pub.md");
  });

  it("a private FILENAME does not shadow a published alias for a visitor", () => {
    // To the admin, `Ghost.md` is a file and its name wins. Inside the
    // visitor's smaller collection no note is named Ghost at all, so the
    // published note that claims the alias is the honest answer — and both
    // branches are computed from notes the caller may already discover, so
    // neither leaks the other's existence.
    assert.equal(resolveLink("Ghost"), "Ghost.md");
    assert.equal(resolveLink("Ghost", true), "Pub.md");
  });
});

// -------------------------------------------------------- the other surfaces

describe("search finds a note by its alias, and says so", () => {
  it("indexes the alias", () => {
    const hits = search("ML");
    const hit = hits.find((h) => h.path === "Notes/Machine Learning.md");
    assert.ok(hit, `expected the ML note among ${JSON.stringify(hits.map((h) => h.path))}`);
    assert.equal(hit.alias, "ML");
  });

  it("says nothing about aliases when the TITLE is what matched", () => {
    const hit = search("Solo").find((h) => h.path === "Notes/Solo.md");
    assert.ok(hit);
    assert.equal(hit.alias, undefined);
  });

  it("a visitor's search never answers with a private note's alias", () => {
    assert.equal(search("Secret", true).some((h) => h.path === "Private.md"), false);
  });
});

describe("the completion list's data source", () => {
  it("carries every alias with the note it names", () => {
    const entries = aliasEntries(false, null);
    const ml = entries.filter((e) => e.path === "Notes/Machine Learning.md").map((e) => e.alias);
    assert.deepEqual(ml.sort(), ["ML", "machine-learning"]);
    // Sorted by alias for a stable popup — and WITHIN one alias, claimants in
    // RESOLUTION order (fewest segments, shortest, then alphabetical: the
    // pickShortest rule), because the completion keeps exactly one row per
    // alias and it must be the row `[[alias]]` actually lands on. Plain path
    // order could keep a row that names the loser.
    const depth = (p: string): number => p.split("/").length;
    assert.deepEqual(
      [...entries].sort(
        (a, b) =>
          a.alias.localeCompare(b.alias) ||
          depth(a.path) - depth(b.path) ||
          a.path.length - b.path.length ||
          a.path.localeCompare(b.path),
      ),
      entries,
    );
  });

  it("offers a visitor only what a visitor may discover", () => {
    const entries = aliasEntries(true, null);
    assert.deepEqual(entries.map((e) => e.alias).sort(), ["Ghost", "Pubby"]);
  });
});

describe("a link made through an alias is a backlink like any other", () => {
  it("counts, with the same context extraction", () => {
    const hits = backlinks("Notes/Machine Learning.md", false, null);
    const hit = hits.find((h) => h.path === "Notes/Reading.md");
    assert.ok(hit, "the note linking [[ML]] should be a backlink");
    assert.match(hit.context, /\[\[ML\]\]/);
    assert.match(hit.context, /Today I read about/);
  });
});

// The parity block, and the reason this file has one: the EDITOR decides
// whether a link is drawn dashed and where a click goes, the indexer decides
// where the backlink and the graph edge go. An alias the server resolved and
// the client did not is a note sitting right there under a dashed link that
// offers to create a duplicate of it — the original bug, moved one process
// over. The client's table is filled from GET /api/aliases by the same refresh
// that loads the tree.
describe("the client resolver names the same note", () => {
  let tree: TreeNode;

  before(async () => {
    tree = await buildTree();
    setAliasTable(aliasEntries(false, null));
  });

  it("resolves an alias, in each of the three spellings", () => {
    assert.equal(clientResolve("ML", tree), "Notes/Machine Learning.md");
    assert.equal(clientResolve("deep learning", tree), "Notes/Deep Learning.md");
    assert.equal(clientResolve("Bee", tree), "Notes/Blocks.md");
    assert.equal(clientResolve("Heat", tree), "papers/Fourier.tex");
  });

  it("keeps the filename ahead of someone else's alias", () => {
    assert.equal(clientResolve("DL", tree), resolveLink("DL"));
    assert.equal(clientResolve("DL", tree), "DL.md");
  });

  it("breaks an alias tie the way the server does", () => {
    assert.equal(clientResolve("AI", tree), resolveLink("AI"));
  });

  it("still answers null for a name nothing claims", () => {
    assert.equal(clientResolve("nobody's alias", tree), null);
  });
});

// ------------------------------------------------------- incremental upkeep

describe("the alias table follows the vault", () => {
  it("a reindexed note loses the aliases it dropped and answers to the new ones", async () => {
    const rel = "Notes/Solo.md";
    await writeFile(path.join(root, rel), note({ aliases: "[Only, Single]" }, "# Solo\n"), "utf8");
    await indexFile(rel);
    assert.equal(resolveLink("Alone"), null, "the dropped alias must not survive the reindex");
    assert.equal(resolveLink("Only"), rel);
    assert.equal(resolveLink("Single"), rel);
  });

  it("a DELETED note leaves the table", async () => {
    // A stale alias that resolves to a file which is no longer there is worse
    // than no aliases at all: the link looks live and opens nothing.
    const rel = "Notes/Solo.md";
    await rm(path.join(root, rel));
    await indexFile(rel); // what the watcher's incremental path does
    assert.equal(resolveLink("Only"), null);
    assert.equal(resolveLink("Single"), null);
    assert.equal(aliasEntries(false, null).some((e) => e.path === rel), false);
  });
});

// --------------------------------------------------- keeping an old title

describe("addNoteAlias — the write behind “keep the old title as an alias”", () => {
  it("adds the key to a note that has frontmatter but no aliases", () => {
    const src = "---\ntitle: A\npublish: true\n---\nbody\n";
    assert.equal(
      addNoteAlias("N.md", src, "Old Title"),
      '---\ntitle: A\npublish: true\naliases: ["Old Title"]\n---\nbody\n',
    );
  });

  it("creates a block for a note that has no frontmatter at all", () => {
    assert.equal(addNoteAlias("N.md", "# N\n", "Old"), '---\naliases: ["Old"]\n---\n# N\n');
  });

  it("merges into an inline list, new name first, every other byte untouched", () => {
    const src = "---\naliases: [ML, machine-learning]\ntags: [x]\n---\nbody\n";
    assert.equal(
      addNoteAlias("N.md", src, "Old"),
      '---\naliases: ["Old", "ML", "machine-learning"]\ntags: [x]\n---\nbody\n',
    );
  });

  it("adds an ITEM to a block list rather than flattening it", () => {
    // Flattening would leave the `- ML` lines orphaned under a key that now
    // holds a value: not a note with an odd alias list, a note whose YAML no
    // longer parses — and the first thing lost when that happens is
    // `publish: true`, i.e. the note silently leaves the public site.
    const src = "---\naliases:\n  - ML\n  - machine-learning\npublish: true\n---\nbody\n";
    assert.equal(
      addNoteAlias("N.md", src, "Old"),
      '---\naliases:\n  - "Old"\n  - ML\n  - machine-learning\npublish: true\n---\nbody\n',
    );
  });

  it("is idempotent, whatever the casing", () => {
    const src = '---\naliases: ["Old Title"]\n---\nbody\n';
    assert.equal(addNoteAlias("N.md", src, "old title"), src);
    assert.equal(addNoteAlias("N.md", src, "  "), src);
  });

  it("writes a `.tex` note's alias into its comment block, which still compiles", () => {
    const src = "%---\n% publish: true\n%---%\n\\documentclass{article}\n";
    const out = addNoteAlias("P.tex", src, "Old Paper");
    assert.equal(out, '%---\n% publish: true\n% aliases: ["Old Paper"]\n%---%\n\\documentclass{article}\n');
    // Every line of the block is still a LaTeX comment.
    for (const line of out.split("\n").slice(0, 4)) assert.match(line, /^%/);
  });

  it("adds an item to a `.tex` block list wearing its own comment prefix", () => {
    const src = "%---\n% aliases:\n%   - Heat\n%---%\n\\documentclass{article}\n";
    assert.equal(
      addNoteAlias("P.tex", src, "Old"),
      '%---\n% aliases:\n%   - "Old"\n%   - Heat\n%---%\n\\documentclass{article}\n',
    );
  });

  it("the note it wrote is one the indexer can read back", async () => {
    const rel = "Notes/Renamed.md";
    await writeFile(path.join(root, rel), "---\npublish: true\n---\n# Renamed\n", "utf8");
    await indexFile(rel);
    const src = "---\npublish: true\n---\n# Renamed\n";
    await writeFile(path.join(root, rel), addNoteAlias(rel, src, "Its Old Name"), "utf8");
    await indexFile(rel);
    assert.equal(resolveLink("Its Old Name"), rel);
    assert.equal(resolveLink("Its Old Name", true), rel, "the publish flag survived the write");
  });
});

describe("addNoteAlias: the block shapes the old regex missed", () => {
  // Each of these is valid YAML the previous implementation mis-filed into the
  // flow path, which rewrote the key line and orphaned the items — frontmatter
  // that stops parsing, and with it `publish: true`. The assertions check the
  // ITEMS survive beside the new one, which is exactly what orphaning breaks.
  it("a trailing comment on the key line", () => {
    const src = "---\ntitle: A\naliases:  # names\n  - ML\npublish: true\n---\nbody\n";
    const out = addNoteAlias("a.md", src, "DL");
    assert.ok(out.includes("  - \"DL\"\n") || out.includes("  - DL\n"), out);
    assert.ok(out.includes("  - ML"), "the existing item was orphaned or lost");
    assert.ok(out.includes("publish: true"), "publish line lost");
  });

  it("a blank line between the key and its items", () => {
    const src = "---\naliases:\n\n  - ML\npublish: true\n---\nbody\n";
    const out = addNoteAlias("a.md", src, "DL");
    assert.ok(out.includes("- ML"), "the existing item was orphaned");
    // However it was inserted, the result must still parse as one list of two.
    assert.equal(parseAliases(readNoteFrontmatter("a.md", out)).length, 2, out);
  });

  it("a comment line between the key and its items", () => {
    const src = "---\naliases:\n  # old names\n  - ML\n---\nbody\n";
    const out = addNoteAlias("a.md", src, "DL");
    assert.equal(parseAliases(readNoteFrontmatter("a.md", out)).length, 2, out);
  });
});
