// DOCUMENTATION & WIKI — the front page as a way IN, not a way through.
//
// Every design in this file answers one question the editorial families never
// ask: somebody arrived knowing what they want, so where is the index? That is
// why four of the five put the TOPIC SHELF or a naked title grid above the
// fold and none of them leads with a picture — a documentation front page that
// opens on artwork has spent the reader's first screen on decoration.
//
// The shared vocabulary of the family: sans-serif headings (a documentation
// heading is a signpost, not a voice), a long measure (76–84ch — reference
// prose is scanned in short bursts, not read in a chair), a rhythm at or under
// 1.0 so more of the index fits on a screen, and `nav.showSearch` ON in all
// five, because the honest answer to "where is the index" is often the search
// box beside it.
//
// The differences are STRUCTURAL, never a font swap: a topic shelf over a card
// index (manual), an incident river over a wall of procedures (runbook), a
// four-across encyclopaedia (compendium), a single narrow guided list
// (handbook), and a glossary that is nothing but its own tag shelf (lexicon).

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** THE PRODUCT MANUAL. Topics first — in a documented project the tags ARE the
 *  sections — then a two-across card index with opening lines and no dates
 *  (documentation is not news, and a date on a card is an invitation to
 *  distrust the older half), then the flat list of everything. Steel-blue
 *  basalt at a compact density: the most rows per screen this family draws. */
const manual: Preset = {
  id: "manual",
  name: { en: "Manual", ar: "الدليل" },
  blurb: {
    en: "For a documented project: the topic shelf first, then every page, densely.",
    ar: "لمشروع موثَّق: رفّ الموضوعات أولًا، ثم كل الصفحات بكثافة.",
  },
  family: "reference",
  tags: ["docs", "wiki", "dense", "sans", "index", "technical", "software"],
  design: design({
    theme: "basalt",
    site: { width: 1120, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16,
        scale: 1.14,
        measure: 80,
        lineHeight: 1.6,
        headingWeight: 700,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.85,
      },
      header: { layout: "inline", density: "compact", sticky: "header", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: true, showPoweredBy: true },
    }),
    sections: [
      { id: "shelf", kind: "topics", heading: "", limit: 18 },
      { id: "rule-a", kind: "divider", style: "rule", space: 20 },
      { id: "pages", kind: "postGrid", heading: "", limit: 12, columns: 2, tag: "", showExcerpt: true, showBanner: false, showDate: false },
      { id: "air-a", kind: "divider", style: "blank", space: 16 },
      { id: "all", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: false },
    ] as Section[],
    // No banner on the article page and no related rail: a reader who came for
    // one procedure is not browsing, and the page under them should end.
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: false, showBackLink: true },
  }),
};

/** THE RUNBOOK. What broke recently, with the opening line of each, over a
 *  three-across wall of procedures with no dates and no excerpts at all — the
 *  half of an operations vault you reach for at three in the morning and read
 *  by TITLE. Void, uppercase, and the theme toggle is off: this is somebody's
 *  terminal, not their reading chair. */
