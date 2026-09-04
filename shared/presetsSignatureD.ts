// THE SIGNATURE COLLECTION, STUDIO D — THE OBSERVATORY.
//
// The press (studio A) argued that type is a machine for publishing. The
// gallery (studio B) argued that a picture is a unit of layout. The letters
// (studio C) argued that a page is a made object. This studio argues the thing
// none of the three could: THAT A PAGE IS SOMEWHERE. Five houses that are each standing in
// a world — a sky, a curtain of light, a dusk, a survey of ground, a printed
// screen — and the reason they are one shelf is that all five answer a question
// no design on the old shelves could ask, because until `chrome.scenery` there
// was nothing to ask it with.
//
// WHAT THE SHELF EXISTED TO FIX, stated plainly because it was the owner's
// report and it was correct: seventy-one finished designs, and the gallery read
// as seventy-one settings of one page. Every one of them was ink on paper. They
// differed in measure, in face, in the run of sections and in five hue-free
// textures — real differences, all of them, and none of them the difference
// between a herbal and a star catalogue. A reader who asked for "a space
// design" could be given a narrower column.
//
// So each house here takes one world all the way, and takes the four other
// decisions with it:
//
//   · WORLD      starfield · aurora · horizon · topography · halftone
//   · MARK       ☾ moon · ✧ star · ✶ burst · ◈ lozenge · ❦ fleuron
//   · GROUND     flat · flat · tinted · ruled · paper
//   · ROOM       sidereal · nocturne · murex · moss · mauveine
//   · MASTHEAD   stackedStart · stacked · banner · rule · inline
//   · MENU       brackets · underline · pills · plain · brackets
//   · END        colophon · grand · columns · columns · colophon
//   · RUN        index · dateline · — · ledger · numbered
//   · MEASURE    980 · 860 · 1040 · 820 · 920 px
//
// EVERY WORLD ONCE, AND FIVE OF THE SIX MARKS. That is a rule rather than an
// accident: a shelf that shipped two starfields would be selling the axis twice
// and demonstrating it once, and the first thing anybody building their own
// design does is open the two that look closest to each other and diff them. So
// all five worlds are here, each in a house that argues for it and next to four
// that argue for something else. The sixth mark is `asterism` — the wordmark
// every one of the other seventy-one designs already wears — and it is the one
// this shelf has no use for, because a house that has chosen a world has
// something of its own to sign with.
//
// A NOTE ON WHY EVERY HOUSE HERE IS NARROW, because it is the one measurement
// that reached all five at once and it is not a coincidence that they are the
// five narrowest signature designs on the shelf. A scenery is masked out from
// under the reading column — that is how a loud world and a legible page are
// the same page (design.css) — so THE WORLD LIVES IN THE MARGINS, and a design
// that wants one has to leave it somewhere to be. At 980 in a 1440 window there
// is 230px of open sky on each side; the press's 1360px monograph would have
// 40px, which is a stripe. A house that has chosen a world keeps a narrow page.
//
// A NOTE ON WHAT A WORLD DOES NOT DO, because it decided three of the five
// grounds. A scenery is a field of LIGHT fixed to the window; a surface is a
// texture of INK fixed to the sheet. They compose, and the composition is the
// point — laid paper under a starfield is a letter written somewhere — but two
// loud ones at once is mud. So the two brightest skies (the starfield's
// starlight, the aurora's curtains) stand on `flat`, and the three quiet ones
// carry the textured grounds. The one house with a TINTED ground is the one
// whose world is a single glow with no pattern in it at all.
//
// AND THE RULE THE OTHER STUDIOS WROTE STILL HOLDS: a preset is pure form (no
// typed heading, no CTA words, no copyright), it names nothing in the vault,
// and it names a built-in room. `check-presets` runs all of that over this file
// with the other seventy-one, and reports no shape collision inside it or
// against the press, the gallery or the letters.

import type { Section } from "./design.ts";
import {
  presetChrome as chrome,
  presetDesignPart as design,
  type Preset,
} from "./presets.ts";

