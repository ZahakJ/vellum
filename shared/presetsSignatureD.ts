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
 *
 * AND IT OPENS ON THE INSTRUMENT IT IS NAMED FOR. The first section is a
 * `band` hero with a blank heading, which prints the site's name and tagline
 * at the leading edge, and the studio sheet draws an orrery beside them: four
 * hairline orbits and an outer rim, a sun at the centre, four planets standing
 * on their rings, a faint ecliptic through the middle, all of it from
 * `sidereal`'s own tokens and none of it a picture. Under the words runs a
 * declination scale, the ticked rule an observing log keeps at the head of
 * every page. The masthead gives the name up on the home page (`showName` and
 * `showTagline` off; the article route prints it again itself), so the name
 * is set once, next to the thing that measures the sky it stands in. The
 * orrery is also the one part of the world a phone keeps: the starfield is
 * masked away under a narrow window, and the instrument stays.
 */
const orrery: Preset = {
  id: "orrery",
  name: { en: "Orrery", ar: "المرصد" },
  blurb: {
    en: "An orrery turning beside the name, then a catalogue of objects kept under a drifting sky.",
    ar: "مرصد صغير يدور بجانب الاسم، ثم فهرس أجرام محفوظ تحت سماء تنساب.",
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
      signature: "orrery",
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
      // The name stands beside the orrery in the opening below; the masthead
      // is the menu alone on the home page and prints the name again on an
      // article, where there is no hero to carry it.
      header: { layout: "stackedStart", density: "regular", sticky: "nav", showName: false, showTagline: false, divider: false },
      nav: { style: "brackets", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "colophon", align: "start", showRss: true, showSearchHint: false },
      surface: "flat",
      scenery: "starfield",
      ornament: "moon",
    }),
    sections: [
      // THE INSTRUMENT. A blank heading prints the site's name and tagline;
      // the studio sheet draws the orrery in the band's second column.
      { id: "instrument", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "tall", treatment: "band" },
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
 * AND IT OPENS ON THE FIRST PAGE OF THE LOG. The first cut put a `band` hero
 * above the run and printed the name twice, once in the masthead and again
 * 250px lower in the band, which is the trap Studio B named and paid two
 * reshoots for: a hero with an empty heading falls back to the site's NAME, and
 * so does every masthead. The rule that came out of it is that the two never
 * both print, and that is how the hero came back. The masthead gives the name
 * up on the home page (`showName` and `showTagline` off), and the band is the
 * first page a night log has: a sky the studio sheet draws itself (two
 * curtains of the room's accent and a scatter of stars, so the world survives
 * on a phone where the window's own aurora is masked away), a horizon line, a
 * band of opaque ground under it with the name set low against the glow, a
 * watch face stopped at midnight at the end of the band, and a strip of
 * twenty four hours along the bottom edge. Then the stack of nights.
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
    en: "The first page of a night log: a horizon, a strip of hours, the name set low under a curtain of light, then dated entries grouped by night.",
    ar: "الصفحة الأولى من سجلّ الليل: أفق، وشريط ساعات، والاسم منخفضًا تحت ستار من الضوء، ثم مدوّنات مؤرَّخة مجموعة بحسب الليلة.",
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
      signature: "nightwatch",
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
      // The name is set low in the first page below; the masthead is the
      // menu alone on the home page and prints the name again on an article.
      header: { layout: "stacked", density: "compact", sticky: "header", showName: false, showTagline: false, divider: true },
      nav: { style: "underline", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "grand", align: "start", showRss: true, showSearchHint: true },
      surface: "flat",
      scenery: "aurora",
      ornament: "star",
    }),
    sections: [
      // THE FIRST PAGE: sky, horizon, the name low on the ground, the hours.
      { id: "firstpage", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "tall", treatment: "band" },
      { id: "air", kind: "divider", style: "blank", space: 20 },
      // THEN ONE RUN AND NOTHING ELSE: a stack of nights, and the newest one
      // is the top of it.
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
 * THE ANNOUNCEMENT IS THE SUNSET, AND IT IS MADE ONCE. The first cut made it
 * in the `banner` masthead and had no hero, because a band hero under a banner
 * printed the identical two lines a second time at a second size, 350px lower
 * (the lesson Nightwatch above learned from the same screenshot). The hero is
 * back and the masthead has stepped aside: `showName` and `showTagline` are
 * off, so on the home page the banner is nothing but the bar the pills sit
 * in, and the fold is the band under it. The studio sheet draws the hour the
 * house is named for: a sky that deepens toward the accent, a half disc of
 * sun sitting on the horizon line with three dark bands of haze through its
 * lower half, layered hairlines of light above the horizon, and a band of
 * opaque ground under it with the name centred inside the arch of the sun.
 * On an article the banner prints the name again itself.
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
    en: "A sun going down into a horizon band with the name under its arch, then one argument and one button.",
    ar: "شمس تغيب في شريط الأفق والاسم تحت قوسها، ثم حجّة واحدة وزرّ واحد.",
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
      signature: "vesper",
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
      // The name stands under the sun in the opening below; on the home page
      // the banner is the bar the pills sit in, and on an article it prints
      // the name again itself.
      header: { layout: "banner", density: "tall", sticky: "none", showName: false, showTagline: false, divider: false },
      nav: { style: "pills", fallback: "topics", showSearch: false, showThemeToggle: true },
      footer: { form: "columns", align: "center", showRss: false, showSearchHint: false },
      surface: "tinted",
      scenery: "horizon",
      ornament: "burst",
    }),
    sections: [
      // THE SUNSET: the name centred in the ground band under the half disc.
      { id: "dusk", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "tall", treatment: "band" },
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
 *
 * AND THE SHEET HAS A HEAD. A survey sheet opens on its title box and its
 * reference square, so the first section is a `band` hero with a blank
 * heading: the name and tagline set in a ruled title box (the same accent
 * hairline and double outline the ledger below wears, so the two read as one
 * form), a scale bar under the tagline, and beside the box a gridded
 * reference square with a graticule through its middle, three contour rings
 * around a station point, and a north arrow through a compass ring in its
 * corner. Everything in it is a gradient in the room's tokens. The `rule`
 * masthead gives the name up on the home page (`showName` and `showTagline`
 * off) so the title box is the only plate, and prints it again on an article.
 */
const ordnance: Preset = {
  id: "ordnance",
  name: { en: "Ordnance", ar: "المساحة" },
  blurb: {
    en: "A survey sheet: the name in a ruled title box beside a gridded reference square, then ruled rows dated in their own column.",
    ar: "ورقة مساحة: الاسم في صندوق عنوان مسطَّر بجانب مربّع مرجعي مشبَّك، ثم صفوف مسطَّرة بتواريخ في عمودها.",
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
      signature: "ordnance",
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
      // The name is the sheet title in the opening below; the rule masthead
      // is the menu alone on the home page and prints the name on an article.
      header: { layout: "rule", density: "compact", sticky: "nav", showName: false, showTagline: false, divider: false },
      nav: { style: "plain", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "columns", align: "start", showRss: true, showSearchHint: true },
      surface: "ruled",
      scenery: "topography",
      ornament: "lozenge",
    }),
    sections: [
      // THE HEAD OF THE SHEET: title box at the start, reference square at
      // the end, the studio sheet draws both.
      { id: "plate", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short", treatment: "band" },
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
 *
 * AND IT OPENS ON THE WALL. The first section is a `band` hero with a blank
 * heading, and the studio sheet pastes it up as bills: two older sheets
 * underneath at slight angles with torn corners (a striped one and a
 * dot screened one, both cut with `clip-path`), and on top of them the newest
 * bill, the name across it in the poster face with a thick rule under it and
 * two strips of tape at its corners. The bill wears the same heavy border and
 * hard accent shadow the numbered run wears below, so the wall and the run
 * are one printing. The inline masthead keeps its utility row and gives the
 * name up on the home page (`showName` off); an article prints it again.
 */
const flypost: Preset = {
  id: "flypost",
  name: { en: "Flypost", ar: "المنشور" },
  blurb: {
    en: "Bills pasted over bills with the name across the top one, then a numbered run set loud on laid paper.",
    ar: "منشورات ملصقة فوق منشورات والاسم على أعلاها، ثم سلسلة مرقّمة بخطٍّ عالٍ على ورق مضلّع.",
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
      signature: "flypost",
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
      // The name is across the top bill in the opening below; the utility row
      // keeps the menu and prints the name again on an article.
      header: { layout: "inline", density: "compact", sticky: "none", showName: false, showTagline: false, divider: true },
      nav: { style: "brackets", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "colophon", align: "center", showRss: true, showSearchHint: false },
      surface: "paper",
      scenery: "halftone",
      ornament: "fleuron",
    }),
    sections: [
      // THE WALL: bills under bills, the name across the top one.
      { id: "wall", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "tall", treatment: "band" },
      // THE RUN STILL OPENS ON A MARK RATHER THAN ON A HEADING, which is what
      // a broadside does: between the wall and the first line of the issue is
      // the fleuron rule, the printer signing the sheet.
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
