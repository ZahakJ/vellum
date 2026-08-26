// The reverse link index and the graph revision — the two halves of the perf
// audit's "graph" section that live on the server.
//
// Neither is a feature: both replace a walk over the whole vault with a lookup,
// and the ONLY way either can go wrong is by answering with LESS than the walk
// did. So every case below is a shape that used to be found the slow way and
// has to keep being found: a basename link, a path-form link, a `./` prefix, an
// explicit `.md`, an anchor tail, a pipe alias, a frontmatter alias, a `\cite`
// and a `\ref`. Plus the tie-break the superset must NOT smuggle a false
// positive through: two notes sharing a basename, where only the shortest path
// actually owns the name.

import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  backlinks,
  graphRevision,
  indexFile,
  initIndexer,
  notesLinkingTo,
} from "../server/indexer.ts";
import { graphBody } from "../server/graphCache.ts";
import { initSite } from "../server/site.ts";
import { initVault } from "../server/vault.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

const data = makeDir();
const root = makeVault({
  // The target every link below is aimed at.
  "Notes/Machine Learning.md": note(
    { publish: "true", aliases: "[ML, تعلم الآلة]", citekey: "ml2024" },
    "# Machine Learning\n",
  ),
  // A DECOY with the same basename at a deeper path: `[[Machine Learning]]`
  // resolves to the shorter path, so this note must never collect the
  // basename's backlinks even though the reverse index files them under the
  // same key.
  "Archive/Old/Machine Learning.md": "# Machine Learning (old)\n",

  "byBasename.md": note({ publish: "true" }, "Everything begins with [[Machine Learning]] and its ideas.\n"),
  "byPath.md": "The canonical page is [[Notes/Machine Learning]] over there.\n",
  "byDotPath.md": "Written by a folder-relative hand: [[./Notes/Machine Learning]] today.\n",
  "byExtension.md": "An explicit file reference, [[Notes/Machine Learning.md]], survives.\n",
  "byAnchor.md": "Straight to a section: [[Machine Learning#Overview]] and onward.\n",
  "byPipe.md": "Reading a piece on [[Machine Learning|the subject]] this evening.\n",
  "byAlias.md": "Today I read about [[ML]] and could not stop thinking.\n",
  "byArabicAlias.md": "قرأت اليوم عن [[تعلم الآلة]] ولم أتوقف عن التفكير.\n",
  // A note nobody should confuse with the target.
  "unrelated.md": "This one points at [[byPipe]] and nothing else.\n",
  // Not published, so the visitor scope must lose it.
  "Private.md": "A private page linking [[Machine Learning]] all the same.\n",

  // LaTeX: a `\cite` of a note's citekey, and a `\ref` of a label another
  // document defines — the two keys that reach a note without a wikilink.
  "Paper.tex":
    "\\documentclass{article}\n\\begin{document}\nAs shown in \\cite{ml2024} the method holds, following \\ref{sec:method} throughout.\n\\end{document}\n",
  "Theory.tex":
    "\\documentclass{article}\n\\begin{document}\n\\section{Method}\\label{sec:method}\nThe method is stated here in full.\n\\end{document}\n",
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

const sources = (target: string, publishedOnly = false): string[] =>
  [...new Set(backlinks(target, publishedOnly, null).map((h) => h.path))].sort();

describe("the reverse link index finds every shape the walk used to find", () => {
  const target = "Notes/Machine Learning.md";

  it("basename, path form, ./ prefix, explicit .md, anchor tail, pipe and alias", () => {
    assert.deepEqual(sources(target), [
      "Paper.tex",
      "Private.md",
      "byAlias.md",
      "byAnchor.md",
      "byArabicAlias.md",
      "byBasename.md",
      "byDotPath.md",
      "byExtension.md",
      "byPath.md",
      "byPipe.md",
    ]);
  });

  it("keeps the backlink card's context line", () => {
    const hit = backlinks(target, false, null).find((h) => h.path === "byAlias.md");
    assert.ok(hit, "the aliased link should still be a backlink");
    assert.match(hit.context, /\[\[ML\]\]/);
    assert.match(hit.context, /Today I read about/);
  });

  it("a `\\cite` of the note's citekey is a backlink", () => {
    const hit = backlinks(target, false, null).find((h) => h.path === "Paper.tex");
    assert.ok(hit, "the citing paper should be a backlink");
    assert.match(hit.context, /method holds/);
  });

  it("a `\\ref` of a label another document defines is a backlink", () => {
    // The label table is the second key a note answers to without ever being
    // wikilinked, so the reverse index has to file xrefs beside links.
    assert.deepEqual(sources("Theory.tex"), ["Paper.tex"]);
  });

  it("the DECOY sharing the basename collects none of them", () => {
    // The reverse index files `[[Machine Learning]]` under one key and both
    // notes answer to it; only resolveLink() knows which one wins, and it is
    // still the one asked.
    assert.deepEqual(sources("Archive/Old/Machine Learning.md"), []);
  });

  it("a visitor loses the unpublished sources and nothing else", () => {
    assert.ok(!sources(target, true).includes("Private.md"));
    assert.ok(sources(target, true).includes("byBasename.md"));
  });

  it("notesLinkingTo answers the same set, minus the cross-references", () => {
    const linking = notesLinkingTo(target);
    assert.ok(linking.includes("byBasename.md"));
    assert.ok(linking.includes("byAlias.md"));
    assert.ok(linking.includes("Private.md"));
    assert.ok(!linking.includes("Paper.tex"), "a \\cite is not a wikilink");
    assert.ok(!linking.includes("unrelated.md"));
  });

  it("a note with no incoming links answers empty, not everything", () => {
    assert.deepEqual(sources("unrelated.md"), []);
  });
});

describe("the reverse index is maintained, not rebuilt", () => {
  const target = "Notes/Machine Learning.md";
  const write = async (rel: string, body: string): Promise<void> => {
    writeFileSync(path.join(root, rel), body);
    await indexFile(rel);
  };

  it("a link added to an existing note appears", async () => {
    await write("unrelated.md", "Now it mentions [[ML]] after all.\n");
    assert.ok(sources(target).includes("unrelated.md"));
  });

  it("a link removed from an existing note disappears", async () => {
    await write("unrelated.md", "This one points at [[byPipe]] and nothing else.\n");
    assert.ok(!sources(target).includes("unrelated.md"));
  });

  it("a link retargeted moves from one note's backlinks to the other's", async () => {
    await write("byBasename.md", note({ publish: "true" }, "Everything begins with [[byPipe]] instead.\n"));
    assert.ok(!sources(target).includes("byBasename.md"));
    assert.ok(sources("byPipe.md").includes("byBasename.md"));
    await write("byBasename.md", note({ publish: "true" }, "Everything begins with [[Machine Learning]] and its ideas.\n"));
    assert.ok(sources(target).includes("byBasename.md"));
  });
});

describe("the graph revision moves only when the graph would", () => {
  const write = async (rel: string, body: string): Promise<void> => {
    writeFileSync(path.join(root, rel), body);
    await indexFile(rel);
  };

  it("holds still through a prose-only edit — the memo's whole reason to exist", async () => {
    await write("byPath.md", "The canonical page is [[Notes/Machine Learning]] over there.\n");
    const before = graphRevision();
    await write(
      "byPath.md",
      "The canonical page is [[Notes/Machine Learning]] over there, and here is a new paragraph.\n",
    );
    assert.equal(graphRevision(), before, "rewriting prose must not cost a graph rebuild");
  });

  it("moves when a link is added", async () => {
    const before = graphRevision();
    await write("byPath.md", "The canonical page is [[Notes/Machine Learning]] and also [[byPipe]].\n");
    assert.notEqual(graphRevision(), before);
  });

  it("moves when a tag is added", async () => {
    const before = graphRevision();
    await write("byPath.md", "A #freshtag and the canonical [[Notes/Machine Learning]].\n");
    assert.notEqual(graphRevision(), before);
  });

  it("moves when the publish flag flips", async () => {
    const before = graphRevision();
    await write("byPath.md", note({ publish: "true" }, "The canonical [[Notes/Machine Learning]].\n"));
    assert.notEqual(graphRevision(), before);
  });

  it("moves when an alias appears — it is how other notes' links land here", async () => {
    const before = graphRevision();
    await write(
      "byPath.md",
      note({ publish: "true", aliases: "[Canon]" }, "The canonical [[Notes/Machine Learning]].\n"),
    );
    assert.notEqual(graphRevision(), before);
  });

  it("holds still for a path the index never had", async () => {
    const before = graphRevision();
    await indexFile("Notes/gone-that-never-existed.md"); // a stat miss on an unknown path
    assert.equal(graphRevision(), before, "forgetting a note we never had is not a change");
  });

  it("moves when a note is deleted, and its backlinks go with it", async () => {
    const before = graphRevision();
    rmSync(path.join(root, "byDotPath.md"));
    await indexFile("byDotPath.md");
    assert.notEqual(graphRevision(), before);
    assert.ok(!sources("Notes/Machine Learning.md").includes("byDotPath.md"));
  });
});

describe("the /api/graph memo is validated, not thrown away", () => {
  const write = async (rel: string, body: string): Promise<void> => {
    writeFileSync(path.join(root, rel), body);
    await indexFile(rel);
  };

  it("survives a prose-only save — the storm this exists for", async () => {
    const first = graphBody(false, null);
    assert.equal(graphBody(false, null), first, "two reads in a row must share one build");
    await write("byAnchor.md", "Straight to a section: [[Machine Learning#Overview]] and onward, at length.\n");
    assert.equal(graphBody(false, null), first, "a body edit that moved no link must not rebuild");
  });

  it("is dropped the moment a link changes", async () => {
    const before = graphBody(false, null);
    await write("byAnchor.md", "Straight to a section: [[Machine Learning#Overview]] and also [[byPipe]].\n");
    assert.notEqual(graphBody(false, null), before);
  });

  it("keeps the visitor and admin answers apart", () => {
    assert.notEqual(graphBody(true, null), graphBody(false, null));
  });
});
