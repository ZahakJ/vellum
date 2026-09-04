// THE SIGNATURE COLLECTION, STUDIO E — THE ROOMS.
//
// The press argued that type is a machine for publishing. The gallery argued
// that a picture is a unit of layout. The letters argued that a page is a made
// object. The observatory argued that a page is SOMEWHERE. All four were
// arguments about what is ON the page, and all four were made inside the same
// room: a masthead over one column over a footer, which is the shape every
// design in this catalogue had until `chrome.shell`.
//
// WHAT THE SHELF EXISTED TO FIX, in the owner's words and they were right
// twice: "these still kinda look lame — you are just changing colours and
// rearranging things. I don't see some totally different designs with totally
// different LAYOUTS." Seventy-six houses and one floor plan. A ground, a world,
// a face and a run are real decisions and not one of them moves a wall.
//
// So each house here takes one ROOM and takes it all the way:
//
//   · SHELL      console · dock · split · rail
//   · FRAME      window · float · plain · plain
//   · WORLD      starfield · nebula · fog · none
//   · ROOM       phosphor · void · porphyry · porcelain
//   · MENU       plain · brackets · plain · underline
//   · RUN        ledger · — · river · index
//   · MEASURE    1040 · 780 · 720 · 900 px
//
// EVERY SHELL ONCE, EVERY NEW FRAME ONCE, BOTH NEW WORLDS ONCE. `stack` is the
// one room not on this shelf, because it is the room the other seventy-six are
// already in — a fifth house standing in it would be selling the axis by
// showing the thing that was already there.
//
// A NOTE ON MEASURE, because it moved in the opposite direction from Studio D's
// and for the same reason. A scenery lives in the MARGINS, so an observatory
// house keeps a narrow page to leave the world somewhere to be. A shell EATS a
// margin — a rail is 264px of window that is no longer page — so a house with
// one has less to give away and sets a narrower column still. Only `dock`
// escapes both: it takes nothing and the page runs full-bleed underneath it,
// which is why the deep field is the widest world on the shelf and the
// narrowest column.
//
// AND THE RULE THE OTHER STUDIOS WROTE STILL HOLDS: a preset is pure form, it
// names nothing in the vault, it names a built-in room, and `check-presets`
// runs all of it over this file with the other seventy-six.

import type { Section } from "./design.ts";
import {
  presetChrome as chrome,
  presetDesignPart as design,
  type Preset,
} from "./presets.ts";

/**
 * MISSION CONTROL — the instrument, and the house the owner asked for by name.
 *
 * `shell: "console"` is the whole design and everything else follows from it: a
 * 216px gutter of raised ground down the reading edge, ruled between every
 * item, its labels set in the mono face at 0.78rem, uppercase, tracked out.
 * That is not a menu styled to look technical — it is a menu that has been
 * moved somewhere a publication would never put one, and the rest of the page
 * is what a room like that does to the writing beside it.
 *
 * `frame: "window"` puts a title bar on every block: a strip of raised ground
 * with three dots at the leading edge and square corners under it. A page of
 * PANELS rather than a page of cards, which is what an instrument shows.
 *
 * `phosphor` because a console is a screen and that room is the only green in
 * the building, and `starfield` over `grid` because a mission watches the sky
 * on graph paper. The run is `ledger` — every row ruled, the date hung in a
 * column of its own — because a console does not have articles, it has ENTRIES.
 *
 * The mark is ◈: geometric, no voice, the one ornament of the six that is not
 * saying anything about the page it sits in, which is the correct amount for a
 * machine to say.
 */
const missionControl: Preset = {
  id: "mission-control",
  name: { en: "Mission Control", ar: "غرفة التحكم" },
  blurb: {
    en: "An instrument: a ruled gutter down the side, and every block in its own window.",
    ar: "آلة قياس: مزراب مسطَّر على الجانب، وكل كتلة في نافذتها.",
  },
  family: "signature",
  tags: [
    "console", "mission", "technical", "mono", "phosphor", "dark", "grid",
    "panels", "sidebar", "ledger", "dashboard", "space",
  ],
  design: design({
    theme: "phosphor",
    site: { width: 1040, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 15,
        scale: 1.2,
        measure: 76,
        lineHeight: 1.55,
        headingWeight: 600,
        headingCase: "uppercase",
        tracking: 0.05,
        headingFamily: "mono",
        bodyFamily: "sans",
        headingFont: "jetbrains-mono",
        bodyFont: "ibm-plex-sans",
        monoFont: "jetbrains-mono",
        rhythm: 0.85,
      },
      header: { layout: "stackedStart", density: "compact", sticky: "none", showTagline: true, divider: false },
      nav: { style: "plain", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "colophon", align: "start", showRss: true, showSearchHint: false },
      surface: "grid",
      scenery: "starfield",
      ornament: "lozenge",
      shell: "console",
      frame: "window",
    }),
    sections: [
      { id: "board", kind: "postGrid", heading: "", limit: 4, columns: 2, tag: "", showExcerpt: true, showBanner: false, showDate: true, card: "boxed" },
      { id: "mark", kind: "divider", style: "rule", space: 26 },
      // ENTRIES, NOT ARTICLES. A console's list is a log: every row ruled, the
      // date in a column of its own, nothing else competing for the line.
      { id: "log", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: true, layout: "ledger" },
      { id: "systems", kind: "topics", heading: "", limit: 20 },
    ] as Section[],
  }),
};

