// JOURNAL — the personal shelf: dated, quiet, a river of entries.
//
// What separates this family from `minimal` is the DATE. A journal front page
// is a chronology and says so: entries are stamped, and the design decides how
// much of each one the reader meets before the next date. What separates the
// five from each other is that decision — a full river, a tight index, cards
// over an index, pictures over notes, one entry given the day — and how much of
// the vault's own furniture (topics, banners, a masthead) is allowed around it.
//
// A post section has no offset, so a FEATURE (one to four entries) may sit over
// a long INDEX and nothing else stacks: two lists of "recent" and "older" would
// print the same twelve entries twice.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** One long river of dated entries with their opening lines, a dotted fold, and
 *  the subjects. The classic weblog shape at a generous rhythm, with the chrome
 *  turned almost all the way down — no masthead, no menu, no divider. */
const daybook: Preset = {
  id: "daybook",
  name: { en: "Daybook", ar: "دفتر اليوم" },
  blurb: {
    en: "One long river of dated entries, each with its opening lines.",
    ar: "نهر طويل من المدوّنات المؤرَّخة، لكلٍّ منها سطورها الأولى.",
  },
  family: "journal",
  tags: ["weblog", "dated", "river", "serif", "roomy", "archive", "diary"],
  design: design({
    theme: "moss",
    site: { width: 840, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.15,
        measure: 68,
        lineHeight: 1.75,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.4,
      },
      header: { layout: "stacked", density: "tall", sticky: "none", divider: true },
      nav: { fallback: "none", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: true, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "river", kind: "postList", heading: "", limit: 20, tag: "", showExcerpt: true, showDate: true },
      { id: "dots", kind: "divider", style: "dots", space: 44 },
      { id: "subjects", kind: "topics", heading: "", limit: 24 },
    ] as Section[],
  }),
};

/** Topics first, then twenty dated titles. A narrow centred masthead, small
 *  caps, and a compact index — the notebook whose owner navigates by subject
 *  and remembers the rest. */
const marginalia: Preset = {
  id: "marginalia",
  name: { en: "Marginalia", ar: "الهوامش" },
  blurb: {
    en: "Subjects across the top, then twenty dated titles in a tight index.",
    ar: "الموضوعات في الأعلى، ثم عشرون عنوانًا مؤرَّخًا في فهرس مضغوط.",
  },
  family: "journal",
  tags: ["topics", "index", "compact", "smallcaps", "narrow", "notebook"],
  design: design({
    theme: "porphyry",
    site: { width: 640, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.2,
        measure: 66,
        lineHeight: 1.7,
        headingWeight: 500,
        headingCase: "smallcaps",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 0.9,
      },
      header: { layout: "stacked", density: "compact", sticky: "nav", divider: true },
      footer: { align: "center", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "subjects", kind: "topics", heading: "", limit: 12 },
      { id: "rule-a", kind: "divider", style: "rule", space: 20 },
      { id: "entries", kind: "postList", heading: "", limit: 20, tag: "", showExcerpt: false, showDate: true },
    ] as Section[],
  }),
};

/** Four recent entries as bordered cards, the whole index under them, and the
 *  subjects at the foot. A commonplace book: things kept, arranged so the
 *  keeping is visible. */
const commonplace: Preset = {
  id: "commonplace",
  name: { en: "Commonplace", ar: "الكشكول" },
  blurb: {
    en: "Four entries as cards, a long index beneath, subjects at the foot.",
    ar: "أربع مدوّنات كبطاقات، وفهرس طويل تحتها، والموضوعات في الأسفل.",
  },
  family: "journal",
  tags: ["cards", "index", "mixed", "sans", "keeping", "scrapbook"],
  design: design({
    theme: "linen",
    site: { width: 860, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.22,
        measure: 70,
        lineHeight: 1.65,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "serif",
        rhythm: 1.1,
      },
      header: { layout: "stacked", density: "regular", sticky: "nav", divider: true },
      footer: { align: "center", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "kept", kind: "postGrid", heading: "", limit: 4, columns: 2, tag: "", showExcerpt: true, showBanner: false, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 32 },
      { id: "index", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: true },
      { id: "air-b", kind: "divider", style: "blank", space: 16 },
      { id: "subjects", kind: "topics", heading: "", limit: 14 },
    ] as Section[],
  }),
};

/** A journal that carries pictures: an opening panel, the three newest entries
 *  as banner tiles, and the river under a rule. For a vault where the entries
 *  were written somewhere other than the desk. */
const fieldNotes: Preset = {
  id: "field-notes",
  name: { en: "Field Notes", ar: "مفكرة ميدانية" },
  blurb: {
    en: "An opening panel, three picture tiles, then the entries with their openings.",
    ar: "لوحة افتتاحية، وثلاث بلاطات مصوَّرة، ثم المدوّنات مع مطالعها.",
  },
  family: "journal",
  tags: ["photos", "travel", "banners", "grid", "sans", "uppercase", "outdoors"],
  design: design({
    theme: "verdigris",
    site: { width: 820, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        scale: 1.25,
        measure: 64,
        lineHeight: 1.7,
        headingWeight: 600,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.2,
      },
      header: { layout: "inline", density: "regular", sticky: "header", showTagline: false, divider: true },
      footer: { align: "start", showRss: true, showSearchHint: false },
    }),
    sections: [
      { id: "panel", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short" },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "tiles", kind: "postGrid", heading: "", limit: 3, columns: 3, tag: "", showExcerpt: false, showBanner: true, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 36 },
      { id: "entries", kind: "postList", heading: "", limit: 20, tag: "", showExcerpt: true, showDate: true },
    ] as Section[],
  }),
};

/** One entry at full width with its picture and its opening, then the ledger:
 *  twenty-four dated titles and the subjects that run through them. The
 *  journal that treats the newest thing as the day's page. */
const almanac: Preset = {
  id: "almanac",
  name: { en: "Almanac", ar: "التقويم" },
  blurb: {
    en: "The newest entry at full width, then a ledger of twenty-four dated titles.",
    ar: "أحدث مدوّنة بعرض الصفحة، ثم سجلّ من أربعة وعشرين عنوانًا مؤرَّخًا.",
  },
  family: "journal",
  tags: ["ledger", "feature", "dated", "serif", "smallcaps", "archive", "today"],
  design: design({
    theme: "tallow",
    site: { width: 760, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.15,
        measure: 72,
        lineHeight: 1.7,
        headingWeight: 700,
        headingCase: "smallcaps",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1,
      },
      header: { layout: "stacked", density: "tall", sticky: "nav", divider: true },
      footer: { align: "center", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "today", kind: "postGrid", heading: "", limit: 1, columns: 1, tag: "", showExcerpt: true, showBanner: true, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 32 },
      { id: "ledger", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "subjects", kind: "topics", heading: "", limit: 18 },
    ] as Section[],
  }),
};

export const JOURNAL_PRESETS: readonly Preset[] = [
  daybook,
  marginalia,
  commonplace,
  fieldNotes,
  almanac,
];
