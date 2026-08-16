// BRUTALIST — the WIDE half of `minimal`, and the loud one.
//
// The minimal family in presetsMinimal.ts is restraint by SUBTRACTION: a
// narrow column (560–780px), quiet weights, and less and less on the page. The
// five here are restraint of a different kind and they sit at the opposite end
// of the same dial — 1040 to 1400 pixels wide, weight 700–800, uppercase in
// four of five, hard rules with zero space around them, and no artwork
// anywhere. Nothing is soft and nothing is decorative; what is left is the
// grid, the rule and the word.
//
// That width is deliberate and it is what keeps the two halves of `minimal`
// apart at thumbnail size: a preset here fills its canvas edge to edge, and one
// from presetsMinimal.ts is a ribbon down the middle. The reader choosing
// between them is choosing between two arguments about restraint — subtract
// until only the essay is left, or refuse to charm and leave the structure
// exposed — and both are minimal, which is why they share a family and not a
// file.
//
// The house rules of this file: `showBanner: false` in every section (a
// generated gradient is decoration and this family does not decorate),
// `divider.space: 0` wherever a rule appears (a hairline that is not touching
// what it separates is a garnish), and a footer stripped to its copyright.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** THE WALL. Twelve titles three across with their dates, a rule with no air
 *  around it, then twenty-four more as a bare index — at 1400px, the widest
 *  page this product will lay out, in the heaviest weight it offers (800) on
 *  the largest scale it offers (1.414). Cinnabar. No search box, no theme
 *  toggle: the reader is not being catered to. */
const concrete: Preset = {
  id: "concrete",
  name: { en: "Concrete", ar: "الخرسانة" },
  blurb: {
    en: "For a site that refuses to charm: full width, heavy, and nothing to look at.",
    ar: "لموقع يرفض التودّد: بعرض الشاشة، ثقيل، ولا شيء للتفرّج عليه.",
  },
  family: "minimal",
  tags: ["brutalist", "wide", "uppercase", "heavy", "rules", "stark", "grid"],
  design: design({
    theme: "cinnabar",
    site: { width: 1400, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.414,
        measure: 86,
        lineHeight: 1.4,
        headingWeight: 800,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.75,
      },
      header: { layout: "stackedStart", density: "compact", sticky: "none", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: false, showThemeToggle: false },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "wall", kind: "postGrid", heading: "", limit: 12, columns: 3, tag: "", showExcerpt: false, showBanner: false, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 0 },
      { id: "index", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: false },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: false, showBackLink: true },
  }),
};

/** THE PLACARD. A tall panel carrying the site's name at the top of the screen
 *  and, under one rule, twenty entries with their opening lines — no menu
 *  (`fallback: "none"`), no search, no chips, no second block. Iron gall,
 *  uppercase at weight 800: a page that announces rather than invites. */
const marquee: Preset = {
  id: "marquee",
  name: { en: "Marquee", ar: "اللافتة" },
  blurb: {
    en: "For announcing rather than inviting: a name the size of the screen, then text.",
    ar: "للإعلان لا للدعوة: اسمٌ بحجم الشاشة، ثم نصّ.",
  },
  family: "minimal",
  tags: ["brutalist", "hero", "uppercase", "no-nav", "loud", "wide", "statement"],
  design: design({
    theme: "iron-gall",
    site: { width: 1120, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.36,
        measure: 78,
        lineHeight: 1.45,
        headingWeight: 800,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.8,
      },
      header: { layout: "inline", density: "compact", sticky: "none", showTagline: false, divider: true },
      nav: { fallback: "none", showSearch: false, showThemeToggle: false, showLangSwitch: true },
      footer: { align: "center", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "placard", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "tall" },
      { id: "rule-a", kind: "divider", style: "rule", space: 0 },
      { id: "entries", kind: "postList", heading: "", limit: 20, tag: "", showExcerpt: true, showDate: true },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: false, showRelated: false, showBackLink: true },
  }),
};

