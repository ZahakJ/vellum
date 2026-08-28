// The webfont catalog — the DATA half, on the shared side of the fence.
//
// It used to live in `server/fonts.ts` beside the downloader, the cache and the
// CSS builder, which was right while the only thing that ever named a face was
// `settings.fonts`: the server read the pick, fetched the family and generated
// the stylesheet, and the browser only ever saw the result.
//
// A DESIGN naming a face changed that. Three things that are not the server now
// have to agree about which ids exist:
//
//   · `validateChrome()` (shared/designChrome.ts) has to refuse an id this
//     build does not have — the same way it refuses an unknown heading case —
//     because a design document travels (export, import, a preset in the
//     catalog) and "the face silently did nothing" is the failure a validator
//     exists to prevent;
//   · the designer's three font rows have to LIST the faces, and they must do
//     it without a round trip: the catalog is a fact about this build, not
//     about this instance, and fetching /api/settings to draw a menu of
//     constants is a request that can fail;
//   · `check-presets` has to assert that every preset's font ids are real,
//     which is a pure-data gate with no server in it at all.
//
// So the twenty-seven families move here and `server/fonts.ts` re-exports them.
// Everything that TOUCHES A DISK OR A NETWORK — the Google fetch, the cache
// under VELLUM_DATA/fonts/catalog, the generated @font-face blocks — stays on
// the server, where it always was. This file is a list.

import type { FontCategory, FontScript } from "./types.ts";

export type { FontCategory, FontScript };

export interface CatalogEntry {
  /** The family name as Google Fonts (and the browser) knows it. */
  family: string;
  category: FontCategory;
  /** Scripts the family actually covers well — drives which slots take it. */
  scripts: FontScript[];
  /** OPTICAL SIZE COMPENSATION, in percent, applied as the `size-adjust`
   *  descriptor when this family is used as the ARABIC half of a composite
   *  (see server/fonts.ts composite()). Absent / 100 means "already matches".
   *
   *  Why it has to exist: the composite puts two faces at ONE font-size, and
   *  an Arabic naskh face carries a much smaller body ("x-height") inside the
   *  same em than a Latin text face does. Amiri's base letters stand at ~0.35
   *  em against Lora's 0.51 em x-height, so `العقل السليم` set beside Lora at
   *  the same px reads like a footnote. `size-adjust` is the only descriptor
   *  that fixes this at the FACE level, which is where it belongs: it scales
   *  the Arabic glyphs alone, so an English instance with an Arabic slot gets
   *  the compensation too — the whole-UI `--font-scale` multiplier under
   *  :root[lang="ar"] scales BOTH scripts and therefore never moves the ratio.
   *
   *  The numbers are measured, not guessed: the height of the round base
   *  letter ه (the closest analogue of a Latin x-height) at a 100px em,
   *  against Lora's x-height of 51, damped 15% toward 100% because Arabic
   *  copy carries no capitals and sits a touch above a pure x-height match.
   *  Anything within a few percent of 100 is left out entirely. */
  sizeAdjust?: number;
}

/** The "no webfont" choice, valid in every slot: the built-in system stacks. */
export const SYSTEM = "system";

/** Catalog ids are the stable wire values (settings.json, /api/settings, the
 *  cache directory name, a design's `typography.headingFont`) — slugs, never
 *  the display family. */