/**
 * ORRERY — the star catalogue, and the house this shelf was built to make.
 *
 * The owner asked for a space design and the honest answer for seventy-one
 * designs was that they could have a dark room and a narrower column. This is
 * the other answer: the page stands in a `starfield` — two dot fields drifting
 * at 150s and 260s over one faint band of galaxy, all three drawn from
 * `sidereal`'s own accent, so the sky is that room's cold starlight rather than
 * a picture somebody chose — and everything else on the page is what a catalogue
 * of objects looks like.
 *
 * WHICH MEANS A LIST AND NOT A GRID. `layout: "index"` is title, a leader of
 * dots, a date: the Messier list, the Bayer designations, every catalogue of
 * things in the sky ever printed. Twenty-four of them under a FEATURE of three,
 * because a catalogue opens on what is worth looking at tonight and then lists
 * everything. The three at the top are `bare` — no box, no rule, the picture and
 * the words standing on the page — because a bordered tile is furniture and
 * there is no furniture in a sky.
 *
 * IBM Plex Mono over Source Serif 4, and the pairing is the argument. An
 * observatory sets its designations in a machine face because they are
 * designations — NGC 6543, α Lyrae — and it sets its prose in a book face
 * because prose is prose. `headingCase: "uppercase"` and 0.06 of tracking put
 * the headings where a plate label is. The measure is wide (1180) and the
 * density `roomy`: what is between two objects is most of what a sky is.
 *
 * The mark is ☾, and it is the only house on the shelf whose ornament is an
 * OBJECT rather than a rule — which is the point of having six marks instead of
 * the wordmark. The masthead is `stackedStart`, flush to the leading edge like
 * the heading of an observing log; the end is a `colophon`, one line, because
 * an instrument is signed and not advertised.
 */
const orrery: Preset = {
  id: "orrery",
  name: { en: "Orrery", ar: "المرصد" },
  blurb: {
    en: "A catalogue of objects, kept under a drifting sky.",
    ar: "فهرس أجرام، محفوظ تحت سماء تنساب.",
  },
  family: "signature",
  tags: [
    "space", "stars", "night", "dark", "sidereal", "mono", "catalogue",
    "index", "astronomy", "science", "wide", "log",
  ],
  design: design({
    theme: "sidereal",
    site: { width: 980, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.26,
        measure: 68,
        lineHeight: 1.7,
        headingWeight: 500,
        headingCase: "uppercase",
        // A designation is read letter by letter, so it is set letter by
        // letter. This is the widest tracking on any shelf and it is the one
        // place it is not a mannerism.
        tracking: 0.06,
        headingFamily: "mono",
        bodyFamily: "serif",
        headingFont: "ibm-plex-mono",
        bodyFont: "source-serif-4",
        monoFont: "ibm-plex-mono",
        rhythm: 1.3,
      },
      header: { layout: "stackedStart", density: "regular", sticky: "nav", showTagline: true, divider: false },
      nav: { style: "brackets", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "colophon", align: "start", showRss: true, showSearchHint: false },
      surface: "flat",
      scenery: "starfield",
      ornament: "moon",
    }),
    sections: [
      // TONIGHT'S THREE, unboxed. `bare` is the card that deletes the tile and
      // lets the picture and the title stand on the ground — which is the only
      // card shape that does not put a rectangle of furniture into a sky.
      { id: "tonight", kind: "postGrid", heading: "", limit: 3, columns: 3, tag: "", showExcerpt: true, showBanner: true, showDate: true, card: "bare" },
      { id: "mark", kind: "divider", style: "ornament", space: 44 },
      // THE CATALOGUE. Twenty-four against the feature's three — eight times,
      // well past the gate's index ≥ 2 × feature bar, and that ratio IS the
      // form: a catalogue lists everything and features almost nothing.
      { id: "catalogue", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: true, layout: "index" },
      { id: "air", kind: "divider", style: "blank", space: 32 },
      { id: "constellations", kind: "topics", heading: "", limit: 14 },
    ] as Section[],
  }),
};

