// PER-DESIGN FONT PAIRING — the contract between a design that names a face
// and a server that has to serve it.
//
// Three seams, and every one of them is a place the two halves could drift:
//
//   1. THE VALIDATORS. A face this build does not have is refused out loud on
//      the write side and dropped quietly on the read side, which is the same
//      split every other design field already has.
//   2. THE FAMILY NAME. `typographyVars()` writes a family name into a
//      visitor's inline style with no knowledge of settings.json; the server
//      emits a family under exactly that name. If the two ever computed it
//      differently the page would silently fall back and nothing would say so
//      — which is precisely the failure mode a test has to pin.
//   3. THE UNION. One stylesheet carries the instance's four slots AND the
//      active design's faces, and the design's Latin face composes with the
//      INSTANCE's Arabic slot, per character, exactly as a settings-chosen
//      face does.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  designFontRefs,
  normalizeChrome,
  stockChrome,
  typographyVars,
  validateChrome,
  type TypographyDesign,
} from "../shared/designChrome.ts";
import {
  designFontFamily,
  designFontRef,
  parseDesignFontRefs,
} from "../shared/fontCatalog.ts";
import { stockDesign } from "../shared/design.ts";
import {
  buildDesignFontCss,
  buildFontCss,
  designCatalogIds,
  siteFontsSignature,
  SYSTEM_SLOTS,
  type FontSlots,
} from "../server/fonts.ts";
import { activeDesignFontRefs } from "../server/designs.ts";
import { initSite } from "../server/site.ts";
import { initVault } from "../server/vault.ts";
import { makeDir, makeVault, removeVault } from "./helpers/vault.ts";

const data = makeDir();
const root = makeVault({ "Home.md": "# Home\n" });

/** A family the CSS builder will believe in: `readFaces()` reads meta.json and
 *  nothing else, so a cache is one JSON file. The ranges are the shapes Google
 *  actually emits, because the composite's whole job is narrowing them. */
function fakeCache(id: string, family: string, ranges: Record<string, string>): void {
  const dir = path.join(data, "fonts", "catalog", id);
  mkdirSync(dir, { recursive: true });
  const faces = Object.entries(ranges).map(([subset, range]) => ({
    file: `${subset}-400.woff2`,
    weight: "400",
    style: "normal",
    range,
    subset,
  }));
  writeFileSync(
    path.join(dir, "meta.json"),
    `${JSON.stringify({ id, family, fetched: new Date().toISOString(), faces }, null, 2)}\n`,
  );
}

before(() => {
  initSite({ VELLUM_DATA: data });
  initVault(root);
  fakeCache("eb-garamond", "EB Garamond", { latin: "U+0000-00FF, U+0131" });
  fakeCache("jetbrains-mono", "JetBrains Mono", { latin: "U+0000-00FF" });
  fakeCache("lora", "Lora", { latin: "U+0000-00FF" });
  fakeCache("amiri", "Amiri", { arabic: "U+0600-06FF, U+FE70-FEFC", latin: "U+0000-00FF" });
  fakeCache("literata", "Literata", { latin: "U+0000-00FF", arabic: "U+0600-06FF" });
});

after(() => removeVault(root));

const typo = (patch: Partial<TypographyDesign>): TypographyDesign => ({
  ...stockChrome().typography,
  ...patch,
});

describe("design fonts: the validators", () => {
  it("accepts a catalog id on both sides", () => {
    const chrome = validateChrome({ typography: { headingFont: "eb-garamond" } });
    assert.equal(chrome.typography.headingFont, "eb-garamond");
    assert.equal(
      normalizeChrome({ typography: { headingFont: "eb-garamond" } }).typography.headingFont,
      "eb-garamond",
    );
  });

  it("REFUSES an unknown id, naming the field", () => {
    assert.throws(
      () => validateChrome({ typography: { headingFont: "eb-garamon" } }),
      (err: Error & { path?: string; code?: string }) =>
        err.path === "typography.headingFont" && err.code === "design_bad_value",
    );
  });

  it("refuses an uploaded face — a design travels and a file does not", () => {
    assert.throws(() => validateChrome({ typography: { bodyFont: "custom:mine.woff2" } }));
  });

  it("DROPS an unknown id on the read side rather than throwing", () => {
    const chrome = normalizeChrome({ typography: { bodyFont: "nope", monoFont: "fira-code" } });
    assert.equal(chrome.typography.bodyFont, undefined);
    assert.equal(chrome.typography.monoFont, "fira-code");
    assert.ok(!("bodyFont" in chrome.typography), "absent means the key is gone, not undefined");
  });

  it("null clears a face back to the instance's stack", () => {
    const chrome = validateChrome({ typography: { headingFont: null } });
    assert.ok(!("headingFont" in chrome.typography));
  });

  it("a design that names nothing is unchanged by both", () => {
    const stock = stockChrome().typography;
    assert.deepEqual(validateChrome({}).typography, stock);
    assert.deepEqual(normalizeChrome({}).typography, stock);
  });
});

