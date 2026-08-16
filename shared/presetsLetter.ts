// LETTER — the newsletter shelf: an invitation, an archive, one button.
//
// Every design here carries a `cta` section, and that section is the ONE place
// in this whole catalog that wants words the preset cannot supply: a button
// with no label renders the localized "Read more" and points at "/". That is
// deliberate — a preset that typed "Subscribe" would ship an English word into
// an Arabic instance — and the panel's own copy tells the owner to write the
// invitation after they apply.
//
// The five differ by WHERE the invitation sits, which is the only real
// decision a newsletter front page makes: above everything, at the end, in the
// middle of the archive, or as the second thing a reader meets after the
// greeting.
//
// Where a design carries both current issues and back issues, the first is a
// FEATURE of three or fewer and the second is a long index — a post section has
// no offset, so any other pairing prints the same issue twice.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/** The invitation is the first thing on the page, above even the newest
 *  letter. Twelve letters with their openings under it, subjects at the foot —
 *  for a list whose sign-up rate matters more than its archive. */
const postmark: Preset = {
  id: "postmark",
  name: { en: "Postmark", ar: "ختم البريد" },
  blurb: {
    en: "The invitation first, above everything, then twelve recent letters.",
    ar: "الدعوة أولًا فوق كل شيء، ثم اثنتا عشرة رسالة حديثة.",
  },
  family: "letter",
  tags: ["cta", "subscribe", "sans", "archive", "invitation", "email", "top"],
  design: design({
    theme: "cinnabar",
    site: { width: 700, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        scale: 1.2,
        measure: 70,
        lineHeight: 1.7,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.1,
      },
      header: { layout: "stacked", density: "compact", sticky: "nav", divider: true },
      footer: { align: "center", showRss: true, showSearchHint: false },
    }),
    sections: [
      { id: "invite", kind: "cta", heading: "", body: "", label: "", url: "/" },
      { id: "rule-a", kind: "divider", style: "rule", space: 32 },
      { id: "letters", kind: "postList", heading: "", limit: 12, tag: "", showExcerpt: true, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "subjects", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
  }),
};

/** A poster for a letter: a tall centred panel carrying the site's own name,
 *  four issues as picture cards, and the invitation at the end. Light headings
 *  at a large size on a bright ground. */
const broadside: Preset = {
  id: "broadside",
  name: { en: "Broadside", ar: "المنشور" },
  blurb: {
    en: "A tall panel, four issues as picture cards, and the invitation at the end.",
    ar: "لوحة عالية، وأربعة أعداد كبطاقات مصوَّرة، والدعوة في النهاية.",
  },
  family: "letter",
  tags: ["hero", "poster", "banners", "serif", "light", "roomy", "issues"],
  design: design({
    theme: "solar",
    site: { width: 900, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 19,
        scale: 1.33,
        measure: 66,
        lineHeight: 1.7,
        headingWeight: 400,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.35,
      },
      header: { layout: "stacked", density: "compact", sticky: "none", showTagline: false, divider: false },
      footer: { align: "center", showRss: true, showSearchHint: false, showPoweredBy: true },
    }),
    sections: [
      { id: "panel", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "tall" },
      { id: "air-a", kind: "divider", style: "blank", space: 48 },
      { id: "issues", kind: "postGrid", heading: "", limit: 4, columns: 2, tag: "", showExcerpt: true, showBanner: true, showDate: true },
      { id: "air-b", kind: "divider", style: "blank", space: 40 },
      { id: "invite", kind: "cta", heading: "", body: "", label: "", url: "/" },
    ] as Section[],
  }),
};

/** The archive AS the front page: subjects, then thirty-six back issues as
 *  dated titles, then the invitation. Compact and uppercase — a run of letters
 *  long enough that finding one matters more than reading the newest. */