/**
 * NIGHTWATCH — the log kept while everyone else is asleep.
 *
 * `aurora`: three broad curtains crossing the window on 90s and 140s, periods
 * that share no factor and therefore never draw the same picture twice in a
 * reading session. In `nocturne` they are that room's blue; the same rules in
 * `phosphor` are green and in `murex` are Tyrian, which is why the world has no
 * colour control on it and never will.
 *
 * THE RUN IS `dateline`, and it is the only house here that groups. A watch is
 * kept by the night, so the entries gather under the day they were written and
 * the reader sees the shape of the weeks — three entries on Tuesday, nothing
 * for nine days, four in one night. No other list layout in the engine can
 * show that, and no other design on the shelf needs it.
 *
 * AND IT OPENS ON THE WATCH ITSELF. The first cut put a `band` hero above the
 * run, and the screenshot printed "Hollow Green" in the masthead and again,
 * 250px lower, in the band — which is the trap Studio B named and paid two
 * reshoots for: a hero with an empty heading falls back to the site's NAME, and
 * so does every masthead. The rule that came out of it holds here. A watch has
 * no front page; it has a stack of nights, and the newest one is the top of it.
 *
 * Work Sans over Literata at a NARROW measure (980 / 64ch) and `compact`
 * density — a log is written close together, and the air on this page is in the
 * sky rather than between the lines. The menu is `underline`, the end is
 * `grand`: the one footer form that is a whole block rather than a line, because
 * the bottom of a night watch is where the reader finds everything else.
 */
const nightwatch: Preset = {
  id: "nightwatch",
  name: { en: "Nightwatch", ar: "السهر" },
  blurb: {
    en: "Dated entries under a slow curtain of light, grouped by the night they were written.",
    ar: "مُدوَّنات مؤرَّخة تحت ستارٍ بطيء من الضوء، مجموعة بحسب ليلة كتابتها.",
  },
  family: "signature",
  tags: [
    "journal", "log", "dark", "nocturne", "aurora", "dated", "diary",
    "night", "narrow", "sans", "entries",
  ],
  design: design({
    theme: "nocturne",
    site: { width: 860, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.2,
        measure: 64,
        lineHeight: 1.65,
        headingWeight: 600,
        headingCase: "normal",
        tracking: 0,
        headingFamily: "sans",
        bodyFamily: "serif",
        headingFont: "work-sans",
        bodyFont: "literata",
        rhythm: 0.95,
      },
      header: { layout: "stacked", density: "compact", sticky: "header", showTagline: true, divider: true },
      nav: { style: "underline", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "grand", align: "start", showRss: true, showSearchHint: true },
      surface: "flat",
      scenery: "aurora",
      ornament: "star",
    }),
    sections: [
      { id: "air", kind: "divider", style: "blank", space: 28 },
      // ONE RUN AND NOTHING ELSE. A watch has no front page: it has a stack of
      // nights, and the newest one is the top of it.
      { id: "watch", kind: "postList", heading: "", limit: 22, tag: "", showExcerpt: true, showDate: true, layout: "dateline" },
      { id: "mark", kind: "divider", style: "ornament", space: 34 },
      { id: "subjects", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
  }),
};

/**
 * VESPER — one argument, at dusk.
 *
 * `horizon` is the only world that does not move and the only one that names a
 * direction: a low band standing off the bottom edge of the WINDOW with a tall
 * soft glow at each margin, so the light stays under the reader's feet however
 * far down they have gone. That is what a horizon is, and it is why this world
 * is drawn against the window rather than against the page. (The side glows are
 * the mask's doing and are written up in `design.css`: a world is taken to
 * nothing across the reading column, so a dusk with all its structure along the
 * bottom would have had its subject deleted and left two lit corners.)
 *
 * IT IS THE ONE HOUSE HERE WITH A TINTED GROUND, and that follows from the
 * world rather than from taste. `tinted` is not a pattern, it is a different
 * sheet — the page moves to `--bg-raised` and the raised blocks swap down to
 * `--bg` — so it is the one ground that adds no marks for a glow to compete
 * with. The two loud skies are on `flat` for the same reason read backwards.
 *
 * THE SHAPE IS A LANDING'S: three FEATURES across, one button, the topics. No
 * long index — this is the shelf's one page that is arguing rather than
 * listing, and an archive under an argument is a change of subject. The CTA is
 * the one section here that WANTS words, and it ships with none: the panel says
 * so after it is applied.
 *
 * THE ANNOUNCEMENT IS THE MASTHEAD AND THERE IS NO HERO, which is the same
 * lesson Nightwatch above learned from the same screenshot. A `banner` is a
 * field of `--bg-raised` running the full width of the window with the name and
 * the tagline standing in it — it IS the fold a landing page opens on, and a
 * band hero underneath printed the identical two lines a second time at a
 * second size, 350px lower. One announcement, made once, in the one piece of
 * chrome that exists to make it.
 *
 * `murex` because Tyrian is the colour of the hour this design is named for.
 * The
 * mark is ✶ — six points, the heaviest of the six, which is what a page with
 * three sections and one button can carry.
 */
