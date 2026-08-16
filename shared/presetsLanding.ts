// LANDING — one hero, one argument, one button.
//
// THE EIGHTH SHELF, and the one the gallery shipped without. `landing` was in
// `PRESET_FAMILIES` from the first commit and had no module behind it, so the
// gallery drew a chip reading "Landing 0" that was `disabled` on every
// instance, in every language, no matter what anybody searched. A filter that
// can never be switched on is not a filter; it is a promise of a shelf, next to
// an empty one. The chips count what is here, so the fix is to put something
// here rather than to teach the chip to hide — a family in a CLOSED vocabulary
// that nothing can ever match is a vocabulary with a dead word in it.
//
// What separates this shelf from `letter`: a letter is an ARCHIVE with an
// invitation attached, and its front page is mostly a list of issues. A landing
// page is an ARGUMENT with the writing attached — the page is the pitch, and
// the posts underneath are the evidence for it. So every design here leads with
// a `hero` or a `cta` and keeps its post section SHORT: a landing page that
// opens onto twenty-four dated rows has stopped being one.
//
// The three catalog rules hold exactly as they do everywhere else, and the
// first one bites hardest here, because a landing page is the most word-shaped
// thing in the catalog. A `hero` with no heading renders the site's own name
// and tagline; a `cta` with no label renders the localized "Read more" and
// points at "/". So these ship as the SHAPE of a pitch with the owner's own
// name already in the biggest type on the page, and the panel's copy tells them
// to write the argument after they apply. A preset that typed "Get started"
// would ship an English word into an Arabic instance — and every one of these
// five would have had to.
//
// The fourth rule (a post section has no offset) is why none of these carries
// two: one short proof-grid or one short river, never both.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** The plainest statement of the family: a tall centred panel, one button under
 *  it, and six recent pieces as evidence. The one to start from when the answer
 *  to "what should the front page do" is "explain what this is, then prove
 *  it". */
const manifesto: Preset = {
  id: "manifesto",
  name: { en: "Manifesto", ar: "البيان" },
  blurb: {
    en: "A tall opening panel, one button, then six pieces as the evidence.",
    ar: "لوحة افتتاحية عالية، وزر واحد، ثم ستة أعمال كدليل.",
  },
  family: "landing",
  tags: ["hero", "cta", "centered", "pitch", "sans", "argument", "simple"],
  design: design({
    theme: "basalt",
    site: { width: 860, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.4,
        measure: 62,
        lineHeight: 1.65,
        headingWeight: 700,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.35,
      },
      header: { layout: "inline", density: "compact", sticky: "header", showTagline: false, divider: false },
      footer: { align: "center", showRss: false, showSearchHint: false },
    }),
    sections: [
      { id: "pitch", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "tall" },
      { id: "act", kind: "cta", heading: "", body: "", label: "", url: "/" },
      { id: "air-a", kind: "divider", style: "blank", space: 56 },
      { id: "proof", kind: "postGrid", heading: "", limit: 6, columns: 3, tag: "", showExcerpt: true, showBanner: false, showDate: false },
      { id: "topics", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
  }),
};

/** The pitch flushed left on a narrow measure, the way a person writes rather
 *  than the way a product page shouts: a short greeting, a paragraph of room
 *  for the argument, the button, and four pieces under it. Serif throughout. */
const overture: Preset = {
  id: "overture",
  name: { en: "Overture", ar: "الافتتاحية" },
  blurb: {
    en: "The argument flushed left on a narrow measure, with four pieces under it.",
    ar: "الحجّة إلى اليسار على قياس ضيّق، وتحتها أربعة أعمال.",
  },
  family: "landing",
  tags: ["hero", "narrow", "serif", "start", "quiet", "personal", "cta"],
  design: design({
    theme: "linen",
    site: { width: 680, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 18.5,
        scale: 1.25,
        measure: 68,
        lineHeight: 1.75,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.15,
      },
      header: { layout: "stackedStart", density: "compact", sticky: "none", divider: false },
      nav: { fallback: "none", showSearch: false, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "greeting", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short" },
      { id: "air-a", kind: "divider", style: "blank", space: 28 },
      { id: "act", kind: "cta", heading: "", body: "", label: "", url: "/" },
      { id: "rule-a", kind: "divider", style: "rule", space: 40 },
      { id: "recent", kind: "postList", heading: "", limit: 4, tag: "", showExcerpt: true, showDate: false },
    ] as Section[],
  }),
};