export const FONT_CATALOG: Record<string, CatalogEntry> = {
  // ── Latin serif (prose) ────────────────────────────────────────────────
  "lora": { family: "Lora", category: "serif", scripts: ["latin"] },
  "eb-garamond": { family: "EB Garamond", category: "serif", scripts: ["latin"] },
  "crimson-pro": { family: "Crimson Pro", category: "serif", scripts: ["latin"] },
  "literata": { family: "Literata", category: "serif", scripts: ["latin"] },
  "source-serif-4": { family: "Source Serif 4", category: "serif", scripts: ["latin"] },
  "merriweather": { family: "Merriweather", category: "serif", scripts: ["latin"] },
  // ── Latin sans (interface) ─────────────────────────────────────────────
  "inter": { family: "Inter", category: "sans", scripts: ["latin"] },
  "source-sans-3": { family: "Source Sans 3", category: "sans", scripts: ["latin"] },
  "ibm-plex-sans": { family: "IBM Plex Sans", category: "sans", scripts: ["latin"] },
  "work-sans": { family: "Work Sans", category: "sans", scripts: ["latin"] },
  // ── Mono (code, raw markdown) ──────────────────────────────────────────
  "jetbrains-mono": { family: "JetBrains Mono", category: "mono", scripts: ["latin"] },
  "ibm-plex-mono": { family: "IBM Plex Mono", category: "mono", scripts: ["latin"] },
  "fira-code": { family: "Fira Code", category: "mono", scripts: ["latin"] },
  "source-code-pro": { family: "Source Code Pro", category: "mono", scripts: ["latin"] },
  // ── Arabic ─────────────────────────────────────────────────────────────
  // Naskh and classical faces first (what a reading column wants), then the
  // modern geometric/kufi ones (what chrome wants). All of them also carry a
  // Latin subset, which buildFontCss() deliberately drops: the Arabic slot
  // answers for Arabic codepoints only, so Latin inside Arabic copy keeps the
  // product's own type.
  // `sizeAdjust` is the measured optical-size compensation (see CatalogEntry):
  // ه-height at a 100px em → 35 for Amiri against Lora's 51, and the naskh
  // faces are the ones that need it most. Faces already sitting within a few
  // percent of the Latin body (Cairo, Almarai, Reem Kufi, Noto Sans Arabic)
  // carry no value at all rather than a decorative 100.
  "amiri": { family: "Amiri", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 138 },
  "scheherazade-new": { family: "Scheherazade New", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 136 },
  "noto-naskh-arabic": { family: "Noto Naskh Arabic", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 114 },
  "markazi-text": { family: "Markazi Text", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 126 },
  "lateef": { family: "Lateef", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 150 },
  "aref-ruqaa": { family: "Aref Ruqaa", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 120 },
  "noto-kufi-arabic": { family: "Noto Kufi Arabic", category: "sans", scripts: ["arabic", "latin"], sizeAdjust: 90 },
  "noto-sans-arabic": { family: "Noto Sans Arabic", category: "sans", scripts: ["arabic", "latin"] },
  "ibm-plex-sans-arabic": { family: "IBM Plex Sans Arabic", category: "sans", scripts: ["arabic", "latin"], sizeAdjust: 120 },
  "cairo": { family: "Cairo", category: "sans", scripts: ["arabic", "latin"] },
  "tajawal": { family: "Tajawal", category: "sans", scripts: ["arabic", "latin"], sizeAdjust: 112 },
  "reem-kufi": { family: "Reem Kufi", category: "sans", scripts: ["arabic", "latin"] },
  "almarai": { family: "Almarai", category: "sans", scripts: ["arabic", "latin"] },
};

/** Catalog lookup by OWN property only. A bare `FONT_CATALOG[id]` resolves up
 *  the prototype chain, so "constructor" / "toString" would read as known ids
 *  (and reach the fetcher, and name a cache directory) — the same reason
 *  patchSettings checks own-properties on its handler table. */
export function catalogEntry(id: string): CatalogEntry | null {
  return Object.prototype.hasOwnProperty.call(FONT_CATALOG, id) ? FONT_CATALOG[id] : null;
}

/** The catalog as a list the settings panel and the designer render selects
 *  from. */
export function catalogList(): (CatalogEntry & { id: string })[] {
  return Object.entries(FONT_CATALOG).map(([id, entry]) => ({ id, ...entry }));
}

/** True when the family covers Arabic — which is what decides WHICH HALF of a
 *  composite it becomes when a design names it. See designFontFamily(). */