const vesper: Preset = {
  id: "vesper",
  name: { en: "Vesper", ar: "الغسق" },
  blurb: {
    en: "One argument and one button, standing in the last of the light.",
    ar: "حجّة واحدة وزرّ واحد، في آخر الضوء.",
  },
  family: "signature",
  tags: [
    "landing", "product", "dusk", "murex", "horizon", "banner", "cta",
    "wide", "dark", "argument", "still",
  ],
  design: design({
    theme: "murex",
    site: { width: 1040, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 18,
        scale: 1.34,
        measure: 62,
        lineHeight: 1.6,
        headingWeight: 700,
        headingCase: "normal",
        tracking: -0.01,
        headingFamily: "sans",
        bodyFamily: "sans",
        headingFont: "inter",
        bodyFont: "inter",
        rhythm: 1.4,
      },
      header: { layout: "banner", density: "tall", sticky: "none", showTagline: true, divider: false },
      nav: { style: "pills", fallback: "topics", showSearch: false, showThemeToggle: true },
      footer: { form: "columns", align: "center", showRss: false, showSearchHint: false },
      surface: "tinted",
      scenery: "horizon",
      ornament: "burst",
    }),
    sections: [
      { id: "three", kind: "postGrid", heading: "", limit: 3, columns: 3, tag: "", showExcerpt: true, showBanner: false, showDate: false, card: "boxed" },
      { id: "mark", kind: "divider", style: "ornament", space: 40 },
      // THE ONE SECTION THAT WANTS WORDS, shipped without any. A preset that
      // typed a call to action would ship a stranger's voice into everybody's
      // site; the renderer prints the localized "Read more" until the owner
      // says otherwise, and the panel tells them so on apply.
      { id: "ask", kind: "cta", heading: "", body: "", label: "", url: "" },
      { id: "topics", kind: "topics", heading: "", limit: 10 },
    ] as Section[],
  }),
};

/**
 * ORDNANCE — the survey, and the house that proves a world need not be a sky.
 *
 * `topography` draws contour rings from two survey points at two pitches — a
 * map of ground nobody has walked. It is the shelf's argument that a scenery is
 * not a synonym for a night sky: this one is drawn in INK on the marks layer
 * and gets its body from a coloured copy of itself on the light one, it does
 * not move at all, and on `moss` — a dark room with a green in it — it reads as
 * the sheet a survey is drawn on rather than as a picture behind one.
 *
 * IT STANDS ON RULED PAPER, which is the composition this whole axis exists
 * for: rules at the design's own line box, travelling with the words because
 * they are ON the sheet, under contours fixed to the window because the ground
 * does not move when you walk. Two textures that mean opposite things, and the
 * page is the field notebook they are both from.
 *
 * `layout: "ledger"` rules every row and hangs the date in a column of its own
 * — a survey is a table before it is a list — and the masthead is `rule`, a
 * plate between two hairlines, which is the only masthead in the engine that
 * looks like the head of a form. Narrow (900), `compact`, IBM Plex Sans over
 * IBM Plex Sans: one face for everything, because a survey does not have a
 * display voice.
 *
 * The mark is ◈: geometric, no voice, the one ornament of the six that is not
 * saying anything about the page it sits in.
 */
