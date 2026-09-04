// THE SITE CHROME OF A DESIGNED SITE — navigation, typography, header and
// footer — as one validated value, shared by the server (which stores and
// re-validates it) and the client (whose designer controls are BUILT from the
// bounds below, so a slider can never offer a value the PATCH refuses).
//
// This file is the whole contract for `design.json`'s `chrome` key. It is
// deliberately pure: no fs, no fetch, no React, no DOM. Two entry points:
//
//   normalizeChrome(raw)  — LENIENT. Never throws. Clamps every number into
//                           its bounds, drops what it cannot understand and
//                           fills the rest from DEFAULT_CHROME. This is what
//                           every READ goes through, on both sides, so a
//                           hand-edited or half-migrated design.json renders
//                           a site instead of a stack trace.
//   validateChrome(raw)   — STRICT. Throws DesignError(path, code) on anything
//                           out of bounds. This is what a PATCH goes through,
//                           so a bad value is REFUSED with the offending field
//                           named rather than silently rounded off.
//
// The two must agree on what is legal; they differ only in what they do about
// an illegal value, which is the difference between "an operator typed this
// just now" and "this is what is on disk".
//
// BOUNDS ARE A FEATURE, NOT A LIMITATION. A design surface that lets its
// owner ship 9px body text on a 240-character measure has shipped a bug: the
// site is unreadable, the owner cannot see why (they designed it at 27" and
// the reader is on a phone), and nothing in the product says no. Every
// numeric control here is a clamp between two values that both read well, and
// the DERIVED sizes (heading steps, section rhythm) are computed from them
// rather than set, so no combination of legal inputs produces an illegal page.
//
// THE ONE IMPORT is `shared/bidi.ts`, which is purer than this file is: a
// regexp and a replace. Every string here renders into a public page, so the
// product's one bidi rule has to reach both validators rather than only the
// one in shared/design.ts.

import { stripBidiControls } from "./bidi.ts";
import {
  catalogEntry,
  designFontFamily,
  designFontRef,
  dedupeFontRefs,
  type DesignFontRef,
  type DesignFontSlot,
} from "./fontCatalog.ts";

// ── Errors ──────────────────────────────────────────────────────────────────

/** A rejected design value. `path` names the field ("typography.baseSize",
 *  "nav.items[2].label"), `code` is the STABLE name the client translates —
 *  the server's prose is English by construction (CONTRACTS: API errors). */
export class DesignError extends Error {
  readonly path: string;
  readonly code: string;
  constructor(path: string, code: string, message: string) {
    super(message);
    this.name = "DesignError";
    this.path = path;
    this.code = code;
  }
}

// ── Navigation ──────────────────────────────────────────────────────────────

/** What one navigation entry points at.
 *  - `home`    the site root ("/")
 *  - `note`    a published note (vault-relative .md path)
 *  - `page`    a static page — a note carrying `page: true` (same addressing
 *              as `note`; the kind is kept apart so the builder can offer the
 *              two lists separately and so a page's URL stays a note URL)
 *  - `topic`   a tag archive ("/topic/<tag>")
 *  - `url`     an explicit URL: absolute http(s), or site-relative ("/feed.xml")
 *  - `group`   a label with children and no destination of its own */
export type NavKind = "home" | "note" | "page" | "topic" | "url" | "group";

export interface NavItem {
  /** Stable id — React keys, drag ordering, and the "which section failed"
   *  message the error boundary shows the admin. */
  id: string;
  kind: NavKind;
  /** What the reader sees. Never derived at render time: a menu label is
   *  editorial (a note called "About the author.md" is "About" in the bar). */
  label: string;
  /** Note path / tag / URL, by kind. Unused by `home` and `group`. */
  target?: string;
  /** Per-item visibility. A hidden item is RETAINED in the config and simply
   *  not rendered — the same lossless rule the whole design file follows, so
   *  taking a link down for a week is not the same as losing how it was set
   *  up. */
  hidden?: boolean;
  /** Open in a new tab. Meaningful for `url` items; ignored elsewhere. */
  newTab?: boolean;
  /** ONE level of nesting. A child carrying children of its own is a
   *  validation error, not a silently flattened menu: two levels of dropdown
   *  in a public site's top bar is a menu nobody can use on a phone. */
  children?: NavItem[];
}

/** HOW A MENU ITEM IS DRAWN, and it is four ways of saying "this is a link"
 *  rather than four colours. "plain" is the bar every design had before this
 *  field existed — a run of muted words that warm on hover. "pills" gives each
 *  one a filled ground. "underline" draws the accent as a RAIL under the item
 *  the reader is on, which is the newspaper and journal answer. "brackets"
 *  wraps the label in `[ ]`, which is the console answer and the one a terminal
 *  design cannot be built without.
 *
 *  The brackets are drawn as pseudo-element CONTENT on the link, which carries
 *  `dir="auto"` — so the pair resolves against the LABEL's own script rather
 *  than the chrome's, and the opening bracket lands at the reading start in
 *  both directions without a rule per direction. The argument, and the
 *  measurement behind it, are in design.css beside the rule that draws it. */
export type NavStyle = "plain" | "pills" | "underline" | "brackets";

/** THE CLOSED VOCABULARIES, once. Both validators read these lists and so does
 *  the panel's SegmentedControl, so a value the control can offer is a value
 *  the PATCH accepts by construction — the same property `TYPO_BOUNDS` gives
 *  the sliders one screen down. */
export const NAV_STYLES: readonly NavStyle[] = ["plain", "pills", "underline", "brackets"];

export interface NavDesign {
  items: NavItem[];
  /** What the bar shows when `items` is empty. "topics" reproduces the stock
   *  blog's behaviour (the busiest published tags, in count order) so a fresh
   *  design starts from something rather than from nothing; "none" is an
   *  empty bar for a site whose nav is entirely hand-built. */
  fallback: "topics" | "none";
  /** How the items are drawn. See NavStyle. */
  style: NavStyle;
  showSearch: boolean;
  showThemeToggle: boolean;
  /** The EN/ع switch, when settings.languageToggle is on. This only decides
   *  whether the DESIGNED chrome offers it; the instance switch still wins. */
  showLangSwitch: boolean;
}

export const NAV_LIMITS = {
  items: 20,
  children: 12,
  label: 60,
  target: 400,
} as const;

// ── Typography ──────────────────────────────────────────────────────────────

/** The three stacks an instance ships (tokens.css). "mono" is here because a
 *  console site is a real thing an author wants and there was no way to ask
 *  for one: every designed page resolved to the serif or the sans stack, so
 *  the terminal look died at the first paragraph. It names the INSTANCE's
 *  mono stack, like its two neighbours. It chooses the STACK; the FACE inside
 *  that stack is the optional `headingFont`/`bodyFont`/`monoFont` below. */
export type FontFamilyChoice = "serif" | "sans" | "mono";
export type HeadingCase = "normal" | "smallcaps" | "uppercase";