const digest: Preset = {
  id: "digest",
  name: { en: "Digest", ar: "الخلاصة" },
  blurb: {
    en: "The back-issue archive as the front page, with the invitation at the foot.",
    ar: "أرشيف الأعداد السابقة كصفحة رئيسية، والدعوة في الأسفل.",
  },
  family: "letter",
  tags: ["archive", "compact", "uppercase", "index", "backissues", "dense"],
  design: design({
    theme: "sandstone",
    site: { width: 660, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16.5,
        scale: 1.15,
        measure: 68,
        lineHeight: 1.6,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "serif",
        rhythm: 0.85,
      },
      header: { layout: "inline", density: "compact", sticky: "nav", showTagline: false, divider: true },
      footer: { align: "start", showRss: true, showSearchHint: true, showPoweredBy: false },
    }),
    sections: [
      { id: "subjects", kind: "topics", heading: "", limit: 20 },
      { id: "rule-a", kind: "divider", style: "rule", space: 20 },
      { id: "issues", kind: "postList", heading: "", limit: 36, tag: "", showExcerpt: false, showDate: true },
      { id: "rule-b", kind: "divider", style: "rule", space: 28 },
      { id: "invite", kind: "cta", heading: "", body: "", label: "", url: "/" },
    ] as Section[],
  }),
};

/** Three current issues across the top, the invitation as a band through the
 *  middle of the page, and the back issues under it. The widest letter here —
 *  a publication rather than a correspondence. */
const bulletin: Preset = {
  id: "bulletin",
  name: { en: "Bulletin", ar: "النشرة" },
  blurb: {
    en: "Three current issues, the invitation as a band, back issues below.",
    ar: "ثلاثة أعداد حالية، والدعوة كشريط في الوسط، والأعداد السابقة تحتها.",
  },
  family: "letter",
  tags: ["wide", "grid", "banners", "middle", "sans", "smallcaps", "publication"],
  design: design({
    theme: "verdigris",
    site: { width: 1040, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.25,
        measure: 64,
        lineHeight: 1.65,
        headingWeight: 600,
        headingCase: "smallcaps",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.2,
      },
      header: { layout: "inline", density: "regular", sticky: "header", divider: true },
      footer: { align: "start", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "current", kind: "postGrid", heading: "", limit: 3, columns: 3, tag: "", showExcerpt: true, showBanner: true, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 36 },
      { id: "invite", kind: "cta", heading: "", body: "", label: "", url: "/" },
      { id: "air-b", kind: "divider", style: "blank", space: 36 },
      { id: "back", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: true },
      { id: "subjects", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
  }),
};

/** A letter that reads like one: a short greeting panel flushed left, the
 *  invitation immediately under it, and then ten undated letters on a wide,
 *  slow measure. No search, no topics, no dates — nothing that turns a
 *  correspondence back into a website. */
const envelope: Preset = {
  id: "envelope",
  name: { en: "Envelope", ar: "الظرف" },
  blurb: {
    en: "A greeting, the invitation under it, then ten undated letters.",
    ar: "تحيّة، والدعوة تحتها، ثم عشر رسائل بلا تواريخ.",
  },
  family: "letter",
  tags: ["personal", "serif", "narrow", "undated", "quiet", "correspondence", "paper"],
  design: design({
    theme: "parchment",
    site: { width: 620, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.1,
        measure: 74,
        lineHeight: 1.8,
        headingWeight: 500,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.3,
      },
      header: { layout: "stacked", density: "compact", sticky: "none", showTagline: false, divider: false },
      nav: { fallback: "none", showSearch: false, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "greeting", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short" },
      { id: "air-a", kind: "divider", style: "blank", space: 20 },
      { id: "invite", kind: "cta", heading: "", body: "", label: "", url: "/" },
      { id: "dots", kind: "divider", style: "dots", space: 40 },
      { id: "letters", kind: "postList", heading: "", limit: 10, tag: "", showExcerpt: true, showDate: false },
    ] as Section[],
  }),
};

export const LETTER_PRESETS: readonly Preset[] = [postmark, broadside, digest, bulletin, envelope];
