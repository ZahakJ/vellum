// THE SIGNATURE COLLECTION, STUDIO C — THE LETTERS.
//
// The press (studio A) argued that type is a machine for publishing. The
// gallery (studio B) argued that a picture is a unit of layout. This studio
// argues the thing both of them assume and neither says out loud: THAT A PAGE
// IS A MADE OBJECT, and that the object is older than the publication.
//
// A sheet pulled on a hand press, a table of the sky kept by a station, a
// gilded leaf out of a codex, and one column of writing in somebody's own hand.
// Four houses whose common ancestor is not a newspaper or a magazine but a
// LETTER — a thing written down, once, on a surface somebody chose on purpose —
// and the reason they are one shelf is that all four had to answer a question
// the other two studios could take for granted: WHAT IS THIS PAGE MADE OF?
//
// The engine had one answer to that for four years, and the answer was "the
// browser's ground". Nothing was printed on anything. So the four below take
// the four surfaces the engine grew, one each, and each of them is the design's
// whole first sentence rather than a texture applied to it:
//
//   · GROUND     paper · grid · ruled · flat
//   · MASTHEAD   rule · inline · banner · stackedStart
//   · END        colophon · columns · grand · colophon
//   · MENU       plain · underline · pills · NONE AT ALL
//   · RUN        index · ledger · index · numbered
//   · CARD       bare, no art · overlay+art · bare+art · —
//   · OPENING    — · panel · — · —
//   · MEASURE    900 · 1280 · 880 · 640 px
//   · FACE       eb-garamond/crimson-pro · ibm-plex-sans/jetbrains-mono ·
//                lora/source-serif-4 · literata (one face)
//
// FOUR GROUNDS, FOUR MASTHEADS, FOUR MENUS AND FOUR RUNS OF WRITING, and the
// widths run from the narrowest page in the signature collection to nearly the
// widest. The END is the one row with a repeat, and it is arithmetic rather than
// laziness: there are three footer forms and four designs, so one form is used
// twice on every studio's shelf (the press and the gallery both doubled up on
// `columns`). This shelf doubles up on the COLOPHON, which is the right one to
// repeat here — a printer's imprint and a person's signature are the same
// gesture at two volumes, and they sit at the foot of two pages a reader will
// never have on screen at once. Every other row is four different answers.
// `check-presets` reports shape collisions and there is not one inside this
// file, against the press, or against the gallery.
//
// A NOTE ON THE RIVER, WHICH NOTHING IN THIS COLLECTION USES. The first cut of
// this shelf gave Salon one, on the argument that a river is the correct
// setting for eight essays on a hand-pressed sheet and that refusing it merely
// because it used to be compulsory would be composing against the old engine.
// It was a good argument and the screenshot refuted it: with the masthead
// cropped off, the page was the stock river with excerpts — the exact shape the
// other eleven were written to kill — and no reader was ever going to give the
// argument the benefit of the doubt. Salon is a broadside now. Twelve
// signature templates, and not one of them lists its writing the way all
// fifty-nine of the older ones do; that is either the point of the release or
// there was no release.
//
// AND A NOTE ON WHICH SCRIPT A DESIGN SPEAKS FOR. A design names a face and the
// face becomes the half of the composite its coverage says it is: name Amiri
// and you have decided the ARABIC half, with the instance's own prose slot
// still answering for Latin. All four below name LATIN faces, which is a
// decision and not an oversight — a preset applied by a stranger does not get
// to overrule an Arabic vault's naskh, and the one design here that most wants
// a particular Arabic face (Illumination) says so in its own comment and leaves
// the slot to its owner. The rule is DESIGN.md's: a design decides one script
// and inherits the other.
//
// THE HOUSE RULES OF THE OTHER SHELVES HOLD, all of them. Every word on these
// pages is the owner's (`heading`, `sub`, `body`, `copyright` are empty and the
// renderers know what empty means); nothing here names a note, a tag or an
// image; each names one built-in theme. Second homes — Salon on `linen`,
// Ephemeris on `nocturne`, Illumination on `porphyry`, Longhand on `palimpsest`
// — ride in `tags`, where the gallery's search box finds them, and NOT in
// `Preset.themes`, which is the envelope's custom-theme payload (`{ base,
// tokens }` records) and would ship a malformed theme to every install if a
// bare string were put in it.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/**
 * SALON — the letterpress room, and the one design in the collection that is
 * about the SHEET rather than about the publication.
 *
 * `surface: "paper"` is the first sentence and the whole argument: laid tooth
 * drawn as three hatchings at co-prime periods, on `porcelain`, which is the
 * whitest ground this product owns. Letterpress is the one printing method
 * whose evidence is physical — the bite of the type into a damp sheet — and a
 * page with no tooth at all is offset. It is a whisper (the measurements are in
 * design.css) and it is the reason this design needs no decoration anywhere
 * else.
 *
 * THE MASTHEAD IS A FORME, and `rule` was written for a newspaper and turns out
 * to belong here at least as much. A rule is a strip of brass a compositor
 * locks into the forme above and below a title, and a hairline over the
 * wordmark with a hairline under it and the menu centred between them is a
 * title page rather than a front page — the difference is entirely the type
 * inside it, which is why the press's own broadsheet wears the same masthead at
 * 700 weight in tracked uppercase and this one wears it at 400.
 *
 * EB Garamond over Crimson Pro at 400 on a 1.196 scale: a Renaissance face for
 * the headings and a Renaissance face underneath it, both light, with barely a
 * step between an h1 and the paragraph below. A fine press owns one cabinet of
 * type and sets everything from it, and the two faces here are as close to that
 * as a catalogue of twenty-seven allows. `rhythm: 1.5` is the second half of
 * that decision — as much air as any design in the catalog takes — because the
 * one thing a hand-pressed page has that a web page never does is MARGIN.
 *
 * THE PAGE IS A BROADSIDE, AND THE FIRST CUT WAS A RIVER. That cut argued that
 * a river is the correct setting for eight essays on a hand-pressed sheet and
 * that refusing it would be composing against the old engine. Shot, the
 * argument came apart: take the rule masthead off and what was left was the
 * stock river with excerpts — the exact universal shape the other eleven were
 * written to kill — and it was the third pale quiet serif column on a shelf
 * that already had two. A river was not what this design wanted. It was what
 * every design used to get.
 *
 * A broadside is what a press actually pulls: ONE SHEET, set in COLUMNS, no
 * pictures, no boxes. `card: "bare"` deletes the border, the radius and the
 * raised ground; `showBanner: false` deletes the picture, which a letterpress
 * sheet has never had; and six entries two across a 900px page is two columns
 * of type on paper and nothing else — which cannot be mistaken for a river,
 * for a card grid, or for either of its neighbours on this shelf. (Klaxon
 * sets bare cards without pictures too, three across 1400px at 800 weight in
 * uppercase on graph paper. A poster and a broadside are both one sheet of
 * type. They are not the same sheet.)
 *
 * Under it the ORNAMENT — the reading view's own ✦ — and then the SHELF: an
 * `index` of sixteen, title, a leader of dots, the date. The first cut refused
 * one on the grounds that a salon shows you what is being read this season and
 * does not hand you the list; what the shot showed is that a fine press has
 * always printed both, and the leader is a printer's device rather than a
 * catalogue's. Then the subjects, and then a COLOPHON: one centred small-caps
 * block set the way the last page of a book is set, naming who made it. A
 * letterpress page ends in a colophon. That is what a colophon is.
 *
 * The article page takes the DROP CAP and refuses the banner: an initial in the
 * heading face on a paragraph with nothing above it but its own title is the
 * oldest gesture in this whole collection, and it turns itself off in an Arabic
 * paragraph for the reason written beside it in design.css.
 */
