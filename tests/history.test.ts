// Note history: the read half of Backup & sync (server/gitSync.ts).
//
// The parity feature this release exists to stand on. Bulk editors are what a
// note-taker most wants and least trusts, because a bad vault-wide edit is
// unrecoverable — so the undo of last resort ships first, and these are the
// promises it makes:
//
//   * a vault that is not a git repository answers `repo: false`, gracefully,
//     because that is a first-run state and not an error;
//   * `--follow` crosses a rename, and each revision carries the path its blob
//     actually lives under (asking for the CURRENT name would simply miss);
//   * a revision id is a bare object name — never `HEAD`, never `sha^`, never
//     a path — because it is spliced into a git revision spec;
//   * the same containment the note API enforces holds here: `..`, dotfiles
//     and anything outside the vault are refused before git is spoken to;
//   * "Snapshot now" commits locally and pushes nothing.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  isFullSha,
  isGitRepo,
  noteHistory,
  noteRevisionBlob,
  snapshotNow,
} from "../server/gitSync.ts";
import { initSite } from "../server/site.ts";
import { assertNotePath, initVault, safeAbs, VaultError } from "../server/vault.ts";
import { makeDir, makeVault, removeVault } from "./helpers/vault.ts";

const data = makeDir();

/** A vault with no `.git` at all — the first-run state. */
const plain = makeVault({ "Home.md": "# Home\n" });

/** A vault that IS a git repository, with a note that was edited and renamed. */
const repo = makeVault({ "Old Name.md": "one\ntwo\n" });

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
}

before(() => {
  initSite({ VELLUM_DATA: data });
  git(["init", "-q", "-b", "main", "."], repo);
  git(["add", "-A"], repo);
  git(["commit", "-qm", "first draft"], repo);
  writeFileSync(path.join(repo, "Old Name.md"), "one\ntwo\nthree\nfour\n");
  git(["add", "-A"], repo);
  git(["commit", "-qm", "two more lines"], repo);
  git(["mv", "Old Name.md", "New Name.md"], repo);
  git(["commit", "-qm", "renamed"], repo);
  writeFileSync(path.join(repo, "New Name.md"), "one\nTWO\nthree\nfour\n");
  git(["add", "-A"], repo);
  git(["commit", "-qm", "shout the second line"], repo);
});

after(() => {
  removeVault(plain);
  removeVault(repo);
  removeVault(data);
});

describe("note history — a vault with no repository", () => {
  before(() => initVault(plain));

  it("answers repo:false rather than an error", async () => {
    assert.equal(await isGitRepo(), false);
    const answer = await noteHistory("Home.md");
    assert.deepEqual(answer, { repo: false, revisions: [], truncated: false });
  });

  it("refuses a revision read outright", async () => {
    await assert.rejects(
      () => noteRevisionBlob("Home.md", "a".repeat(40)),
      (err: unknown) => err instanceof VaultError && err.status === 404,
    );
  });
});

describe("note history — a git vault", () => {
  before(() => initVault(repo));

  it("lists every commit that touched the note, newest first", async () => {
    const { repo: isRepo, revisions, truncated } = await noteHistory("New Name.md");
    assert.equal(isRepo, true);
    assert.equal(truncated, false);
    assert.equal(revisions.length, 4);
    assert.deepEqual(
      revisions.map((r) => r.subject),
      ["shout the second line", "renamed", "two more lines", "first draft"],
    );
    for (const r of revisions) {
      assert.ok(isFullSha(r.sha), `full object name: ${r.sha}`);
      assert.ok(r.short.length >= 4 && r.sha.startsWith(r.short));
      assert.ok(!Number.isNaN(Date.parse(r.iso)), `parseable date: ${r.iso}`);
    }
  });

  it("carries the path each revision's blob actually lives under", async () => {
    const { revisions } = await noteHistory("New Name.md");
    // The rename commit and everything after it is the new name; everything
    // before it is the old one. Asking git for `<old sha>:New Name.md` misses.
    assert.deepEqual(
      revisions.map((r) => r.path),
      ["New Name.md", "New Name.md", "Old Name.md", "Old Name.md"],
    );
  });

  it("counts the lines each revision changed", async () => {
    const { revisions } = await noteHistory("New Name.md");
    assert.deepEqual({ added: revisions[0].added, removed: revisions[0].removed }, { added: 1, removed: 1 });
    assert.deepEqual({ added: revisions[2].added, removed: revisions[2].removed }, { added: 2, removed: 0 });
    assert.deepEqual({ added: revisions[3].added, removed: revisions[3].removed }, { added: 2, removed: 0 });
  });

  it("hands back the bytes of an old revision, across the rename", async () => {
    const { revisions } = await noteHistory("New Name.md");
    const first = revisions[3];
    const blob = await noteRevisionBlob(first.path, first.sha);
    assert.equal(blob.content, "one\ntwo\n");
    assert.equal(blob.path, "Old Name.md");
    const latest = await noteRevisionBlob(revisions[0].path, revisions[0].sha);
    assert.equal(latest.content, "one\nTWO\nthree\nfour\n");
  });

  it("honours the ceiling and says when it truncated", async () => {
    const { revisions, truncated } = await noteHistory("New Name.md", 2);
    assert.equal(revisions.length, 2);
    assert.equal(truncated, true);
  });

  it("answers an empty list for a note git has never seen", async () => {
    const answer = await noteHistory("Never Existed.md");
    assert.deepEqual(answer, { repo: true, revisions: [], truncated: false });
  });
});

