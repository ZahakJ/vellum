// DIGITAL GARDEN — the family that refuses the date.
//
// The other argument this product has with a blogging platform. A blog is a
// stack: the newest thing is the important thing, and the front page is a
// queue. A garden is a MESH — a note is worth what points at it — and the
// software underneath this one already keeps that mesh: wikilinks resolve
// between notes, `showRelated` puts every note that shares a tag at the foot
// of the one you are reading, and the tag shelf is a real index of the whole
// vault rather than a widget somebody installed.
//
// So every design in this file makes the same three commitments, and they are
// commitments a chronological platform cannot make without a plugin:
//
//   1. `showDate: false` ON EVERY SECTION. Not a preference — the structural
//      claim of the family. A garden that prints dates is a blog apologising.
//   2. THE TAG SHELF IS A FIRST-CLASS BLOCK, never a footer ornament: 16 to 40
//      chips, above the fold in three of the five.
//   3. `article.showRelated: true` EVERYWHERE, and `showMeta: false` in four —
//      the foot of a note is where the mesh is visible, and a timestamp there
//      is the one fact about a growing note that is always wrong.
//
// The five shapes: a three-across mesh under the shelf (rhizome), a labelled
// specimen sheet (herbarium), a warm single column of things in progress
// (trellis), one flat overgrown page (thicket), and a picture field you wander
// (constellation).

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** THE MESH. Twenty-eight tags first, then notes three across with their
 *  opening lines, a dotted rule, and the rest as titles. Nothing is dated,
 *  nothing is ranked, and the widest thing on the page is the shelf you
 *  navigate by. Moss, roomy, with a sticky whole header — in a garden the
 *  search box has to stay in reach while you scroll a mesh. */