export interface TypographyDesign {
  /** Body size in px. */
  baseSize: number;
  /** Modular scale ratio: each heading step multiplies by this. */
  scale: number;
  /** Reading measure in ch (characters per line) — the one control that
   *  decides whether long-form prose is readable at all. */
  measure: number;
  /** Body line height (unitless multiplier). */
  lineHeight: number;
  headingWeight: number;
  headingCase: HeadingCase;
  /** Extra letter-spacing on headings, in em. The CASE still carries its own
   *  need (uppercase without air is a wall), so this is what the AUTHOR adds
   *  on top of that — 0 is exactly the spacing every design had before the
   *  control existed. */
  tracking: number;
  headingFamily: FontFamilyChoice;
  bodyFamily: FontFamilyChoice;
  /**
   * THE FACES. Optional catalog ids (shared/fontCatalog.ts) — a design naming
   * real type rather than "whatever this instance calls serif".
   *
   * ABSENT IS THE DEFAULT AND ABSENT IS A REAL ANSWER: the role resolves to
   * the instance's own stack, exactly as every design did before these three
   * fields existed. Present, the resolved family is emitted AHEAD of that
   * stack in `typographyVars`, so a face the server could not serve falls
   * through to the token beside it and the page is the page it would have
   * been. A design's type is never all-or-nothing.
   *
   * THE SPLIT BETWEEN THEM. `headingFont` and `bodyFont` name a face for a
   * ROLE. `monoFont` names the face of the design's MONO STACK — so it
   * dresses code inside the author's prose, AND it is what a role set to the
   * mono family resolves to when that role names no face of its own. That is
   * what makes a console design one decision instead of three: set the
   * families to mono, name one mono face, and every heading, paragraph and
   * code span is in it.
   *
   * CATALOG IDS ONLY — never an uploaded `custom:` face. A design travels: it
   * is exported, imported, and shipped in the preset catalog, and a file that
   * exists on one instance names nothing on another. The instance's own four
   * slots are where an operator's licensed face belongs.
   */
  headingFont?: string;
  bodyFont?: string;
  monoFont?: string;
  /** Vertical rhythm multiplier for the space BETWEEN sections (header pad,
   *  page gap, footer pad, gap under headings). 1 = the stock spacing. */
  rhythm: number;
}

/** min / max / step / default for every numeric typography control. The
 *  designer's sliders read these, the strict validator enforces them, and the
 *  lenient normalizer clamps to them — one table, so a control can never
 *  offer a value the server refuses. */
export const TYPO_BOUNDS = {
  // 15px is the floor at which the naskh faces (which run small at a given
  // px) stay readable; past 21 the measure collapses on a phone.
  baseSize: { min: 15, max: 21, step: 0.5, default: 17 },
  // Below 1.10 headings stop being a hierarchy; past 1.414 an h1 on a phone
  // is wider than the phone.
  scale: { min: 1.1, max: 1.414, step: 0.008, default: 1.22 },
  // The classic 45–85ch band, minus the extremes: 58 is a narrow column that
  // still holds a sentence, 86 is as wide as prose may get before the eye
  // loses the line start.
  measure: { min: 58, max: 86, step: 1, default: 70 },
  // THE FLOOR IS 1.2, NOT 1.4, BECAUSE DENSITY IS A LOOK. 1.4 is the right
  // floor for prose set in a proportional face at a comfortable measure, and
  // it was written as if that were the only kind of page a design could be.
  // It is not: a console, a ledger, an index — anything set in the mono stack
  // at a narrow measure — reads WRONG at 1.4, because a monospaced line is
  // shorter, its glyphs are already spaced, and the leading a serif needs
  // makes a terminal look like a form. 1.2 is the tightest setting at which
  // ascenders and descenders on adjacent lines still clear each other in
  // every stack this ships, which is what the floor is actually for; below it
  // the lines collide and no amount of taste rescues them. The reader who
  // wants air still has the whole band above.
  lineHeight: { min: 1.2, max: 1.9, step: 0.05, default: 1.65 },
  headingWeight: { min: 400, max: 800, step: 100, default: 600 },
  // Headings only, and in em so it scales with the type rather than fighting
  // it. Negative is real: a large display heading in a tight face wants its
  // letters pulled together, and -0.02 is as far as that goes before the
  // counters close up. 0.12 is a poster, not a paragraph — past it the word
  // stops being a word.
  tracking: { min: -0.02, max: 0.12, step: 0.005, default: 0 },
  rhythm: { min: 0.75, max: 1.6, step: 0.05, default: 1 },
} as const;

export type TypoNumberKey = keyof typeof TYPO_BOUNDS;

// ── Header ──────────────────────────────────────────────────────────────────

/**
 * Where the site identity sits, and what it sits IN. Five mastheads:
 *
 *   stacked       the stock blog's centred masthead
 *   stackedStart  the same block flushed to the reading direction's leading edge
 *   inline        identity and navigation on one row (the compact, app-like header)
 *   rule          THE NEWSPAPER. A hairline above the wordmark and a hairline
 *                 below it, with the nav centred beneath — the two rules are
 *                 the masthead, which is why this layout does not also take the
 *                 `divider` hairline (three rules in 120px is a fence).
 *   banner        THE MAGAZINE. The header is a BAR: a full-width field of
 *                 `--bg-raised` running edge to edge behind a centred block, so
 *                 the identity sits on ground of its own rather than on the page.
 *
 * A LAYOUT IS NOT A SIXTH SIDEBAR, and that is a decision rather than an
 * omission. A side rail is the one masthead this engine cannot draw: DESIGN.md's
 * "one column per page" is the rule `.s-dsn-page` enforces and the reason the
 * stock blog had to learn its own measure twice, and a nav column beside the
 * writing means two columns, a second measure, a phone breakpoint that reflows
 * the page rather than the bar, and a sticky element that is taller than the
 * viewport on the design most likely to want one. It is deferred, not refused —
 * when it lands it lands as a change to the PAGE, not as one more header enum.
 */
export type HeaderLayout = "stacked" | "stackedStart" | "inline" | "rule" | "banner";

export const HEADER_LAYOUTS: readonly HeaderLayout[] = [
  "stacked",
  "stackedStart",
  "inline",
  "rule",
  "banner",
];

export type HeaderDensity = "compact" | "regular" | "tall";
/** What survives a scroll: nothing, the nav bar alone (the stock behaviour),
 *  or the whole header block. */
export type StickyMode = "none" | "nav" | "header";

export interface HeaderDesign {
  layout: HeaderLayout;
  density: HeaderDensity;
  sticky: StickyMode;
  /** Show settings.logo in place of the site name when one is configured.
   *  Off shows the name as type even on an instance that has a logo. */
  showLogo: boolean;
  /** Show the site name beside the logo (a wordmark next to a device). */
  showName: boolean;
  showTagline: boolean;
  /** Hairline under the header block. */
  divider: boolean;
}

