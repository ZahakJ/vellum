// Durable note writes (server/vault.ts).
//
// The guarantee under test is not "writeNote writes" — the old bare
// `fs.writeFile` did that too. It is that the note on disk is ALWAYS either
// the old one or the new one. `fs.writeFile` opens with O_TRUNC, so between
// that call and the last byte the note is zero bytes long; every save in the
// product went through that window, hundreds of times an hour, on the one file
// the user was promised was safe to keep for ten years.
//
// Atomicity itself cannot be observed from inside the process that performs
// it, so these tests pin the four things that CAN be observed and that a naive
// write-then-rename would each have got wrong.

import assert from "node:assert/strict";
import { chmodSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { VaultError, initVault, isIgnoredSegment, readNote, writeNote } from "../server/vault.ts";
import { makeVault, removeVault } from "./helpers/vault.ts";

const root = makeVault({
  "Note.md": "# original\n",
  "folder/Inner.md": "# inner\n",
  "locked/Held.md": "# held\n",
  "target/Real.md": "# real\n",
});
// A note kept as a symlink to another note inside the vault. CONTRACTS states
// such a link "still resolves and still works", and `fs.writeFile` followed it;
// a rename over the link itself would have replaced it with a regular file.
symlinkSync(path.join(root, "target/Real.md"), path.join(root, "Linked.md"));
initVault(root);

after(() => {
  try {
    chmodSync(path.join(root, "locked"), 0o755); // or the rm cannot descend
  } catch {
    /* already writable */
  }
  removeVault(root);
});

describe("durable note writes", () => {
  it("writes the content and reports the published file's mtime", async () => {
    const before = Date.now();
    const written = await writeNote("Note.md", "# rewritten\n");
    assert.equal(written.content, "# rewritten\n");
    assert.equal(readFileSync(path.join(root, "Note.md"), "utf8"), "# rewritten\n");
    // The mtime is read back AFTER the rename, so it describes the file a
    // reader would now open — which is what a write precondition compares.
    assert.ok(written.mtimeMs >= before - 2000);
    assert.equal(written.mtimeMs, statSync(path.join(root, "Note.md")).mtimeMs);
  });

  it("leaves no temp file behind on success", async () => {
    await writeNote("folder/Inner.md", "# changed\n");
    assert.deepEqual(readdirSync(path.join(root, "folder")), ["Inner.md"]);
  });

  it("names its temp file something the tree, indexer and watcher all skip", () => {
    // The dot prefix is why a save never flickers a ghost note through the
    // sidebar or into the search index. isIgnoredSegment is the single rule
    // all three of those walks consult.
    assert.equal(isIgnoredSegment(`.Note.md.${process.pid}.tmp`), true);
  });

  it("leaves the previous note intact when the write fails", async (t) => {
    // The whole point, and the one thing the old implementation could not do:
    // it had already truncated the file before it could discover the failure.
    if (process.getuid?.() === 0) {
      t.skip("running as root: mode bits do not deny the write");
      return;
    }
    const dir = path.join(root, "locked");
    chmodSync(dir, 0o555); // no new files in this directory
    await assert.rejects(() => writeNote("locked/Held.md", "# clobbered\n"));
    chmodSync(dir, 0o755);
    assert.equal(readFileSync(path.join(dir, "Held.md"), "utf8"), "# held\n");
    assert.deepEqual(readdirSync(dir), ["Held.md"]);
  });

  it("carries the target's mode across the rename", async (t) => {
    if (process.getuid?.() === 0) {
      t.skip("running as root: umask and mode bits behave differently");
      return;
    }
    // A rename hands the target the TEMP file's permissions, so without the
    // chmod a note the owner had narrowed to 0600 would silently widen.
    const abs = path.join(root, "Note.md");
    chmodSync(abs, 0o600);
    await writeNote("Note.md", "# again\n");
    assert.equal(statSync(abs).mode & 0o777, 0o600);
  });

  it("follows a symlinked note instead of replacing the link", async () => {
    await writeNote("Linked.md", "# through the link\n");
    assert.equal(lstatSync(path.join(root, "Linked.md")).isSymbolicLink(), true);
    assert.equal(readFileSync(path.join(root, "target/Real.md"), "utf8"), "# through the link\n");
    const back = await readNote("Linked.md");
    assert.equal(back.content, "# through the link\n");
  });
});

describe("the write precondition", () => {
  // `NoteData` has carried `mtimeMs` since the beginning and no writer ever
  // read it back, so saving was unconditional last-write-wins. That is fine
  // with one editor and stops being fine the moment a second pane, a second
  // window, Obsidian or a `git pull` can reach the same file.

  it("accepts a write whose base mtime still matches", async () => {
    const first = await writeNote("Note.md", "# one\n");
    const second = await writeNote("Note.md", "# two\n", first.mtimeMs);
    assert.equal(second.content, "# two\n");
    assert.equal(readFileSync(path.join(root, "Note.md"), "utf8"), "# two\n");
  });

  it("refuses a stale write, and touches nothing", async () => {
    const mine = await writeNote("Note.md", "# mine\n");
    // Somebody else — another window, Obsidian, a git pull — writes after me.
    await writeNote("Note.md", "# theirs\n");
    await assert.rejects(
      () => writeNote("Note.md", "# mine, later\n", mine.mtimeMs),
      (err: unknown) => {
        assert.ok(err instanceof VaultError);
        assert.equal(err.status, 409);
        // A STABLE code, not prose: the client translates the code and keeps
        // the English message only as the fallback for what is unnamed.
        assert.equal(err.code, "stale");
        return true;
      },
    );
    // The refusal must be total. A precondition that half-writes is worse than
    // none, because the file it leaves behind is neither version.
    assert.equal(readFileSync(path.join(root, "Note.md"), "utf8"), "# theirs\n");
  });

  it("writes when the file is GONE, rather than refusing into the void", async () => {
    // Deleted since the caller read it. Recreating is kinder than refusing to
    // save work into a file somebody else removed — and the caller hears about
    // the deletion from the watcher regardless.
    const before = await writeNote("Ghost.md", "# here\n");
    rmSync(path.join(root, "Ghost.md"));
    const again = await writeNote("Ghost.md", "# back\n", before.mtimeMs);
    assert.equal(again.content, "# back\n");
  });

  it("is opt-in: a writer that passes no base mtime is unconditional", async () => {
    // The publish toggle, the banner setter, the section writer and the rename
    // link-rewrite each derive a whole file from the one they are replacing,
    // and keep the old behaviour on purpose.
    await writeNote("Note.md", "# a\n");
    const out = await writeNote("Note.md", "# b\n");
    assert.equal(out.content, "# b\n");
  });
});
