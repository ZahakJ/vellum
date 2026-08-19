// The settings index (client/components/settings/settingsIndex.ts) and the
// search over it.
//
// The index is GENERATED from the panel's source and gated by
// `npm run check-settings`, so what is worth testing here is not that it
// matches — the gate proves that — but that a reader searching for a thing
// they can see actually finds it, in both languages.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SETTINGS_INDEX } from "../client/components/settings/settingsIndex.ts";
import { searchSettings } from "../client/components/settings/searchSettings.ts";
import { setLang, t } from "../client/i18n.ts";

describe("the settings index", () => {
  it("covers every tab the panel has", () => {
    const tabs = new Set(SETTINGS_INDEX.map((e) => e.tab));
    for (const id of ["device", "identity", "language", "publishing", "vault", "typography", "sync"]) {
      assert.ok(tabs.has(id), `no rows indexed for the ${id} tab`);
    }
  });

  it("names no key twice within a tab", () => {
    const seen = new Set<string>();
    for (const e of SETTINGS_INDEX) {
      const key = `${e.tab}/${e.label}`;
      assert.ok(!seen.has(key), `duplicate row ${key}`);
      seen.add(key);
    }
  });

  it("carries the environment variables an operator would search for", () => {
    const envs = new Set(SETTINGS_INDEX.map((e) => e.env).filter(Boolean));
    for (const name of ["SITE_NAME", "SITE_LANG", "PUBLIC_LAYOUT"]) {
      assert.ok(envs.has(name), `${name} is not reachable from the settings search`);
    }
  });
});

describe("searching the settings", () => {
  it("finds a row by its own label", () => {
    setLang("en");
    const label = t(SETTINGS_INDEX[0].label);
    const hits = searchSettings(label);
    assert.ok(hits.some((h) => h.entry.label === SETTINGS_INDEX[0].label), `"${label}" found nothing`);
  });

  it("finds a row by its ENVIRONMENT VARIABLE — the operator's half", () => {
    setLang("en");
    const hits = searchSettings("SITE_LANG");
    assert.ok(hits.length > 0, "SITE_LANG found nothing");
    assert.equal(hits[0].entry.env, "SITE_LANG");
  });

  it("is case-insensitive, so a variable typed in lower case still lands", () => {
    setLang("en");
    assert.ok(searchSettings("site_lang").length > 0);
  });

  it("returns nothing for an empty query rather than everything", () => {
    assert.deepEqual(searchSettings(""), []);
    assert.deepEqual(searchSettings("   "), []);
  });

  it("ranks a LABEL match above a help-text match", () => {
    setLang("en");
    // A word common enough to appear in both places; the row that is NAMED for
    // it must come first, because that is the one the reader meant.
    const hits = searchSettings("theme");
    assert.ok(hits.length > 1, "expected several theme rows");
    assert.ok(/theme/i.test(t(hits[0].entry.label)), `first hit was "${t(hits[0].entry.label)}"`);
  });

  it("searches ARABIC labels on an Arabic instance, from the same index", () => {
    setLang("ar");
    const entry = SETTINGS_INDEX.find((e) => /[؀-ۿ]/.test(t(e.label)));
    assert.ok(entry, "no Arabic label found — the dictionary is not translated");
    const hits = searchSettings(t(entry.label));
    assert.ok(hits.some((h) => h.entry.label === entry.label), "an Arabic label found nothing");
    setLang("en");
  });

  it("folds the alef family — and the fold provably DOES something", () => {
    setLang("ar");
    // The first version of this test compared the two spellings and passed
    // while both returned [] — two empty lists agreeing that the fold was
    // broken. So first find a label that really contains a hamza-alef, then
    // assert the BARE spelling finds it: non-empty, or the test says nothing.
    const hamza = SETTINGS_INDEX.find((e) => /[\u0622\u0623\u0625]/.test(t(e.label)));
    assert.ok(hamza, "no hamza-alef label in the index — pick another probe");
    const bare = t(hamza.label).replace(/[\u0622\u0623\u0625]/g, "\u0627");
    const hits = searchSettings(bare);
    assert.ok(
      hits.some((h) => h.entry.label === hamza.label),
      `bare-alef "${bare}" did not find the hamza-spelled label "${t(hamza.label)}"`,
    );
    setLang("en");
  });
});
