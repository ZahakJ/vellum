// Server solidity: the five ways this process used to lie, lose or die.
//
// Every case below is a measured failure from the v1.8 audit, and each one is
// pinned at the seam that fixed it:
//
//   A1  /api/posts was O(published × total) — `isTemplateNote()` re-walked the
//       whole index once per published post. The memo has to INVALIDATE, or the
//       cure is worse than the disease: a templates folder that appears or
//       disappears must be seen.
//   A2  the minisearch auto-vacuum raced index mutations and killed the
//       process. Mutations now go through one chain; a save storm must survive.
//   A3  a bare `catch` around the write precondition's `stat` turned "I could
//       not look" into "there is nothing there", so a save that could not be
//       checked was performed anyway; and raw errnos reached clients as 500s.
//   A4  a transient read error evicted a note from the index until restart.
//   A5  the SSE stream narrated a `git pull` one file at a time.
//   A6  boot seeded `vault-seed/` into a directory the reader had made.

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  detectTemplatesFolder,
  indexFile,
  indexStats,
  initIndexer,
  isTemplateNote,
  posts as postsRaw,
  search as searchRaw,
  whenIndexed,
} from "../server/indexer.ts";
import { hasMarkdown, seedAvailable, seedVault } from "../server/seed.ts";
import { initSite } from "../server/site.ts";
import {
  VaultError,
  emitEvent,
  initVault,
  onEventCoalesced,
  writeFailure,
  writeNote,
} from "../server/vault.ts";
import type { VaultEvent } from "../shared/types.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

const posts = () => postsRaw(false, null);
const search = (q: string) => searchRaw(q, false, null);

const data = makeDir();
const root = makeVault({
  "Alpha.md": note({ publish: "true" }, "# Alpha\n\nA paragraph long enough to be a real excerpt for this note.\n"),
  "Beta.md": note({ publish: "true" }, "# Beta\n\nAnother paragraph, also long enough to count as prose here.\n"),
  "guarded/Held.md": note({ publish: "true" }, "# Held\n\nThe unmistakable word chartreuse lives in this note's prose.\n"),
  "precondition/Note.md": "# original\n",
});

before(async () => {
  initSite({ VELLUM_DATA: data });
  initVault(root);
  await initIndexer();
});

after(() => {
  for (const dir of ["guarded", "precondition"]) {
    try {
      chmodSync(path.join(root, dir), 0o755);
    } catch {
      /* already writable */
    }
  }
  removeVault(root);
  removeVault(data);
});

const asRoot = process.getuid?.() === 0;

// ─────────────────────────────────────────────────────── A1: templates memo

describe("templates folder detection", () => {
  it("answers nothing for a vault that has no templates folder", () => {
    assert.equal(detectTemplatesFolder(), null);
    assert.equal(isTemplateNote("Alpha.md"), false);
  });

  it("SEES a templates folder that appears — the memo invalidates on index writes", async () => {
    mkdirSync(path.join(root, "Templates"), { recursive: true });
    writeFileSync(path.join(root, "Templates/Daily.md"), note({ publish: "true" }, "# {{date}}\n"));
    await indexFile("Templates/Daily.md");
    assert.equal(detectTemplatesFolder(), "Templates");
    assert.equal(isTemplateNote("Templates/Daily.md"), true);
  });

  it("keeps a stencil out of the post list even when it says publish: true", () => {
    const listed = posts().map((p) => p.path);
    assert.ok(listed.includes("Alpha.md"));
    assert.ok(!listed.includes("Templates/Daily.md"), "a template reached the blog's post list");
  });

  it("SEES it go away again", async () => {
    const abs = path.join(root, "Templates/Daily.md");
    writeFileSync(abs, "");
    await import("node:fs/promises").then((fs) => fs.rm(abs));
    await indexFile("Templates/Daily.md"); // absent → removed from the index
    assert.equal(detectTemplatesFolder(), null);
  });
});

// ───────────────────────────────────────── A2: one chain, no vacuum races

