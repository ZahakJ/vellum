// ACADEMIC & RESEARCH — designs drawn around a page that carries MATHEMATICS.
//
// This is one of the two families that exist to show what a note-hooked
// publisher can do that a plugin economy does badly. A Vellum note is rendered
// by ONE renderer, and that renderer already sets `$$…$$` with KaTeX, resolves
// `[[wikilinks]]` between papers, and lays a right-to-left abstract out with
// logical properties. So the design's whole job here is to get out of the way
// of a display equation, and every choice below is that job:
//
//   · SERIF BODY in four of the five. A display equation is set in a serif
//     math face; a sans body around it is two typefaces arguing.
//   · A LONG LINE HEIGHT (1.6–1.8). An inline $\tfrac{1}{2}$ is taller than
//     the line it sits in, and a tight leading makes every paragraph
//     containing one lurch.
//   · NO BANNER ON THE ARTICLE PAGE in four of the five, and no artwork above
//     the fold in three: a paper opens on its title and its abstract.
//   · `showTags` and `showRelated` ON almost everywhere — the tag archive is
//     the subject index a preprint server charges for.
//
// Five shapes, not one shape in five palettes: a bare dated list (preprint), a
// seminar with the next three talks (colloquium), a title page over its own
// contents (thesis), a two-column volume of abstracts (proceedings), and a
// syllabus that is a picture wall (lyceum).

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** THE PREPRINT SERVER. A dated list of papers with their abstracts, a rule,
 *  the subject shelf, and nothing else on the page — the design to pick when
 *  the front page's only job is "what is new, and what is it about". Solar (the
 *  brightest ground this product has, and the closest to paper) at 820px with
 *  an 18px serif on a 1.75 leading, which is the most equation-tolerant body
 *  setting in the catalog. */