// ── Footer ──────────────────────────────────────────────────────────────────

export type FooterEntryKind = "link" | "text" | "social";

/** A known social network — the label and the icon are ours, the target is
 *  the operator's URL. An open-ended "icon name" field would be a promise to
 *  ship every icon in the world. */
export type SocialNetwork = "mastodon" | "x" | "github" | "linkedin" | "rss" | "email";

export const SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  "mastodon",
  "x",
  "github",
  "linkedin",
  "rss",
  "email",
];

export interface FooterEntry {
  id: string;
  kind: FooterEntryKind;
  /** Link text, the text itself, or the social account's display name. */
  label: string;
  /** URL (link/social) — same rules as a `url` nav item. Unused by `text`. */
  target?: string;
  /** `social` only. */
  network?: SocialNetwork;
}

export interface FooterColumn {
  id: string;
  /** Column heading. Empty renders an untitled column (a run of links with
   *  no header), which is a real layout, not a mistake. */
  title: string;
  entries: FooterEntry[];
}

/**
 * WHAT SHAPE THE END OF THE PAGE IS. Three, and they are three different
 * statements rather than three paddings:
 *
 *   columns   the grid of titled columns this footer has always been
 *   colophon  ONE centred prose block set the way a book's colophon is —
 *             small caps, a narrow measure, the entries running as text rather
 *             than as a grid. The end of a letterpress page, not a sitemap.
 *   grand     THE BIG-TYPE FOOTER: the site's own name at display size across
 *             the end of the page, with the footer's entries as a single row
 *             beneath it.
 *
 * A GRAND FOOTER'S ROW IS THE FOOTER'S OWN ENTRIES, never the header's menu,
 * and that is the whole reason it needs no new field. A footer that reached
 * into `nav.items` would print the masthead twice on a design whose menu is the
 * topics fallback — a list that CHANGES as the author writes — and it would
 * make the footer's own columns dead weight the moment this form was chosen.
 * The columns flatten; nothing is invented and nothing is discarded.
 */
export type FooterForm = "columns" | "colophon" | "grand";

export const FOOTER_FORMS: readonly FooterForm[] = ["columns", "colophon", "grand"];

export interface FooterDesign {
  columns: FooterColumn[];
  /** How the columns and the copyright are SET. See FooterForm. */
  form: FooterForm;
  /** Copyright template — {year} and {siteName} are substituted, exactly as
   *  settings.footer is. Empty falls back to the instance's own footer line,
   *  so a designed site inherits what the stock site already showed. */
  copyright: string;
  showCopyright: boolean;
  showRss: boolean;
  /** The "Ctrl K to search" hint the stock footer carries. */
  showSearchHint: boolean;
  showPoweredBy: boolean;
  align: "start" | "center";
}

export const FOOTER_LIMITS = {
  columns: 4,
  entries: 8,
  title: 40,
  label: 60,
  target: 400,
  copyright: 200,
} as const;

// ── The whole chrome ────────────────────────────────────────────────────────

/**
 * THE GROUND THE WHOLE SITE IS PRINTED ON — and it is the one field in this
 * file that had to argue hardest for its own existence, because a surface is
 * the shape of a thing that usually turns out to be a colour.
 *
 *   flat    nothing. The page ground, exactly as every design drew it before.
 *   ruled   faint horizontal baselines, at the design's OWN line height —
 *           the writing paper a ledger and a journal are set on.
 *   grid    the same pitch in both axes: graph paper, for a technical site.
 *   tinted  the page ground moves to `--bg-raised`. No pattern; a different
 *           sheet of paper.
 *   paper   a fine irregular fleck, drawn as three repeating gradients at
 *           co-prime periods and odd angles. Laid paper, no image file.
 *
 * IT DECIDES ARRANGEMENT, NOT HUE, and that is checkable rather than claimed:
 * every value above is `--bg-raised` or a `color-mix` of `--text` into
 * transparent, so all five surfaces are the same decision in all twenty-one
 * themes and a theme retune moves them without anyone editing this file.
 *
 * IT IS A WHISPER, AND THAT IS A MEASUREMENT. Contrast is measured COMPOSITED —
 * the real pixels under real text with the pattern painted, the way the ambient
 * masthead's numbers were taken — not argued from an alpha. The floors and the
 * readings are recorded in `design.css` beside the rules that draw them.
 *
 * IT LIVES ON `chrome`, NOT ON `site`. `site` is a closed allowlist whose keys
 * are a schema bump (`shared/design.ts`); `chrome` is leniently normalized, so
 * a design written before this field renders flat and a design written after it
 * renders on an older build as the page it always was.
 */
export type ChromeSurface = "flat" | "ruled" | "grid" | "tinted" | "paper";

export const CHROME_SURFACES: readonly ChromeSurface[] = [
  "flat",
  "ruled",
  "grid",
  "tinted",
  "paper",
];

/**
 * THE WORLD BEHIND THE PAGE — the axis the shelf did not have.
 *
 * `surface` above answers "what is this printed ON", and it answers it in ink:
 * five textures, every one of them a `color-mix` of `--text` into transparent,
 * hue-free by construction so that one rule is right in twenty-one rooms. That
 * was the correct shape for a sheet of paper and it is the reason sixty designs
 * could differ in type, in arrangement and in ground and still read, side by
 * side in the gallery, as sixty settings of the same page. A reader who asked
 * for "a space design" was told they could have a narrower measure.
 *
 * So this is the other question: WHAT IS THE PAGE STANDING IN. A scenery is a
 * field of LIGHT rather than a texture of ink — it is drawn from the room's own
 * `--accent`, it is the size of the window rather than the size of a line box,
 * and it is the one thing on a designed page that is allowed to move. Five
 * worlds, and they are worlds rather than patterns:
 *
 *   none        nothing. The page stands in the room, as every design did.
 *   starfield   deep sky: two dot fields at different scales drifting at
 *               different rates, over one faint band of galaxy. The near field
 *               is starlight (`--accent` mixed toward white); the far one is
 *               the accent itself, so sidereal's sky is cold, murex's is
 *               Tyrian and phosphor's is a green nobody else has.
 *   aurora      three broad soft curtains crossing the window, shifting on
 *               periods that never lock step.
 *   horizon     one vast glow rising off the bottom edge — dusk, and the only
 *               world that names a direction.
 *   topography  contour rings from two survey points: a map of ground nobody
 *               has walked.
 *   halftone    a coarse dot screen at 45°, printed loud. The one world made of
 *               ink rather than light, and the reason `--text` appears below.
 *
 * IT IS FIXED TO THE WINDOW, NOT TO THE PAPER, and that is the whole difference
 * between a scenery and a surface. `background-attachment: local` is what makes
 * ruled paper ruled — the lines travel with the words because they are ON the
 * sheet. A sky does not travel with the words; the reader moves and the sky
 * stays, which is what makes a page feel like it is somewhere. Mechanically
 * that is one sticky, zero-height layer pinned to the top of the scrollport,
 * with the field drawn on its two pseudo-elements (`design.css`).
 *
 * IT IS A WHISPER AND THAT IS A MEASUREMENT, exactly as the surfaces are. The
 * numbers are composited readings taken off real pixels with the animations
 * running, and they are recorded in `design.css` beside the rules that draw
 * them — not argued from an alpha, because the first draft of `horizon` argued
 * from an alpha and measured 3.9 on parchment.
 *
 * `prefers-reduced-motion` FREEZES IT RATHER THAN DELETING IT, and this is the
 * one place this feature parts company with the ambient layer (`ambient.css`,
 * rule 4). That layer is an atmosphere the OWNER switched on behind a masthead:
 * with it gone the masthead is the masthead, and deleting it costs nothing. A
 * scenery is what the AUTHOR chose their site to stand in — deleting it hands a
 * reader who asked for less motion a different design instead. So the fields
 * stay, the drift stops, and a reader with the setting on sees the same still
 * sky in every screenshot.
 *
 * IT LIVES ON `chrome` FOR THE REASON `surface` DOES: `site` is a closed
 * allowlist whose keys are a schema bump, `chrome` is leniently normalized, so
 * a design written before this field renders with no sky and a design written
 * after it renders on an older build as the page it always was.
 */
