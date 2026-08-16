// MINIMAL — the essay shelf: measure first, chrome last.
//
// These are the designs for a site whose front page is an act of restraint.
// The variable they trade in is the COLUMN: how wide the reader's line is, how
// much space is above and below it, and how little else is allowed on screen
// while they decide what to read. Five settings of one dial would be five
// versions of the same preset, so each of these also makes a different
// structural choice — a bare index, a book page, a card index, a hero over
// eight essays, a sans column under a bar — and the type is drawn to match
// rather than to differ.
//
// Where a design is narrower than the header's own 1100px row, its identity is
// CENTRED (`stacked`): a flush-left wordmark over a 560px column leaves the
// name hanging in space beside the text it belongs to. The wide designs in the
// other families can afford `inline` and `stackedStart`, and use them.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** The narrowest thing this product will draw: a 560px column, titles and
 *  dates, under a wordmark small enough to be a caption. No search, no topics,
 *  no excerpts — the reader either recognises the title or they do not. */
const measure: Preset = {
  id: "measure",
  name: { en: "Measure", ar: "المقاس" },
  blurb: {
    en: "A single narrow column of titles and dates, and nothing else at all.",
    ar: "عمود ضيّق واحد من العناوين والتواريخ، ولا شيء غير ذلك.",
  },
  family: "minimal",
  tags: ["narrow", "index", "bare", "serif", "quiet", "titles", "spare"],
  design: design({
    theme: "void",
    site: { width: 560, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 19,
        scale: 1.1,
        measure: 60,
        lineHeight: 1.85,
        headingWeight: 500,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.25,
      },
      header: { layout: "stacked", density: "compact", sticky: "none", showTagline: false, divider: false },
      nav: { fallback: "none", showSearch: false, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "index", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: true },
    ] as Section[],
  }),
};

/** A book page. A tall centred masthead over a hairline, ten essays with their
 *  opening lines, and the topics at the foot where a colophon would be. Small
 *  caps and a slow rhythm — the most generous spacing in the family. */
const folio: Preset = {
  id: "folio",
  name: { en: "Folio", ar: "الملزمة" },
  blurb: {
    en: "A book page: a tall masthead, ten essays with their opening lines.",
    ar: "صفحة كتاب: ترويسة عالية، وعشر مقالات مع سطورها الأولى.",
  },
  family: "minimal",
  tags: ["book", "serif", "smallcaps", "roomy", "essays", "classical", "print"],
  design: design({
    theme: "parchment",
    site: { width: 700, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 18.5,
        scale: 1.2,
        measure: 72,
        lineHeight: 1.75,
        headingWeight: 600,
        headingCase: "smallcaps",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.45,
      },
      header: { layout: "stacked", density: "tall", sticky: "none", divider: true },
      footer: { align: "center", showRss: true, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "rule-a", kind: "divider", style: "rule", space: 8 },
      { id: "essays", kind: "postList", heading: "", limit: 10, tag: "", showExcerpt: true, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 40 },
      { id: "topics", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
  }),
};

/** The same restraint in a modern voice: a bar across the top instead of a
 *  masthead, one sans-serif column under it, twelve pieces with their openings
 *  and no dates, and a rail of topics at the foot. For a site whose writing is
 *  not filed by when it was written. */
const grotesk: Preset = {
  id: "grotesk",
  name: { en: "Grotesk", ar: "القلم الحديث" },
  blurb: {
    en: "A bar, one sans-serif column, undated, and a rail of topics at the foot.",
    ar: "شريط علوي، وعمود واحد بخط حديث بلا تواريخ، وشريط موضوعات في الأسفل.",
  },
  family: "minimal",
  tags: ["sans", "modern", "undated", "column", "topics", "clean"],
  design: design({
    theme: "sumi",
    site: { width: 660, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.25,
        measure: 66,
        lineHeight: 1.7,
        headingWeight: 500,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.05,
      },
      header: { layout: "inline", density: "compact", sticky: "nav", showTagline: false, divider: true },
      footer: { align: "start", showRss: true, showSearchHint: true, showPoweredBy: false },
    }),
    sections: [
      { id: "writing", kind: "postList", heading: "", limit: 12, tag: "", showExcerpt: true, showDate: false },
      { id: "air-a", kind: "divider", style: "blank", space: 32 },
      { id: "topics", kind: "topics", heading: "", limit: 24 },
    ] as Section[],
  }),
};

/** A card index. Twelve titles in two bordered columns with their dates and
 *  nothing else, under a tiny uppercase header — minimal without being a
 *  list, and the one design here that fills its width. */
const footnote: Preset = {
  id: "footnote",
  name: { en: "Footnote", ar: "الحاشية" },
  blurb: {
    en: "A card index: two columns of titles and dates, nothing more.",
    ar: "فهرس بطاقات: عمودان من العناوين والتواريخ، لا أكثر.",
  },
  family: "minimal",
  tags: ["cards", "index", "compact", "titles", "two-column", "archive"],
  design: design({
    theme: "tallow",
    site: { width: 740, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.1,
        measure: 74,
        lineHeight: 1.8,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "serif",
        rhythm: 0.85,
      },
      header: { layout: "stacked", density: "compact", sticky: "nav", showTagline: false, divider: true },
      footer: { align: "center", showRss: false, showSearchHint: true, showPoweredBy: false },
    }),
    sections: [
      { id: "cards", kind: "postGrid", heading: "", limit: 12, columns: 2, tag: "", showExcerpt: false, showBanner: false, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 16 },
      { id: "topics", kind: "topics", heading: "", limit: 30 },
    ] as Section[],
  }),
};

/** A reading room. The only minimal design with a panel at the top: the site's
 *  own name at display size over eight recent essays with their openings, on
 *  the widest measure the family allows. */
const verso: Preset = {
  id: "verso",
  name: { en: "Verso", ar: "الصفحة اليسرى" },
  blurb: {
    en: "A name at display size over eight recent essays on a wide measure.",
    ar: "اسم بحجم كبير فوق ثماني مقالات حديثة بمقاس عريض.",
  },
  family: "minimal",
  tags: ["hero", "wide", "serif", "reading", "essays", "display"],
  design: design({
    theme: "lapis",
    site: { width: 780, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        scale: 1.35,
        measure: 78,
        lineHeight: 1.65,
        headingWeight: 400,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.1,
      },
      header: { layout: "stackedStart", density: "compact", sticky: "header", showTagline: false, divider: true },
      footer: { align: "start", showRss: true, showSearchHint: false },
    }),
    sections: [
      { id: "panel", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short" },
      { id: "air-a", kind: "divider", style: "blank", space: 28 },
      { id: "essays", kind: "postList", heading: "", limit: 8, tag: "", showExcerpt: true, showDate: true },
    ] as Section[],
  }),
};

export const MINIMAL_PRESETS: readonly Preset[] = [measure, folio, grotesk, footnote, verso];