const rhizome: Preset = {
  id: "rhizome",
  name: { en: "Rhizome", ar: "الجذمور" },
  blurb: {
    en: "For a linked garden, not a blog: tags first, notes as a mesh, no dates.",
    ar: "لحديقة مترابطة لا مدوّنة: الوسوم أولًا، والملاحظات شبكة، بلا تواريخ.",
  },
  family: "reference",
  tags: ["garden", "wikilinks", "undated", "network", "chips", "notes", "organic"],
  design: design({
    theme: "moss",
    site: { width: 1000, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.22,
        measure: 72,
        lineHeight: 1.7,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "serif",
        rhythm: 1.2,
      },
      header: { layout: "inline", density: "regular", sticky: "header", showTagline: false, divider: false },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "center", showRss: false, showSearchHint: true },
    }),
    sections: [
      { id: "shelf", kind: "topics", heading: "", limit: 28 },
      { id: "mesh", kind: "postGrid", heading: "", limit: 12, columns: 3, tag: "", showExcerpt: true, showBanner: false, showDate: false },
      { id: "dots-a", kind: "divider", style: "dots", space: 36 },
      { id: "rest", kind: "postList", heading: "", limit: 30, tag: "", showExcerpt: false, showDate: false },
    ] as Section[],
    article: { showBanner: false, showMeta: false, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE SPECIMEN SHEET. Nine notes pressed under glass — three across, each
 *  with its plate and its name and nothing else — then the shelf, then the
 *  LABELS: thirty names in a column, titles only. Verdigris, small caps, and
 *  the only garden design that leads with artwork.
 *
 *  The labels used to be a second GRID of eight, which is the arrangement the
 *  catalog's own rule calls a bug and a real vault proved instantly: a post
 *  section has no offset, so eight of the nine plates above were simply printed
 *  again, four across, with their pictures off. A herbarium's labels are NAMES,
 *  so the fix was also the truer metaphor — a long list under the plates rather
 *  than the plates a second time. */
const herbarium: Preset = {
  id: "herbarium",
  name: { en: "Herbarium", ar: "المعشبة" },
  blurb: {
    en: "For notes pressed and labelled: a specimen sheet of plates, then the shelf.",
    ar: "لملاحظات مضغوطة ومعنونة: ورقة عيّنات مصوّرة، ثم رفّ الوسوم.",
  },
  family: "reference",
  tags: ["garden", "specimens", "grid", "banners", "undated", "labels", "collection"],
  design: design({
    theme: "verdigris",
    site: { width: 1140, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.2,
        measure: 70,
        lineHeight: 1.65,
        headingWeight: 600,
        headingCase: "smallcaps",
        headingFamily: "serif",
        bodyFamily: "sans",
        rhythm: 1.05,
      },
      header: { layout: "stacked", density: "regular", sticky: "nav", divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "center", showRss: false, showSearchHint: true },
    }),
    sections: [
      { id: "plates", kind: "postGrid", heading: "", limit: 9, columns: 3, tag: "", showExcerpt: false, showBanner: true, showDate: false },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "shelf", kind: "topics", heading: "", limit: 20 },
      { id: "rule-a", kind: "divider", style: "rule", space: 20 },
      { id: "labels", kind: "postList", heading: "", limit: 30, tag: "", showExcerpt: false, showDate: false },
    ] as Section[],
    article: { showBanner: true, showMeta: false, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** WORK IN PUBLIC. A short panel that says what this garden is FOR, a dotted
 *  rule, eighteen notes with their opening lines and no dates, and the shelf at
 *  the end. Sandstone, serif throughout, weight 500 and the slowest rhythm in
 *  the family (1.3) — the design for somebody publishing things they have not
 *  finished, which is what the family is actually about. */
const trellis: Preset = {
  id: "trellis",
  name: { en: "Trellis", ar: "التعريشة" },
  blurb: {
    en: "For working in public: an opening panel, then everything you are growing.",
    ar: "للعمل على المكشوف: لوحة افتتاحية، ثم كل ما تنمّيه.",
  },
  family: "reference",
  tags: ["garden", "hero", "undated", "growing", "serif", "roomy", "drafts"],
  design: design({
    theme: "sandstone",
    site: { width: 880, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        scale: 1.24,
        measure: 68,
        lineHeight: 1.75,
        headingWeight: 500,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.3,
      },
      header: { layout: "inline", density: "compact", sticky: "none", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: true, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "opening", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short" },
      { id: "dots-a", kind: "divider", style: "dots", space: 32 },
      { id: "growing", kind: "postList", heading: "", limit: 18, tag: "", showExcerpt: true, showDate: false },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "shelf", kind: "topics", heading: "", limit: 16 },
    ] as Section[],
    article: { showBanner: false, showMeta: false, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE OVERGROWN VAULT. Everything on one page and no hierarchy anywhere:
 *  sixteen notes four across with their opening lines, forty tags, then forty
 *  titles — the design for a vault that got big without getting organised, and
 *  the honest answer to "I have nine hundred notes and none of them are posts".
 *  Porphyry, compact, dotted rules doing all the separating. */
const thicket: Preset = {
  id: "thicket",
  name: { en: "Thicket", ar: "الأيكة" },
  blurb: {
    en: "For a big tangled vault: everything on one flat page, undated, unranked.",
    ar: "لمكتبة كبيرة متشابكة: كل شيء في صفحة واحدة، بلا تواريخ ولا تراتب.",
  },
  family: "reference",
  tags: ["garden", "dense", "flat", "undated", "chips", "overgrown", "wide"],
  design: design({
    theme: "porphyry",
    site: { width: 1240, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16,
        scale: 1.12,
        measure: 82,
        lineHeight: 1.55,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.85,
      },
      header: { layout: "inline", density: "compact", sticky: "nav", showTagline: false, divider: false },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: true, showPoweredBy: false },
    }),
    sections: [
      { id: "growth", kind: "postGrid", heading: "", limit: 16, columns: 4, tag: "", showExcerpt: true, showBanner: false, showDate: false },
      { id: "dots-a", kind: "divider", style: "dots", space: 20 },
      { id: "shelf", kind: "topics", heading: "", limit: 40 },
      { id: "dots-b", kind: "divider", style: "dots", space: 20 },
      { id: "undergrowth", kind: "postList", heading: "", limit: 40, tag: "", showExcerpt: false, showDate: false },
    ] as Section[],
    article: { showBanner: false, showMeta: false, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE FIELD. Two plates the width of half the page, a sky of thirty tags, and
 *  nine more plates three across — a garden read by wandering rather than by
 *  scrolling to the bottom. Nocturne, roomy, the largest scale in the family
 *  (1.28) at weight 500: big quiet titles under pictures, and no date to tell
 *  you which one you were supposed to read first. */
const constellation: Preset = {
  id: "constellation",
  name: { en: "Constellation", ar: "الكوكبة" },
  blurb: {
    en: "For a garden read by wandering: a field of plates and a sky of tags.",
    ar: "لحديقة تُقرأ بالتجوال: حقل من الصور وسماء من الوسوم.",
  },
  family: "reference",
  tags: ["garden", "banners", "undated", "wander", "grid", "night", "visual"],
  design: design({
    theme: "nocturne",
    site: { width: 1180, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.28,
        measure: 66,
        lineHeight: 1.7,
        headingWeight: 500,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.35,
      },
      header: { layout: "stacked", density: "regular", sticky: "header", showTagline: false, divider: false },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "center", showRss: false, showSearchHint: true },
    }),
    sections: [
      { id: "near", kind: "postGrid", heading: "", limit: 2, columns: 2, tag: "", showExcerpt: false, showBanner: true, showDate: false },
      { id: "air-a", kind: "divider", style: "blank", space: 12 },
      { id: "sky", kind: "topics", heading: "", limit: 30 },
      { id: "air-b", kind: "divider", style: "blank", space: 12 },
      { id: "far", kind: "postGrid", heading: "", limit: 8, columns: 4, tag: "", showExcerpt: false, showBanner: true, showDate: false },
    ] as Section[],
    article: { showBanner: true, showMeta: false, showTags: true, showRelated: true, showBackLink: true },
  }),
};

export const GARDEN_PRESETS: readonly Preset[] = [
  rhizome,
  herbarium,
  trellis,
  thicket,
  constellation,
];
