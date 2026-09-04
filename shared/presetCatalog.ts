// THE SHIPPED CATALOG. Eighty finished designs, as data.
//
// FOUR ARE HERE. The rest are written against the same three rules,
// and the rules are the whole contract for adding one:
//
//  1. A PRESET IS PURE FORM. Every text field it could set — a section
//     heading, a hero's own heading and sub, a CTA's words, a footer
//     copyright, a nav label, a rich-text body — is LEFT EMPTY, and the
//     renderers already know what empty means: a hero with no heading is the
//     site's name and tagline, an empty section heading renders no heading at
//     all, an empty copyright falls back to the instance's own footer line, an
//     empty CTA label is the localized "Read more". A preset that typed
//     "Latest writing" into a heading would ship an English word into an
//     Arabic instance and a stranger's voice into everybody's — and it would
//     have to, because `Section.heading` is a plain string with nowhere to put
//     a second language. So the shape is ours and every word on the page is
//     the owner's. That is also why fifty of these are cheap to write and
//     impossible to mistranslate.
//  2. A PRESET NAMES NOTHING IN THE VAULT. No `note` section, no `note`/`page`
//     nav item, no tag filter, no image path. A shipped design cannot know
//     what is in somebody else's vault, and a preset that guessed would render
//     as the owner's very first error card. What it CAN lean on is the
//     fallback that already exists: `nav.fallback: "topics"` fills the menu
//     from the busiest published tags, and the list and grid sections read
//     every published post. A fresh install gets a furnished site.
//  3. A PRESET IS A LOOK, SO IT NAMES A THEME. One of the built-ins, chosen
//     because the layout was drawn against it — a broadsheet is a broadsheet
//     on parchment. It applies on FORK, and only to readers who have not
//     chosen a theme of their own (`DesignedSite`'s rule, and the right one).
//
// A FOURTH RULE, practical rather than architectural, and every family module
// restates it because it is the one that bites while composing: A POST SECTION
// HAS NO OFFSET. `postGrid` and `postList` both read the newest published posts
// and cap them, so two post sections in one design print the same posts twice —
// three across the top and again in the river underneath. A design may
// therefore carry ONE post section, or a FEATURE of one to four posts over a
// LONG INDEX (twenty or more), where an archive that begins with the piece
// above it is what a reader expects. Two grids of similar size stacked is the
// arrangement that reads as a bug.
//
// `assertCatalog(PRESETS)` runs at the bottom of this file: a duplicate id, an
// un-Arabic blurb or a section that names a note fails at import time rather
// than in front of an author.

import type { Section } from "./design.ts";
import { ACADEMIC_PRESETS } from "./presetsAcademic.ts";
import { BRUTALIST_PRESETS } from "./presetsBrutalist.ts";
import { DOCS_PRESETS } from "./presetsDocs.ts";
import { EDITORIAL_PRESETS } from "./presetsEditorial.ts";
import { GALLERY_PRESETS } from "./presetsGallery.ts";
import { GARDEN_PRESETS } from "./presetsGarden.ts";
import { JOURNAL_PRESETS } from "./presetsJournal.ts";
import { LANDING_PRESETS } from "./presetsLanding.ts";
import { LETTER_PRESETS } from "./presetsLetter.ts";
import { MINIMAL_PRESETS } from "./presetsMinimal.ts";
import { PORTFOLIO_PRESETS } from "./presetsPortfolio.ts";
import { SIGNATURE_A_PRESETS } from "./presetsSignatureA.ts";
import { SIGNATURE_B_PRESETS } from "./presetsSignatureB.ts";
import { SIGNATURE_C_PRESETS } from "./presetsSignatureC.ts";
import { SIGNATURE_D_PRESETS } from "./presetsSignatureD.ts";
import { SIGNATURE_E_PRESETS } from "./presetsSignatureE.ts";
import {
  assertCatalog,
  presetChrome as chrome,
  presetDesignPart as design,
  type Preset,
} from "./presets.ts";

// The two authoring helpers — `chrome` (a diff against the stock defaults) and
// `design` (the halves nobody varies) — live in shared/presets.ts beside the
// type, because the catalog is SPLIT BY FAMILY: one module per shelf of the
// gallery, so fifty designs are fifty reviewable diffs rather than one
// three-thousand-line file, and two people adding presets to two families do
// not edit the same lines. This file is the assembly and the order.

// ── The four written with the engine ────────────────────────────────────────

/** A front page that RANKS things: three lead stories across the top, the rest
 *  as a river beneath, topics at the foot. Uppercase serif headings on a wide
 *  measure — the shape of a paper, at the size a screen can hold. */