describe("design fonts: what typographyVars emits", () => {
  it("ABSENT is the stock token, exactly as before the feature", () => {
    const vars = typographyVars(typo({}));
    assert.equal(vars["--dsg-head-font"], "var(--font-serif)");
    assert.equal(vars["--dsg-body-font"], "var(--font-serif)");
    assert.equal(vars["--dsg-mono-font"], "var(--font-mono)");
  });

  it("PRESENT is the resolved family with the token behind it", () => {
    const vars = typographyVars(typo({ headingFont: "eb-garamond" }));
    assert.equal(
      vars["--dsg-head-font"],
      `"${designFontFamily("eb-garamond", "prose")}", var(--font-serif)`,
    );
    // The fallback is the feature: a face that never downloads leaves the page
    // exactly as it was.
    assert.ok(vars["--dsg-head-font"].endsWith("var(--font-serif)"));
  });

  it("the family follows the STACK the role stands in", () => {
    const sans = typographyVars(typo({ headingFamily: "sans", headingFont: "inter" }));
    assert.equal(sans["--dsg-head-font"], `"${designFontFamily("inter", "ui")}", var(--font-ui)`);
  });

  it("a mono role with no face of its own resolves to monoFont", () => {
    const vars = typographyVars(
      typo({ headingFamily: "mono", bodyFamily: "mono", monoFont: "jetbrains-mono" }),
    );
    const family = `"${designFontFamily("jetbrains-mono", "mono")}", var(--font-mono)`;
    assert.equal(vars["--dsg-head-font"], family);
    assert.equal(vars["--dsg-body-font"], family);
    assert.equal(vars["--dsg-mono-font"], family);
  });

  it("a role's own face still outranks the mono stack's", () => {
    const vars = typographyVars(
      typo({ headingFamily: "mono", headingFont: "fira-code", monoFont: "jetbrains-mono" }),
    );
    assert.equal(
      vars["--dsg-head-font"],
      `"${designFontFamily("fira-code", "mono")}", var(--font-mono)`,
    );
  });
});

describe("design fonts: which faces a design asks for", () => {
  it("names each (id, slot) pair once", () => {
    const refs = designFontRefs(typo({ headingFont: "lora", bodyFont: "lora" }));
    assert.equal(refs.length, 1);
    assert.deepEqual(refs[0], designFontRef("lora", "prose"));
  });

  it("the same face in two stacks is two families", () => {
    const refs = designFontRefs(
      typo({ headingFont: "lora", bodyFamily: "sans", bodyFont: "lora" }),
    );
    assert.deepEqual(
      refs.map((r) => r.family).sort(),
      [designFontFamily("lora", "prose"), designFontFamily("lora", "ui")].sort(),
    );
  });

  it("a mono face is asked for by the roles that inherit it", () => {
    const refs = designFontRefs(typo({ bodyFamily: "mono", monoFont: "jetbrains-mono" }));
    assert.deepEqual(refs.map((r) => r.family), [designFontFamily("jetbrains-mono", "mono")]);
  });

  it("the wire form survives the round trip, and drops what it cannot use", () => {
    const refs = designFontRefs(typo({ headingFont: "lora", monoFont: "fira-code" }));
    const spec = refs.map((r) => `${r.slot}:${r.id}`).join(",");
    assert.deepEqual(parseDesignFontRefs(spec), refs);
    assert.deepEqual(parseDesignFontRefs("prose:not-a-font,junk,arabic:amiri"), []);
  });
});

