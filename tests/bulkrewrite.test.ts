// The two v1.8 bulk verbs and the engine under them: tag rename/merge
// (server/tagRewrite.ts) and heading-link repair (server/headingRepair.ts).
//
// Both are the same promise — "change anything, break nothing" — and both are
// only worth shipping if the rewrites are BYTE-SURGICAL. So most of what is
// asserted here is what did NOT change: the comment above the key, the quote
// style inside the list, the `#define` in the shell fence, the CRLF line
// endings, the alias on the far side of the wikilink. A tag renamer that eats
// one of those is a tag renamer nobody can be given.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  applyBulk,
  previewBulk,
  undoBulk,
  type BulkTransform,
} from "../server/bulkRewrite.ts";
import {
  anchorsOfContent,
  clearHeadingChains,
  detectHeadingRename,
  observeWrite,
  rewriteHeadingLinks,
} from "../server/headingRepair.ts";
import { isTagName, rewriteTag } from "../server/tagRewrite.ts";
import { initIndexer, notesWithTag } from "../server/indexer.ts";
import { initSite } from "../server/site.ts";
import { initVault, readNote } from "../server/vault.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

// ===================================================================== tags

describe("tag names", () => {
  it("accepts what the indexer can read back", () => {
    for (const name of ["task", "zettel/seed", "v2", "_wip", "كتب-عربية", "مسودة"]) {
      assert.ok(isTagName(name), `${name} should be a tag`);
    }
  });

  it("refuses what a note could not carry", () => {
    // A name the rewrite could write and the indexer could not read back would
    // silently DELETE the tag from every note it claimed to rename.
    for (const name of ["", "  ", "-lead", "two words", "a//b", "/lead", "trail/", "a,b", "a#b"]) {
      assert.ok(!isTagName(name), `${JSON.stringify(name)} should not be a tag`);
    }
  });
});

describe("tag rename: inline #tags", () => {
  const rw = (src: string, from = "draft", to = "wip") => rewriteTag("N.md", src, from, to);

  it("rewrites a tag in prose and leaves the sentence alone", () => {
    const out = rw("A #draft note, and (#draft) again — but #drafting is a word.\n");
    assert.equal(
      out?.text,
      "A #wip note, and (#wip) again — but #drafting is a word.\n",
    );
    assert.equal(out?.count, 2);
  });

  it("carries the whole nested subtree", () => {
    const out = rewriteTag("N.md", "#zettel and #zettel/seed and #zettelkasten\n", "zettel", "slip");
    assert.equal(out?.text, "#slip and #slip/seed and #zettelkasten\n");
    assert.equal(out?.count, 2);
  });

  it("NEVER EDITS CODE — the reason this is not a find-and-replace", () => {
    // server/indexer.ts's parseTags reads `#draft` inside a fence as a tag (a
    // known over-count, tests/tags.test.ts pins it). Rewriting it would be data
    // loss in somebody's shell script.
    const src = "```sh\n#draft is a comment here\n```\n\nAnd `#draft` inline.\n\nReal: #draft\n";
    const out = rw(src);
    assert.equal(
      out?.text,
      "```sh\n#draft is a comment here\n```\n\nAnd `#draft` inline.\n\nReal: #wip\n",
    );
    assert.equal(out?.count, 1);
  });

  it("keeps a tag that only TOUCHES a code span", () => {
    // The pattern consumes the boundary character before the hash, so the
    // match can start one byte outside a span the hash is inside — and one
    // byte inside a span the hash is outside.
    const out = rw("`x` #draft and ` #draft ` and `#draft`\n");
    assert.equal(out?.text, "`x` #wip and ` #draft ` and `#draft`\n");
    assert.equal(out?.count, 1);
  });

  it("keeps CRLF line endings byte for byte", () => {
    const out = rw("line one\r\n#draft\r\nline three\r\n");
    assert.equal(out?.text, "line one\r\n#wip\r\nline three\r\n");
  });

  it("does not touch the frontmatter as if it were prose", () => {
    // `title: A #draft of the thing` is a VALUE, not a tag line. It is inside
    // the block, so the inline pass must never see it.
    const src = "---\ntitle: A #draft of the thing\n---\n\nBody #draft\n";
    const out = rw(src);
    assert.equal(out?.text, "---\ntitle: A #draft of the thing\n---\n\nBody #wip\n");
    assert.equal(out?.count, 1);
  });

  it("renames Arabic tags", () => {
    const out = rewriteTag("N.md", "نص فيه #مسودة هنا\n", "مسودة", "قيد-العمل");
    assert.equal(out?.text, "نص فيه #قيد-العمل هنا\n");
  });

  it("answers null when the note carries nothing to change", () => {
    assert.equal(rw("Nothing here.\n"), null);
  });
});