export type ChromeScenery =
  | "none"
  | "starfield"
  | "aurora"
  | "horizon"
  | "topography"
  | "halftone";

export const CHROME_SCENERIES: readonly ChromeScenery[] = [
  "none",
  "starfield",
  "aurora",
  "horizon",
  "topography",
  "halftone",
];

/**
 * THE MARK A DESIGN SIGNS ITS BREAKS WITH.
 *
 * The ornament divider and the dotted one both drew `✦` — Vellum's own
 * wordmark, hard-coded in `design.css`, on every design on the shelf. That is
 * the right default and it was the wrong CONSTANT: a page standing in a
 * starfield that breaks its sections with the product's logo is wearing
 * somebody else's monogram, and a herbal that breaks them with a fleuron is
 * saying something the same page with a four-pointed star is not.
 *
 * Six marks, closed, and every one of them is a glyph rather than an image
 * because a preset may not name a file and a divider must survive being printed
 * (`print.css`), copied, and read by a screen reader that is told to ignore it.
 * They are chosen from the ranges a text face actually covers — U+2020..U+27BF,
 * which the serif, sans and mono stacks all have — so a design does not fall
 * back to a box on somebody else's machine.
 */
export type ChromeOrnament =
  | "asterism" // ✦ the wordmark, and the default every design had
  | "star" // ✧ hollow — a night sky, a map's legend
  | "burst" // ✶ six points, heavier: a compass rose at small size
  | "moon" // ☾ the one mark that is an object rather than a rule
  | "lozenge" // ◈ geometric, technical, no voice
  | "fleuron"; // ❦ the printer's leaf, for a page that wants a century

export const CHROME_ORNAMENTS: readonly ChromeOrnament[] = [
  "asterism",
  "star",
  "burst",
  "moon",
  "lozenge",
  "fleuron",
];

export interface DesignChrome {
  nav: NavDesign;
  typography: TypographyDesign;
  header: HeaderDesign;
  footer: FooterDesign;
  surface: ChromeSurface;
  /** The paper's tooth, and then the world it is standing in. Two keys rather
   *  than one enum of twenty because they answer different questions and a
   *  design routinely wants both — laid paper under a starfield is a letter
   *  written somewhere. */
  scenery: ChromeScenery;
  ornament: ChromeOrnament;
}

export const DEFAULT_CHROME: DesignChrome = {
  nav: {
    items: [],
    fallback: "topics",
    style: "plain",
    showSearch: true,
    showThemeToggle: true,
    showLangSwitch: true,
  },
  typography: {
    baseSize: TYPO_BOUNDS.baseSize.default,
    scale: TYPO_BOUNDS.scale.default,
    measure: TYPO_BOUNDS.measure.default,
    lineHeight: TYPO_BOUNDS.lineHeight.default,
    headingWeight: TYPO_BOUNDS.headingWeight.default,
    headingCase: "normal",
    tracking: TYPO_BOUNDS.tracking.default,
    headingFamily: "serif",
    bodyFamily: "serif",
    rhythm: TYPO_BOUNDS.rhythm.default,
  },
  header: {
    layout: "stacked",
    density: "regular",
    sticky: "nav",
    showLogo: true,
    showName: true,
    showTagline: true,
    divider: true,
  },
  footer: {
    columns: [],
    form: "columns",
    copyright: "",
    showCopyright: true,
    showRss: true,
    showSearchHint: true,
    showPoweredBy: true,
    align: "center",
  },
  surface: "flat",
  scenery: "none",
  ornament: "asterism",
};

/** A deep copy of the stock defaults — "reset to stock defaults", and the
 *  starting point of every new design. Frozen constants would be shared
 *  structure the designer then mutates. */
export function stockChrome(): DesignChrome {
  return structuredClone(DEFAULT_CHROME);
}

// ── The stored document ─────────────────────────────────────────────────────

/* THE DOCUMENT LIVES IN shared/design.ts. This module owns the CHROME only —
   nav, typography, header, footer — which is one field on that document
   (`DesignDoc.chrome`). Two modules describing the same file is how a design
   store ends up with two ideas of what a design is. */


// ── Small shared helpers ────────────────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** A short, URL-safe, collision-unlikely id. Used by the client when it adds
 *  a row and by the server when it accepts one that arrived without an id. */
export function designId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Round to the control's own step so the stored value is one the slider can
 *  actually return to (and so a float never prints as 1.2200000000000002). */
function snap(value: number, key: TypoNumberKey): number {
  const { min, max, step } = TYPO_BOUNDS[key];
  const clamped = Math.min(max, Math.max(min, value));
  const steps = Math.round((clamped - min) / step);
  return Math.round((min + steps * step) * 1000) / 1000;
}

/** Single-line, control characters stripped, trimmed, capped. The same
 *  treatment settings.ts gives every stored string. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return stripBidiControls(value).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

/** A URL a designed page may LINK to. Absolute http/https, or site-relative
 *  ("/about", "/feed.xml"). Everything else — javascript:, data:, vbscript:,
 *  a protocol-relative "//evil.example" — is refused: these strings land in
 *  an <a href> on every visitor's page, and the operator typing them is not
 *  always the person who will click them. */
export function isSafeLinkTarget(value: string): boolean {
  if (value === "") return false;
  if (value.startsWith("//")) return false; // protocol-relative
  if (value.startsWith("/")) return !value.startsWith("/\\");
  return /^https?:\/\/[^\s]+$/i.test(value);
}

