// Settings validation (server/settings.ts). PATCH /api/settings is the one
// admin-authenticated route that writes arbitrary JSON into a file the whole
// site reads on every request, so its allowlist is a security boundary as much
// as a schema: an unknown key is a 400, a prototype key is a 400, and a patch
// that fails anywhere lands nothing at all.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";
import { getSettings, patchSettings } from "../server/settings.ts";
import { initSite } from "../server/site.ts";
import { initVault, VaultError } from "../server/vault.ts";
import { makeDir, makeVault, removeVault } from "./helpers/vault.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const data = makeDir();
const root = makeVault({
  "Home.md": "# Home\n",
  "attachments/logo.png": "png",
  "attachments/favicon.ico": "ico",
  "attachments/notes.pdf": "pdf",
  ".obsidian/icon.png": "png",
});

before(() => {
  initSite({ VELLUM_DATA: data });
  initVault(root);
});

after(() => {
  removeVault(root);
  removeVault(data);
});

beforeEach(() => {
  // Every test starts from an empty stored file (env defaults in effect).
  patchSettings({
    siteName: null,
    tagline: null,
    footer: null,
    defaultTheme: null,
    publicLayout: null,
    blogLocale: null,
    language: null,
    languageFilter: null,
    languageToggle: null,
    commentsEnabled: null,
    shareButtons: null,
    excludeTags: null,
    favicon: null,
    logo: null,
    home: null,
  });
});

/** The 400 message a rejected patch answers with, or "" when it was accepted. */
function refuse(patch: Record<string, unknown>): string {
  try {
    patchSettings(patch);
    return "";
  } catch (err) {
    assert.ok(err instanceof VaultError, `expected a VaultError, got ${String(err)}`);
    assert.equal(err.status, 400);
    return err.message;
  }
}

describe("the allowlist", () => {
  it("refuses any key it does not know", () => {
    for (const key of ["nope", "adminPasswordHash", "sessionSecret", "port", "vaultPath", "SITE_NAME"]) {
      assert.match(refuse({ [key]: "x" }), /Unknown settings key/, `accepted ${key}`);
    }
  });

  it("refuses inherited Object.prototype names as keys", () => {
    // JSON.parse gives these as OWN properties, which is exactly how they
    // arrive from a request body — `in` would have resolved them up the chain.
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      const patch = JSON.parse(`{"${key}": {"polluted": true}}`) as Record<string, unknown>;
      assert.match(refuse(patch), /Unknown settings key/, `accepted ${key}`);
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined, "prototype was polluted");
  });

  it("refuses an unknown key inside home", () => {
    assert.match(refuse({ home: { mode: "note", nope: 1 } }), /Unknown settings key: home\.nope/);
    assert.match(refuse({ home: JSON.parse('{"__proto__": 1}') }), /Unknown settings key: home\./);
  });

  it("lands NOTHING when any key in the patch is bad", () => {
    patchSettings({ siteName: "Before" });
    assert.match(refuse({ siteName: "After", defaultTheme: "not-a-theme" }), /defaultTheme/);
    assert.equal(getSettings().siteName, "Before", "a partial patch was persisted");
  });
});

