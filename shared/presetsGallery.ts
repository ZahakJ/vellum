// GALLERY — the picture shelf: banners at full width, captions second.
//
// These are the designs where the artwork is the content. They are worth
// shipping to a vault with NO images at all, because a post without a banner
// gets `generatedBannerCss()` — deterministic per title, painted out of the
// theme's own tokens — so a contact sheet of a text-only vault is still a
// contact sheet, in the site's own colours, and it fills in with real
// photographs one post at a time.
//
// The variable across the five is the SIZE OF ONE PICTURE: four across, one
// across, a poster over an index wall, two prints on a white wall, and a shop
// window over a printed catalogue.
//
// None of them stacks two picture grids. A post section has no offset, so a
// small grid over a larger one prints the same photographs twice at two sizes —
// which looks like a bug rather than a decision. Where a second post section
// earns its place it is a LIST: a catalogue under the window, not a second wall.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** A contact sheet, edge to edge: twelve pictures four across on the widest
 *  page this product will draw, with a one-line header and no dates. The
 *  design that says "look first". */
const lightbox: Preset = {
  id: "lightbox",
  name: { en: "Lightbox", ar: "صندوق الضوء" },
  blurb: {
    en: "A contact sheet edge to edge: twelve pictures, four across, no dates.",
    ar: "ورقة تجارب بعرض الشاشة: اثنتا عشرة صورة، أربع في الصف، بلا تواريخ.",
  },
  family: "gallery",
  tags: ["contactsheet", "grid", "wide", "banners", "uppercase", "sans", "photos", "dense"],
  design: design({
    theme: "void",
    site: { width: 1400, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16,
        scale: 1.15,
        measure: 60,
        lineHeight: 1.5,
        headingWeight: 500,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.8,
      },
      header: { layout: "inline", density: "compact", sticky: "header", showTagline: false, divider: false },
      nav: { fallback: "none", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "sheet", kind: "postGrid", heading: "", limit: 12, columns: 4, tag: "", showExcerpt: false, showBanner: true, showDate: false },
    ] as Section[],
  }),
};

/** One picture at a time, full width, six of them down the page under a tall
 *  centred masthead. The slowest gallery here: light serif headings, the
 *  roomiest rhythm, and a date under each plate. */
const plate: Preset = {
  id: "plate",
  name: { en: "Plate", ar: "اللوحة" },
  blurb: {
    en: "One picture at a time, full width, six down the page.",
    ar: "صورة واحدة في كل مرة، بعرض الصفحة، ستّ على امتداد الصفحة.",
  },
  family: "gallery",
  tags: ["single", "fullwidth", "serif", "roomy", "slow", "plates", "photos"],
  design: design({
    theme: "iron-gall",
    site: { width: 900, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        scale: 1.2,
        measure: 62,
        lineHeight: 1.65,
        headingWeight: 400,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.45,
      },
      header: { layout: "stacked", density: "tall", sticky: "none", divider: true },
      footer: { align: "center", showRss: true, showSearchHint: false },
    }),
    sections: [
      { id: "plates", kind: "postGrid", heading: "", limit: 6, columns: 1, tag: "", showExcerpt: false, showBanner: true, showDate: true },
    ] as Section[],
  }),
};

/** A show: a tall centred panel for the poster, and an index wall of twelve
 *  small pictures under it, four across. */
const exhibition: Preset = {
  id: "exhibition",
  name: { en: "Exhibition", ar: "المعرض" },
  blurb: {
    en: "A poster panel, then an index wall of twelve pictures four across.",
    ar: "لوحة إعلان، ثم جدار فهرس من اثنتي عشرة صورة أربع في الصف.",
  },
  family: "gallery",
  tags: ["hero", "poster", "wall", "grid", "smallcaps", "wide", "show", "curated"],
  design: design({
    theme: "porphyry",
    site: { width: 1240, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.3,
        measure: 62,
        lineHeight: 1.6,
        headingWeight: 600,
        headingCase: "smallcaps",
        headingFamily: "serif",
        bodyFamily: "sans",
        rhythm: 1.15,
      },
      header: { layout: "stackedStart", density: "regular", sticky: "nav", showTagline: false, divider: true },
      footer: { align: "start", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "poster", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "tall" },
      { id: "air-a", kind: "divider", style: "blank", space: 56 },
      { id: "wall", kind: "postGrid", heading: "", limit: 12, columns: 4, tag: "", showExcerpt: false, showBanner: true, showDate: false },
      { id: "rule-a", kind: "divider", style: "rule", space: 40 },
      { id: "subjects", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
  }),
};

/** Two prints to a wall, with a wide white mount around them: a light theme,
 *  the slowest rhythm in the catalog, dates under the titles and the subjects
 *  at the foot. The gallery for a room with windows. */
const passepartout: Preset = {
  id: "passepartout",
  name: { en: "Passepartout", ar: "البرواز" },
  blurb: {
    en: "Two prints to a wall, with a wide mount of white space around them.",
    ar: "صورتان في كل صف، مع هامش أبيض واسع حولهما.",
  },
  family: "gallery",
  tags: ["light", "airy", "two-up", "prints", "sans", "roomy", "white"],
  design: design({
    theme: "linen",
    site: { width: 980, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.2,
        measure: 66,
        lineHeight: 1.7,
        headingWeight: 500,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.5,
      },
      header: { layout: "stacked", density: "regular", sticky: "none", divider: false },
      footer: { align: "center", showRss: true, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "air-a", kind: "divider", style: "blank", space: 8 },
      { id: "prints", kind: "postGrid", heading: "", limit: 8, columns: 2, tag: "", showExcerpt: false, showBanner: true, showDate: true },
      { id: "air-b", kind: "divider", style: "blank", space: 40 },
      { id: "subjects", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
  }),
};

/** A shop window: two pieces given the front, then the whole catalogue under
 *  them as dated titles. The tightest type here — heavy uppercase at the top of
 *  the scale, so a two-word title reads as a sign — and the only gallery in the
 *  family that ends in words. */
const vitrine: Preset = {
  id: "vitrine",
  name: { en: "Vitrine", ar: "الفاترينة" },
  blurb: {
    en: "Two pieces given the window, then the whole catalogue as dated titles.",
    ar: "قطعتان في الواجهة، ثم الفهرس كاملًا عناوين مؤرَّخة.",
  },
  family: "gallery",
  tags: ["window", "grid", "uppercase", "display", "banners", "shop", "bold"],
  design: design({
    theme: "basalt",
    site: { width: 1120, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.414,
        measure: 60,
        lineHeight: 1.55,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "serif",
        rhythm: 0.95,
      },
      header: { layout: "inline", density: "tall", sticky: "nav", divider: true },
      footer: { align: "center", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "window", kind: "postGrid", heading: "", limit: 2, columns: 2, tag: "", showExcerpt: true, showBanner: true, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 28 },
      { id: "catalogue", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "subjects", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
  }),
};

export const GALLERY_PRESETS: readonly Preset[] = [
  lightbox,
  plate,
  exhibition,
  passepartout,
  vitrine,
];