/** A tag a `topic` item may point at — the shape settings.excludeTags uses. */
export function isSimpleTag(value: string): boolean {
  return value !== "" && value.length <= 50 && /^[\p{L}\p{N}][\p{L}\p{N}_/-]*$/u.test(value);
}

/** A vault-relative markdown path. Containment is re-checked server-side
 *  (safeAbs); this is the shape check both sides can run. */
export function isNotePathish(value: string): boolean {
  if (value === "" || value.length > NAV_LIMITS.target) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("..")) return false;
  return /\.md$/i.test(value);
}

/** The lenient half of an enum: a value in the vocabulary, or the default.
 *  `undefined` (the field was written before it existed) and garbage (a
 *  hand-edit, a design from a newer build) take the SAME road on purpose —
 *  what a read owes the reader is a page, and the strict half next door is
 *  where the two are told apart out loud. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

// ── Lenient normalization (reads) ───────────────────────────────────────────

function normNavItem(raw: unknown, depth: number): NavItem | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  const known: NavKind[] = ["home", "note", "page", "topic", "url", "group"];
  if (typeof kind !== "string" || !known.includes(kind as NavKind)) return null;
  const label = cleanText(raw.label, NAV_LIMITS.label);
  if (label === "") return null;
  const item: NavItem = {
    id: typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : designId(),
    kind: kind as NavKind,
    label,
  };
  const target = cleanText(raw.target, NAV_LIMITS.target);
  if (item.kind === "note" || item.kind === "page") {
    if (!isNotePathish(target)) return null;
    item.target = target;
  } else if (item.kind === "topic") {
    if (!isSimpleTag(target)) return null;
    item.target = target;
  } else if (item.kind === "url") {
    if (!isSafeLinkTarget(target)) return null;
    item.target = target;
    if (raw.newTab === true) item.newTab = true;
  }
  if (raw.hidden === true) item.hidden = true;
  if (depth === 0 && Array.isArray(raw.children)) {
    const kids: NavItem[] = [];
    for (const child of raw.children.slice(0, NAV_LIMITS.children)) {
      const norm = normNavItem(child, 1);
      if (norm) kids.push(norm);
    }
    if (kids.length > 0) item.children = kids;
  }
  // A group with nothing under it is a label that does nothing.
  if (item.kind === "group" && !item.children) return null;
  return item;
}

function normNav(raw: unknown): NavDesign {
  const d = DEFAULT_CHROME.nav;
  if (!isRecord(raw)) return { ...d, items: [] };
  const items: NavItem[] = [];
  if (Array.isArray(raw.items)) {
    for (const entry of raw.items.slice(0, NAV_LIMITS.items)) {
      const item = normNavItem(entry, 0);
      if (item) items.push(item);
    }
  }
  return {
    items,
    fallback: raw.fallback === "none" ? "none" : "topics",
    style: oneOf(raw.style, NAV_STYLES, d.style),
    showSearch: raw.showSearch !== false,
    showThemeToggle: raw.showThemeToggle !== false,
    showLangSwitch: raw.showLangSwitch !== false,
  };
}

function normTypography(raw: unknown): TypographyDesign {
  const d = DEFAULT_CHROME.typography;
  if (!isRecord(raw)) return { ...d };
  const num = (key: TypoNumberKey): number => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value)
      ? snap(value, key)
      : TYPO_BOUNDS[key].default;
  };
  const family = (value: unknown, fallback: FontFamilyChoice): FontFamilyChoice =>
    value === "serif" || value === "sans" || value === "mono" ? value : fallback;
  const headingCase: HeadingCase =
    raw.headingCase === "smallcaps" || raw.headingCase === "uppercase"
      ? raw.headingCase
      : "normal";
  // A face this build does not have is DROPPED, not kept and not clamped: the
  // role falls back to the instance's stack, which is exactly what "absent"
  // means, and the site renders. The strict half says no to the same value out
  // loud — see validateChrome.
  const face = (value: unknown): string | undefined =>
    typeof value === "string" && catalogEntry(value) !== null ? value : undefined;
  const heading = face(raw.headingFont);
  const body = face(raw.bodyFont);
  const mono = face(raw.monoFont);
  return {
    baseSize: num("baseSize"),
    scale: num("scale"),
    measure: num("measure"),
    lineHeight: num("lineHeight"),
    headingWeight: num("headingWeight"),
    headingCase,
    tracking: num("tracking"),
    headingFamily: family(raw.headingFamily, d.headingFamily),
    bodyFamily: family(raw.bodyFamily, d.bodyFamily),
    // Spread rather than assigned: an absent face must not become
    // `headingFont: undefined` in the stored JSON, because `countChanges()`
    // walks the draft leaf-wise and a key that exists holding nothing is a
    // difference from a key that does not exist.
    ...(heading ? { headingFont: heading } : {}),
    ...(body ? { bodyFont: body } : {}),
    ...(mono ? { monoFont: mono } : {}),
    rhythm: num("rhythm"),
  };
}

function normHeader(raw: unknown): HeaderDesign {
  const d = DEFAULT_CHROME.header;
  if (!isRecord(raw)) return { ...d };
  const layout = oneOf(raw.layout, HEADER_LAYOUTS, d.layout);
  const density: HeaderDensity =
    raw.density === "compact" || raw.density === "tall" ? raw.density : "regular";
  const sticky: StickyMode =
    raw.sticky === "none" || raw.sticky === "header" ? raw.sticky : "nav";
  return {
    layout,
    density,
    sticky,
    showLogo: raw.showLogo !== false,
    showName: raw.showName !== false,
    showTagline: raw.showTagline !== false,
    divider: raw.divider !== false,
  };
}

function normFooterEntry(raw: unknown): FooterEntry | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (kind !== "link" && kind !== "text" && kind !== "social") return null;
  const label = cleanText(raw.label, FOOTER_LIMITS.label);
  if (label === "") return null;
  const entry: FooterEntry = {
    id: typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : designId(),
    kind,
    label,
  };
  if (kind !== "text") {
    const target = cleanText(raw.target, FOOTER_LIMITS.target);
    if (!isSafeLinkTarget(target)) return null;
    entry.target = target;
  }
  if (kind === "social") {
    const network = raw.network;
    entry.network = SOCIAL_NETWORKS.includes(network as SocialNetwork)
      ? (network as SocialNetwork)
      : "rss";
  }
  return entry;
}

function normFooter(raw: unknown): FooterDesign {
  const d = DEFAULT_CHROME.footer;
  if (!isRecord(raw)) return { ...d, columns: [] };
  const columns: FooterColumn[] = [];
  if (Array.isArray(raw.columns)) {
    for (const col of raw.columns.slice(0, FOOTER_LIMITS.columns)) {
      if (!isRecord(col)) continue;
      const entries: FooterEntry[] = [];
      if (Array.isArray(col.entries)) {
        for (const entry of col.entries.slice(0, FOOTER_LIMITS.entries)) {
          const norm = normFooterEntry(entry);
          if (norm) entries.push(norm);
        }
      }
      const title = cleanText(col.title, FOOTER_LIMITS.title);
      if (title === "" && entries.length === 0) continue;
      columns.push({
        id: typeof col.id === "string" && ID_RE.test(col.id) ? col.id : designId(),
        title,
        entries,
      });
    }
  }
  return {
    columns,
    form: oneOf(raw.form, FOOTER_FORMS, d.form),
    copyright: cleanText(raw.copyright, FOOTER_LIMITS.copyright),
    showCopyright: raw.showCopyright !== false,
    showRss: raw.showRss !== false,
    showSearchHint: raw.showSearchHint !== false,
    showPoweredBy: raw.showPoweredBy !== false,
    align: raw.align === "start" ? "start" : "center",
  };
}

/** LENIENT: anything unparseable becomes its stock default. Never throws.
 *  Every read — server startup, `/api/design/site`, the client's own render —
 *  goes through this, which is what makes a corrupt design file survivable
 *  exactly as a corrupt settings.json is. */
