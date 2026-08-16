// PORTFOLIO — the work, and what you have to say about it.
//
// The line between this family and `gallery` is the one that decides every
// choice in this file. A GALLERY hangs pictures: captions come second, and the
// ideal page has no prose on it at all. A PORTFOLIO is somebody's case for
// being hired, and a case is made in sentences — so every image grid here
// carries `showExcerpt: true`, four of the five put a second, TEXT block under
// the pictures (an annotated river, a dated archive, an enquiry button), and
// all five wear a STRONG header: tall or sticky, ruled, and never the bare
// inline line a gallery gets away with.
//
// The five differ in how much of the page one project is allowed to take, and
// each carries one structure nothing else in the catalog has:
//
//   casebook     two lead cases, then everything annotated in a river
//   commissions  nine projects three across, then the dated archive
//   practice     the services shelf FIRST, then plates, then one button
//   lookbook     pairs of plates at the largest scale here, and a button
//   showreel     one lead frame, then a four-across strip of everything
//
// A vault with no banners is not a failure case: the product paints one from
// the title, deterministically, out of the running theme's tokens.
//
// TWO OF THESE PRINTED THEMSELVES TWICE, and both were fixed against a real
// vault rather than on paper. A post section has NO OFFSET — `pick()` is
// `slice(0, limit)` from the top of the same feed — so `commissions` showed
// nine projects and then an "archive" of ten, which is the same nine with one
// row on the end, and `showreel` carried a lead frame, a strip AND an index, so
// the newest post appeared three times on one page. The rule that survives is
// the one `check-presets.mjs` now enforces: at most two post sections, and the
// index at least twice the feature, so the overlap reads as an archive that
// begins with the piece above it rather than as a stutter.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** THE CASEBOOK. Two lead cases side by side — plate, title, date, and no
 *  prose — over an ANNOTATED river of everything, opening lines and all. The
 *  leads carry no excerpt on purpose: a section cannot skip what the section
 *  above it already showed, so the two posts appear twice on this page, and one
 *  line echoing under a picture reads as a lead story while one paragraph
 *  echoing under another reads as a bug. Cinnabar under a tall ruled masthead:
 *  the strongest header in the family, because this is a personal practice and
 *  the name at the top is half the pitch. */