/** The loudest page in the catalog, and deliberately: a full-height panel in
 *  heavy uppercase over a dark ground, two picture cards as proof, and the
 *  button at the end. For a launch, a book, or one piece of work that the whole
 *  site exists to point at. */
const billboard: Preset = {
  id: "billboard",
  name: { en: "Billboard", ar: "اللوحة الإعلانية" },
  blurb: {
    en: "A full-height panel in heavy uppercase, two picture cards, then the button.",
    ar: "لوحة بكامل الارتفاع بخط ثقيل كبير، وبطاقتان مصوَّرتان، ثم الزر.",
  },
  family: "landing",
  tags: ["hero", "uppercase", "heavy", "dark", "banners", "launch", "loud"],
  design: design({
    theme: "void",
    site: { width: 1080, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.414,
        measure: 58,
        lineHeight: 1.5,
        headingWeight: 800,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.45,
      },
      header: { layout: "inline", density: "tall", sticky: "none", showTagline: false, divider: false },
      footer: { align: "center", showRss: false, showSearchHint: false },
    }),
    sections: [
      { id: "panel", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "tall" },
      { id: "air-a", kind: "divider", style: "blank", space: 64 },
      { id: "proof", kind: "postGrid", heading: "", limit: 2, columns: 2, tag: "", showExcerpt: false, showBanner: true, showDate: false },
      { id: "air-b", kind: "divider", style: "blank", space: 56 },
      { id: "act", kind: "cta", heading: "", body: "", label: "", url: "/" },
    ] as Section[],
  }),
};

/** A landing page that leads with the WORK rather than with a claim about it:
 *  three banners across the top at full width, the argument under them, and the
 *  button last. For a site whose evidence is more persuasive than its pitch. */
const shopfront: Preset = {
  id: "shopfront",
  name: { en: "Shopfront", ar: "الواجهة" },
  blurb: {
    en: "Three pictures first, the argument under them, the button last.",
    ar: "ثلاث صور أولًا، والحجّة تحتها، والزر في النهاية.",
  },
  family: "landing",
  tags: ["banners", "grid", "images", "work-first", "sans", "wide", "cta"],
  design: design({
    theme: "porphyry",
    site: { width: 1120, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.3,
        measure: 64,
        lineHeight: 1.6,
        headingWeight: 600,
        headingCase: "smallcaps",
        headingFamily: "sans",
        bodyFamily: "serif",
        rhythm: 1.2,
      },
      header: { layout: "inline", density: "regular", sticky: "nav", divider: true },
      footer: { align: "start", showRss: true, showSearchHint: false },
    }),
    sections: [
      { id: "work", kind: "postGrid", heading: "", limit: 3, columns: 3, tag: "", showExcerpt: false, showBanner: true, showDate: false },
      { id: "air-a", kind: "divider", style: "blank", space: 44 },
      { id: "pitch", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short" },
      { id: "rule-a", kind: "divider", style: "rule", space: 36 },
      { id: "act", kind: "cta", heading: "", body: "", label: "", url: "/" },
      { id: "topics", kind: "topics", heading: "", limit: 8 },
    ] as Section[],
  }),
};

/** One screen and nothing else: a short panel, the button, and a rule. No post
 *  section at all — the only design in the catalog with none, and the right
 *  answer for a site that is a card rather than a publication. The topics strip
 *  is the one door out, filled from the busiest tags. */
const calling: Preset = {
  id: "calling",
  name: { en: "Calling Card", ar: "بطاقة التعريف" },
  blurb: {
    en: "One screen: a short panel, one button, and a way through to the topics.",
    ar: "شاشة واحدة: لوحة قصيرة، وزر واحد، ومنفذ إلى المواضيع.",
  },
  family: "landing",
  tags: ["single", "card", "short", "minimal", "serif", "compact", "one-screen"],
  design: design({
    theme: "moss",
    site: { width: 620, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.2,
        measure: 66,
        lineHeight: 1.7,
        headingWeight: 500,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.1,
      },
      header: { layout: "stacked", density: "compact", sticky: "none", divider: false },
      nav: { fallback: "topics", showSearch: false, showThemeToggle: true },
      footer: { align: "center", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "card", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "short" },
      { id: "air-a", kind: "divider", style: "blank", space: 32 },
      { id: "act", kind: "cta", heading: "", body: "", label: "", url: "/" },
      { id: "dots", kind: "divider", style: "dots", space: 44 },
      { id: "topics", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
  }),
};

export const LANDING_PRESETS: readonly Preset[] = [
  manifesto,
  overture,
  billboard,
  shopfront,
  calling,
];