describe("enum keys", () => {
  it("defaultTheme accepts only the built-in themes", () => {
    for (const theme of ["iron-gall", "void", "lapis", "parchment"]) {
      patchSettings({ defaultTheme: theme });
      assert.equal(getSettings().defaultTheme, theme);
    }
    assert.match(refuse({ defaultTheme: "midnight" }), /must be one of/);
    assert.match(refuse({ defaultTheme: "Iron-Gall" }), /must be one of/);
  });

  it("the server's theme list matches the client's, exactly", () => {
    // The two lists live in different files by necessity (server can't import
    // the store). When a designer adds a theme to client/state.ts and forgets
    // this Set, the admin panel offers a theme the API answers 400 for.
    const serverSrc = readFileSync(path.join(repo, "server/settings.ts"), "utf8");
    const clientSrc = readFileSync(path.join(repo, "client/state.ts"), "utf8");
    const serverList = /const THEMES = new Set\(\[([^\]]*)\]\)/.exec(serverSrc)?.[1];
    const clientList = /export const THEMES = \[([^\]]*)\]/.exec(clientSrc)?.[1];
    assert.ok(serverList, "could not find THEMES in server/settings.ts");
    assert.ok(clientList, "could not find THEMES in client/state.ts");
    const names = (list: string): string[] =>
      [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(names(serverList), names(clientList), "theme lists have drifted apart");
  });

  it("publicLayout accepts app/blog, case-insensitively", () => {
    patchSettings({ publicLayout: "BLOG" });
    assert.equal(getSettings().publicLayout, "blog");
    assert.match(refuse({ publicLayout: "magazine" }), /must be "app" or "blog"/);
  });

  it("language accepts en/ar only", () => {
    patchSettings({ language: "AR" });
    assert.equal(getSettings().language, "ar");
    assert.match(refuse({ language: "fr" }), /must be "en" or "ar"/);
  });

  it("home.mode accepts note/dashboard, and 'note' means 'stored default'", () => {
    patchSettings({ home: { mode: "dashboard" } });
    assert.equal(getSettings().home?.mode, "dashboard");
    patchSettings({ home: { mode: "note" } });
    assert.equal(getSettings().home?.mode, undefined, "the default is not stored");
    assert.match(refuse({ home: { mode: "grid" } }), /home\.mode/);
  });

  it("booleans are booleans, not strings", () => {
    for (const key of ["languageFilter", "languageToggle", "commentsEnabled", "shareButtons"]) {
      assert.match(refuse({ [key]: "true" }), /must be a boolean or null/, `accepted "${key}": "true"`);
      assert.match(refuse({ [key]: 1 }), /must be a boolean or null/);
      patchSettings({ [key]: true });
    }
    assert.equal(getSettings().languageFilter, true);
  });
});