const salon: Preset = {
  id: "salon",
  name: { en: "Salon", ar: "المجلس" },
  blurb: {
    en: "For a few things read closely, on the best paper in the house.",
    ar: "لأشياء قليلة تُقرأ بتمهّل، على أجود ورقٍ في البيت.",
  },
  family: "signature",
  tags: [
    "letterpress", "paper", "colophon", "dropcap", "river", "rule", "salon",
    "quiet", "serif", "fine", "press", "porcelain", "linen", "parchment",
  ],
  design: design({
    theme: "porcelain",
    // 900 RATHER THAN 720, because a broadside is a sheet and a sheet has two
    // columns on it. At 720 the two tracks were 340px each, which is a column
    // of four-word lines; at 900 they are 430, which is a column. The article
    // page does not move — its measure is 68 characters wherever the front page
    // sets its width — so the finest reading page in the collection is the page
    // it was.
    site: { width: 900, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 19,
        // NEARLY NO STEP AT ALL, and for the opposite of the plate book's
        // reason. Gravure flattens its scale so that nothing is an event;
        // this flattens it because a hand press sets a page from ONE cabinet
        // of type, and the difference between a heading and a paragraph in a
        // finely printed book is two sizes and a lot of air rather than a
        // shout. 1.196 on a 19px body puts an h1 at 32px.
        scale: 1.196,
        measure: 68,
        lineHeight: 1.8,
        headingWeight: 400,
        headingCase: "normal",
        // A whisper, on a face that does not need it: Garamond's own fit is
        // right and this is the amount a compositor adds by putting a hair
        // space in, not the amount a designer adds by dragging a slider.
        tracking: 0.01,
        headingFamily: "serif",
        bodyFamily: "serif",
        headingFont: "eb-garamond",
        bodyFont: "crimson-pro",
        // AS MUCH AIR AS THE CONTROL ALLOWS ANYBODY (1.6 is the ceiling and
        // `passepartout` is the only other design at 1.5). Everything else on
        // this page is a subtraction; the margin is the one thing being spent.
        rhythm: 1.5,
      },
      // NO HAIRLINE UNDER THE HEADER, because the rule masthead's own lower
      // rule already answers and three rules inside 120px is a fence. The
      // switch is out of play for this layout by design (see design.css); it
      // is written out so the intent is on the page rather than implied by an
      // omission.
      // REGULAR RATHER THAN TALL, and a screenshot decided it. `tall` on a
      // design already carrying `rhythm: 1.5` compounds: the first shot at 1440
      // put 145px of nothing above the wordmark and 115px below it, so the two
      // rules were 320px apart with a name and a line in the middle and the
      // reading began below the fold. The forme is still the biggest thing on
      // the page at `regular`; it is no longer the only thing on the screen.
      header: { layout: "rule", density: "regular", sticky: "none", showTagline: true, divider: false },
      nav: { style: "plain", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "colophon", align: "center", showRss: true, showSearchHint: false },
      surface: "paper",
    }),
    sections: [
      // SIX, IN TWO COLUMNS, WITH THEIR OPENING LINES AND NO PICTURES. The
      // sheet. `showBanner: false` is the setting that makes it a broadside
      // rather than a portfolio: a hand press sets type and prints it, and a
      // photograph on a letterpress page is a photograph somebody pasted on
      // afterwards.
      { id: "sheet", kind: "postGrid", heading: "", limit: 6, columns: 2, tag: "", showExcerpt: true, showBanner: false, showDate: true, card: "bare" },
      { id: "mark", kind: "divider", style: "ornament", space: 44 },
      // THE SHELF, sixteen against the sheet's six — past the catalog's
      // index ≥ 2 × feature bar, because a list that repeated most of the sheet
      // would be a second sheet.
      { id: "shelf", kind: "postList", heading: "", limit: 16, tag: "", showExcerpt: false, showDate: true, layout: "index" },
      { id: "subjects", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
    // No photograph at the head of the writing: a fine-press page opens on its
    // title and its initial, and a banner strip above them is a magazine.
    article: {
      showBanner: false,
      showMeta: true,
      showTags: true,
      showRelated: true,
      showBackLink: true,
      dropCap: true,
    },
  }),
};

