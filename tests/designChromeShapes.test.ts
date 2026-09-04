// THE CHROME FIELDS — a masthead's shape, the page's ground, the shape of the
// end of the page, and how a menu item is drawn.
//
// Four enums across the whole chrome document, and every one of them is a place
// the two halves of this schema could drift. What is pinned here:
//
//   1. ABSENT IS THE OLD BEHAVIOUR. A `designs.json` written before these
//      fields existed — which is every design on every instance that upgrades —
//      must validate, and must come back drawing exactly what it drew
//      yesterday. That is the whole reason they are enums with a default
//      carried on `chrome` rather than a schema bump.
//   2. A VALUE THIS BUILD DOES NOT KNOW IS A NAMED 400. The path in the error is
//      what the owner's notice prints and what makes a hand-edited file fixable
//      without a debugger, so the tests read the path, not just the throw.
//   3. THE TWO VALIDATORS AGREE ON WHAT IS LEGAL AND DISAGREE ONLY ON WHAT TO
//      DO ABOUT AN ILLEGAL VALUE. `normalizeChrome` renders a page;
//      `validateChrome` says no out loud. A value one of them accepts and the
//      other refuses is a design that saves and never loads, or loads and never
//      saves.
//   4. `surface`, `scenery`, `ornament`, `shell` AND `frame` ARE TOP-LEVEL
//      CHROME KEYS. They are
//      the scalars that are not inside `header` / `footer` / `nav`, which is
//      exactly the shape a loop over those three groups walks past — it did
//      once, in check-presets, when `surface` was the only one. There are five
//      now, so the same omission would be five times as quiet — and one of
//      them, `shell`, decides where the chrome IS.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHROME_FRAMES,
  CHROME_ORNAMENTS,
  CHROME_SCENERIES,
  CHROME_SHELLS,
  CHROME_SURFACES,
  DesignError,
  FOOTER_FORMS,
  HEADER_LAYOUTS,
  NAV_STYLES,
  normalizeChrome,
  stockChrome,
  validateChrome,
} from "../shared/designChrome.ts";
import { validateDesign } from "../shared/design.ts";

/** A stored document with `chrome` swapped in. */
function doc(chrome: unknown): Record<string, unknown> {
  return {
    id: "d1",
    name: "A design",
    schema: 1,
    theme: null,
    site: { width: 720, density: "regular" },
    chrome,
    sections: [],
    article: {},
    createdMs: 1,
    updatedMs: 1,
  };
}

/** The path a rejection names, or "" if it did not reject. */
function refusal(chrome: unknown): string {
  try {
    validateChrome(chrome);
    return "";
  } catch (err) {
    assert.ok(err instanceof DesignError, "a rejection must be a DesignError");
    return err.path;
  }
}