describe("tag rename: frontmatter, byte-surgically", () => {
  it("keeps a flow list's quotes, hashes and spacing", () => {
    const src = '---\ntags: ["#delta", \'draft\',  plain]\nother: x\n---\nbody\n';
    const out = rewriteTag("N.md", src, "draft", "wip");
    assert.equal(out?.text, '---\ntags: ["#delta", \'wip\',  plain]\nother: x\n---\nbody\n');
  });

  it("keeps a trailing comment on the key line", () => {
    // THE DIFFERENTIATOR. Obsidian's properties editor round-trips this away.
    const src = "---\ntags: [draft, ideas] # the workflow ones\n---\nbody\n";
    const out = rewriteTag("N.md", src, "draft", "wip");
    assert.equal(out?.text, "---\ntags: [draft, ideas] # the workflow ones\n---\nbody\n".replace("draft,", "wip,"));
  });

  it("keeps a block list a block list", () => {
    const src = "---\npublish: true\ntags:\n  - zeta\n  - draft\nother: x\n---\nbody\n";
    const out = rewriteTag("N.md", src, "draft", "wip");
    assert.equal(out?.text, "---\npublish: true\ntags:\n  - zeta\n  - wip\nother: x\n---\nbody\n");
  });

  it("reads a bare scalar and a comma scalar", () => {
    assert.equal(
      rewriteTag("N.md", "---\ntags: draft\n---\nb\n", "draft", "wip")?.text,
      "---\ntags: wip\n---\nb\n",
    );
    assert.equal(
      rewriteTag("N.md", "---\ntags: draft, ideas\n---\nb\n", "draft", "wip")?.text,
      "---\ntags: wip, ideas\n---\nb\n",
    );
  });

  it("leaves an INDENTED tags: key alone — it belongs to another mapping", () => {
    const src = "---\nmeta:\n  tags: [draft]\n---\nbody\n";
    assert.equal(rewriteTag("N.md", src, "draft", "wip"), null);
  });

  it("rewrites frontmatter AND body in one pass", () => {
    const src = "---\ntags: [draft]\n---\n\nProse with #draft in it.\n";
    const out = rewriteTag("N.md", src, "draft", "wip");
    assert.equal(out?.text, "---\ntags: [wip]\n---\n\nProse with #wip in it.\n");
    assert.equal(out?.count, 2);
  });

  it("keeps a `.tex` note's comment block commented, and never touches its body", () => {
    // `#` is a macro-parameter character in LaTeX: `#draft` in a .tex file is a
    // compile error, not a tag. Only the frontmatter moves.
    const src = "%---\n% publish: true\n% tags: [draft, ideas]\n%---%\n\\section{A} % #draft\n";
    const out = rewriteTag("Paper.tex", src, "draft", "wip");
    assert.equal(out?.text, "%---\n% publish: true\n% tags: [wip, ideas]\n%---%\n\\section{A} % #draft\n");
    assert.equal(out?.count, 1);
  });
});

describe("tag MERGE: renaming onto a name that exists", () => {
  it("does not print the target twice in a flow list", () => {
    const out = rewriteTag("N.md", "---\ntags: [alpha, beta]\n---\nb\n", "alpha", "beta");
    assert.equal(out?.text, "---\ntags: [beta]\n---\nb\n");
  });

  it("drops the duplicate whichever side it falls on", () => {
    const out = rewriteTag("N.md", "---\ntags: [beta, alpha]\n---\nb\n", "alpha", "beta");
    assert.equal(out?.text, "---\ntags: [beta]\n---\nb\n");
  });

  it("removes the whole line in a block list", () => {
    const src = "---\ntags:\n  - beta\n  - alpha\n  - gamma\n---\nb\n";
    const out = rewriteTag("N.md", src, "alpha", "beta");
    assert.equal(out?.text, "---\ntags:\n  - beta\n  - gamma\n---\nb\n");
  });

  it("removes the duplicate at the END of a comma scalar, separator and all", () => {
    const out = rewriteTag("N.md", "---\ntags: alpha, beta\n---\nb\n", "alpha", "beta");
    assert.equal(out?.text, "---\ntags: beta\n---\nb\n");
  });

  it("leaves PROSE alone — two #betas in one sentence is the author's sentence", () => {
    const out = rewriteTag("N.md", "About #beta and #alpha.\n", "alpha", "beta");
    assert.equal(out?.text, "About #beta and #beta.\n");
  });
});