/**
 * EPHEMERIS — the observing station, and the only design in this studio whose
 * body copy is not set in a book face at all.
 *
 * An ephemeris is a table of where things were, and when, kept nightly by
 * somebody whose job is to write down what they saw. So the page is a LOG that
 * happens to have plates in it, and every decision below follows from that
 * sentence rather than from "space".
 *
 * THE GROUND IS A COORDINATE GRID. `surface: "grid"` is graph paper on the
 * press's poster and a plate-measuring grid here, on `sidereal`, which is the
 * one room in the building whose ground is genuinely a night sky — the same
 * primitive, at the same whisper, doing a completely different job because the
 * room around it changed. (An owner who turns on the instance's AMBIENT
 * masthead gets the drift behind the identity as well; it is an instance
 * setting rather than a design field, deliberately, and this is the design it
 * was made for.)
 *
 * THE HEADINGS ARE ENGRAVED AND THE PROSE IS TYPED. IBM Plex Sans at 500 in
 * uppercase on 0.075em of tracking is an instrument label; JetBrains Mono
 * underneath it — reached through `monoFont`, because `bodyFamily: "mono"`
 * resolves through the design's mono face — is the log itself. It is the
 * inverse of every design on the other two shelves: the press's console set
 * EVERYTHING in one monospace, and this sets only the writing in one, so the
 * plates are labelled by the institution and the entries are kept by a person.
 *
 * `card: "overlay"` for the six plates, three across a 1280px page: a title on
 * a scrim over the picture, which on a dark room is not a stripe across a
 * photograph but the room itself. Under them the LEDGER — the date hanging in
 * a fixed column of its own with a hairline under every row, twenty deep. A
 * ledger is the shape an observing log has always had, and this is the only
 * design in the collection where the layout and the thing it is imitating are
 * the same object.
 *
 * The masthead is `inline` and STICKY AT THE WHOLE BLOCK, which nothing else in
 * the collection does: a station's bar stays across the top while the sky
 * scrolls under it. Its tagline is off, so the tagline appears exactly once —
 * in the opening, at size — and the name is small at the reading start, which
 * the eye files as chrome. The opening is the `panel`, the treatment both other
 * studios passed over: the rounded plate with the generated artwork behind it,
 * which on `sidereal` is a field of the theme's own accent hues and reads as a
 * survey exposure rather than as a missing photograph.
 */