const ordnance: Preset = {
  id: "ordnance",
  name: { en: "Ordnance", ar: "المساحة" },
  blurb: {
    en: "A field notebook: ruled rows, dated in their own column, over contoured ground.",
    ar: "دفتر ميداني: صفوف مسطَّرة بتواريخ في عمودها، فوق أرضٍ بخطوط تضاريس.",
  },
  family: "signature",
  tags: [
    "notes", "survey", "map", "ledger", "moss", "light", "technical",
    "narrow", "sans", "ruled", "reference", "table",
  ],
  design: design({
    theme: "moss",
    site: { width: 820, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 16,
        scale: 1.18,
        measure: 72,
        lineHeight: 1.55,
        headingWeight: 600,
        headingCase: "smallcaps",
        tracking: 0.02,
        headingFamily: "sans",
        bodyFamily: "sans",
        headingFont: "ibm-plex-sans",
        bodyFont: "ibm-plex-sans",
        monoFont: "ibm-plex-mono",
        rhythm: 0.85,
      },
      header: { layout: "rule", density: "compact", sticky: "nav", showTagline: true, divider: false },
      nav: { style: "plain", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "columns", align: "start", showRss: true, showSearchHint: true },
      surface: "ruled",
      scenery: "topography",
      ornament: "lozenge",
    }),
    sections: [
      { id: "sheet", kind: "postList", heading: "", limit: 26, tag: "", showExcerpt: false, showDate: true, layout: "ledger" },
      { id: "mark", kind: "divider", style: "ornament", space: 30 },
      { id: "sectors", kind: "topics", heading: "", limit: 18 },
    ] as Section[],
  }),
};

/**
 * FLYPOST — printed loud, on a screen you can see.
 *
 * `halftone` is the one world made of ink rather than light: a coarse dot
 * screen at 45°, drawn as two grids offset by half a tile because that IS a 45°
 * lattice and a rotated layer leaves four empty corners. Behind it a second,
 * coarser screen at a pitch that is not a multiple of the first, so the two beat
 * against each other slowly and the page reads as a PRESS rather than as graph
 * paper.
 *
 * ON LAID PAPER, which is the loudest composition on the shelf and deliberately
 * so: a fleck of tooth fixed to the sheet under a dot screen fixed to the
 * window. Everything else here is a riso print — `mauveine`, the one light room
 * with a colour that looks like a second pass; `numbered` for the run, which
 * sets oversized faint ordinals down the side of the page; an `inline` masthead
 * that is a utility row rather than a nameplate, because a flyposted sheet puts its
 * voice in the work and not in its own name.
 *
 * Merriweather at 700 over Source Sans 3, `headingCase: "uppercase"`, negative
 * tracking: a poster face set tight. The mark is ❦, the printer's leaf, which
 * is four hundred years older than everything else on this page and is exactly
 * why it belongs on it.
 */
const flypost: Preset = {
  id: "flypost",
  name: { en: "Flypost", ar: "المنشور" },
  blurb: {
    en: "A numbered run set loud on laid paper, under a printer’s dot screen.",
    ar: "سلسلة مرقّمة بخطٍّ عالٍ على ورق مضلّع، تحت شبكة نقاط الطابع.",
  },
  family: "signature",
  tags: [
    "zine", "poster", "print", "riso", "mauveine", "halftone", "numbered",
    "light", "loud", "uppercase", "essays",
  ],
  design: design({
    theme: "mauveine",
    site: { width: 920, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.38,
        measure: 66,
        lineHeight: 1.6,
        headingWeight: 700,
        headingCase: "uppercase",
        tracking: -0.015,
        headingFamily: "serif",
        bodyFamily: "sans",
        headingFont: "merriweather",
        bodyFont: "source-sans-3",
        rhythm: 1.15,
      },
      header: { layout: "inline", density: "compact", sticky: "none", showTagline: false, divider: true },
      nav: { style: "brackets", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "colophon", align: "center", showRss: true, showSearchHint: false },
      surface: "paper",
      scenery: "halftone",
      ornament: "fleuron",
    }),
    sections: [
      // THE RUN OPENS ON A MARK RATHER THAN ON A HEADING, which is what a
      // broadside does: the masthead here is a thin utility row with the name
      // set small, so the first thing at full width is the fleuron rule — the
      // printer signing the sheet before the first line of it.
      { id: "mark-a", kind: "divider", style: "ornament", space: 34 },
      // THE WHOLE ISSUE, NUMBERED. Oversized faint ordinals down the side are
      // the only list layout that is itself a piece of printing, which is the
      // one thing this house is about.
      { id: "issue", kind: "postList", heading: "", limit: 20, tag: "", showExcerpt: true, showDate: true, layout: "numbered" },
      { id: "mark-b", kind: "divider", style: "ornament", space: 34 },
      { id: "subjects", kind: "topics", heading: "", limit: 16 },
    ] as Section[],
  }),
};

export const SIGNATURE_D_PRESETS: Preset[] = [
  orrery,
  nightwatch,
  vesper,
  ordnance,
  flypost,
];