/** THE SLAB. One block and one rule: sixteen titles four across with their
 *  dates, and then the page stops. No hero, no excerpts, no chips, no list
 *  under it — the whole design is a table of what exists. Linen (a cool light
 *  grey, the Swiss end of this family) at 1320px, uppercase, weight 800. */
const slab: Preset = {
  id: "slab",
  name: { en: "Slab", ar: "اللوح" },
  blurb: {
    en: "For a site that is a table of contents: sixteen titles, four across, done.",
    ar: "لموقعٍ هو فهرسٌ لا غير: ستة عشر عنوانًا في أربعة أعمدة، وانتهى.",
  },
  family: "minimal",
  tags: ["brutalist", "grid", "four-column", "titles", "swiss", "flat", "table"],
  design: design({
    theme: "linen",
    site: { width: 1320, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16,
        scale: 1.24,
        measure: 80,
        lineHeight: 1.45,
        headingWeight: 800,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.75,
      },
      header: { layout: "inline", density: "compact", sticky: "nav", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: false },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "table", kind: "postGrid", heading: "", limit: 16, columns: 4, tag: "", showExcerpt: false, showBanner: false, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 0 },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: false, showBackLink: true },
  }),
};

/** HAIRLINE. The quiet one, and the only design in the catalog where a rule
 *  separates EVERY block from the next: six entries two across, rule, the tag
 *  shelf, rule, twenty titles, rule. Weight 400 and no uppercase anywhere —
 *  this is brutalism as structure rather than as volume, which is why it is
 *  drawn on parchment and not on black. */
const hairline: Preset = {
  id: "hairline",
  name: { en: "Hairline", ar: "الشعرة" },
  blurb: {
    en: "For structure without volume: every block separated by one rule, nothing else.",
    ar: "لبنيةٍ بلا صخب: كل كتلة يفصلها خطٌّ واحد، ولا شيء سواه.",
  },
  family: "minimal",
  tags: ["brutalist", "rules", "structure", "light", "quiet", "grid", "paper"],
  design: design({
    theme: "parchment",
    site: { width: 1040, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.15,
        measure: 74,
        lineHeight: 1.6,
        headingWeight: 400,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1,
      },
      header: { layout: "stackedStart", density: "regular", sticky: "nav", divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: true, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "recent", kind: "postGrid", heading: "", limit: 6, columns: 2, tag: "", showExcerpt: true, showBanner: false, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 0 },
      { id: "shelf", kind: "topics", heading: "", limit: 14 },
      { id: "rule-b", kind: "divider", style: "rule", space: 0 },
      { id: "index", kind: "postList", heading: "", limit: 20, tag: "", showExcerpt: false, showDate: false },
      { id: "rule-c", kind: "divider", style: "rule", space: 0 },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE MANIFESTO. One block, sixteen entries, each a full-width uppercase line
 *  with its date and its opening sentence — no grid, no rules, no shelf, no
 *  second thought. Void, weight 800, leading at the floor (1.4) and rhythm at
 *  the floor (0.75): the loudest page in the catalog, and the shortest file. */
const manifest: Preset = {
  id: "manifest",
  name: { en: "Manifest", ar: "البيان" },
  blurb: {
    en: "For one uninterrupted run of writing: full-width lines, loud, and nothing else.",
    ar: "لدفقٍ واحد متّصل من الكتابة: أسطر بعرض الصفحة، صاخبة، ولا شيء غيرها.",
  },
  family: "minimal",
  tags: ["brutalist", "river", "uppercase", "heavy", "single", "dark", "loud"],
  design: design({
    theme: "void",
    site: { width: 1240, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.32,
        measure: 84,
        lineHeight: 1.4,
        headingWeight: 800,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.75,
      },
      header: { layout: "stackedStart", density: "compact", sticky: "header", showTagline: false, divider: false },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: false },
      footer: { align: "start", showRss: true, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "run", kind: "postList", heading: "", limit: 16, tag: "", showExcerpt: true, showDate: true },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: false, showBackLink: true },
  }),
};

export const BRUTALIST_PRESETS: readonly Preset[] = [
  concrete,
  marquee,
  slab,
  hairline,
  manifest,
];