// ================================================================== headings

const anchors = (src: string) => anchorsOfContent("N.md", src);

describe("heading rename detection", () => {
  it("sees one heading renamed in place", () => {
    const hit = detectHeadingRename(
      anchors("# Top\n\n## Introduction\n\n## End\n"),
      anchors("# Top\n\n## Preface\n\n## End\n"),
    );
    assert.equal(hit?.from.id, "introduction");
    assert.equal(hit?.to.id, "preface");
    assert.equal(hit?.to.title, "Preface");
  });

  it("refuses to guess when two headings moved at once", () => {
    // A paste, not a rename. Rewriting the vault on a heuristic is exactly the
    // failure mode a bulk tool cannot have.
    assert.equal(
      detectHeadingRename(anchors("# A\n\n## B\n"), anchors("# X\n\n## Y\n")),
      null,
    );
  });

  it("says nothing when a heading is added or removed", () => {
    assert.equal(detectHeadingRename(anchors("# A\n"), anchors("# A\n\n## B\n")), null);
    assert.equal(detectHeadingRename(anchors("# A\n\n## B\n"), anchors("# A\n")), null);
  });

  it("says nothing when the SLUG survives the edit", () => {
    // "Introduction" → "Introduction!" is the same anchor; no link broke, so
    // there is nothing to offer and nothing to interrupt anybody about.
    assert.equal(
      detectHeadingRename(anchors("## Introduction\n"), anchors("## Introduction!\n")),
      null,
    );
  });
});

describe("the rename CHAIN — a save fires while the reader is still typing", () => {
  const before0 = anchors("## Introduction\n");

  it("keeps naming the anchor the vault's links actually point at", () => {
    clearHeadingChains();
    // Three saves, one word being retyped a letter at a time.
    const one = observeWrite("N.md", before0, "## Introductio\n");
    assert.equal(one?.from, "introduction");
    const two = observeWrite("N.md", anchors("## Introductio\n"), "## Introduc\n");
    assert.equal(two?.from, "introduction", "the chain must not forget where it started");
    const three = observeWrite("N.md", anchors("## Introduc\n"), "## Preface\n");
    assert.equal(three?.from, "introduction");
    assert.equal(three?.to, "preface");
    assert.equal(three?.toTitle, "Preface");
  });

  it("dissolves when the heading is typed back to what it was", () => {
    clearHeadingChains();
    observeWrite("N.md", before0, "## Introductio\n");
    const back = observeWrite("N.md", anchors("## Introductio\n"), "## Introduction\n");
    assert.equal(back, null, "an identity rename is not a rename");
  });

  it("starts a NEW chain when the next edit is somewhere else", () => {
    clearHeadingChains();
    observeWrite("N.md", anchors("## A\n\n## B\n"), "## X\n\n## B\n");
    const next = observeWrite("N.md", anchors("## X\n\n## B\n"), "## X\n\n## Y\n");
    assert.equal(next?.from, "b", "a second heading is its own rename");
  });
});

describe("heading-link rewriting", () => {
  const yes = () => true;
  const from = { id: "introduction", title: "Introduction" };
  const to = { id: "preface", title: "Preface" };

  it("answers a slug tail with the new slug and a title tail with the new title", () => {
    // findAnchor() accepts both spellings, so the repair has to answer in the
    // register it was addressed in — rewriting `[[N#Introduction]]` into
    // `[[N#preface]]` would work and would also vandalise the reader's prose.
    const out = rewriteHeadingLinks("[[N#introduction]] and [[N#Introduction]]\n", yes, from, to);
    assert.equal(out.text, "[[N#preface]] and [[N#Preface]]\n");
    assert.equal(out.count, 2);
  });

  it("keeps the alias, the embed bang and the target's own spelling", () => {
    const out = rewriteHeadingLinks("![[Folder/N#Introduction|see here]]\n", yes, from, to);
    assert.equal(out.text, "![[Folder/N#Preface|see here]]\n");
  });

  it("leaves links into OTHER notes alone", () => {
    const out = rewriteHeadingLinks(
      "[[N#Introduction]] and [[Other#Introduction]]\n",
      (target) => target === "N",
      from,
      to,
    );
    assert.equal(out.text, "[[N#Preface]] and [[Other#Introduction]]\n");
    assert.equal(out.count, 1);
  });

  it("leaves a link with no anchor alone", () => {
    const out = rewriteHeadingLinks("[[N]] and [[N|alias]]\n", yes, from, to);
    assert.equal(out.count, 0);
  });
});