/**
 * DEEP FIELD — dark, and as deep as this engine goes.
 *
 * `shell: "dock"` is the only arrangement in the engine where the page runs
 * UNDER the chrome: one floating pill, rounded and translucent, hanging over
 * writing that is full-bleed beneath it. It takes no margin at all, which is
 * why this is the house that can afford the loudest world on the shelf.
 *
 * `scenery: "nebula"` is that world. Three great clouds at three depths over
 * four layers of stars, each moving at its own rate — 90s, 150s, 260s, 420s —
 * so the depth is four speeds rather than a picture of depth. `starfield` is a
 * clear night; this is the long exposure. On `void`, the deepest room in the
 * building, it is the page the owner asked for in the words "dark and epic and
 * deep", and the reason it works is that a dock keeps no margins to hide it in:
 * the world is the whole window and the writing floats in it.
 *
 * `frame: "float"` finishes the argument. Nothing is ruled and every block
 * lifts off the ground on a shadow, because a border is an edge cut out of
 * paper and there is no paper here.
 *
 * A NARROW COLUMN IN A WIDE WORLD (780px), which is the inverse of what a dark
 * magazine usually does and is the whole composition: the more window the
 * writing gives back, the more sky there is to be in.
 */
const deepField: Preset = {
  id: "deep-field",
  name: { en: "Deep Field", ar: "الحقل العميق" },
  blurb: {
    en: "A narrow column of writing floating in a very large, very slow sky.",
    ar: "عمود ضيّق من الكتابة يطفو في سماء واسعة بطيئة جدًّا.",
  },
  family: "signature",
  tags: [
    "space", "dark", "void", "nebula", "stars", "floating", "dock",
    "epic", "narrow", "atmosphere", "essays", "night",
  ],
  design: design({
    theme: "void",
    site: { width: 780, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.3,
        measure: 66,
        lineHeight: 1.75,
        headingWeight: 600,
        headingCase: "normal",
        tracking: 0,
        headingFamily: "serif",
        bodyFamily: "serif",
        headingFont: "eb-garamond",
        bodyFont: "crimson-pro",
        rhythm: 1.4,
      },
      header: { layout: "inline", density: "compact", sticky: "none", showTagline: false, divider: false },
      nav: { style: "brackets", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "colophon", align: "center", showRss: true, showSearchHint: false },
      surface: "flat",
      scenery: "nebula",
      ornament: "star",
      shell: "dock",
      frame: "float",
    }),
    sections: [
      // NOTHING BUT THE WRITING, floating. No hero: the dock already carries
      // the name, and a band under a floating bar is a second announcement in a
      // house whose whole argument is that there is nothing between the reader
      // and the sky. (Studio B's rule, in a room it had never seen.)
      { id: "air", kind: "divider", style: "blank", space: 40 },
      { id: "field", kind: "postList", heading: "", limit: 18, tag: "", showExcerpt: true, showDate: true, layout: "river" },
      { id: "mark", kind: "divider", style: "ornament", space: 44 },
      { id: "regions", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
  }),
};

/**
 * REVENANT — the house that is not empty.
 *
 * `scenery: "fog"` is the one world that takes light AWAY: a vignette that
 * closes the corners of the window in the room's own ground, and two banks
 * crossing it on 190s and 310s, periods that never repeat a shape inside a
 * reading session. Every other world adds something; this one removes, which is
 * the difference between a room with weather in it and a room somebody has left.
 *
 * `shell: "split"` is what makes it unsettling rather than merely dim. The panel
 * on the reading edge DOES NOT SCROLL — a whole screen of its own ground, the
 * name and the menu standing still in the middle of it — while the writing
 * moves past. Two speeds on one screen, and the still one is the one with the
 * name on it.
 *
 * `porphyry` and a book face at a long measure, because the point is not a
 * horror pastiche: it is a house that reads perfectly well and does not feel
 * unoccupied. The mark is ☾. The run is the plain `river`, deliberately — a
 * numbered or ruled list would be somebody keeping records, and there is
 * nobody here keeping records.
 */