export function normalizeChrome(raw: unknown): DesignChrome {
  const source = isRecord(raw) ? raw : {};
  return {
    nav: normNav(source.nav),
    typography: normTypography(source.typography),
    header: normHeader(source.header),
    footer: normFooter(source.footer),
    surface: oneOf(source.surface, CHROME_SURFACES, DEFAULT_CHROME.surface),
    scenery: oneOf(source.scenery, CHROME_SCENERIES, DEFAULT_CHROME.scenery),
    ornament: oneOf(source.ornament, CHROME_ORNAMENTS, DEFAULT_CHROME.ornament),
  };
}

// ── Strict validation (writes) ──────────────────────────────────────────────

function bad(path: string, code: string, message: string): never {
  throw new DesignError(path, code, message);
}

/**
 * THE STRICT SIDE OF `cleanText`, AND IT STRIPS BIDI FOR THE SAME REASON.
 *
 * Every string this validates — a nav label, a group label, a footer column's
 * label, `footer.copyright` — is drawn into the PUBLIC header and footer of a
 * designed site, beside note titles, for a reader with no cookie. An RLO in a
 * label renders as text that differs from the text stored and reorders every
 * glyph after it ("safe‮evil" draws as "safelive"), which is exactly the
 * lie `shared/bidi.ts` exists to refuse and exactly what `shared/design.ts`
 * already refuses for a section heading. One validator was missed; a design
 * document is one document, so both halves of it now answer the same way.
 */
function strictText(value: unknown, path: string, max: number, required: boolean): string {
  if (typeof value !== "string") {
    if (required) bad(path, "design_bad_string", `${path} must be a string`);
    return "";
  }
  const clean = stripBidiControls(value).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (clean.length > max) {
    bad(path, "design_too_long", `${path} is too long (${max} characters max)`);
  }
  if (required && clean === "") bad(path, "design_empty", `${path} must not be empty`);
  return clean;
}

function strictNavItem(raw: unknown, path: string, depth: number): NavItem {
  if (!isRecord(raw)) bad(path, "design_bad_item", `${path} must be an object`);
  const known: NavKind[] = ["home", "note", "page", "topic", "url", "group"];
  if (typeof raw.kind !== "string" || !known.includes(raw.kind as NavKind)) {
    bad(`${path}.kind`, "design_bad_kind", `${path}.kind must be one of: ${known.join(", ")}`);
  }
  const kind = raw.kind as NavKind;
  const item: NavItem = {
    id: typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : designId(),
    kind,
    label: strictText(raw.label, `${path}.label`, NAV_LIMITS.label, true),
  };
  if (kind === "note" || kind === "page") {
    const target = strictText(raw.target, `${path}.target`, NAV_LIMITS.target, true);
    if (!isNotePathish(target)) {
      bad(`${path}.target`, "design_bad_note", `${path}.target must be a vault markdown path`);
    }
    item.target = target;
  } else if (kind === "topic") {
    const target = strictText(raw.target, `${path}.target`, NAV_LIMITS.target, true);
    if (!isSimpleTag(target)) {
      bad(`${path}.target`, "design_bad_tag", `${path}.target must be a simple tag name`);
    }
    item.target = target;
  } else if (kind === "url") {
    const target = strictText(raw.target, `${path}.target`, NAV_LIMITS.target, true);
    if (!isSafeLinkTarget(target)) {
      bad(`${path}.target`, "design_bad_url", `${path}.target must be an http(s) or site-relative URL`);
    }
    item.target = target;
    if (raw.newTab === true) item.newTab = true;
  }
  if (raw.hidden === true) item.hidden = true;
  if (Array.isArray(raw.children) && raw.children.length > 0) {
    if (depth > 0) {
      bad(`${path}.children`, "design_too_deep", "Navigation nests one level only");
    }
    if (raw.children.length > NAV_LIMITS.children) {
      bad(`${path}.children`, "design_too_many", `A submenu holds at most ${NAV_LIMITS.children} items`);
    }
    item.children = raw.children.map((child, i) =>
      strictNavItem(child, `${path}.children[${i}]`, 1),
    );
  }
  if (kind === "group" && !item.children) {
    bad(`${path}.children`, "design_empty_group", `${path} is a group with no items under it`);
  }
  return item;
}

/** STRICT: the shape a PATCH must have. Throws DesignError naming the field.
 *  Returns the cleaned value (trimmed strings, snapped numbers, ids filled) —
 *  what actually lands on disk. */