const ephemeris: Preset = {
  id: "ephemeris",
  name: { en: "Ephemeris", ar: "الزيج" },
  blurb: {
    en: "For a log kept at night: plates in the dark, and the ambient sky behind them.",
    ar: "لسجلٍّ يُكتب ليلًا: صورٌ في العتمة، وسماءٌ متحرّكة خلفها.",
  },
  family: "signature",
  tags: [
    "observatory", "astronomy", "log", "ledger", "overlay", "grid", "mono",
    "ambient", "night", "station", "dark", "sidereal", "nocturne", "void",
  ],
  design: design({
    theme: "sidereal",
    site: { width: 1280, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 15.5,
        scale: 1.212,
        measure: 74,
        // A monospaced line is short and its glyphs are already spaced, so it
        // wants less leading than a serif at the same size — but this is a
        // log somebody reads rather than a terminal somebody scans, so it sits
        // a long way above the console's 1.25 and well below the salon's 1.8.
        lineHeight: 1.55,
        headingWeight: 500,
        headingCase: "uppercase",
        // An instrument label's spacing. At 500 in uppercase this is what
        // separates a designation from a headline that happens to be small.
        tracking: 0.075,
        headingFamily: "sans",
        // MONO, AND NAMED ONCE. `bodyFamily: "mono"` with no `bodyFont` of its
        // own resolves through `monoFont` (see typographyVars), so this single
        // id sets the excerpts, the ledger's rows and the code inside the
        // author's prose in the same face.
        bodyFamily: "mono",
        headingFont: "ibm-plex-sans",
        monoFont: "jetbrains-mono",
        rhythm: 1.1,
      },
      // STICKY AT THE HEADER RATHER THAN AT THE NAV, which nothing else in the
      // collection does: the whole bar stays across the top while the sky
      // scrolls under it, which is what an instrument panel is.
      header: {
        layout: "inline",
        density: "regular",
        sticky: "header",
        showTagline: false,
        divider: true,
      },
      nav: { style: "underline", fallback: "topics", showSearch: true, showThemeToggle: true },
      // CENTRED, for the reason the gallery's private view recorded: the foot
      // takes a flat 24px gutter and no measure of its own, so on a 1280px page
      // in a 1440px window `align: "start"` hangs the meta row 56px outside the
      // column everything above it lines up with.
      footer: { form: "columns", align: "center", showRss: true, showSearchHint: true },
      surface: "grid",
    }),
    sections: [
      // THE PANEL, which is the one opening neither other studio took. A band
      // refuses to invent artwork and a split sets it beside the words; a panel
      // puts the generated field BEHIND them, and on a night-sky room a field
      // of the theme's own hues is an exposure rather than an apology for a
      // missing photograph.
      { id: "plate", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "tall", treatment: "panel" },
      { id: "survey", kind: "postGrid", heading: "", limit: 6, columns: 3, tag: "", showExcerpt: false, showBanner: true, showDate: true, card: "overlay" },
      { id: "rule", kind: "divider", style: "rule", space: 26 },
      // THE LOG, and it is twenty rows against the survey's six for the
      // catalog's own reason (an index must add at least as much as it
      // repeats) and for a better one: a station's plates are the exceptional
      // nights and the log is every night.
      // WITH ITS ONE LINE, which is the only place on this page the design's
      // own prose face appears in quantity — and it costs nothing, because the
      // overlay cards above refuse an excerpt by construction. So there is no
      // stutter to trade against: the plates carry the pictures and the log
      // carries the writing, which is what a log is. A ledger row's excerpt is
      // a single truncated line in the title's column (see design.css), so
      // twenty of them stay a run somebody scans rather than a run they read.
      { id: "log", kind: "postList", heading: "", limit: 20, tag: "", showExcerpt: true, showDate: true, layout: "ledger" },
      { id: "objects", kind: "topics", heading: "", limit: 14 },
    ] as Section[],
    // The plate travels with the entry: a log's page IS its exposure.
    article: { showBanner: true, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/**
 * ILLUMINATION — the deluxe manuscript, and the flagship of this product's own
 * identity. It is the one design in the seventy-one that is trying to look like
 * the thing the software is named after.
 *
 * `iron-gall` is the room: the default dark theme, named for the ink that ate
 * its way through eight hundred years of European and Islamic manuscripts, and
 * the ground every other decision here is made against. On it:
 *
 * THE HEADPIECE. `header.layout: "banner"` is a full-width field of
 * `--bg-raised` behind the identity — and a decorated band across the top of a
 * page, holding the title, with the text beginning underneath it, is a
 * ʿunwān: the headpiece of an illuminated manuscript. The press's poster wears
 * the same masthead as an industrial bar and the gallery's private view wears
 * it as an entrance wall. Here it is gilding. `tall`, no hairline under it (the
 * field's own edge is the rule), and the menu inside it takes PILLS, which are
 * a control panel at the top of an app and RUBRICS here — the coloured ground
 * behind a heading that tells a reader which part of the book they are in.
 *
 * THE PAGE IS RULED. Every manuscript page was ruled before it was written on:
 * a scribe pricked the margins and drew the lines, and the writing sat on them.
 * `surface: "ruled"` draws faint baselines at the design's OWN line height,
 * which means the rules on this page are the rules this page's text is set to —
 * the same primitive that lands as scan lines under the console's 1.25 mono and
 * as a paste-up sheet under the magazine's 1.6.
 *
 * SMALL CAPS AT 600 ON A 60-CHARACTER MEASURE, which is the narrowest column in
 * this studio, in Lora over Source Serif 4 — a face with enough weight in its
 * strokes to read as written rather than as set, over a quieter one for the
 * body. Two ORNAMENT dividers break the page, because a manuscript's sections
 * are separated by a mark and never by a hairline, and the article page takes
 * the DROP CAP, which is the whole gesture this feature was built for.
 *
 * THE RUN IS A TABLE OF CONTENTS. Four openings across the top as `bare` cards
 * — picture, title, words, no box, because a miniature in a codex is not in a
 * frame — and then the `index`: eighteen titles with a dotted leader running
 * out to the date. The press's console uses the same layout as a directory
 * listing. Here it is the fihrist at the front of the book, and the two do not
 * read as cousins for a second.
 *
 * The end of the page is `grand`: the site's own name at display size across
 * the foot with the entries run together beneath it. A deluxe manuscript signs
 * itself at the end, at size, in the largest letters in the book.
 *
 * ON THE ARABIC HALF. This is the design that most wants a particular naskh
 * face, and it deliberately does not name one. A preset applied by a stranger
 * does not get to overrule an Arabic vault's own type; the instance's `arabic`
 * font slot dresses this page's other script, and an owner who wants Amiri or
 * Aref Ruqaa under these rules sets it once, for their whole site, where that
 * decision belongs.
 */
const illumination: Preset = {
  id: "illumination",
  name: { en: "Illumination", ar: "التذهيب" },
  blurb: {
    en: "For work made to be kept: ruled pages, a mark between the parts, a gilded end.",
    ar: "لعملٍ يُصنع ليبقى: صفحاتٌ مسطّرة، وعلامةٌ بين الأقسام، وخِتامٌ مُذهَّب.",
  },
  family: "signature",
  tags: [
    "manuscript", "codex", "illuminated", "ruled", "ornament", "smallcaps",
    "dropcap", "banner", "index", "gilded", "iron-gall", "porphyry", "sumi",
  ],
  design: design({
    theme: "iron-gall",
    site: { width: 880, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        // THE WIDEST STEP IN THIS STUDIO, against the salon's flattest. A
        // manuscript's hierarchy is not subtle — a chapter opening is four
        // times the size of the text under it and half of it is gold — and
        // 1.34 on 17.5px puts an h1 at 42px over the body.
        scale: 1.34,
        measure: 60,
        lineHeight: 1.7,
        headingWeight: 600,
        headingCase: "smallcaps",
        tracking: 0.03,
        headingFamily: "serif",
        bodyFamily: "serif",
        headingFont: "lora",
        bodyFont: "source-serif-4",
        rhythm: 1.2,
      },
      header: { layout: "banner", density: "tall", sticky: "none", showTagline: true, divider: false },
      nav: { style: "pills", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "grand", align: "center", showRss: true, showSearchHint: false },
      surface: "ruled",
    }),
    sections: [
      // FOUR MINIATURES, UNBOXED. `bare` deletes the border, the radius and the
      // raised ground, so the picture and the words stand on the ruled page —
      // which is where an illumination stands. Two across an 880px column, with
      // their opening lines, because four openings are the front of the book.
      { id: "openings", kind: "postGrid", heading: "", limit: 4, columns: 2, tag: "", showExcerpt: true, showBanner: true, showDate: true, card: "bare" },
      { id: "mark-a", kind: "divider", style: "ornament", space: 40 },
      // THE FIHRIST. Eighteen against the openings' four — far past the
      // catalog's index ≥ 2 × feature bar, and it needs to be: a table of
      // contents that listed six things would be a second feature.
      { id: "contents", kind: "postList", heading: "", limit: 18, tag: "", showExcerpt: false, showDate: true, layout: "index" },
      { id: "mark-b", kind: "divider", style: "ornament", space: 40 },
      { id: "subjects", kind: "topics", heading: "", limit: 16 },
    ] as Section[],
    article: {
      showBanner: true,
      showMeta: true,
      showTags: true,
      showRelated: true,
      showBackLink: true,
      dropCap: true,
    },
  }),
};