const preprint: Preset = {
  id: "preprint",
  name: { en: "Preprint", ar: "المسوّدة البحثية" },
  blurb: {
    en: "For papers and long proofs: abstracts, dates, a subject shelf, no artwork.",
    ar: "للأوراق والبراهين الطويلة: مستخلصات وتواريخ ورفّ موضوعات، بلا صور.",
  },
  family: "reference",
  tags: ["academic", "paper", "serif", "math", "latex", "abstracts", "sober"],
  design: design({
    theme: "solar",
    site: { width: 820, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.16,
        measure: 76,
        lineHeight: 1.75,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.15,
      },
      header: { layout: "stacked", density: "tall", sticky: "none", divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "center", showRss: true, showSearchHint: false, showPoweredBy: true },
    }),
    sections: [
      { id: "papers", kind: "postList", heading: "", limit: 20, tag: "", showExcerpt: true, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 32 },
      { id: "subjects", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
    // The banner comes off and the meta stays: a paper's date and reading time
    // are part of its identity, and a decorative image above the abstract is
    // not.
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE SEMINAR. An invitation panel, then the next three talks side by side
 *  with their opening lines, then the archive of everything already given.
 *  Lapis and small caps — the register of a departmental notice board that
 *  somebody has taken care of. The only academic design with a three-across
 *  grid, because three is how many sessions anybody plans ahead. */
const colloquium: Preset = {
  id: "colloquium",
  name: { en: "Colloquium", ar: "الندوة" },
  blurb: {
    en: "For a seminar or reading group: the next sessions first, the archive under.",
    ar: "لحلقة بحث أو مجموعة قراءة: الجلسات القادمة أولًا، ثم الأرشيف.",
  },
  family: "reference",
  tags: ["seminar", "series", "talks", "academic", "hero", "schedule", "smallcaps"],
  design: design({
    theme: "lapis",
    site: { width: 900, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.26,
        measure: 72,
        lineHeight: 1.65,
        headingWeight: 600,
        headingCase: "smallcaps",
        headingFamily: "sans",
        bodyFamily: "serif",
        rhythm: 1.1,
      },
      header: { layout: "stackedStart", density: "compact", sticky: "nav", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "invite", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short" },
      { id: "rule-a", kind: "divider", style: "rule", space: 28 },
      { id: "sessions", kind: "postGrid", heading: "", limit: 3, columns: 3, tag: "", showExcerpt: true, showBanner: false, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "archive", kind: "postList", heading: "", limit: 16, tag: "", showExcerpt: false, showDate: true },
      { id: "fields", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE TITLE PAGE. One tall centred panel carrying the site's name the way a
 *  thesis carries its own, a full rule under it, and then the contents:
 *  undated titles in the order they were written. No menu at all
 *  (`fallback: "none"`), no topics, no excerpts. Iron gall at 680px — the
 *  narrowest measure in the family, for a document meant to be read from the
 *  beginning. */
const thesis: Preset = {
  id: "thesis",
  name: { en: "Thesis", ar: "الأطروحة" },
  blurb: {
    en: "For one long argument in parts: a title page, then its contents in order.",
    ar: "لحجّة واحدة طويلة على أجزاء: صفحة عنوان، ثم فهرس أجزائها بالترتيب.",
  },
  family: "reference",
  tags: ["longform", "chapters", "narrow", "serif", "title-page", "ink", "sober"],
  design: design({
    theme: "iron-gall",
    site: { width: 680, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.14,
        measure: 66,
        lineHeight: 1.8,
        headingWeight: 500,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.2,
      },
      header: { layout: "inline", density: "compact", sticky: "none", showTagline: false, divider: true },
      nav: { fallback: "none", showSearch: true, showThemeToggle: true },
      footer: { align: "center", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "title", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "tall" },
      { id: "rule-a", kind: "divider", style: "rule", space: 40 },
      { id: "contents", kind: "postList", heading: "", limit: 40, tag: "", showExcerpt: false, showDate: false },
    ] as Section[],
    // A chapter has no related rail and no tag chips: it has a next chapter.
    article: { showBanner: false, showMeta: true, showTags: false, showRelated: false, showBackLink: true },
  }),
};

/** THE VOLUME. Twelve abstracts two across with their dates, the subject index
 *  under a rule, then the full table of contents — the shape of a conference
 *  proceedings, at the density of one. Sumi, an inline header that gets out of
 *  the way in one line, and serif headings over a sans body: the abstract is
 *  metadata, the paper is prose. */
const proceedings: Preset = {
  id: "proceedings",
  name: { en: "Proceedings", ar: "الوقائع" },
  blurb: {
    en: "For a volume of papers: abstracts two across, a subject index, contents.",
    ar: "لمجلّد من الأبحاث: مستخلصات في عمودين، وفهرس موضوعات، ثم المحتويات.",
  },
  family: "reference",
  tags: ["volume", "abstracts", "conference", "academic", "index", "dense", "two-up"],
  design: design({
    theme: "sumi",
    site: { width: 1080, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.18,
        measure: 70,
        lineHeight: 1.6,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "sans",
        rhythm: 0.9,
      },
      header: { layout: "inline", density: "regular", sticky: "nav", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "abstracts", kind: "postGrid", heading: "", limit: 12, columns: 2, tag: "", showExcerpt: true, showBanner: false, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 24 },
      { id: "subjects", kind: "topics", heading: "", limit: 20 },
      { id: "air-a", kind: "divider", style: "blank", space: 16 },
      { id: "contents", kind: "postList", heading: "", limit: 30, tag: "", showExcerpt: false, showDate: true },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE TEACHING SITE. The only academic design that leads with pictures, and
 *  it earns them: a course is a sequence somebody has to be able to SEE, so
 *  six units run three across as plates, the reading list follows with its
 *  opening lines, and the topics close it. Tallow — warm, dark, lamp-lit — at
 *  a roomy density with tall uppercase serif headings. */
const lyceum: Preset = {
  id: "lyceum",
  name: { en: "Lyceum", ar: "دار الحكمة" },
  blurb: {
    en: "For a course or a teaching site: the units as plates, the reading list under.",
    ar: "لمساق أو موقع تدريسي: الوحدات لوحاتٍ، وقائمة القراءة تحتها.",
  },
  family: "reference",
  tags: ["teaching", "course", "syllabus", "banners", "grid", "academic", "warm"],
  design: design({
    theme: "tallow",
    site: { width: 1160, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        scale: 1.3,
        measure: 68,
        lineHeight: 1.7,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "serif",
        bodyFamily: "sans",
        rhythm: 1.25,
      },
      header: { layout: "stacked", density: "tall", sticky: "nav", divider: false },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "center", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "units", kind: "postGrid", heading: "", limit: 6, columns: 3, tag: "", showExcerpt: false, showBanner: true, showDate: false },
      { id: "air-a", kind: "divider", style: "blank", space: 32 },
      { id: "reading", kind: "postList", heading: "", limit: 12, tag: "", showExcerpt: true, showDate: false },
      { id: "rule-a", kind: "divider", style: "rule", space: 24 },
      { id: "topics", kind: "topics", heading: "", limit: 14 },
    ] as Section[],
    article: { showBanner: true, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

export const ACADEMIC_PRESETS: readonly Preset[] = [
  preprint,
  colloquium,
  thesis,
  proceedings,
  lyceum,
];