describe("per-key validators", () => {
  it("caps string lengths per key, not with one global budget", () => {
    assert.match(refuse({ siteName: "x".repeat(81) }), /too long \(80/);
    assert.match(refuse({ tagline: "x".repeat(161) }), /too long \(160/);
    assert.match(refuse({ footer: "x".repeat(201) }), /too long \(200/);
    patchSettings({ siteName: "x".repeat(80) });
    assert.equal(getSettings().siteName?.length, 80);
  });

  it("strips control characters and trims", () => {
    patchSettings({ siteName: "  A\tB\nC  " });
    assert.equal(getSettings().siteName, "A B C");
  });

  it("clears a key with null or an empty string", () => {
    patchSettings({ siteName: "Set" });
    patchSettings({ siteName: "" });
    assert.equal(getSettings().siteName, undefined);
    patchSettings({ siteName: "Set" });
    patchSettings({ siteName: null });
    assert.equal(getSettings().siteName, undefined);
    patchSettings({ siteName: "   " });
    assert.equal(getSettings().siteName, undefined, "whitespace-only clears too");
  });

  it("rejects a non-string where a string belongs", () => {
    assert.match(refuse({ siteName: 42 }), /must be a string or null/);
    assert.match(refuse({ siteName: { a: 1 } }), /must be a string or null/);
  });

  it("validates blogLocale as BCP47 and canonicalizes it", () => {
    patchSettings({ blogLocale: "en-us" });
    assert.equal(getSettings().blogLocale, "en-US");
    patchSettings({ blogLocale: "ar-EG-u-nu-latn" });
    assert.equal(getSettings().blogLocale, "ar-EG-u-nu-latn");
    assert.match(refuse({ blogLocale: "not a locale" }), /not a valid BCP47/);
    assert.match(refuse({ blogLocale: "e".repeat(40) }), /too long|not a valid BCP47/);
  });

  it("excludeTags: strips #, dedupes, refuses junk and refuses a flood", () => {
    patchSettings({ excludeTags: ["#draft", "draft", "zettel/seed", "مسودة"] });
    assert.deepEqual(getSettings().excludeTags, ["draft", "zettel/seed", "مسودة"]);
    assert.match(refuse({ excludeTags: "draft" }), /must be an array/);
    assert.match(refuse({ excludeTags: [1] }), /must be an array of strings/);
    assert.match(refuse({ excludeTags: ["has space"] }), /is not a simple tag/);
    assert.match(refuse({ excludeTags: ["-leading-dash"] }), /is not a simple tag/);
    assert.match(refuse({ excludeTags: ["x".repeat(51)] }), /is not a simple tag/);
    assert.match(refuse({ excludeTags: new Array(201).fill("tag") }), /too many tags/);
    patchSettings({ excludeTags: [] });
    assert.equal(getSettings().excludeTags, undefined, "an empty array clears back to env");
  });

  it("favicon must be a safe vault IMAGE path", () => {
    patchSettings({ favicon: "attachments/favicon.ico" });
    assert.equal(getSettings().favicon, "attachments/favicon.ico");
    patchSettings({ favicon: "./attachments/logo.png" });
    assert.equal(getSettings().favicon, "attachments/logo.png", "normalized on the way in");
    assert.match(refuse({ favicon: "attachments/notes.pdf" }), /must be a vault image path/);
    assert.match(refuse({ favicon: "Home.md" }), /must be a vault image path/);
    assert.match(refuse({ favicon: "../outside.png" }), /not a valid vault path/);
    assert.match(refuse({ favicon: ".obsidian/icon.png" }), /not a valid vault path/);
  });

  it("KNOWN BUG: favicon accepts a URL and mangles it into a vault path", () => {
    // cleanVaultImage has no scheme guard (cleanImageRef, which logo and
    // home.banner use, does). "https://example.com/x.png" normalizes to
    // "https:/example.com/x.png" — a path that passes safeAbs, ends in .png,
    // and is stored. The admin sees the field accept their URL; the site then
    // serves no favicon at all, and the bogus path joins settingsAssetPaths().
    patchSettings({ favicon: "https://example.com/x.png" });
    assert.equal(getSettings().favicon, "https:/example.com/x.png");
    // A non-https scheme is mangled the same way rather than refused.
    patchSettings({ favicon: "javascript:x.png" });
    assert.equal(getSettings().favicon, "javascript:x.png");
  });

  it("logo and home.banner also accept an https URL — and only https", () => {
    patchSettings({ logo: "https://example.com/logo.png" });
    assert.equal(getSettings().logo, "https://example.com/logo.png");
    for (const bad of [
      "http://example.com/logo.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "vbscript:x",
      "HTTP://example.com/logo.png",
    ]) {
      assert.match(refuse({ logo: bad }), /https:\/\/ URL or a vault image path/, `accepted ${bad}`);
      assert.match(refuse({ home: { banner: bad } }), /https:\/\/ URL or a vault image path/);
    }
  });

  it("home.note must be a safe markdown path", () => {
    patchSettings({ home: { note: "Home.md" } });
    assert.equal(getSettings().home?.note, "Home.md");
    assert.match(refuse({ home: { note: "attachments/logo.png" } }), /must be a markdown path/);
    assert.match(refuse({ home: { note: "../outside.md" } }), /not a valid vault path/);
    assert.match(refuse({ home: { note: ".trash/Old.md" } }), /not a valid vault path/);
    assert.match(refuse({ home: { note: 7 } }), /must be a string or null/);
  });

  it("home merges key by key instead of replacing the object", () => {
    patchSettings({ home: { mode: "dashboard", note: "Home.md" } });
    patchSettings({ home: { note: null } });
    assert.equal(getSettings().home?.mode, "dashboard", "an unrelated key was dropped");
    assert.equal(getSettings().home?.note, undefined);
  });
});

describe("the stored file", () => {
  it("preserves unknown keys written by other tooling", () => {
    const file = path.join(data, "settings.json");
    patchSettings({ siteName: "A" });
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    raw.someFutureKey = { kept: true };
    // Write it back the way an external tool would, then patch again.
    writeFileSync(file, JSON.stringify(raw, null, 2));
    patchSettings({ tagline: "B" });
    const reread = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.deepEqual(reread.someFutureKey, { kept: true });
    assert.equal(reread.siteName, "A");
    assert.equal(reread.tagline, "B");
  });

  it("drops malformed values on READ instead of throwing", () => {
    const file = path.join(data, "settings.json");
    writeFileSync(
      file,
      JSON.stringify({ siteName: 42, defaultTheme: "nope", excludeTags: ["ok", "not ok"], language: "fr" }),
    );
    const settings = getSettings();
    assert.equal(settings.siteName, undefined);
    assert.equal(settings.defaultTheme, undefined);
    assert.equal(settings.language, undefined);
    assert.deepEqual(settings.excludeTags, ["ok"], "the good entries survive");
  });

  it("survives a corrupt file (env defaults, no crash)", () => {
    const file = path.join(data, "settings.json");
    writeFileSync(file, "{not json");
    assert.deepEqual(getSettings(), {});
  });
});