export function validateChrome(raw: unknown): DesignChrome {
  if (!isRecord(raw)) bad("chrome", "design_bad_object", "Design chrome must be an object");

  // ── nav
  const navRaw = isRecord(raw.nav) ? raw.nav : {};
  if (navRaw.items !== undefined && !Array.isArray(navRaw.items)) {
    bad("nav.items", "design_bad_array", "nav.items must be an array");
  }
  const itemsRaw = Array.isArray(navRaw.items) ? navRaw.items : [];
  if (itemsRaw.length > NAV_LIMITS.items) {
    bad("nav.items", "design_too_many", `The menu holds at most ${NAV_LIMITS.items} top-level items`);
  }
  // ONE enum reader for the whole chrome — nav, header, footer and the surface
  // — so every closed vocabulary is refused the same way, with the field named
  // and the legal values listed. It is declared here rather than beside the
  // header because a `const` arrow is not hoisted and the nav now reads one.
  const enumKey =<T extends string>(key: string, value: unknown, allowed: readonly T[]): T | null => {
    if (value === undefined) return null;
    if (typeof value !== "string" || !allowed.includes(value as T)) {
      bad(key, "design_bad_value", `${key} must be one of: ${allowed.join(", ")}`);
    }
    return value as T;
  };
  const nav: NavDesign = {
    items: itemsRaw.map((item, i) => strictNavItem(item, `nav.items[${i}]`, 0)),
    fallback: navRaw.fallback === "none" ? "none" : "topics",
    style: enumKey("nav.style", navRaw.style, NAV_STYLES) ?? DEFAULT_CHROME.nav.style,
    showSearch: navRaw.showSearch !== false,
    showThemeToggle: navRaw.showThemeToggle !== false,
    showLangSwitch: navRaw.showLangSwitch !== false,
  };

  // ── typography: every number must already be inside its bounds. Clamping a
  // value an operator just typed hides the refusal; the panel's own controls
  // cannot produce one, so anything out of range came from an import or a
  // hand-edit and deserves to be named.
  const typoRaw = isRecord(raw.typography) ? raw.typography : {};
  const typo = { ...DEFAULT_CHROME.typography };
  for (const key of Object.keys(TYPO_BOUNDS) as TypoNumberKey[]) {
    const value = typoRaw[key];
    if (value === undefined) continue;
    const { min, max } = TYPO_BOUNDS[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      bad(`typography.${key}`, "design_bad_number", `typography.${key} must be a number`);
    }
    if (value < min || value > max) {
      bad(
        `typography.${key}`,
        "design_out_of_range",
        `typography.${key} must be between ${min} and ${max}`,
      );
    }
    typo[key] = snap(value, key);
  }
  if (typoRaw.headingCase !== undefined) {
    if (
      typoRaw.headingCase !== "normal" &&
      typoRaw.headingCase !== "smallcaps" &&
      typoRaw.headingCase !== "uppercase"
    ) {
      bad("typography.headingCase", "design_bad_value", "typography.headingCase is not a known value");
    }
    typo.headingCase = typoRaw.headingCase;
  }
  for (const key of ["headingFamily", "bodyFamily"] as const) {
    const value = typoRaw[key];
    if (value === undefined) continue;
    if (value !== "serif" && value !== "sans" && value !== "mono") {
      bad(
        `typography.${key}`,
        "design_bad_value",
        `typography.${key} must be "serif", "sans" or "mono"`,
      );
    }
    typo[key] = value;
  }
  // THE FACES. `null` / `""` is how a control CLEARS one back to the
  // instance's stack — an explicit "no face", the same shape `fonts.<slot>`
  // takes — and it deletes the key rather than storing an empty string,
  // because absent is the state the renderer understands.
  //
  // An unknown id is a 400 that NAMES it. A design travels: it is exported,
  // imported and applied from a preset, and a silently-ignored `headingFont`
  // is a design that renders in the wrong type on the machine it lands on with
  // nothing anywhere saying why. An uploaded `custom:` id is refused by the
  // same check for the same reason — it is not in the catalog because it is
  // not portable.
  for (const key of ["headingFont", "bodyFont", "monoFont"] as const) {
    if (!Object.prototype.hasOwnProperty.call(typoRaw, key)) continue;
    const value = typoRaw[key];
    if (value === undefined) continue;
    if (value === null || value === "") {
      delete typo[key];
      continue;
    }
    if (typeof value !== "string" || catalogEntry(value) === null) {
      bad(
        `typography.${key}`,
        "design_bad_value",
        `typography.${key} must be a font id from the catalog, or null`,
      );
    }
    typo[key] = value as string;
  }

  // ── header
  const headerRaw = isRecord(raw.header) ? raw.header : {};
  const header = { ...DEFAULT_CHROME.header };
  header.layout = enumKey("header.layout", headerRaw.layout, HEADER_LAYOUTS) ?? header.layout;
  header.density =
    enumKey("header.density", headerRaw.density, ["compact", "regular", "tall"] as const) ??
    header.density;
  header.sticky =
    enumKey("header.sticky", headerRaw.sticky, ["none", "nav", "header"] as const) ?? header.sticky;
  for (const key of ["showLogo", "showName", "showTagline", "divider"] as const) {
    const value = headerRaw[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      bad(`header.${key}`, "design_bad_boolean", `header.${key} must be a boolean`);
    }
    header[key] = value;
  }

  // ── footer
  const footerRaw = isRecord(raw.footer) ? raw.footer : {};
  if (footerRaw.columns !== undefined && !Array.isArray(footerRaw.columns)) {
    bad("footer.columns", "design_bad_array", "footer.columns must be an array");
  }
  const colsRaw = Array.isArray(footerRaw.columns) ? footerRaw.columns : [];
  if (colsRaw.length > FOOTER_LIMITS.columns) {
    bad("footer.columns", "design_too_many", `The footer holds at most ${FOOTER_LIMITS.columns} columns`);
  }
  const columns: FooterColumn[] = colsRaw.map((col, i) => {
    const at = `footer.columns[${i}]`;
    if (!isRecord(col)) bad(at, "design_bad_item", `${at} must be an object`);
    if (col.entries !== undefined && !Array.isArray(col.entries)) {
      bad(`${at}.entries`, "design_bad_array", `${at}.entries must be an array`);
    }
    const entriesRaw = Array.isArray(col.entries) ? col.entries : [];
    if (entriesRaw.length > FOOTER_LIMITS.entries) {
      bad(`${at}.entries`, "design_too_many", `A footer column holds at most ${FOOTER_LIMITS.entries} entries`);
    }
    return {
      id: typeof col.id === "string" && ID_RE.test(col.id) ? col.id : designId(),
      title: strictText(col.title, `${at}.title`, FOOTER_LIMITS.title, false),
      entries: entriesRaw.map((entry, j) => {
        const path = `${at}.entries[${j}]`;
        if (!isRecord(entry)) bad(path, "design_bad_item", `${path} must be an object`);
        const kind = enumKey(`${path}.kind`, entry.kind, ["link", "text", "social"] as const);
        if (kind === null) bad(`${path}.kind`, "design_bad_kind", `${path}.kind is required`);
        const out: FooterEntry = {
          id: typeof entry.id === "string" && ID_RE.test(entry.id) ? entry.id : designId(),
          kind,
          label: strictText(entry.label, `${path}.label`, FOOTER_LIMITS.label, true),
        };
        if (kind !== "text") {
          const target = strictText(entry.target, `${path}.target`, FOOTER_LIMITS.target, true);
          if (!isSafeLinkTarget(target)) {
            bad(`${path}.target`, "design_bad_url", `${path}.target must be an http(s) or site-relative URL`);
          }
          out.target = target;
        }
        if (kind === "social") {
          const network = enumKey(`${path}.network`, entry.network, SOCIAL_NETWORKS);
          if (network === null) bad(`${path}.network`, "design_bad_value", `${path}.network is required`);
          out.network = network;
        }
        return out;
      }),
    };
  });
  const footer: FooterDesign = {
    columns,
    form: enumKey("footer.form", footerRaw.form, FOOTER_FORMS) ?? DEFAULT_CHROME.footer.form,
    copyright: strictText(footerRaw.copyright, "footer.copyright", FOOTER_LIMITS.copyright, false),
    showCopyright: footerRaw.showCopyright !== false,
    showRss: footerRaw.showRss !== false,
    showSearchHint: footerRaw.showSearchHint !== false,
    showPoweredBy: footerRaw.showPoweredBy !== false,
    align: enumKey("footer.align", footerRaw.align, ["start", "center"] as const) ?? "center",
  };

  // ── the ground everything above is printed on, the world it stands in, and
  // the mark it breaks itself with
  const surface = enumKey("surface", raw.surface, CHROME_SURFACES) ?? DEFAULT_CHROME.surface;
  const scenery = enumKey("scenery", raw.scenery, CHROME_SCENERIES) ?? DEFAULT_CHROME.scenery;
  const ornament =
    enumKey("ornament", raw.ornament, CHROME_ORNAMENTS) ?? DEFAULT_CHROME.ornament;

  return { nav, typography: typo, header, footer, surface, scenery, ornament };
}

