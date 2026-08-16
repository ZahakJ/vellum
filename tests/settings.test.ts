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
  });

  it("lowercases the theme id, because the env door does too", () => {
    // This case used to assert the opposite — that "Iron-Gall" was a 400. It
    // is a deliberate change, not a regression: `DEFAULT_THEME` is lowercased
    // by readEnvTheme() before validation, so `DEFAULT_THEME=SOLAR` booted the
    // instance on solar while `PATCH {"defaultTheme":"SOLAR"}` answered 400 —
    // one value accepted at one door and refused at the other. Theme ids are a
    // closed lowercase enum, so both doors now coerce to the canonical form.
    patchSettings({ defaultTheme: "Iron-Gall" });
    assert.equal(getSettings().defaultTheme, "iron-gall");
  });

  it("the server and the client read ONE theme list", () => {
    // This used to compare two hand-maintained lists and warn when they drifted
    // — the server could not import the client store, so the same enum was
    // written twice. It is written once now, in shared/themes.ts, and both
    // sides import it; the drift this case guarded against is no longer
    // expressible. So the case guards the ARRANGEMENT that made it impossible.
    const serverSrc = readFileSync(path.join(repo, "server/settings.ts"), "utf8");
    const clientSrc = readFileSync(path.join(repo, "client/state.ts"), "utf8");
    const sharedSrc = readFileSync(path.join(repo, "shared/themes.ts"), "utf8");
    assert.match(
      serverSrc,
      /import \{ THEMES as THEME_IDS \} from "\.\.\/shared\/themes\.ts"/,
      "the server must take its theme list from shared/themes.ts",
    );
    assert.match(
      clientSrc,
      /from "\.\/themes\.ts"/,
      "the client must take its theme list from shared/themes.ts",
    );
    assert.match(
      sharedSrc,
      /export const THEMES = \[\.\.\.DARK_THEMES, \.\.\.LIGHT_THEMES\]/,
      "shared/themes.ts must remain the one definition",
    );
  });

  it("publicLayout accepts app/blog/designed, case-insensitively", () => {
    patchSettings({ publicLayout: "BLOG" });
    assert.equal(getSettings().publicLayout, "blog");
    // "designed" is the third public shell (the site design engine). It was
    // not a value when this case was written; it is one now, and a case that
    // still asserted a two-value enum would fail the moment the engine landed.
    patchSettings({ publicLayout: "DESIGNED" });
    assert.equal(getSettings().publicLayout, "designed");
    assert.match(refuse({ publicLayout: "magazine" }), /must be/);
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
    // languageFilter is NOT in this list any more: it grew from a boolean into
    // a four-value enum (off / follow / ar / en), so "must be a boolean" is no
    // longer the thing it says. Its own case is below.
    for (const key of ["languageToggle", "commentsEnabled", "shareButtons"]) {
      assert.match(refuse({ [key]: "true" }), /must be a boolean or null/, `accepted "${key}": "true"`);
      assert.match(refuse({ [key]: 1 }), /must be a boolean or null/);
      patchSettings({ [key]: true });
    }
    assert.equal(getSettings().commentsEnabled, true);
  });

  it("languageFilter is an enum, and still takes the booleans it used to", () => {
    for (const mode of ["off", "follow", "ar", "en"]) {
      patchSettings({ languageFilter: mode });
      assert.equal(getSettings().languageFilter, mode);
    }
    assert.match(refuse({ languageFilter: "fr" }), /must be one of/);
    assert.match(refuse({ languageFilter: 1 }), /must be one of/);
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

  it("home.note must be a safe NOTE path", () => {
    patchSettings({ home: { note: "Home.md" } });
    assert.equal(getSettings().home?.note, "Home.md");
    // A note is no longer only markdown: `.tex` and `.latex` are notes too, so
    // the rule is "a note path" rather than "a markdown path". The refusal is
    // still the same refusal — an image is not a home page.
    patchSettings({ home: { note: "Paper.tex" } });
    assert.equal(getSettings().home?.note, "Paper.tex");
    assert.match(refuse({ home: { note: "attachments/logo.png" } }), /must be a note path/);
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

  // The RAW value is judged before it is cleaned. `cleanValue` REPAIRS control
  // characters (a run of them becomes a space), so running it first made the
  // `control` reason unreachable: "med\0ia" was answered 200 and stored as the
  // folder "med ia" — a folder the author never typed.
  it("refuses a control character in attachments.folder instead of repairing it", () => {
    // Spelled as escapes: a literal control byte in a source file is invisible.
    for (const ch of ["\u0000", "\u0009", "\u001f", "\u007f"]) {
      assert.match(
        refuse({ attachments: { folder: `med${ch}ia` } }),
        /control characters/,
        `accepted U+${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
      );
      assert.equal(getSettings().attachments?.folder, undefined, "nothing was stored");
    }
  });

  it("still tolerates surrounding whitespace on a good folder", () => {
    patchSettings({ attachments: { folder: "media/uploads\n" } });
    assert.equal(getSettings().attachments?.folder, "media/uploads");
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