const runbook: Preset = {
  id: "runbook",
  name: { en: "Runbook", ar: "دفتر التشغيل" },
  blurb: {
    en: "For operations notes read under pressure: what broke, then the procedures.",
    ar: "لملاحظات التشغيل تُقرأ تحت الضغط: ما الذي تعطّل، ثم الإجراءات.",
  },
  family: "reference",
  tags: ["ops", "runbook", "uppercase", "dense", "technical", "dark", "incident"],
  design: design({
    theme: "void",
    site: { width: 980, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16,
        scale: 1.12,
        measure: 82,
        lineHeight: 1.55,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.8,
      },
      header: { layout: "inline", density: "compact", sticky: "nav", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: false },
      footer: { align: "start", showRss: false, showSearchHint: true, showPoweredBy: false },
    }),
    sections: [
      { id: "recent", kind: "postList", heading: "", limit: 6, tag: "", showExcerpt: true, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 24 },
      { id: "procedures", kind: "postGrid", heading: "", limit: 12, columns: 3, tag: "", showExcerpt: false, showBanner: false, showDate: false },
      { id: "air-a", kind: "divider", style: "blank", space: 12 },
      { id: "systems", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE ENCYCLOPAEDIA. Sixteen titles four across, then the whole tag shelf,
 *  then the annotated list — the widest column this family draws (1280) and
 *  the only one in serif small caps, because a compendium is a printed
 *  reference before it is a website. Parchment, at a regular density. */
const compendium: Preset = {
  id: "compendium",
  name: { en: "Compendium", ar: "الموسوعة" },
  blurb: {
    en: "For a large reference vault: a four-across title grid, then all of it.",
    ar: "لمكتبة مرجعية كبيرة: شبكة عناوين رباعية، ثم كل ما فيها.",
  },
  family: "reference",
  tags: ["encyclopedia", "wide", "grid", "serif", "smallcaps", "index", "archive"],
  design: design({
    theme: "parchment",
    site: { width: 1280, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.2,
        measure: 74,
        lineHeight: 1.6,
        headingWeight: 600,
        headingCase: "smallcaps",
        headingFamily: "serif",
        bodyFamily: "sans",
        rhythm: 0.95,
      },
      header: { layout: "stacked", density: "regular", sticky: "nav", divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "center", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "entries", kind: "postGrid", heading: "", limit: 16, columns: 4, tag: "", showExcerpt: false, showBanner: false, showDate: false },
      { id: "rule-a", kind: "divider", style: "rule", space: 28 },
      { id: "shelf", kind: "topics", heading: "", limit: 24 },
      { id: "air-a", kind: "divider", style: "blank", space: 20 },
      { id: "annotated", kind: "postList", heading: "", limit: 40, tag: "", showExcerpt: true, showDate: true },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE HANDBOOK. The one small design in a family of dense ones: a short
 *  opening panel that says what this project IS, one plain list of pages in
 *  the order they were written, and the topics at the foot. 760px, sans
 *  headings over a serif body, no header rule and nothing sticky — a first-run
 *  guide for a project that has fifteen pages, not five hundred. */
const handbook: Preset = {
  id: "handbook",
  name: { en: "Handbook", ar: "الكتيّب" },
  blurb: {
    en: "For a small documented project: a short opening panel and one plain list.",
    ar: "لمشروع صغير موثَّق: لوحة افتتاحية قصيرة وقائمة واحدة بلا زخرفة.",
  },
  family: "reference",
  tags: ["guide", "narrow", "list", "onboarding", "calm", "hero", "docs"],
  design: design({
    theme: "linen",
    site: { width: 760, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.18,
        measure: 68,
        lineHeight: 1.7,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "serif",
        rhythm: 1,
      },
      header: { layout: "inline", density: "compact", sticky: "none", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: true },
    }),
    sections: [
      { id: "opening", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short" },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "pages", kind: "postList", heading: "", limit: 28, tag: "", showExcerpt: false, showDate: false },
      { id: "rule-a", kind: "divider", style: "rule", space: 24 },
      { id: "topics", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
    article: { showBanner: false, showMeta: false, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE GLOSSARY. Thirty-six tags across the top and then every entry, dated,
 *  with nothing between them — a wiki of short definitions where the shelf IS
 *  the navigation and a card grid would be four words in a box. The tightest
 *  type in the product: 16.5px on an 84ch measure at rhythm 0.75. */
const lexicon: Preset = {
  id: "lexicon",
  name: { en: "Lexicon", ar: "المعجم" },
  blurb: {
    en: "For a glossary of short entries: the whole tag shelf, then every entry.",
    ar: "لمسرد من مداخل قصيرة: رفّ الوسوم كاملًا، ثم كل مدخل.",
  },
  family: "reference",
  tags: ["glossary", "wiki", "chips", "dense", "uppercase", "entries", "flat"],
  design: design({
    theme: "sandstone",
    site: { width: 1040, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.1,
        measure: 84,
        lineHeight: 1.5,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.75,
      },
      header: { layout: "stackedStart", density: "compact", sticky: "nav", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: true, showPoweredBy: false },
    }),
    sections: [
      { id: "shelf", kind: "topics", heading: "", limit: 36 },
      { id: "rule-a", kind: "divider", style: "rule", space: 16 },
      { id: "entries", kind: "postList", heading: "", limit: 60, tag: "", showExcerpt: false, showDate: true },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

export const DOCS_PRESETS: readonly Preset[] = [manual, runbook, compendium, handbook, lexicon];