const revenant: Preset = {
  id: "revenant",
  name: { en: "Revenant", ar: "العائد" },
  blurb: {
    en: "A still panel, a moving page, and fog closing the corners of both.",
    ar: "لوحة ساكنة، وصفحة متحركة، وضباب يُطبق على زوايا كليهما.",
  },
  family: "signature",
  tags: [
    "haunted", "fog", "dark", "porphyry", "atmosphere", "split", "panel",
    "gothic", "moody", "essays", "quiet", "serif",
  ],
  design: design({
    theme: "porphyry",
    site: { width: 720, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.24,
        measure: 70,
        lineHeight: 1.8,
        headingWeight: 500,
        headingCase: "normal",
        tracking: 0.01,
        headingFamily: "serif",
        bodyFamily: "serif",
        headingFont: "lora",
        bodyFont: "lora",
        rhythm: 1.3,
      },
      header: { layout: "stacked", density: "regular", sticky: "none", showTagline: true, divider: false },
      nav: { style: "plain", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "colophon", align: "center", showRss: false, showSearchHint: false },
      surface: "paper",
      scenery: "fog",
      ornament: "moon",
      shell: "split",
      frame: "plain",
    }),
    sections: [
      { id: "river", kind: "postList", heading: "", limit: 16, tag: "", showExcerpt: true, showDate: true, layout: "river" },
      { id: "mark", kind: "divider", style: "ornament", space: 40 },
      { id: "rooms", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
  }),
};

/**
 * STACKS — the side rail, and the shape the owner described as "a bar with
 * options to read blogs".
 *
 * `shell: "rail"` turns the menu from a ROW into a LIST, and that is the whole
 * feature rather than a styling of it. A row wraps at eight items; a column
 * does not wrap at all, so this is the only shell a site with twenty topics can
 * actually use — and the rail never leaves the window, so a reader four screens
 * into a piece is still one glance from every part of the site.
 *
 * Everything else is a reference book. `porcelain`, which is the coolest light
 * room; IBM Plex Sans over IBM Plex Serif at a long measure; an `index` run
 * twenty-eight deep — title, a leader of dots, the date — because the front
 * page of a handbook is its table of contents and nothing else. No world at
 * all: this is the shelf's argument that a shell is a structural decision and
 * not a mood, and it is the only house on it that would be at home in a
 * company.
 *
 * The mark is ✦, the one Studio D had no use for. A handbook has not chosen a
 * world and has nothing of its own to sign with, and saying so is more honest
 * than picking a fleuron for a manual.
 */
const stacks: Preset = {
  id: "stacks",
  name: { en: "Stacks", ar: "الأرفف" },
  blurb: {
    en: "Every topic standing in a rail that never leaves, and a contents page beside it.",
    ar: "كل موضوع في شريط جانبي لا يغيب، وفهرس بجانبه.",
  },
  family: "reference",
  tags: [
    "docs", "reference", "rail", "sidebar", "handbook", "library", "index",
    "porcelain", "light", "sans", "navigation", "topics",
  ],
  design: design({
    theme: "porcelain",
    site: { width: 900, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 16,
        scale: 1.22,
        measure: 78,
        lineHeight: 1.65,
        headingWeight: 600,
        headingCase: "normal",
        tracking: 0,
        headingFamily: "sans",
        bodyFamily: "serif",
        headingFont: "ibm-plex-sans",
        bodyFont: "source-serif-4",
        monoFont: "ibm-plex-mono",
        rhythm: 1,
      },
      header: { layout: "stackedStart", density: "regular", sticky: "none", showTagline: true, divider: false },
      nav: { style: "underline", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "columns", align: "start", showRss: true, showSearchHint: true },
      surface: "flat",
      scenery: "none",
      ornament: "asterism",
      shell: "rail",
      frame: "plain",
    }),
    sections: [
      { id: "contents", kind: "postList", heading: "", limit: 28, tag: "", showExcerpt: false, showDate: true, layout: "index" },
      { id: "air", kind: "divider", style: "blank", space: 28 },
      { id: "sections", kind: "topics", heading: "", limit: 24 },
    ] as Section[],
  }),
};

export const SIGNATURE_E_PRESETS: Preset[] = [
  missionControl,
  deepField,
  revenant,
  stacks,
];