export function coversArabic(id: string): boolean {
  return catalogEntry(id)?.scripts.includes("arabic") ?? false;
}

// ------------------------------------------------- a design's own faces

/** The three stacks a design's typography resolves against, and therefore the
 *  three instance slots a design-named face can be paired with. They are
 *  spelled like `FontSlot` (server/fonts.ts) on purpose: a design's "serif"
 *  heading pairs with whatever the operator put in the PROSE slot. */
export type DesignFontSlot = "prose" | "ui" | "mono";

/**
 * The `@font-face` family name a design-named face is served under.
 *
 * WHY IT IS COMPUTED FROM (id, slot) AND NOTHING ELSE. `typographyVars()` runs
 * in the browser, on a visitor's page, with no knowledge of `settings.fonts` —
 * it has the design and nothing more. So the name it writes into
 * `--dsg-head-font` must be derivable from the design alone, while the SERVER,
 * which does know the instance's slots, emits a family under exactly that name.
 * The pair is the whole contract between the two halves of this feature.
 *
 * The slot is in the name because it changes what the family CONTAINS: a
 * design that names an Arabic face becomes the Arabic half of a composite whose
 * Latin half is the instance's slot for that role (prose / ui / mono), so
 * `amiri` under `prose` and `amiri` under `mono` are two different families.
 *
 * Nothing here consults the catalog: an id that is not in it simply never gets
 * a family emitted, the `var(--font-*)` fallback beside it answers instead, and
 * the page is the page it would have been. A broken face is a non-event, like a
 * broken design.
 */
export function designFontFamily(id: string, slot: DesignFontSlot): string {
  return `VellumDsg-${slot}-${id.replace(/[^A-Za-z0-9-]+/g, "-")}`;
}

/** One face a design asks for: the catalog id, the stack it stands in for, and
 *  the family name both halves of the feature agree to call it. */
export interface DesignFontRef {
  id: string;
  slot: DesignFontSlot;
  family: string;
}

export function designFontRef(id: string, slot: DesignFontSlot): DesignFontRef {
  return { id, slot, family: designFontFamily(id, slot) };
}

const DESIGN_SLOTS: DesignFontSlot[] = ["prose", "ui", "mono"];

/** De-duplicate by family — one composite per (id, slot) pair, however many
 *  roles point at it. */
export function dedupeFontRefs(refs: DesignFontRef[]): DesignFontRef[] {
  const seen = new Map<string, DesignFontRef>();
  for (const ref of refs) if (!seen.has(ref.family)) seen.set(ref.family, ref);
  return [...seen.values()];
}

/** The wire form the designer's draft-face route speaks: `prose:lora,ui:inter`.
 *  A pair per ref, because the SLOT is half of what identifies the family — and
 *  a query string is the one place the pair has to survive as text. */
export function designFontRefSpec(refs: DesignFontRef[]): string {
  return dedupeFontRefs(refs)
    .map((ref) => `${ref.slot}:${ref.id}`)
    .join(",");
}

/** …and back. Anything malformed, unknown to the catalog, or past the cap is
 *  DROPPED rather than refused: this parses a query parameter, and a preview
 *  that quietly serves the faces it recognises is better than one that 400s a
 *  panel because a stale link named a family we retired. `max` bounds what one
 *  request can make the server fetch. */
export function parseDesignFontRefs(spec: string, max = 24): DesignFontRef[] {
  const out: DesignFontRef[] = [];
  for (const token of spec.split(",")) {
    const [slot, ...rest] = token.trim().split(":");
    const id = rest.join(":");
    if (!DESIGN_SLOTS.includes(slot as DesignFontSlot)) continue;
    if (!catalogEntry(id)) continue;
    out.push(designFontRef(id, slot as DesignFontSlot));
  }
  return dedupeFontRefs(out).slice(0, max);
}
