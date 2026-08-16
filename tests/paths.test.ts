// Path safety (server/vault.ts): every path a client can name has to land
// inside the vault, and the parts of the vault the app pretends do not exist
// (.obsidian, .trash, dotfiles) must stay unreachable through every route.

import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  assertMarkdown,
  initVault,
  isIgnoredRel,
  isIgnoredSegment,
  normalizeRel,
  readNote,
  VaultError,
  safeAbs,
} from "../server/vault.ts";
import { makeDir, makeVault, removeVault } from "./helpers/vault.ts";

const outside = makeDir();
writeFileSync(path.join(outside, "secret.md"), "# outside the vault\n");

const root = makeVault({
  "Note.md": "# Note\n",
  "folder/Inner.md": "# Inner\n",
  ".obsidian/workspace.json": "{}",
  ".trash/Old.md": "# Old\n",
  ".hidden.md": "# Hidden\n",
  "attachments/img.png": "png",
});
symlinkSync(path.join(outside, "secret.md"), path.join(root, "escape.md"));
symlinkSync(outside, path.join(root, "escapedir"));
initVault(root);

after(() => {
  removeVault(root);
  removeVault(outside);
});

/** The status a safeAbs()-style call rejects `rel` with, or "" when it allows it. */
function reject(rel: string): number | "" {
  try {
    safeAbs(rel);
    return "";
  } catch (err) {
    assert.ok(err instanceof VaultError, `expected VaultError for ${JSON.stringify(rel)}`);
    return err.status;
  }
}

describe("normalizeRel", () => {
  it("canonicalizes separators, leading ./ and trailing /", () => {
    assert.equal(normalizeRel("a\\b\\c.md"), "a/b/c.md");
    assert.equal(normalizeRel("./a/b.md"), "a/b.md");
    assert.equal(normalizeRel("//a/b.md"), "a/b.md");
    assert.equal(normalizeRel("a//b.md"), "a/b.md");
    assert.equal(normalizeRel("a/./b.md"), "a/b.md");
    assert.equal(normalizeRel("folder/"), "folder");
    assert.equal(normalizeRel(""), "");
    assert.equal(normalizeRel("."), "");
  });

  it("keeps dots that are part of a NAME (a note may be called 'Jr..md')", () => {
    assert.equal(normalizeRel("Jr..md"), "Jr..md");
    assert.equal(normalizeRel("a/..b.md"), "a/..b.md");
    assert.equal(normalizeRel("a/b...md"), "a/b...md");
  });
});

describe("safeAbs traversal", () => {
  it("refuses .. as a whole segment (400)", () => {
    for (const rel of [
      "../secret.md",
      "a/../../secret.md",
      "..",
      "a/b/../../../secret.md",
      "..\\..\\secret.md",
      "./../secret.md",
      "folder/../../secret.md",
    ]) {
      assert.equal(reject(rel), 400, `should reject ${JSON.stringify(rel)}`);
    }
  });

  it("never escapes on percent-encoded separators (the layer above decodes once)", () => {
    // Hono has already URL-decoded the query param, so what arrives here is
    // literal text: "%2e%2e" is a NAME, not a traversal, and must resolve
    // inside the vault (as a missing file) rather than climbing out of it.
    for (const rel of ["a/%2e%2e/b.md", "%2e%2e/secret.md", "..%2f..%2fsecret.md", "%252e%252e/x.md"]) {
      const status = reject(rel);
      if (status === "") {
        assert.ok(safeAbs(rel).startsWith(root + path.sep), `${rel} escaped the vault`);
      } else {
        // A refusal is fine too — "..%2f…" opens with a dot, so the dotfile
        // rule hides it (404) before the traversal rule can 400 it.
        assert.ok(status === 400 || status === 404, `unexpected status ${status} for ${rel}`);
      }
    }
  });

  it("refuses NUL bytes", () => {
    const NUL = String.fromCharCode(0);
    assert.equal(reject(`Note.md${NUL}.png`), 400);
    assert.equal(reject(`folder/${NUL}/x.md`), 400);
  });

  it("treats an absolute-looking path as vault-relative, never as absolute", () => {
    assert.equal(safeAbs("/Note.md"), path.join(root, "Note.md"));
    assert.equal(safeAbs("/etc/passwd"), path.join(root, "etc/passwd"));
  });

  it("resolves ordinary paths inside the vault", () => {
    assert.equal(safeAbs("Note.md"), path.join(root, "Note.md"));
    assert.equal(safeAbs("folder/Inner.md"), path.join(root, "folder/Inner.md"));
    assert.equal(safeAbs(""), root);
  });
});