describe("design chrome: the shape fields", () => {
  it("a chrome written before the fields existed keeps the shape it had", () => {
    // Exactly what an older `designs.json` carries: the four groups, none of
    // the new keys, no `surface` at all.
    const old = {
      nav: { items: [], fallback: "topics", showSearch: true, showThemeToggle: true, showLangSwitch: true },
      typography: {},
      header: { layout: "stacked", density: "regular", sticky: "nav" },
      footer: { columns: [], copyright: "", align: "center" },
    };
    for (const chrome of [normalizeChrome(old), validateChrome(old)]) {
      assert.equal(chrome.header.layout, "stacked");
      assert.equal(chrome.nav.style, "plain");
      assert.equal(chrome.footer.form, "columns");
      assert.equal(chrome.surface, "flat");
      // THE WHOLE PROMISE OF THE SCENERY RELEASE, in two lines. Every design
      // on every instance that upgrades was authored without these keys, and
      // "no sky, and the wordmark on the dividers" is precisely the page each
      // of them drew yesterday.
      assert.equal(chrome.scenery, "none");
      assert.equal(chrome.ornament, "asterism");
      // AND THE ROOM. `shell` is the field that moves walls rather than
      // furniture, so an upgraded design coming back as anything but "stack"
      // would be every existing site relaid out overnight.
      assert.equal(chrome.shell, "stack");
      assert.equal(chrome.frame, "plain");
    }
  });

  it("the stock chrome is the old page, forever", () => {
    const stock = stockChrome();
    assert.equal(stock.surface, "flat");
    assert.equal(stock.scenery, "none");
    assert.equal(stock.ornament, "asterism");
    assert.equal(stock.shell, "stack");
    assert.equal(stock.frame, "plain");
    assert.equal(stock.nav.style, "plain");
    assert.equal(stock.footer.form, "columns");
    assert.equal(stock.header.layout, "stacked");
  });

  it("every value in every vocabulary survives BOTH validators unchanged", () => {
    for (const layout of HEADER_LAYOUTS) {
      const raw = { header: { layout } };
      assert.equal(normalizeChrome(raw).header.layout, layout);
      assert.equal(validateChrome(raw).header.layout, layout);
    }
    for (const style of NAV_STYLES) {
      const raw = { nav: { style } };
      assert.equal(normalizeChrome(raw).nav.style, style);
      assert.equal(validateChrome(raw).nav.style, style);
    }
    for (const form of FOOTER_FORMS) {
      const raw = { footer: { form } };
      assert.equal(normalizeChrome(raw).footer.form, form);
      assert.equal(validateChrome(raw).footer.form, form);
    }
    for (const surface of CHROME_SURFACES) {
      const raw = { surface };
      assert.equal(normalizeChrome(raw).surface, surface);
      assert.equal(validateChrome(raw).surface, surface);
    }
    for (const scenery of CHROME_SCENERIES) {
      const raw = { scenery };
      assert.equal(normalizeChrome(raw).scenery, scenery);
      assert.equal(validateChrome(raw).scenery, scenery);
    }
    for (const ornament of CHROME_ORNAMENTS) {
      const raw = { ornament };
      assert.equal(normalizeChrome(raw).ornament, ornament);
      assert.equal(validateChrome(raw).ornament, ornament);
    }
    for (const shell of CHROME_SHELLS) {
      const raw = { shell };
      assert.equal(normalizeChrome(raw).shell, shell);
      assert.equal(validateChrome(raw).shell, shell);
    }
    for (const frame of CHROME_FRAMES) {
      const raw = { frame };
      assert.equal(normalizeChrome(raw).frame, frame);
      assert.equal(validateChrome(raw).frame, frame);
    }
  });

  it("the two grounds compose: a surface and a scenery are separate answers", () => {
    // The reason this is a second key rather than five more values of the
    // first. A texture of ink on the sheet and a field of light behind it are
    // not alternatives, and a design that wants laid paper under a starfield
    // must be able to say so in one document.
    const both = validateChrome({ surface: "paper", scenery: "starfield" });
    assert.equal(both.surface, "paper");
    assert.equal(both.scenery, "starfield");
    assert.deepEqual(normalizeChrome(structuredClone(both)), both);
  });

  it("the two masthead shapes this release adds are real values, not strings", () => {
    // The point of the release, stated as a test: a newspaper plate and a
    // magazine bar are choices the engine now has and did not.
    assert.ok(HEADER_LAYOUTS.includes("rule"));
    assert.ok(HEADER_LAYOUTS.includes("banner"));
    assert.equal(validateChrome({ header: { layout: "banner" } }).header.layout, "banner");
  });

  it("a sidebar masthead is refused, by name, because it is deferred and not shipped", () => {
    // Not a curiosity: "sidebar" is the value somebody will hand-edit in after
    // reading a changelog, and the honest answer is a 400 naming the field
    // rather than a page that silently draws the centred masthead.
    assert.equal(refusal({ header: { layout: "sidebar" } }), "header.layout");
    assert.equal(normalizeChrome({ header: { layout: "sidebar" } }).header.layout, "stacked");
  });

  it("an unknown value is a 400 that NAMES the field", () => {
    assert.equal(refusal({ header: { layout: "diagonal" } }), "header.layout");
    assert.equal(refusal({ nav: { style: "neon" } }), "nav.style");
    assert.equal(refusal({ footer: { form: "sitemap" } }), "footer.form");
    assert.equal(refusal({ surface: "linen" }), "surface");
    // A non-string is the same refusal: the vocabulary is the check.
    assert.equal(refusal({ surface: 3 }), "surface");
    // The new vocabularies answer the same way, and the names matter: a reader
    // who hand-edits `scenery: "starlight"` after a changelog gets the field
    // back, not a page that quietly stands in nothing. (It was `nebula` here
    // until `nebula` became a real world, which is the shape of test that
    // stops being a test the moment the thing it names ships.)
    assert.equal(refusal({ scenery: "starlight" }), "scenery");
    assert.equal(refusal({ ornament: "logo" }), "ornament");
    assert.equal(refusal({ scenery: 3 }), "scenery");
    assert.equal(refusal({ shell: "sidebar" }), "shell");
    assert.equal(refusal({ frame: "card" }), "frame");
    assert.equal(refusal({ nav: { style: null } }), "nav.style");
  });

  it("the lenient half never throws and always lands on the default", () => {
    for (const junk of [undefined, null, 7, "linen", {}, []]) {
      assert.equal(normalizeChrome({ surface: junk }).surface, "flat");
      assert.equal(normalizeChrome({ scenery: junk }).scenery, "none");
      assert.equal(normalizeChrome({ ornament: junk }).ornament, "asterism");
      assert.equal(normalizeChrome({ shell: junk }).shell, "stack");
      assert.equal(normalizeChrome({ frame: junk }).frame, "plain");
      assert.equal(normalizeChrome({ nav: { style: junk } }).nav.style, "plain");
      assert.equal(normalizeChrome({ footer: { form: junk } }).footer.form, "columns");
      assert.equal(normalizeChrome({ header: { layout: junk } }).header.layout, "stacked");
    }
  });

  it("the whole document validator carries the chrome's rejection out", () => {
    // `validateDesign` calls `validateChrome`, and the path it throws is what
    // the route turns into a named 400 rather than a 500.
    assert.throws(
      () => validateDesign(doc({ surface: "linen" })),
      (err: unknown) => err instanceof DesignError && err.path === "surface",
    );
    const ok = validateDesign(doc({ surface: "paper", footer: { form: "grand" }, nav: { style: "brackets" } }));
    assert.equal(ok.chrome.surface, "paper");
    assert.equal(ok.chrome.footer.form, "grand");
    assert.equal(ok.chrome.nav.style, "brackets");
  });

  it("a design carrying every new field round-trips through a full save", () => {
    // The shape a preset applied through the import route produces: written,
    // validated, read back leniently, and identical both times.
    const written = validateChrome({
      surface: "ruled",
      scenery: "topography",
      ornament: "lozenge",
      shell: "console",
      frame: "window",
      header: { layout: "rule", density: "tall" },
      footer: { form: "colophon", align: "center" },
      nav: { style: "underline" },
    });
    assert.deepEqual(normalizeChrome(structuredClone(written)), written);
  });
});