describe("design fonts: the served stylesheet", () => {
  it("emits a composite under the family typographyVars names", async () => {
    const css = await buildDesignFontCss(
      designFontRefs(typo({ headingFont: "eb-garamond" })),
      SYSTEM_SLOTS,
    );
    assert.match(css, new RegExp(`font-family: "${designFontFamily("eb-garamond", "prose")}"`));
    assert.match(css, /url\("\/api\/fonts\/catalog\/eb-garamond\/latin-400\.woff2"\)/);
    // Never an external host, on this route as on every other.
    assert.ok(!css.includes("fonts.gstatic.com"));
  });

  it("a design's LATIN face composes with the INSTANCE's Arabic slot", async () => {
    const slots: FontSlots = { ...SYSTEM_SLOTS, arabic: "amiri" };
    const css = await buildDesignFontCss(
      designFontRefs(typo({ headingFont: "eb-garamond" })),
      slots,
    );
    const family = designFontFamily("eb-garamond", "prose");
    // Both halves under ONE family, Arabic first and narrowed to Arabic
    // codepoints — the per-character pick the instance-wide system makes.
    assert.equal(css.match(new RegExp(`font-family: "${family}"`, "g"))?.length, 2);
    // The Arabic half is declared FIRST and carries the measured optical-size
    // compensation, exactly as it does for a settings-chosen face.
    assert.ok(css.indexOf("amiri/arabic-400") < css.indexOf("eb-garamond/latin-400"));
    assert.match(css, /size-adjust: 138%/);
    assert.match(css, /unicode-range: U\+0600-06FF, U\+FE70-FEFC/);
    // …and only the Arabic half is compensated: the number describes THAT
    // family's body height, and is meaningless on the Latin one.
    assert.equal(css.match(/size-adjust/g)?.length, 1);
  });

  it("carves the Arabic codepoints out of the Latin half, so the pick is by coverage", async () => {
    // `literata` is faked with an Arabic subset it does not really have — the
    // shape of a Latin family whose Google slices overlap the Arabic blocks.
    // Standing beside a chosen Arabic face, that subset must not be emitted at
    // all, or the browser would pick by declaration order instead.
    const slots: FontSlots = { ...SYSTEM_SLOTS, arabic: "amiri" };
    const css = await buildDesignFontCss(
      designFontRefs(typo({ headingFont: "literata" })),
      slots,
    );
    assert.match(css, /literata\/latin-400\.woff2/);
    assert.ok(!css.includes("literata/arabic-400.woff2"));
  });

  it("a design's ARABIC face becomes the Arabic half, pairing with the instance's Latin", async () => {
    const slots: FontSlots = { ...SYSTEM_SLOTS, prose: "lora" };
    const refs = designFontRefs(typo({ headingFont: "amiri" }));
    const css = await buildDesignFontCss(refs, slots);
    assert.match(css, /url\("\/api\/fonts\/catalog\/amiri\/arabic-400\.woff2"\)/);
    assert.match(css, /url\("\/api\/fonts\/catalog\/lora\/latin-400\.woff2"\)/);
    // The counterpart has to be CACHED for that to work, so it is named.
    assert.deepEqual(designCatalogIds(refs, slots).sort(), ["amiri", "lora"]);
  });

  it("a face that is not on disk emits nothing — the fallback answers", async () => {
    const css = await buildDesignFontCss(
      designFontRefs(typo({ headingFont: "merriweather" })),
      SYSTEM_SLOTS,
    );
    assert.equal(css.trim(), "");
  });

  it("the sheet is the UNION: instance slots plus the design's faces", async () => {
    const slots: FontSlots = { ...SYSTEM_SLOTS, prose: "lora" };
    const refs = designFontRefs(typo({ headingFont: "eb-garamond" }));
    const css =
      (await buildFontCss(slots, { prefix: "Vellum", root: true })) +
      (await buildDesignFontCss(refs, slots));
    assert.match(css, /font-family: "VellumProse"/);
    assert.match(css, /--font-serif: "VellumProse"/);
    assert.match(css, new RegExp(`font-family: "${designFontFamily("eb-garamond", "prose")}"`));
    // The design's family is NEVER remapped onto an instance token: a design's
    // type reaches its page through --dsg-*, never by moving :root.
    assert.ok(!/--font-serif: "VellumDsg/.test(css));
  });
});

describe("design fonts: the cache-buster", () => {
  it("is empty when neither the instance nor the design names a face", () => {
    assert.equal(siteFontsSignature(SYSTEM_SLOTS, []), "");
  });

  it("is present for a design's faces even with every slot on system", () => {
    const sig = siteFontsSignature(SYSTEM_SLOTS, designFontRefs(typo({ bodyFont: "lora" })));
    assert.notEqual(sig, "");
    assert.match(sig, /prose:lora/);
  });

  it("moves when the design's faces move", () => {
    const a = siteFontsSignature(SYSTEM_SLOTS, designFontRefs(typo({ bodyFont: "lora" })));
    const b = siteFontsSignature(SYSTEM_SLOTS, designFontRefs(typo({ bodyFont: "literata" })));
    assert.notEqual(a, b);
  });
});

describe("design fonts: which design is the public one", () => {
  it("reads the ACTIVE design's faces, and answers [] when there is none", () => {
    writeFileSync(
      path.join(data, "designs.json"),
      `${JSON.stringify({ schema: 1, activeId: null, designs: [], themes: [] }, null, 2)}\n`,
    );
    assert.deepEqual(activeDesignFontRefs(), []);

    const quiet = stockDesign("quiet", "Quiet");
    const loud = stockDesign("loud", "Loud");
    loud.chrome.typography.headingFont = "eb-garamond";
    writeFileSync(
      path.join(data, "designs.json"),
      `${JSON.stringify(
        { schema: 1, activeId: "loud", designs: [quiet, loud], themes: [] },
        null,
        2,
      )}\n`,
    );
    assert.deepEqual(activeDesignFontRefs(), [designFontRef("eb-garamond", "prose")]);

    // A design that is merely STORED is not the public site's typography.
    writeFileSync(
      path.join(data, "designs.json"),
      `${JSON.stringify(
        { schema: 1, activeId: "quiet", designs: [quiet, loud], themes: [] },
        null,
        2,
      )}\n`,
    );
    assert.deepEqual(activeDesignFontRefs(), []);
  });
});
