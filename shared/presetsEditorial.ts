// EDITORIAL — the magazine shelf: a masthead, columns, and a front page that
// RANKS things.
//
// The family exists because a front page is an argument about importance. Every
// design here answers the same question — "what is the biggest thing on this
// page, and what does the reader see second?" — and they answer it five
// different ways: a wall of headlines, a rack of covers, a hero over a river,
// a wire of text columns, and a weekend feature with air around it.
//
// The three catalog rules (shared/presetCatalog.ts) hold in every one: no copy,
// nothing named from the vault, and a theme the layout was drawn against. So
// does the fourth, practical one — a post section reads the newest posts and
// there is no offset, so no design here stacks two of them unless the first is
// a FEATURE (one or two posts) and the second is a long INDEX, where an
// archive that begins with the piece above it is what a reader expects.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** A wall of headlines: sixteen titles and dates, four across, with nothing
 *  competing — no pictures, no summaries, no lead story. The front page for an
 *  archive deep enough that BREADTH is the argument. Uppercase serif on a cool
 *  white ground, the modern paper rather than the cream one. */
const frontPage: Preset = {
  id: "front-page",
  name: { en: "Front Page", ar: "الصفحة الأولى" },
  blurb: {
    en: "A wall of sixteen headlines, four across, and nothing competing.",
    ar: "جدار من ستة عشر عنوانًا، أربعة في الصف، بلا مزاحم.",
  },
  family: "editorial",
  tags: ["wide", "grid", "uppercase", "masthead", "news", "dense", "headlines", "titles"],
  design: design({
    theme: "linen",
    site: { width: 1200, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.29,
        measure: 64,
        lineHeight: 1.55,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "serif",
        bodyFamily: "sans",
        rhythm: 0.9,
      },
      header: { layout: "stacked", density: "tall", sticky: "nav", divider: true },
      footer: { align: "center", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "wall", kind: "postGrid", heading: "", limit: 16, columns: 4, tag: "", showExcerpt: false, showBanner: false, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 28 },
      { id: "topics", kind: "topics", heading: "", limit: 16 },
    ] as Section[],
  }),
};

/** A rack of covers. Topics run across the top like the labels on a newsstand
 *  shelf, and everything under them is a picture with a title on it — twelve
 *  tiles, three across, no excerpts competing for the eye. */
const kiosk: Preset = {
  id: "kiosk",
  name: { en: "Kiosk", ar: "الكشك" },
  blurb: {
    en: "Topics across the top, then twelve covers three abreast.",
    ar: "الموضوعات في الأعلى، ثم اثنا عشر غلافًا ثلاثة في كل صف.",
  },
  family: "editorial",
  tags: ["covers", "grid", "banners", "topics", "sans", "wide", "smallcaps", "browse"],
  design: design({
    theme: "cinnabar",
    site: { width: 1320, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.2,
        measure: 62,
        lineHeight: 1.6,
        headingWeight: 600,
        headingCase: "smallcaps",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.15,
      },
      header: { layout: "inline", density: "regular", sticky: "header", showTagline: false, divider: false },
      footer: { align: "start", showSearchHint: false, showPoweredBy: true },
    }),
    sections: [
      { id: "shelf", kind: "topics", heading: "", limit: 18 },
      { id: "air-a", kind: "divider", style: "blank", space: 16 },
      { id: "covers", kind: "postGrid", heading: "", limit: 12, columns: 3, tag: "", showExcerpt: false, showBanner: true, showDate: true },
    ] as Section[],
  }),
};

/** The dramatic one: a tall opening panel, a pair of features under it, and a
 *  river beneath a dotted rule. The heading scale is at the top of its range,
 *  so an h1 on this page is four steps above the prose and reads across a
 *  room. */
const gazette: Preset = {
  id: "gazette",
  name: { en: "Gazette", ar: "الجريدة" },
  blurb: {
    en: "A tall opening panel, two features, and a river under a dotted rule.",
    ar: "لوحة افتتاحية عالية، ومقالان بارزان، ونهر تحت خط منقّط.",
  },
  family: "editorial",
  tags: ["hero", "serif", "grid", "river", "dramatic", "large", "feature"],
  design: design({
    theme: "iron-gall",
    site: { width: 1000, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.414,
        measure: 70,
        lineHeight: 1.6,
        headingWeight: 700,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1,
      },
      header: { layout: "stackedStart", density: "regular", sticky: "nav", showTagline: false, divider: true },
      footer: { align: "start", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "opening", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "tall" },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "features", kind: "postGrid", heading: "", limit: 2, columns: 2, tag: "", showExcerpt: true, showBanner: true, showDate: true },
      { id: "dots", kind: "divider", style: "dots", space: 40 },
      { id: "river", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: true, showDate: true },
      { id: "air-b", kind: "divider", style: "blank", space: 8 },
      { id: "topics", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
  }),
};

/** No pictures anywhere, on purpose: twenty-four headline-and-summary cards in
 *  three columns, then the subjects. The densest front page this vocabulary can
 *  build, for an archive where the writing is the news and a banner is a
 *  distraction. */
const wire: Preset = {
  id: "wire",
  name: { en: "Wire", ar: "البرقية" },
  blurb: {
    en: "No pictures at all: twenty-four headlines and summaries in three columns.",
    ar: "بلا صور إطلاقًا: أربعة وعشرون عنوانًا وملخّصًا في ثلاثة أعمدة.",
  },
  family: "editorial",
  tags: ["dense", "text", "sans", "uppercase", "compact", "index", "news", "nopictures"],
  design: design({
    theme: "basalt",
    site: { width: 1140, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 15.5,
        scale: 1.15,
        measure: 60,
        lineHeight: 1.45,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.8,
      },
      header: { layout: "inline", density: "compact", sticky: "nav", showTagline: false, divider: true },
      footer: { align: "start", showRss: true, showSearchHint: true, showPoweredBy: false },
    }),
    sections: [
      { id: "columns", kind: "postGrid", heading: "", limit: 24, columns: 3, tag: "", showExcerpt: true, showBanner: false, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 24 },
      { id: "topics", kind: "topics", heading: "", limit: 24 },
    ] as Section[],
  }),
};

/** The unhurried magazine: a centred masthead, a short opening panel, and six
 *  pieces three across with their pictures and their opening lines. Light
 *  headings at a large size with a lot of air — the Saturday paper rather than
 *  the Monday one. */
const weekend: Preset = {
  id: "weekend",
  name: { en: "Weekend Edition", ar: "عدد نهاية الأسبوع" },
  blurb: {
    en: "An opening panel, six pieces three across, and a lot of air.",
    ar: "لوحة افتتاحية، وستّ مقالات ثلاث في الصف، ومساحة واسعة.",
  },
  family: "editorial",
  tags: ["airy", "feature", "serif", "light", "roomy", "weekend", "leisure"],
  design: design({
    theme: "solar",
    site: { width: 1080, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 19,
        scale: 1.33,
        measure: 68,
        lineHeight: 1.7,
        headingWeight: 400,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.4,
      },
      header: { layout: "stacked", density: "compact", sticky: "none", showTagline: false, divider: false },
      footer: { align: "center", showRss: true, showSearchHint: false },
    }),
    sections: [
      { id: "opening", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "short" },
      { id: "air-a", kind: "divider", style: "blank", space: 40 },
      { id: "pieces", kind: "postGrid", heading: "", limit: 6, columns: 3, tag: "", showExcerpt: true, showBanner: true, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 48 },
      { id: "topics", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
  }),
};

export const EDITORIAL_PRESETS: readonly Preset[] = [frontPage, kiosk, gazette, wire, weekend];