const broadsheet: Preset = {
  id: "broadsheet",
  name: { en: "Broadsheet", ar: "الصحيفة" },
  blurb: {
    en: "Three leads across the top, then a river of everything else.",
    ar: "ثلاثة عناوين رئيسية في الأعلى، ثم نهر من بقية المقالات.",
  },
  family: "editorial",
  tags: ["wide", "serif", "grid", "uppercase", "masthead", "news", "magazine"],
  design: design({
    theme: "parchment",
    site: { width: 1080, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.33,
        measure: 66,
        lineHeight: 1.6,
        headingWeight: 700,
        headingCase: "uppercase",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 1.1,
      },
      header: { layout: "stacked", density: "tall", sticky: "nav", divider: true },
      footer: { align: "center", showRss: true, showSearchHint: true },
    }),
    sections: [
      { id: "leads", kind: "postGrid", heading: "", limit: 3, columns: 3, tag: "", showExcerpt: true, showBanner: true, showDate: true },
      { id: "rule-a", kind: "divider", style: "rule", space: 40 },
      { id: "river", kind: "postList", heading: "", limit: 14, tag: "", showExcerpt: true, showDate: true },
      { id: "air-a", kind: "divider", style: "blank", space: 24 },
      { id: "topics", kind: "topics", heading: "", limit: 14 },
    ] as Section[],
  }),
};

/** Nothing but the writing. A narrow column, a compact inline header, no
 *  masthead, no rules, no chips — the design that gets out of the way, and the
 *  one to start from when the answer to "what should the front page do" is
 *  "list what I wrote". */
const quietPage: Preset = {
  id: "quiet-page",
  name: { en: "Quiet Page", ar: "الصفحة الهادئة" },
  blurb: {
    en: "One narrow column and no furniture — the type does all the work.",
    ar: "عمود واحد ضيّق بلا زخرفة — الخط وحده يقوم بالعمل.",
  },
  family: "minimal",
  tags: ["narrow", "serif", "list", "calm", "reading", "plain", "simple"],
  design: design({
    theme: "linen",
    site: { width: 640, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.15,
        measure: 68,
        lineHeight: 1.7,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "serif",
        bodyFamily: "serif",
        rhythm: 0.9,
      },
      header: { layout: "inline", density: "compact", sticky: "none", showTagline: false, divider: false },
      nav: { fallback: "none", showSearch: true, showThemeToggle: true },
      footer: { align: "start", showRss: false, showSearchHint: false, showPoweredBy: false },
    }),
    sections: [
      { id: "writing", kind: "postList", heading: "", limit: 30, tag: "", showExcerpt: true, showDate: true },
    ] as Section[],
  }),
};

/** Pictures first. A full-bleed opening panel, then a two-up grid of banners
 *  with the titles under them and no excerpts to compete — for a vault whose
 *  posts carry images, and for one whose posts do not, because the generated
 *  artwork is drawn from the same theme the page is. */
const atelier: Preset = {
  id: "atelier",
  name: { en: "Atelier", ar: "المرسم" },
  blurb: {
    en: "A full-width opening panel over a two-up grid of banners.",
    ar: "لوحة افتتاحية بعرض الصفحة فوق شبكة من لافتتين في الصف.",
  },
  family: "portfolio",
  tags: ["images", "grid", "banners", "hero", "sans", "wide", "visual", "work"],
  design: design({
    theme: "sumi",
    site: { width: 1140, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.25,
        measure: 62,
        lineHeight: 1.6,
        headingWeight: 600,
        headingCase: "uppercase",
        headingFamily: "sans",
        bodyFamily: "sans",
        rhythm: 1.25,
      },
      header: { layout: "inline", density: "regular", sticky: "header", showTagline: false },
      footer: { align: "start", showSearchHint: false },
    }),
    sections: [
      { id: "opening", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "tall" },
      { id: "air-a", kind: "divider", style: "blank", space: 48 },
      { id: "work", kind: "postGrid", heading: "", limit: 8, columns: 2, tag: "", showExcerpt: false, showBanner: true, showDate: false },
      { id: "air-b", kind: "divider", style: "blank", space: 32 },
      { id: "topics", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
  }),
};

/** The newsletter shape: an invitation above the fold, eight recent letters
 *  under it, and one button at the bottom that the author points wherever the
 *  subscribing happens. The CTA is the one section here that WANTS words — the
 *  panel says so after it is applied. */