/**
 * LONGHAND — the essayist, and the design this whole collection is a rebuke to
 * until you read it twice.
 *
 * Eleven signature templates argue with a shout: a rule masthead, a scrim, a
 * headpiece, graph paper, brackets, gold. This one has NO ground (`flat`), NO
 * menu at all, NO pictures, NO second section, NO ornament, and the plainest
 * masthead in the set — the name flushed to the reading edge at `compact` with
 * one line under it. Everything a design can decline, it declines. What is left
 * is a numbered column of writing on the narrowest page in the collection, and
 * that is the entire site.
 *
 * THE MENU IS GONE, and for one round it looked exactly like the bug somebody
 * was always going to call it. `fallback: "none"` with no items means
 * `DesignNav` renders nothing — but the BAR was still drawn: an empty
 * hundred-and-forty-pixel band with its hairline, its 1100px row and the search
 * box marooned at the far end of it, which is not a refusal, it is a menu that
 * failed to load. A bar with no links is not a bar. It is not rendered at all
 * now (DesignHeader), and the search box and the theme switch — which belong to
 * the instance rather than to the menu — come back into the masthead and sit
 * under the name on the name's own alignment, where a nameplate's furniture
 * goes.
 *
 * What is left is the argument: a site with fourteen essays on its front page
 * does not need a navigation, it needs somebody to start reading. Search stays
 * on because a reader looking for a particular piece has to be able to find it,
 * and it is the one control that gets smaller the more writing there is rather
 * than larger.
 *
 * `numbered` is the only furniture on the page: an oversized faint ordinal
 * hanging beside every entry in the design's own heading face, counting down
 * the reading edge. The press's offprint counts because a journal issue has a
 * contents; the zine counts because it is counting what it crammed in; this
 * counts because THE ORDER IS THE POINT — an essayist's fourteenth piece is
 * the fourteenth thing they thought, and the numeral is the only mark on this
 * page that is not a word.
 *
 * ONE FACE, ONE WEIGHT, ONE CASE. Literata at 400 on a 1.164 scale — the face
 * that was drawn for reading long-form on a screen, doing all three jobs, with
 * an h1 that stands 30px against a 19px paragraph and no other event on the
 * page. `lineHeight: 1.85` is a step off the ceiling and `rhythm: 1.4` is most
 * of the way to the salon's: this is a page made almost entirely of vertical
 * space, and the discipline is that the measure never moves — 68 characters, on
 * a 640px column, at every width down to the phone.
 *
 * `tallow` because the whole thing is one candle's worth of light on a page,
 * and the essay is what is under it. `palimpsest` is the other answer — the
 * same design in daylight — and it is in the tags. The end is a COLOPHON with
 * everything switched off but the line the instance already writes: a person's
 * site signs itself once, quietly, and stops.
 */