describe("safeAbs invisibility rules", () => {
  it("404s dotfiles and the ignored trees (existence is never revealed)", () => {
    for (const rel of [
      ".obsidian/workspace.json",
      ".obsidian",
      ".trash/Old.md",
      ".trash",
      ".hidden.md",
      "folder/.git/config",
      "node_modules/pkg/index.js",
      "NODE_MODULES/pkg/index.js",
    ]) {
      assert.equal(reject(rel), 404, `should hide ${JSON.stringify(rel)}`);
    }
  });

  it("uses the same rule for a single segment and a whole path", () => {
    assert.equal(isIgnoredSegment(".obsidian"), true);
    assert.equal(isIgnoredSegment(".Trash"), true);
    assert.equal(isIgnoredSegment("node_modules"), true);
    assert.equal(isIgnoredSegment("Node_Modules"), true);
    assert.equal(isIgnoredSegment("notes"), false);
    assert.equal(isIgnoredRel(""), false);
    assert.equal(isIgnoredRel("a/.obsidian/b"), true);
    assert.equal(isIgnoredRel("a/b/c.md"), false);
  });
});

describe("assertMarkdown", () => {
  it("accepts .md in any case and rejects everything else", () => {
    assert.equal(assertMarkdown("a/b.md"), "a/b.md");
    assert.equal(assertMarkdown("a/b.MD"), "a/b.MD");
    assert.equal(assertMarkdown("./a/b.md"), "a/b.md");
    for (const rel of ["", "a/b.txt", "a/b.markdown", "a/b.md.png", "folder"]) {
      assert.throws(() => assertMarkdown(rel), VaultError, `should reject ${JSON.stringify(rel)}`);
    }
  });
});

describe("unicode normalisation", () => {
  // A macOS vault stores "café.md" decomposed (NFD); a link typed on Linux is
  // composed (NFC). Neither vault.ts nor the indexer normalises, so the two
  // spellings are different paths — the reason a "file exists but the link is
  // broken" report is almost always a Mac-authored note.
  const nfc = "caf\u00e9.md"; //  é as one codepoint
  const nfd = "cafe\u0301.md"; // e + combining acute

  it("does NOT fold NFC and NFD spellings together (known gap)", () => {
    assert.notEqual(nfc, nfd);
    assert.equal(nfc.normalize("NFD"), nfd, "fixture sanity: same grapheme, two encodings");
    assert.notEqual(safeAbs(nfc), safeAbs(nfd));
    assert.equal(normalizeRel(nfd), nfd, "normalizeRel is path-shape only, not unicode");
  });
});

describe("symlinks", () => {
  // This block used to DOCUMENT the opposite: safeAbs was a lexical check, so
  // "escape.md" — a symlink pointing out of the vault — was inside the vault
  // as a STRING and reading it happily returned a file from elsewhere on the
  // disk. One `ln -s /etc evil` turned an anonymous reader into a filesystem
  // reader. Containment is now checked against the FILESYSTEM (realpath), on
  // reads as well as writes, so the gap the old test described is closed and
  // these assertions are its inverse.
  it("refuses a symlink that escapes the vault, on read", async () => {
    assert.throws(() => safeAbs("escape.md"), VaultError, "the link itself is not resolvable");
    await assert.rejects(() => readNote("escape.md"), VaultError);
  });

  it("refuses a path THROUGH a symlinked directory", async () => {
    assert.throws(() => safeAbs("escapedir/secret.md"), VaultError);
    await assert.rejects(() => readNote("escapedir/secret.md"), VaultError);
  });
});