const casebook: Preset = {
  id: "casebook",
  name: { en: "Casebook", ar: "كرّاسة الأعمال" },
  blurb: {
    en: "For work you write about: two lead cases, then everything with its story.",
    ar: "لعملٍ تكتب عنه: حالتان رئيسيتان، ثم كل شيء مع حكايته.",
  },
  family: "portfolio",
  tags: ["case-study", "cases", "banners", "annotated", "writing", "practice", "uppercase"],
  design: design({
    theme: "cinnabar",
    site: { width: 1160, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.28,
        measure: 68,
        lineHeight: 1.6,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.15,
      },
      header: { layout: "stacked", density: "tall", sticky: "nav", divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: true },
    }),
    sections: [
      { id: "leads", kind: "postGrid", heading: "", limit: 2, columns: 2, tag: "", showExcerpt: false, showBanner: true, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 28 },
      { id: "river", kind: "postList", heading: "", limit: 12, tag: "", showExcerpt: true, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 16 },
      { id: "topics", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
    article: { showBanner: true, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE WORKING PRACTICE. Nine projects three across — plate, title, date, one
 *  line — over the dated archive of everything older, and the client sectors as
 *  chips. Basalt at a compact density with a sticky one-line header: the design
 *  for a portfolio that is updated monthly rather than curated yearly. */
const commissions: Preset = {
  id: "commissions",
  name: { en: "Commissions", ar: "التكليفات" },
  blurb: {
    en: "For a busy practice: nine projects with a line each, then the archive.",
    ar: "لممارسة نشطة: تسعة مشاريع لكلٍّ سطر، ثم الأرشيف.",
  },
  family: "portfolio",
  tags: ["projects", "grid", "banners", "archive", "dense", "studio", "dated"],
  design: design({
    theme: "basalt",
    site: { width: 1200, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.2,
        measure: 66,
        lineHeight: 1.55,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.95,
      },
      header: { layout: "inline", density: "compact", sticky: "header", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: true, showSearchHint: true, showPoweredBy: false },
    }),
    sections: [
      { id: "projects", kind: "postGrid", heading: "", limit: 9, columns: 3, tag: "", showExcerpt: true, showBanner: true, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 24 },
      { id: "archive", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 12 },
      { id: "sectors", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
    article: { showBanner: true, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE PRACTICE. The only design in the catalog that opens on the TAG SHELF as
 *  a statement of what you do — the chips are the services — then six plates in
 *  pairs with a line each, then one button. Porphyry, roomy, serif headings at
 *  weight 500 over a sans body: an enquiry page that happens to have a
 *  portfolio in it. The CTA is the one section here that wants words, and the
 *  panel says so the moment it is applied. */
const practice: Preset = {
  id: "practice",
  name: { en: "Practice", ar: "الممارسة" },
  blurb: {
    en: "For a practice that takes enquiries: what you do, the work, one button.",
    ar: "لممارسة تستقبل الطلبات: ما تفعله، ثم الأعمال، ثم زرّ واحد.",
  },
  family: "portfolio",
  tags: ["services", "chips", "banners", "cta", "enquiry", "roomy", "freelance"],
  design: design({
    theme: "porphyry",
    site: { width: 1040, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        scale: 1.24,
        measure: 66,
        lineHeight: 1.7,
        headingWeight: 500,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "sans",
        rhythm: 1.35,
      },
      header: { layout: "stackedStart", density: "tall", sticky: "none", divider: false },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "services", kind: "topics", heading: "", limit: 10 },
      { id: "air-a", kind: "divider", style: "blank", space: 8 },
      { id: "work", kind: "postGrid", heading: "", limit: 6, columns: 2, tag: "", showExcerpt: true, showBanner: true, showDate: false },
      { id: "air-b", kind: "divider", style: "blank", space: 32 },
      { id: "enquire", kind: "cta", heading: "", body: "", label: "", url: "/" },
    ] as Section[],
    article: { showBanner: true, showMeta: false, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE LOOKBOOK. Eight plates in pairs with a caption line each, then the
 *  button — a season's work, published the way a season is published. Solar,
 *  and the most extreme type in the family: uppercase SERIF at weight 400 on
 *  the largest scale here (1.34), which reads as a caption rather than as a
 *  headline. The search box is off; nobody searches a lookbook. */
const lookbook: Preset = {
  id: "lookbook",
  name: { en: "Lookbook", ar: "كتيّب المعروضات" },
  blurb: {
    en: "For a season's work in pairs: two plates a row and one button at the end.",
    ar: "لأعمال موسم مثنى مثنى: صورتان في الصف، وزرّ واحد في النهاية.",
  },
  family: "portfolio",
  tags: ["pairs", "banners", "captions", "light", "seasonal", "serif", "cta"],
  design: design({
    theme: "solar",
    site: { width: 1240, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.34,
        measure: 64,
        lineHeight: 1.6,
        headingWeight: 400,
        headingCase: "uppercase",
        headingFamily: "serif",
        bodyFamily: "sans",
        rhythm: 1.2,
      },
      header: { layout: "stacked", density: "regular", sticky: "none", showTagline: false, divider: false },
      nav: { fallback: "topics", showSearch: false, showThemeToggle: true },
      footer: { align: "center", showRss: false, showSearchHint: false, showPoweredBy: true },
    }),
    sections: [
      { id: "looks", kind: "postGrid", heading: "", limit: 8, columns: 2, tag: "", showExcerpt: true, showBanner: true, showDate: false },
      { id: "air-a", kind: "divider", style: "blank", space: 40 },
      { id: "enquire", kind: "cta", heading: "", body: "", label: "", url: "/" },
    ] as Section[],
    article: { showBanner: true, showMeta: false, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/** THE REEL. One lead frame the full width of the column — plate, date, opening
 *  line — then twelve more four across as a strip, then the dated index. The
 *  design for work that arrives in cuts: the piece, and the run of pieces
 *  around it. Basalt is taken by `commissions`, so this one is sumi: a neutral
 *  dark room at 1280px, compact, uppercase at weight 700. */
const showreel: Preset = {
  id: "showreel",
  name: { en: "Showreel", ar: "الشريط" },
  blurb: {
    en: "For work that arrives in cuts: one lead frame, then a strip of the rest.",
    ar: "لعملٍ يأتي لقطاتٍ: لقطة رئيسية واحدة، ثم شريط ببقيّتها.",
  },
  family: "portfolio",
  tags: ["reel", "strip", "banners", "motion", "wide", "index", "dark"],
  design: design({
    theme: "sumi",
    site: { width: 1280, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.22,
        measure: 66,
        lineHeight: 1.55,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 0.9,
      },
      header: { layout: "inline", density: "regular", sticky: "header", showTagline: false, divider: true },
      nav: { fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: true, showSearchHint: true, showPoweredBy: false },
    }),
    sections: [
      { id: "lead", kind: "postGrid", heading: "", limit: 1, columns: 1, tag: "", showExcerpt: true, showBanner: true, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "strip", kind: "postGrid", heading: "", limit: 20, columns: 4, tag: "", showExcerpt: false, showBanner: true, showDate: false },
      { id: "rule-a", kind: "divider", style: "rule", space: 24 },
      { id: "sectors", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
    article: { showBanner: true, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

export const PORTFOLIO_PRESETS: readonly Preset[] = [
  casebook,
  commissions,
  practice,
  lookbook,
  showreel,
];