// ============================================== the candidate list, on a vault

const data = makeDir();
const root = makeVault({
  "Inline.md": "Prose with #draft and #zettel/seed.\n",
  "Front.md": note({ tags: "[draft, ideas]" }, "body\n"),
  "Both.md": note({ tags: "draft" }, "and #draft again\n"),
  "Clean.md": "nothing here\n",
  "Nested.md": "#zettel/seed only\n",
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

describe("notesWithTag: the candidate list", () => {
  it("finds inline, frontmatter and both", () => {
    assert.deepEqual(notesWithTag("draft"), ["Both.md", "Front.md", "Inline.md"]);
  });

  it("includes the nested children of the tag being renamed", () => {
    assert.deepEqual(notesWithTag("zettel"), ["Inline.md", "Nested.md"]);
  });

  it("is empty for a tag nothing carries", () => {
    assert.deepEqual(notesWithTag("nothing"), []);
  });
});

// ================================================= the engine, on a real vault
//
// Everything above is pure. This is the part that writes: the preview and the
// apply must run the SAME transform over the SAME reads (or the preview is a
// preview of a different operation), and the undo must put every byte back.
// These run LAST in the file because they change the fixture underneath.

describe("bulkRewrite: preview, apply, undo", () => {
  const rename = (from: string, to: string): BulkTransform => (relPath, content) =>
    rewriteTag(relPath, content, from, to);

  it("previews exactly what the apply will change, and writes nothing", async () => {
    const preview = await previewBulk(notesWithTag("draft"), rename("draft", "wip"));
    assert.deepEqual(
      preview.files.map((f) => f.path),
      ["Both.md", "Front.md", "Inline.md"],
    );
    assert.equal(preview.edits, 4, "Both.md carries the tag twice");
    assert.ok(preview.files[0].lines.length > 0, "a preview shows the lines it will touch");
    // The dry run is a dry run.
    assert.match((await readNote("Inline.md")).content, /#draft/);
  });

  it("applies, and hands back a way out", async () => {
    const before = new Map<string, string>();
    for (const p of notesWithTag("draft")) before.set(p, (await readNote(p)).content);

    const result = await applyBulk(notesWithTag("draft"), rename("draft", "wip"));
    assert.equal(result.notes, 3);
    assert.equal(result.edits, 4);
    assert.deepEqual(result.skipped, []);
    assert.ok(result.undoId, "an edit this size must be undoable");
    assert.match((await readNote("Inline.md")).content, /#wip/);
    assert.equal((await readNote("Front.md")).content.includes("draft"), false);
    // The index moved with the files: the old tag is gone, the new one is there.
    assert.deepEqual(notesWithTag("draft"), []);
    assert.deepEqual(notesWithTag("wip"), ["Both.md", "Front.md", "Inline.md"]);

    // …and back, byte for byte.
    const undone = await undoBulk(result.undoId as string);
    assert.equal(undone.notes, 3);
    for (const [p, text] of before) {
      assert.equal((await readNote(p)).content, text, `${p} did not come back unchanged`);
    }
    assert.deepEqual(notesWithTag("draft"), ["Both.md", "Front.md", "Inline.md"]);
  });

  it("SKIPS a note that changed under it rather than clobbering the change", async () => {
    // The promise the whole engine rests on. A second writer lands between our
    // read and our write; that note is left exactly as they left it, and the
    // reader is told which one.
    const result = await applyBulk(notesWithTag("draft"), (relPath, content) => {
      if (relPath === "Front.md") {
        // Somebody else's save, in the window this call is meant to close.
        writeFileSync(path.join(root, "Front.md"), "---\ntags: [draft]\n---\nSOMEBODY ELSE\n");
      }
      return rewriteTag(relPath, content, "draft", "wip");
    });
    assert.deepEqual(result.skipped, [{ path: "Front.md", reason: "conflict" }]);
    assert.match((await readNote("Front.md")).content, /SOMEBODY ELSE/);
    if (result.undoId) await undoBulk(result.undoId);
  });

  it("refuses an undo it can no longer honour", async () => {
    await assert.rejects(() => undoBulk("not-a-bundle"), /taken back/);
  });
});