describe("index mutations are serialized", () => {
  it("survives a save storm from two writers without losing the index", async () => {
    // The audit's shape, shrunk to a test: two clients alternating writes to
    // two notes, fast enough that a batched vacuum would overlap a mutation.
    // 400 writes was enough to kill the process 5/5 before autoVacuum went off.
    const files = ["Alpha.md", "Beta.md"];
    for (let i = 0; i < 400; i++) {
      const file = files[i % 2];
      const body = `# ${file}\n\nRevision ${i} of a paragraph long enough to count as prose in this vault.\n`;
      writeFileSync(path.join(root, file), note({ publish: "true" }, body));
      // Not awaited every time: the point is to have several in flight at once,
      // which is exactly what two browsers autosaving do.
      void indexFile(file);
    }
    await whenIndexed();
    // The index is still coherent: both notes searchable, one record each.
    const hits = search("Revision");
    assert.equal(hits.filter((h) => h.path === "Alpha.md").length, 1);
    assert.equal(hits.filter((h) => h.path === "Beta.md").length, 1);
    assert.equal(posts().filter((p) => p.path === "Alpha.md").length, 1);
    // 400 discards left plenty of dirt for the deferred vacuum to find.
    assert.ok(indexStats().dirt > 20, `dirt ${indexStats().dirt} — nothing to vacuum?`);
  });

  it("vacuums on its own schedule once the storm stops", async () => {
    // The vacuum runs on the chain, ~2s after the last mutation. A vacuum
    // nobody can observe is a vacuum that quietly stopped happening — and the
    // reason it is deferred at all is that minisearch's own (auto, batched,
    // between-ticks) one raced the saves above and killed the process.
    for (let i = 0; i < 40; i++) {
      if (indexStats().dirt === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await whenIndexed();
    }
    assert.equal(indexStats().dirt, 0, "the deferred vacuum never ran");
    // …and the index still answers correctly afterwards.
    assert.equal(search("Revision").filter((h) => h.path === "Alpha.md").length, 1);
  });
});

// ──────────────────────────────────────────── A3: the write path's errnos

describe("write failures say what happened", () => {
  it("maps the errnos a reader can act on, and passes anything else through", () => {
    const full = writeFailure(Object.assign(new Error("x"), { code: "ENOSPC" }), "Note.md");
    assert.ok(full instanceof VaultError);
    assert.equal(full.code, "diskFull");
    assert.equal(full.status, 507);
    const ro = writeFailure(Object.assign(new Error("x"), { code: "EROFS" }), "Note.md");
    assert.equal((ro as VaultError).code, "readOnly");
    // A bug in our own code must NOT come back dressed as a disk problem.
    const bug = new TypeError("undefined is not a function");
    assert.equal(writeFailure(bug, "Note.md"), bug);
  });

  it("REFUSES a precondition it could not check, instead of writing anyway", async (t) => {
    if (asRoot) {
      t.skip("running as root: permission bits do not apply");
      return;
    }
    const dir = path.join(root, "precondition");
    const abs = path.join(dir, "Note.md");
    const before = readFileSync(abs, "utf8");
    chmodSync(dir, 0o600); // readable, not traversable: stat inside → EACCES
    try {
      // The bug: this `stat` failing used to be swallowed, the precondition
      // skipped, and the write performed — the one thing the precondition
      // exists to prevent.
      await assert.rejects(
        () => writeNote("precondition/Note.md", "# clobbered\n", 1),
        (err: unknown) => err instanceof VaultError && err.status !== 409,
      );
    } finally {
      chmodSync(dir, 0o755);
    }
    assert.equal(readFileSync(abs, "utf8"), before, "the unguarded write went through");
  });
});

// ────────────────────────────────────── A4: a read that failed is not a delete

describe("a transient read error does not evict a note", () => {
  it("keeps the stale record when the file cannot be read", async (t) => {
    if (asRoot) {
      t.skip("running as root: permission bits do not apply");
      return;
    }
    assert.equal(search("chartreuse").length, 1, "fixture note is not indexed");
    const dir = path.join(root, "guarded");
    chmodSync(dir, 0o600); // EACCES on every read under it
    try {
      await indexFile("guarded/Held.md");
      // The old behaviour: gone from search, gone from the graph, gone from
      // the post list, until the process restarted — and nothing said so.
      assert.equal(search("chartreuse").length, 1, "an EACCES evicted the note");
      assert.ok(posts().some((p) => p.path === "guarded/Held.md"));
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  it("still removes a note that is genuinely gone", async () => {
    const abs = path.join(root, "Beta.md");
    const kept = readFileSync(abs, "utf8");
    await import("node:fs/promises").then((fs) => fs.rm(abs));
    await indexFile("Beta.md");
    assert.equal(posts().some((p) => p.path === "Beta.md"), false);
    writeFileSync(abs, kept);
    await indexFile("Beta.md");
  });
});

// ──────────────────────────────────────────────── A5: the aggregate coalescer

describe("the SSE coalescer", () => {
  it("narrates a few events and summarizes a storm", async () => {
    const heard: VaultEvent[] = [];
    const off = onEventCoalesced((ev) => heard.push(ev));
    try {
      // A handful: every one is named, because a client can follow that.
      for (let i = 0; i < 5; i++) emitEvent({ kind: "changed", path: `Small ${i}.md` });
      assert.equal(heard.length, 5);
      assert.ok(heard.every((e) => e.kind === "changed"));

      // A `git pull`: 1,000 files. The client is told once.
      heard.length = 0;
      for (let i = 0; i < 1000; i++) emitEvent({ kind: "changed", path: `Storm ${i}.md` });
      assert.ok(heard.length < 40, `narrated ${heard.length} of a 1000-file storm`);
      assert.ok(!heard.some((e) => e.kind === "bulk"), "the bulk frame went out mid-storm");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const bulk = heard.filter((e) => e.kind === "bulk");
      assert.equal(bulk.length, 1, "exactly one bulk frame settles the storm");
      assert.equal(bulk[0].path, "");
    } finally {
      off();
    }
  });
});

// ──────────────────────────────────────────────────── A6: seeding on a click

describe("the starter vault is offered, not imposed", () => {
  it("is available for an empty directory the reader made", () => {
    const empty = makeDir();
    try {
      assert.equal(hasMarkdown(empty), false);
      assert.equal(seedAvailable(empty), true);
      const guide = seedVault(empty);
      assert.equal(guide, "Welcome.md");
      assert.ok(existsSync(path.join(empty, "Welcome.md")));
      assert.equal(hasMarkdown(empty), true);
    } finally {
      removeVault(empty);
    }
  });

  it("REFUSES a vault that already holds notes — twice is not an accident", () => {
    const mine = makeVault({ "Private/Journal.md": "# mine\n" });
    try {
      assert.equal(seedAvailable(mine), false);
      assert.equal(seedVault(mine), null);
      assert.ok(!existsSync(path.join(mine, "Welcome.md")), "the seed landed on the reader's vault");
    } finally {
      removeVault(mine);
    }
  });
});