const longhand: Preset = {
  id: "longhand",
  name: { en: "Longhand", ar: "بخطّ اليد" },
  blurb: {
    en: "For one person writing at length, with nothing on the page to interrupt it.",
    ar: "لشخصٍ واحد يكتب مطوّلًا، ولا شيء على الصفحة يقاطعه.",
  },
  family: "signature",
  tags: [
    "essay", "essayist", "quiet", "restraint", "numbered", "colophon", "narrow",
    "one-column", "reading", "longform", "tallow", "palimpsest", "parchment",
  ],
  design: design({
    // THE NARROWEST PAGE IN THE SIGNATURE COLLECTION, at `roomy`. (Three of the
    // older shelves go narrower still — `measure` sets 560 — which is the point:
    // restraint was always reachable, and what was not was restraint that still
    // had a VOICE.) The width and the density are not in tension:
    // density sets the space BETWEEN blocks and the width sets the column, and a
    // narrow column with a great deal of air above and below it is what a book
    // of essays looks like.
    theme: "tallow",
    site: { width: 640, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 19,
        // Nearly flat, at 400, in one face: an h1 of 30px over a 19px body.
        // The plate book flattens its scale so the captions never shout and the
        // salon flattens its because a press owns one cabinet; this flattens
        // it because an essay has no headlines in it at all.
        scale: 1.164,
        measure: 68,
        lineHeight: 1.85,
        headingWeight: 400,
        headingCase: "normal",
        tracking: 0,
        headingFamily: "serif",
        bodyFamily: "serif",
        headingFont: "literata",
        bodyFont: "literata",
        rhythm: 1.4,
      },
      header: {
        layout: "stackedStart",
        density: "compact",
        sticky: "none",
        showTagline: true,
        divider: false,
      },
      // NO MENU. `fallback: "none"` and no items means there is no bar at all —
      // see the note above, DesignNav (which renders null rather than an empty
      // run) and DesignHeader (which no longer draws a band around it).
      nav: { style: "plain", fallback: "none", showSearch: true, showThemeToggle: true },
      footer: {
        form: "colophon",
        align: "center",
        showRss: true,
        showSearchHint: false,
        showPoweredBy: false,
      },
      surface: "flat",
    }),
    sections: [
      // ONE SECTION. Not one post section — ONE SECTION, which no other design
      // in the signature collection is, and which five of the quiet older
      // shelves are. There is no divider because there is nothing to divide, and
      // no topics run because a chip is a filter and this page does not have
      // enough on it to need filtering.
      { id: "essays", kind: "postList", heading: "", limit: 14, tag: "", showExcerpt: true, showDate: true, layout: "numbered" },
    ] as Section[],
    // NO BANNER AND NO RELATED RUN. An essay opens on its title and ends when it
    // ends; a strip of "you might also like" underneath is a magazine trying to
    // keep you, and this design's entire argument is that it is not trying to
    // keep you. The back link stays, because leaving must be one press.
    article: {
      showBanner: false,
      showMeta: true,
      showTags: true,
      showRelated: false,
      showBackLink: true,
    },
  }),
};

export const SIGNATURE_C_PRESETS: readonly Preset[] = [salon, ephemeris, illumination, longhand];