const dispatch: Preset = {
  id: "dispatch",
  name: { en: "Dispatch", ar: "الرسالة" },
  blurb: {
    en: "An invitation above the fold, recent letters below, one button at the end.",
    ar: "دعوة في صدر الصفحة، وأحدث الرسائل تحتها، وزر واحد في النهاية.",
  },
  family: "letter",
  tags: ["newsletter", "cta", "hero", "sans", "subscribe", "email", "list"],
  design: design({
    theme: "nocturne",
    site: { width: 760, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        scale: 1.2,
        measure: 70,
        lineHeight: 1.7,
        headingWeight: 600,
        headingCase: "normal",
        headingFamily: "sans",
        bodyFamily: "serif",
        rhythm: 1.05,
      },
      header: { layout: "stackedStart", density: "regular", sticky: "nav" },
      footer: { align: "center", showRss: true },
    }),
    sections: [
      { id: "invite", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short" },
      { id: "air-a", kind: "divider", style: "blank", space: 20 },
      { id: "letters", kind: "postList", heading: "", limit: 8, tag: "", showExcerpt: true, showDate: true },
      { id: "dots", kind: "divider", style: "dots", space: 44 },
      { id: "join", kind: "cta", heading: "", body: "", label: "", url: "/" },
    ] as Section[],
  }),
};

/** THE CATALOG. Ordered as the gallery shows it with no filter on: the family
 *  order of PRESET_FAMILIES, and inside a family, most-generally-useful first.
 *  It is not alphabetical on purpose — the first row of a gallery is an
 *  editorial decision, and "atelier before broadsheet" is not one.
 *
 *  The four above lead their families because they are the plainest statement
 *  of what each family is for; the family modules follow behind them.
 *
 *  EVERY FAMILY HAS A MODULE, and that is a rule rather than an accident of
 *  where the writing stopped. `PRESET_FAMILIES` is a CLOSED vocabulary the
 *  gallery draws a chip for, unconditionally, counting what is here — so a
 *  family with nothing behind it renders as a chip that is `disabled` on every
 *  instance, in every language, no matter what anybody types in the search box.
 *  `landing` shipped exactly that. A filter that can never be switched on is
 *  not a filter; it is a promise of a shelf next to an empty one, and the fix
 *  is a module rather than a chip that learns to hide, because the alternative
 *  is a closed vocabulary carrying a dead word.
 *
 *  Two families are served by more than one module, and both splits are
 *  editorial rather than accidental. `minimal` holds the narrow essay shelf
 *  (presetsMinimal.ts) and then the wide, heavy, uppercase half
 *  (presetsBrutalist.ts) — two arguments about restraint that share a family
 *  and not a file. `reference` holds documentation, then research, then the
 *  digital-garden designs, which is the order somebody browsing the chip is
 *  most likely to want them in.
 *
 *  THE SIGNATURE COLLECTION LEADS, and that is the one place the "family order"
 *  rule is doing editorial work rather than following it. The eight older
 *  families name a JOB and their order is a taxonomy; `signature` names a BAR,
 *  and the designs held to it are the answer to the question somebody actually
 *  opens this gallery with. It arrives as studio modules — the press, then the
 *  gallery, then the letters — so a shelf of signature designs reads as
 *  arguments of four rather than as loose cards, and the studios themselves are
 *  ordered as a person would browse them: the ones made of TYPE, then the ones
 *  made of PICTURES, then the ones made of PAPER — and then the OBSERVATORY,
 *  the five houses that are each standing in a world. Studio D goes last of the
 *  four and not first, though it is the loudest shelf in the building, because
 *  the gallery's first row is what a reader takes the product to be: a page of
 *  starfields and dot screens says this is a toy, and the same five cards four
 *  rows down say the thing that is true, which is that the type came first and
 *  the sky is also available. */
export const PRESETS: readonly Preset[] = [
  ...SIGNATURE_A_PRESETS,
  ...SIGNATURE_B_PRESETS,
  ...SIGNATURE_C_PRESETS,
  ...SIGNATURE_D_PRESETS,
  ...SIGNATURE_E_PRESETS,
  broadsheet,
  ...EDITORIAL_PRESETS,
  quietPage,
  ...MINIMAL_PRESETS,
  ...BRUTALIST_PRESETS,
  ...JOURNAL_PRESETS,
  atelier,
  ...PORTFOLIO_PRESETS,
  ...DOCS_PRESETS,
  ...ACADEMIC_PRESETS,
  ...GARDEN_PRESETS,
  ...LANDING_PRESETS,
  ...GALLERY_PRESETS,
  dispatch,
  ...LETTER_PRESETS,
];

assertCatalog(PRESETS);

export default PRESETS;