describe("note history — what a revision id may be", () => {
  before(() => initVault(repo));

  it("accepts a full object name only", () => {
    assert.equal(isFullSha("a".repeat(40)), true);
    assert.equal(isFullSha("b".repeat(64)), true); // sha-256 repositories
    assert.equal(isFullSha("abc1234"), false);
    assert.equal(isFullSha("HEAD"), false);
    assert.equal(isFullSha("HEAD~1"), false);
    assert.equal(isFullSha(`${"a".repeat(40)}^`), false);
    assert.equal(isFullSha(`${"a".repeat(40)}:../../etc/passwd`), false);
    assert.equal(isFullSha("A".repeat(40)), false); // git prints lowercase
  });

  it("refuses anything else before git is spoken to", async () => {
    for (const sha of ["HEAD", "main", "", `${"a".repeat(40)}^`, "@{-1}"]) {
      await assert.rejects(
        () => noteRevisionBlob("New Name.md", sha),
        (err: unknown) => err instanceof VaultError && err.status === 400,
        `refused: ${JSON.stringify(sha)}`,
      );
    }
  });
});

describe("note history — the path is the vault's own boundary", () => {
  before(() => initVault(repo));

  // The routes run `assertNotePath()` then `safeAbs()` before either git call,
  // which is the same pair every note route runs. These assert that pair
  // answers the way the history routes need it to.
  it("refuses traversal, absolute paths and non-notes", () => {
    for (const bad of ["../../etc/passwd", "/etc/passwd", "..", "notes/../../out.md"]) {
      assert.throws(
        () => safeAbs(assertNotePath(bad)),
        (err: unknown) => err instanceof VaultError && (err.status === 400 || err.status === 404),
        `refused: ${bad}`,
      );
    }
    // Not a note at all.
    assert.throws(() => assertNotePath("attachments/logo.png"), VaultError);
    assert.throws(() => assertNotePath(""), VaultError);
  });

  it("refuses the paths the whole app is built to never see", () => {
    for (const bad of [".git/config.md", ".trash/gone.md", ".obsidian/plugins/x.md"]) {
      assert.throws(
        () => safeAbs(assertNotePath(bad)),
        (err: unknown) => err instanceof VaultError && err.status === 404,
        `refused: ${bad}`,
      );
    }
  });
});

describe("snapshot now", () => {
  before(() => initVault(repo));

  it("commits the working tree locally and answers the short sha", async () => {
    writeFileSync(path.join(repo, "New Name.md"), "one\nTWO\nthree\nfour\nfive\n");
    const made = await snapshotNow();
    assert.equal(made.committed, true);
    assert.ok(made.sha && made.sha.length >= 4);
    const { revisions } = await noteHistory("New Name.md");
    assert.equal(revisions.length, 5);
    assert.match(revisions[0].subject, /^vellum snapshot: /);
  });

  it("is a no-op on a clean tree", async () => {
    assert.deepEqual(await snapshotNow(), { committed: false, sha: null });
  });

  it("pushes nothing — there is no remote at all", () => {
    assert.throws(() => git(["remote", "get-url", "origin"], repo));
  });
});