// ── Derived values (one implementation, used by the site and the preview) ───

/** Which INSTANCE slot a design family choice stands in for. A design's serif
 *  is whatever the operator put in the prose slot, its sans is the ui slot,
 *  its mono is the mono slot — so a face the design names is composed against
 *  the same counterpart the instance would have used. */
export function roleSlot(choice: FontFamilyChoice): DesignFontSlot {
  return choice === "sans" ? "ui" : choice === "mono" ? "mono" : "prose";
}

/**
 * Every face this typography actually asks for, as (id, slot, family) — the
 * list the server turns into `@font-face` blocks and the designer turns into a
 * draft-face request.
 *
 * It is derived from the config rather than read off it, because "which faces
 * does this design need" is not the same question as "which fields are set":
 * a role set to the mono family with no face of its own resolves to `monoFont`
 * (see TypographyDesign), and `monoFont` is needed for code even when nothing
 * else uses it. One function answers it for both sides, so the family the
 * browser asks for and the family the server emits can never drift.
 */
export function designFontRefs(typo: TypographyDesign): DesignFontRef[] {
  const refs: DesignFontRef[] = [];
  const push = (id: string | undefined, choice: FontFamilyChoice): void => {
    const face = id ?? (choice === "mono" ? typo.monoFont : undefined);
    if (face) refs.push(designFontRef(face, roleSlot(choice)));
  };
  push(typo.headingFont, typo.headingFamily);
  push(typo.bodyFont, typo.bodyFamily);
  if (typo.monoFont) refs.push(designFontRef(typo.monoFont, "mono"));
  return dedupeFontRefs(refs);
}


/** The CSS custom properties a typography config resolves to. Returned as a
 *  plain record so the caller can spread it into a React `style` prop (the
 *  live site) or write it into a <style> block (the designer's preview) —
 *  the SAME numbers either way, which is what makes the preview honest.
 *
 *  Heading sizes are DERIVED from base × scale^n rather than set one by one:
 *  six independent size fields is six ways to break the hierarchy, and a
 *  modular scale cannot produce an h3 larger than its h2. */
export function typographyVars(typo: TypographyDesign): Record<string, string> {
  const { baseSize: base, scale, measure, lineHeight, rhythm } = typo;
  const step = (n: number): string => `${Math.round(base * Math.pow(scale, n) * 100) / 100}px`;
  const stack = (choice: FontFamilyChoice): string =>
    choice === "sans"
      ? "var(--font-ui)"
      : choice === "mono"
        ? "var(--font-mono)"
        : "var(--font-serif)";
  // A ROLE'S FACE IN FRONT OF ITS STACK, never instead of it. The design's
  // family is always the last word in the list, so an id the server could not
  // serve — a face still downloading, a cache hand-deleted, a design imported
  // onto an instance that has never fetched it — falls through to the token
  // and the page is exactly the page it was before this feature. The fallback
  // IS the feature.
  const role = (id: string | undefined, choice: FontFamilyChoice): string => {
    const face = id ?? (choice === "mono" ? typo.monoFont : undefined);
    const fallback = stack(choice);
    return face ? `"${designFontFamily(face, roleSlot(choice))}", ${fallback}` : fallback;
  };
  const bodyFont = role(typo.bodyFont, typo.bodyFamily);
  const headFont = role(typo.headingFont, typo.headingFamily);
  const monoFont = typo.monoFont
    ? `"${designFontFamily(typo.monoFont, "mono")}", var(--font-mono)`
    : "var(--font-mono)";
  return {
    "--dsg-base": `${base}px`,
    "--dsg-line": String(lineHeight),
    // The measure twice over. `ch` is the honest unit and is what the PROSE
    // itself is capped in — it is a character count, which is what the
    // control means. But a `ch` resolves against the element's own font-size,
    // so the wrappers AROUND the prose (the page column, the article header,
    // the footer grid) would each measure it in their own type and land on a
    // different width; those take the px twin, computed once here from the
    // one base size. 0.52em is the average lowercase advance of the serif and
    // sans stacks this ships with, measured against Georgia and system-ui.
    "--dsg-measure": `${measure}ch`,
    "--dsg-measure-px": `${Math.round(measure * base * 0.52)}px`,
    "--dsg-body-font": bodyFont,
    "--dsg-head-font": headFont,
    // The design's monospace, for the code inside the author's own prose. It
    // is emitted whether or not a face is named, because the fallback alone is
    // worth having: `.s-dsg` code used to read the app's `--font-mono`
    // directly, which is right for a code block in the editor and merely a
    // coincidence on a designed page.
    "--dsg-mono-font": monoFont,
    "--dsg-head-weight": String(typo.headingWeight),
    "--dsg-head-transform": typo.headingCase === "uppercase" ? "uppercase" : "none",
    "--dsg-head-variant": typo.headingCase === "smallcaps" ? "small-caps" : "normal",
    // The author's own tracking, raw. It is emitted separately from the value
    // the stylesheet reads so the two halves stay legible: the CASE has a need
    // (uppercase and small caps without air are a wall, which is why they
    // carry 0.045em whether or not anybody asks) and the AUTHOR has an
    // intention, and `--dsg-head-tracking` is the sum. A design that says
    // nothing gets 0 here, which composes to exactly the spacing every design
    // had before this control existed.
    "--dsg-tracking": `${typo.tracking}em`,
    "--dsg-head-tracking": `calc(var(--dsg-tracking) + ${
      typo.headingCase === "normal" ? "0em" : "0.045em"
    })`,
    "--dsg-h1": step(3),
    "--dsg-h2": step(2),
    "--dsg-h3": step(1),
    "--dsg-h4": step(0),
    // Headings breathe in proportion to their own size; the rhythm control
    // scales the space between blocks, never the type itself.
    "--dsg-head-space": `${Math.round(base * 1.4 * rhythm) / 1}px`,
    "--dsg-block-space": `${Math.round(base * 0.95 * rhythm)}px`,
    "--dsg-section-space": `${Math.round(base * 2.6 * rhythm)}px`,
    "--dsg-rhythm": String(rhythm),
  };
}
