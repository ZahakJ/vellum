// THE SIGNATURE COLLECTION, STUDIO B — THE GALLERY.
//
// The press (studio A) argued that type is a machine for publishing. This
// studio argues the other half of the same trade: THAT A PICTURE IS A UNIT OF
// LAYOUT AND NOT A DECORATION ON ONE. Four houses built by people whose work is
// looked at before it is read — a studio hanging its own objects, a book of
// photographic plates, a stapled zine, and a magazine that comes out in issues
// — and the reason they are one shelf is that all four had to answer a question
// no design on the old shelves could ask: WHERE DOES THE IMAGE GO?
//
// The engine had exactly one answer for four years. A post was a bordered tile
// with a 128px strip of picture cropped across its top, and a photographer's
// site and a documentation site drew the same tile at different font sizes. So
// the four below take the four other answers, one each, and they take them all
// the way:
//
//   · CARD       overlay×2 · masonry×3 · overlay×3 · overlay×1 + bare×2
//   · MASTHEAD   banner · stackedStart · stacked · rule
//   · GROUND     flat · tinted · paper · ruled
//   · END        columns · grand · colophon · columns
//   · MENU       plain · underline · brackets · pills
//   · OPENING    — · band · — · —
//   · RUN        index · — · numbered · —
//   · MEASURE    1180 · 1360 · 940 · 1120 px
//   · FACE       eb-garamond/source-sans-3 · inter (one face) ·
//                fira-code/lora · work-sans/literata
//
// FOUR DIFFERENT GROUNDS, FOUR DIFFERENT MASTHEADS AND FOUR DIFFERENT MENUS,
// and the CARD row is the one that repeats — deliberately, and only after two
// rounds of screenshots said so. The private view, the zine and the feature
// desk all put the words ON the picture, because that is what a wall, a
// photocopied sheet and a cover have in common and it is nothing at all like a
// bordered tile; what separates them is the COUNT, which is what a 200px card
// actually resolves. Two plates at 590px in a dark room is a hang. Eight at
// 290px on lilac laid paper is a contact sheet somebody cut up. ONE at 1120px
// with the headline set across it at forty pixels is a cover, and the engine
// draws it as one (design.css: an overlay with nobody beside it is not a card).
// `check-presets` reports shape collisions and there is not one inside this
// file or against the press.
//
// A NOTE ON WHERE THE PICTURES COME FROM, because it decided all four
// arrangements AND, after two rounds of screenshots, two rules in the engine. A
// preset may not name an image — a shipped design cannot know what is in a
// stranger's vault — so every photograph on these pages is the author's own
// post banner. That is why NONE of these four opens on a hero at all: all four
// open on the work itself.
//
// WHERE A POST HAS NO BANNER, THE TWO PICTURE-SHAPED CARDS NOW PRINT TYPE
// RATHER THAN INVENTING A PICTURE. The generated field is a good answer for a
// 128px strip above a title and a bad one at plate size: five synthetic
// gradients among nineteen photographs is the first thing a reader's eye lands
// on in a monograph, and two saturated tiles in a hang of eight is a gallery
// exhibiting work it does not have. So `masonry` prints a LEAF — a hairline,
// air, the title at h2 — and `overlay` prints a LABEL, and both are what the
// object they are imitating actually does with a gap. The three other card
// shapes still generate, still on the operator's own toggle. The split hero
// takes the other road entirely: it borrows the newest post's photograph,
// because a cover shows the cover story.
//
// AND A NOTE ON THE NAME PRINTED TWICE, which cost this studio two rounds of
// screenshots and in the end cost it a hero. A hero with an empty heading falls
// back to the site's NAME, and so does every masthead — `showName` is forced
// back on when there is no logo to stand in for it (DesignHeader: "never an
// empty identity") — so a design with a hero prints one word twice however the
// switches are set. The first cut of Cover Story wore a centred `stacked` plate
// over a split hero and drew "Hollow Green" at 38px and again at 33px, 250px
// apart, which reads as a bug. The second cut made the masthead a thin `inline`
// utility row so the hero would be the only place anything was announced — and
// what came back was worse in a quieter way: a fold whose text half held the
// site's name, its tagline, and nothing else, because there is nothing else a
// preset is allowed to put there.
//
// The rule the two reshoots produced, and it is stronger than the one they
// started with: A PRESET'S HERO SAYS THE NAME OR IT SAYS NOTHING, so a design
// that wants its front page to say something ELSE does not open on a hero.
// Three of these four open on the work; the fourth opens on a half-title,
// because a half-title IS the name and a plate book is the one house where
// printing it large is the whole gesture (Gravure, `band`, 33px, its masthead
// deliberately reduced to a running head). The two with loud mastheads
// (Vernissage's banner field, Mimeo's centred nameplate) and the one with a
// nameplate between rules (Cover Story) have no hero at all, and all three are
// better for it: a gallery, a zine and a magazine open on the work, not on an
// introduction.
//
// THE HOUSE RULES OF THE OTHER SHELVES HOLD, all of them. Every word on these
// pages is the owner's; nothing here names a note, a tag or an image; each
// names one built-in theme. Second homes — Vernissage on `void`, Gravure on
// `linen`, Mimeo on `cinnabar`, Cover Story on `nocturne` — ride in `tags`,
// where the gallery's search box finds them, and NOT in `Preset.themes`, which
// is the envelope's custom-theme payload (`{ base, tokens }` records) and would
// ship a malformed theme to every install if a bare string were put in it.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/**
 * VERNISSAGE — the private view, and the design that finally lets a picture be
 * the whole card instead of a strip above one.
 *
 * `card: "overlay"` is the entire argument: the title sits on a scrim over the
 * photograph, so a row of work is a row of WORK rather than a row of tiles with
 * pictures in them. Six of them, two across a 1180px page at `roomy` density
 * — a gallery's spacing rule is that the wall between two pieces is part of the
 * hang — and NO excerpt anywhere on the page, because the renderer refuses one
 * on an overlay for the same reason a wall label is not a review.
 *
 * A PLATE IS 5:4 AND IT WAS 3:1, which was the difference between a hang and a
 * row of banners. The overlay card had a HEIGHT (190px) where it needed a
 * PROPORTION: two across this page came out 770 wide and 255 tall, so every
 * photograph in the vault was cropped to a letterbox and the design that exists
 * to give a picture the whole card gave it a strip. It is a proportion now
 * (design.css), so the plates on this wall are 590×472 and they take the wall.
 *
 * AND THE HANG IS ONLY THE HANG. Under it is the CHECKLIST — an `index` run,
 * eighteen deep: title, a leader of dots, the date, and nothing else. Every
 * gallery in the world prints one, on a sheet by the door, listing everything
 * in the room including what is in the racks; a front page that is six
 * pictures and no list is a room with no checklist and a website that stops.
 * The press's console uses the same layout as a directory listing and the
 * manuscript uses it as a fihrist. Here it is a wall list, and the three do not
 * read as cousins for a moment.
 *
 * The masthead is a BANNER: a field of `--bg-raised` running the full width of
 * the window behind the name and the tagline, which is the entrance wall a
 * gallery paints its name on and the only masthead in the engine that is a
 * ground rather than type on the page. It is `tall`, its own `divider` is off,
 * and NOTHING follows it but the work: no hero, no heading, no introduction.
 * You walk in and it is there. (The field draws its own closing hairline now,
 * in `--border`, and that is the engine's decision rather than this design's:
 * "the field's own edge is the rule" was true on `porcelain` and false in this
 * room — `--bg-raised` and `--bg` are a couple of values apart on `sumi`, so
 * the one masthead that is a ground was, in the dark, no masthead at all.)
 *
 * WHERE THERE IS NO PHOTOGRAPH THERE IS A LABEL. An overlay used to insist on
 * artwork and invent it where a post had none, which on this page printed two
 * saturated synthetic tiles into a hang of eight — a gallery exhibiting work it
 * does not have. It takes no artwork now: the card keeps its 5:4 proportion,
 * drops the scrim (a fixed dark gradient exists to sit on an unpredictable
 * photograph, and over the theme's own ground it is a black stripe), and sets
 * the title centred in the field on the room's own tokens. That is a WALL
 * LABEL, which is the honest thing to hang where a picture is missing.
 *
 * EB Garamond at 500 over Source Sans 3 — a Renaissance book face used at
 * display size for the titles and a plain grotesque for everything that is not
 * a title, which is how a contemporary gallery sets a catalogue and the exact
 * inverse of the sans-display-over-serif-body pairing every magazine uses. The
 * run ends on the ORNAMENT, the reading view's own ✦ rule, because a hang ends
 * with a mark and not with a hairline.
 *
 * `sumi` because a dark room is what makes a photograph a photograph, and
 * because the scrim idiom the overlay card is drawn with is tuned for light
 * type — on ink it is not a stripe across the picture, it is the room. `void`
 * and `porcelain` are the other two answers and are in the tags.
 */
const vernissage: Preset = {
  id: "vernissage",
  name: { en: "Vernissage", ar: "الافتتاح" },
  blurb: {
    en: "For work that is looked at before it is read: the pictures take the whole wall.",
    ar: "لعملٍ يُنظر إليه قبل أن يُقرأ: الصور تأخذ الجدار كلّه.",
  },
  family: "signature",
  tags: [
    "portfolio", "gallery", "overlay", "banner", "atelier", "studio", "work",
    "images", "exhibition", "dark", "sumi", "void", "porcelain",
  ],
  design: design({
    theme: "sumi",
    site: { width: 1180, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 17,
        scale: 1.3,
        measure: 66,
        lineHeight: 1.7,
        headingWeight: 500,
        headingCase: "normal",
        // A whisper of air, and no more: Garamond's fit is the face's own
        // argument and a catalogue that tracks it out is a catalogue set by
        // somebody who did not trust it.
        tracking: 0.01,
        headingFamily: "serif",
        bodyFamily: "sans",
        headingFont: "eb-garamond",
        bodyFont: "source-sans-3",
        rhythm: 1.35,
      },
      header: { layout: "banner", density: "tall", sticky: "none", showTagline: true, divider: false },
      nav: { style: "plain", fallback: "topics", showSearch: true, showThemeToggle: true },
      // CENTRED, AND THAT WAS A SCREENSHOT'S DECISION. `align: "start"` reads
      // right for an address block and renders wrong here: `.s-dsg-foot` takes
      // a flat 24px gutter and no measure of its own, so on a 1180px page in a
      // 1440px window the copyright line sat 130px outside the column every
      // other thing on the site lines up with. Centred, it hangs under the
      // middle of the hang, which is where a gallery signs its wall anyway.
      footer: { form: "columns", align: "center", showRss: false, showSearchHint: false },
      surface: "flat",
    }),
    sections: [
      { id: "hang", kind: "postGrid", heading: "", limit: 6, columns: 2, tag: "", showExcerpt: false, showBanner: true, showDate: true, card: "overlay" },
      { id: "mark", kind: "divider", style: "ornament", space: 36 },
      // THE CHECKLIST BY THE DOOR. Eighteen against the hang's six, which is
      // past the catalog's index ≥ 2 × feature bar and is the point: a hang is
      // what is on the wall this month and a checklist is everything there is.
      { id: "checklist", kind: "postList", heading: "", limit: 18, tag: "", showExcerpt: false, showDate: true, layout: "index" },
      { id: "rooms", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
    // The article page keeps its banner: a piece of work on this site arrives
    // with its picture, on the front page and on its own page alike.
    article: { showBanner: true, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/**
 * GRAVURE — the plate book, and the one design on either signature shelf whose
 * type is deliberately not worth looking at.
 *
 * `card: "masonry"` is the only card shape that asks a photograph how tall it
 * is. Every other one crops to a 128px strip or to a stated ratio; masonry
 * drops the grid for CSS columns and renders a real `<img>`, so a portrait
 * plate is a portrait plate and the bottoms of the columns rag the way the
 * pages of a plate book do. Eighteen of them, three across a 1360px page —
 * as wide as this engine goes before a measure stops meaning anything, and the
 * widest page on this shelf, because a plate is only as good as the paper around
 * it. Three rather than two was a screenshot's decision: at two the plates ran
 * 660px wide and the wall was seven thousand pixels tall, which is a slideshow
 * rather than a book.
 *
 * EIGHTEEN RATHER THAN TWENTY-FOUR, AND TWO COLUMNS ON A PHONE, which together
 * are one fix for one number. At 390 the wall collapsed to a single column and
 * twenty-four plates became eleven thousand pixels of scrolling — a book nobody
 * reaches the end of. Masonry is now the one card shape that KEEPS two columns
 * on a phone (design.css says why: every other card carries words, and this one
 * carries a picture with a caption under it), and eighteen plates two across is
 * about five thousand. A plate book is long. It is not that long.
 *
 * AND WHERE THERE IS NO PLATE, THERE IS A LEAF. Five of the twenty-four came
 * back as flat synthetic fields, because a masonry card used to invent artwork
 * for a post that had none — which is the right trade for a 128px strip above a
 * title and a fatal one at plate size, since a generated gradient printed
 * beside nineteen photographs is the first thing a reader's eye lands on. It
 * takes no artwork now. What it draws instead is a hairline, a great deal of
 * air, and the title at the design's h2: a printed leaf bound in among the
 * plates, which is what a monograph does with a section title and is a page
 * rather than an apology.
 *
 * THE TYPE IS A CAPTION AND NEVER A HEADLINE, which is one setting doing the
 * work of a whole argument: `scale: 1.132` is nearly FLAT, so an h1 is 22px
 * against a 15.5px body and no heading on the page ever shouts. Inter at 400 in
 * uppercase on 0.1em of tracking is the letterspaced small cap under a plate in
 * a photographic monograph, and it is the ONLY voice here — one face, one
 * weight, one case, everywhere.
 *
 * NEAR-ZERO CHROME, and it is subtraction rather than restraint. The masthead
 * is `stackedStart` at `compact` with no tagline and no hairline: the name
 * flushed to the reading edge in the same 400-weight tracked caps as everything
 * else, which is a running head rather than a nameplate. The opening is a
 * `band`, the one hero treatment that refuses to invent artwork it was not
 * given, so the page begins with a field of toned ground and the photographer's
 * own name centred in it and no picture competing with the plates below — a
 * half-title, then the plates. The end is `grand`: that name a third time, at
 * display size across the foot, which is how a monograph is signed and the only
 * loud thing on the site.
 *
 * THE HALF-TITLE IS AS TALL AS ITS OWN TYPE, and getting there took the band
 * away from the panel's rules. A band inherited the 360px floor a hero takes
 * because a PHOTOGRAPH needs room to be one, and set its title at a floor of
 * 29px whatever the design's scale said — so this design, whose whole argument
 * is a 22px h1, opened on a 360px field of grey with a small caption adrift in
 * the middle of it, which reads as a placeholder somebody forgot to style. A
 * band has no photograph in it: its height is its padding and its type
 * (design.css), it draws a hairline above and below itself because a
 * compositor locks a band in with brass, and its title is the design's OWN h1
 * multiplied by 1.5. Here that is a 33px line between two rules on toned
 * ground, which is a half-title.
 *
 * `tinted` moves the page to `--bg-raised` and the raised blocks on it to
 * `--bg`, so the plates are mounted on toned board rather than lying on white —
 * the difference between a book and a contact sheet.
 *
 * AND IT GIVES EVERY PLATE A CAPTION CARD, which a reader will reasonably wonder
 * whether anybody asked for. A masonry card paints no ground of its own; the
 * tinted swap paints one anyway, because it is written to stop a card being the
 * exact colour of the paper it lies on. So on this ground, and only on this
 * ground, each photograph ends up with a pale strip beneath it holding its title
 * and its date. That is a plate MOUNTED with its caption on the mount, it is the
 * best accident on either signature shelf, and it is written down here so that
 * whoever next narrows the tinted rule knows a design is standing on it.
 *
 * `porcelain` because a plate book is printed on the best paper in the building;
 * `linen` and `sumi` are in the tags.
 */
const gravure: Preset = {
  id: "gravure",
  name: { en: "Gravure", ar: "الطبعة الغائرة" },
  blurb: {
    en: "For a book of plates: nothing on the page but the photographs and their names.",
    ar: "لكتاب لوحات: لا شيء على الصفحة سوى الصور وأسمائها.",
  },
  family: "signature",
  tags: [
    "photography", "plates", "masonry", "monograph", "grand", "quiet", "wide",
    "captions", "book", "images", "porcelain", "linen", "sumi",
  ],
  design: design({
    theme: "porcelain",
    site: { width: 1360, density: "roomy" },
    chrome: chrome({
      typography: {
        baseSize: 15.5,
        // NEARLY FLAT ON PURPOSE. 1.132 puts an h1 at 22px over a 15.5px body,
        // which is a hierarchy a reader can still follow and a page on which
        // nothing typographic is an event. The band hero is the one exception
        // and it is a deliberate one: a band sets the design's own h1 at 1.5×,
        // so the half-title lands at 33px and the site's name is the single
        // piece of display type in the building.
        scale: 1.132,
        measure: 68,
        lineHeight: 1.75,
        headingWeight: 400,
        headingCase: "uppercase",
        // The plate caption's spacing. At 400 weight in uppercase this is what
        // separates a caption from a headline that happens to be small.
        tracking: 0.1,
        headingFamily: "sans",
        bodyFamily: "sans",
        headingFont: "inter",
        bodyFont: "inter",
        rhythm: 1.25,
      },
      header: { layout: "stackedStart", density: "compact", sticky: "nav", showTagline: false, divider: false },
      nav: { style: "underline", fallback: "topics", showSearch: true, showThemeToggle: false },
      footer: { form: "grand", align: "center", showRss: false, showSearchHint: false, showPoweredBy: false },
      surface: "tinted",
    }),
    sections: [
      // CENTRED IN THE BAND, because this one is a TITLE PAGE. Flushed to the
      // start it read as an empty panel with a caption in the corner; centred
      // between the band's two rules it is the half-title a plate book opens
      // on, and the only display type in the building. (`height` is inert on a
      // band — the treatment takes its height from its own type, which is the
      // whole reason it stopped being a grey rectangle — and it is left at
      // `tall` because it is what this opening would be if it ever carried a
      // photograph.)
      { id: "plate", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "tall", treatment: "band" },
      { id: "plates", kind: "postGrid", heading: "", limit: 18, columns: 3, tag: "", showExcerpt: false, showBanner: true, showDate: true, card: "masonry" },
      { id: "air", kind: "divider", style: "blank", space: 40 },
      { id: "subjects", kind: "topics", heading: "", limit: 12 },
    ] as Section[],
    // No related run and no back link on the article page: a plate book is
    // turned page by page, and a strip of "you might also like" under a
    // photograph is a shop rather than a book.
    article: { showBanner: true, showMeta: true, showTags: true, showRelated: false, showBackLink: true },
  }),
};

/**
 * MIMEO — the zine, and the loudest page on this shelf without being the
 * biggest.
 *
 * A zine is not a small magazine. It is a page that was STAPLED rather than
 * published: typed headlines cut out and pasted over photocopied pictures, too
 * much on every sheet, a colophon on the back telling you who made it and how
 * to write to them. Every setting below is one of those four sentences.
 *
 * THE HEADLINES ARE TYPED. `headingFamily: "mono"` with Fira Code over a body
 * of Lora is the pairing this whole collection did not have — a monospaced
 * display face over a serif text face, which is a typewriter over a book and
 * exactly what a cut-and-paste page is made of. It shares the mono stack with
 * the press's console and nothing else: at 700 weight, uppercase, on lilac, at
 * 2.6× the body size, it is a headline that was banged out rather than set.
 *
 * THE SCALE IS THE WILDEST HERE and the base is nearly the smallest: 1.38 on
 * 15.5px puts an h1 at 41px over 15.5px body copy, a ratio no other design on
 * either signature shelf comes near. That gap IS the look — a zine has two type
 * sizes, SHOUTING and small print, and nothing in between.
 *
 * THE HEADLINE IS PASTED OVER THE PICTURE, which is the sentence three
 * paragraphs up and, for one round, was not on the page. The first cut ran
 * `card: "ledger"` — six bordered, rounded, raised tiles in an orderly two-by-
 * three — and what came back was a TIDY page: white cards on lilac, evenly
 * gutted, over an orderly numbered list. A zine is not tidy. `card: "overlay"`
 * puts the typed caps straight onto the photocopy with no box, no gutter of
 * ground and no radius between the picture and the words, and EIGHT of them run
 * three across a 940px page at `compact` with the last row ragged — which is a
 * sheet somebody crammed, and is the "crowded" the blurb has been promising.
 *
 * (It is the third overlay in the twelve and the other two are in the dark:
 * the private view hangs six at 590px on ink and the observing station logs six
 * at 390px on a night sky. Eight at 290px in banged-out mono caps on lilac laid
 * paper is not a hang and it is not a survey — it is a contact sheet somebody
 * cut up, and the same primitive doing a third job is what this collection has
 * been arguing a primitive is for.)
 *
 * Under it the CONTENTS, `numbered`, sixteen deep with excerpts and an
 * oversized faint ordinal hanging beside every entry: a zine numbers its pieces
 * because it is counting them, and because a column of faint numerals down the
 * reading edge is the one thing on the page that is not type doing a job. (The
 * press's offprint counts too, and the two are not cousins: six entries in a
 * scholarly serif small-cap on toned stock is a table of contents, and sixteen
 * in banged-out mono caps on lilac laid paper is a list of what is in this
 * one.) Two ORNAMENTS break the run, which is a mark rather than a rule and the
 * right way for a page this busy to take a breath.
 *
 * The masthead is `stacked` at `tall` — the nameplate CENTRED and large, which
 * on a zine is not a masthead at all but a COVER, and the reason this design has
 * no hero: the cover is already there.
 *
 * `paper` is the ground: laid tooth drawn as three hatchings at co-prime
 * periods, which is the closest this engine gets to a sheet that has been
 * through a machine. It is a COARSER tooth than it was — 2px hatchings at 13,
 * 17 and 23 rather than 1px at 5, 7 and 11 — because at the old pitch nothing
 * resolved as a line at 1440 and the whole thing integrated to a quarter of a
 * percent of wash, which is offset. Less ink, three times the tooth, and the
 * contrast numbers did not move; design.css records them. `[ brackets ]` on
 * the menu — the same characters the
 * console uses, doing a completely different job here, which is what a
 * photocopied page does with everything it borrows. `mauveine` because a zine
 * is printed in whatever ink the machine has and lilac is the one every riso in
 * the world has too much of; `cinnabar` and `murex` are in the tags.
 */
const mimeo: Preset = {
  id: "mimeo",
  name: { en: "Mimeo", ar: "الرونيو" },
  blurb: {
    en: "For a page that was stapled, not published: loud, crowded, and entirely yours.",
    ar: "لصفحةٍ دُبّست ولم تُنشر: صاخبة، مزدحمة، ولك وحدك.",
  },
  family: "signature",
  tags: [
    "zine", "fanzine", "riso", "paper", "collage", "ledger", "ornament",
    "loud", "brackets", "mono", "mauveine", "cinnabar", "murex",
  ],
  design: design({
    theme: "mauveine",
    site: { width: 940, density: "compact" },
    chrome: chrome({
      typography: {
        baseSize: 15.5,
        scale: 1.38,
        measure: 60,
        lineHeight: 1.45,
        headingWeight: 700,
        headingCase: "uppercase",
        tracking: 0.03,
        headingFamily: "mono",
        bodyFamily: "serif",
        headingFont: "fira-code",
        bodyFont: "lora",
        rhythm: 0.9,
      },
      header: { layout: "stacked", density: "tall", sticky: "none", showTagline: true, divider: true },
      nav: { style: "brackets", fallback: "topics", showSearch: true, showThemeToggle: true },
      // THE BACK PAGE OF A ZINE IS A COLOPHON. Who made it, where to write, who
      // to thank — one centred small-caps block rather than a grid of titled
      // columns, which is a company's footer and not a person's.
      footer: { form: "colophon", align: "center", showRss: true, showSearchHint: false },
      surface: "paper",
    }),
    sections: [
      // EIGHT ACROSS THE TOP AND NO EXCERPTS ON THEM, and the second half of
      // that is the one setting on this page a screenshot decided rather than
      // an argument. With excerpts on, the strip and the first entries of the
      // contents ran the same opening lines 150px apart — the stutter
      // `check-presets` counts, arriving as a look rather than as a number.
      // Off, the strip carries PICTURES and the contents carries the WRITING,
      // which is how a zine is actually laid out. (An overlay refuses an
      // excerpt anyway: four lines of body copy over a photograph is the
      // arrangement that makes the title unfindable.)
      // EIGHT, THREE ACROSS, so the last row is two and rags — which is what a
      // sheet somebody filled up looks like and is the opposite of the tidy
      // two-by-three this used to be. (Eight over sixteen is the anti-stutter
      // rule exactly at its bar, which is the right place for it here: a zine's
      // contents IS the strip again, written out.)
      { id: "reviews", kind: "postGrid", heading: "", limit: 8, columns: 3, tag: "", showExcerpt: false, showBanner: true, showDate: true, card: "overlay" },
      { id: "mark-a", kind: "divider", style: "ornament", space: 30 },
      { id: "long", kind: "postList", heading: "", limit: 16, tag: "", showExcerpt: true, showDate: true, layout: "numbered" },
      { id: "mark-b", kind: "divider", style: "ornament", space: 30 },
      { id: "scene", kind: "topics", heading: "", limit: 20 },
    ] as Section[],
    article: { showBanner: true, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/**
 * COVER STORY — the feature desk, and the design that spends its whole picture
 * budget on ONE picture.
 *
 * THE FRONT PAGE IS A COVER AND NOT AN INTRODUCTION, which is the sentence the
 * first two cuts of this template kept failing to say. Both of them opened on a
 * `split` hero: the words at the reading start, a borrowed plate at the end. It
 * is a beautiful primitive and it is the wrong opening for a PRESET, for a
 * reason that has nothing to do with taste. A preset is pure form — every copy
 * string in it is empty, because the words on a shipped design belong to the
 * owner — so a hero here can only fall back to the site's NAME and its tagline.
 * A magazine's cover does not say the magazine's name twice and then stop. Two
 * fresh readers said the same thing about it: a third of the fold was empty, and
 * what filled the rest was a line of chrome beside a photograph.
 *
 * So the hero is gone and the first block on the page is THE COVER STORY
 * ITSELF: one post, the full width of the page, its own photograph, and its own
 * headline set across it at display size. An overlay card alone in its grid is
 * not a card and the engine now knows it (design.css: 16:7 rather than 5:4, the
 * headline at the design's h1 rather than at body size, the scrim given room to
 * climb). Nothing is announced above it, because a cover announces itself, and
 * the newest post is the cover story for exactly as long as it is the newest —
 * which is what an issue is.
 *
 * THE MASTHEAD IS THE NAMEPLATE NOW, and it had to be. The old one was `inline`
 * — the name small at the reading start with the menu beside it — which put a
 * two-line wordmark and a row of section pills in the same 60px and let the
 * pills wrap under it. Two lines of name against two rows of menu is not a
 * masthead, it is a collision. `rule` gives the name a line of its own between
 * two hairlines at 1.7× the h1 (68px here), and hands the menu its own centred
 * band underneath. The vocabulary files this masthead under the newspaper and
 * Late Edition wears it that way; nothing about two rules is a newspaper's
 * property. What is a newspaper is what Late Edition puts between them — a
 * serif in 700-weight caps on sandstone over a day file in two ruled columns —
 * and what is a magazine is what goes between them here.
 *
 * THE PILLS FIT ON ONE ROW, and that is arithmetic rather than luck. Ten of the
 * fixture's topic chips measure about 850px; the rule masthead's menu is
 * centred in a three-track grid whose outer tracks are the width of the TOOLS,
 * so a search box costs the run 280px of the 1120 and the theme switch alone
 * costs 80. `showSearch: false` is what buys the tenth chip its place on the
 * line — and the search is not lost: `showSearchHint` prints the Ctrl-K line at
 * the foot, which is where a magazine keeps the small print anyway.
 *
 * UNDER THE FOLD, THE WELL — eight features, two across, and NOT ONE PICTURE
 * among them. `card: "bare"` with `showBanner: false` is the plateless bare
 * card, which the engine sets at the design's h2 (30px here) because a card
 * with no picture on it has nothing else to be larger than: eight 30px
 * headlines with a standfirst under each, in two columns, is the well of a
 * magazine. The reason there are no pictures in it is the reason there is one
 * on the cover. A post section has no offset, so the well opens on the same
 * piece the cover carries; with banners on, that piece printed its photograph
 * twice on one page, 400px apart, which is the stutter arriving as a look. With
 * them off, the cover has the only photograph on the front and the well has the
 * writing — one object, then eight arguments — and the repeat is a headline in
 * two sizes rather than a picture in two places.
 *
 * Between them the SECTION RAIL, which is where a magazine keeps its contents
 * and is also 120px of chips between the repeat and itself. (The press's
 * broadsheet answers the same problem the same way, which is not a coincidence:
 * it is the same problem.)
 *
 * Work Sans at 700 on NEGATIVE tracking over Literata — the tight grotesque
 * deck over the screen-drawn book face, which is the modern magazine's pairing,
 * and the only negative tracking in the catalog. A display line set tight is the
 * single clearest signal that a headline was typeset rather than typed, which is
 * precisely the sentence Mimeo two entries up is arguing the opposite of. The
 * scale is 1.32, the widest step gap on this shelf after the zine's: it has to
 * carry a 40px cover line, a 30px well headline and a 17.5px paragraph without
 * either of the first two being the second.
 *
 * `ruled` at a 1.6 line height on a 17.5px base is a 28px baseline grid — the
 * layout sheet a page is pasted up on, and a completely different texture from
 * the same surface under the console's 1.25 mono, where it lands as scan lines.
 * The article page takes the DROP CAP, because an initial on the first
 * paragraph of a feature is the oldest magazine gesture there is, and it turns
 * itself off in an Arabic paragraph for the reason written beside it.
 *
 * `lapis` because a design magazine is printed in one deep colour and blue is
 * the one that has never gone out; `nocturne` and `linen` are in the tags.
 */
const coverStory: Preset = {
  id: "cover-story",
  name: { en: "Cover Story", ar: "قصّة الغلاف" },
  blurb: {
    en: "For writing that comes out in issues, with one piece on the front each time.",
    ar: "لكتابةٍ تصدر في أعداد، ولكلّ عددٍ قصّةٌ على غلافه.",
  },
  family: "signature",
  tags: [
    "magazine", "feature", "cover", "overlay", "well", "issue", "desk",
    "dropcap", "editorial", "rule", "ruled", "sans", "lapis", "nocturne", "linen",
  ],
  design: design({
    theme: "lapis",
    site: { width: 1120, density: "regular" },
    chrome: chrome({
      typography: {
        baseSize: 17.5,
        // THREE SIZES, FAR APART. 1.32 puts the cover line at 40px, the well's
        // plateless headlines at 30px and the paragraph at 17.5px — a front
        // page has a cover, a headline and a standfirst, and a scale that
        // cannot tell those three apart is a page of one type size.
        scale: 1.32,
        measure: 68,
        lineHeight: 1.6,
        headingWeight: 700,
        headingCase: "normal",
        // PULLED TIGHT, and it is the only negative tracking in the whole
        // sixty-seven-design catalog. A grotesque at 700 on the 40px cover line
        // this scale produces has too much air between its letters at 0;
        // -0.015em is the amount a magazine's art desk takes out by hand, and it
        // stops one step short of the floor where the counters start closing.
        tracking: -0.015,
        headingFamily: "sans",
        bodyFamily: "serif",
        headingFont: "work-sans",
        bodyFont: "literata",
        rhythm: 1.05,
      },
      header: { layout: "rule", density: "regular", sticky: "nav", showTagline: true, divider: false },
      // NO SEARCH BOX IN THE BAR — see the arithmetic above; the foot carries
      // the Ctrl-K hint instead.
      nav: { style: "pills", fallback: "topics", showSearch: false, showThemeToggle: true },
      footer: { form: "columns", align: "center", showRss: true, showSearchHint: true },
      surface: "ruled",
    }),
    sections: [
      // THE COVER. One post, one column, the whole width of the page: the
      // engine draws an overlay with nobody beside it as a cover plate rather
      // than as a card (design.css). No excerpt — a standfirst under a headline
      // that is lying on a photograph is a third thing competing with two.
      { id: "cover", kind: "postGrid", heading: "", limit: 1, columns: 1, tag: "", showExcerpt: false, showBanner: true, showDate: true, card: "overlay" },
      { id: "fold", kind: "divider", style: "rule", space: 26 },
      { id: "sections", kind: "topics", heading: "", limit: 16 },
      // THE WELL. Eight against the cover's one clears the anti-stutter rule
      // with room to spare, and the pictures stay off it on purpose.
      { id: "well", kind: "postGrid", heading: "", limit: 8, columns: 2, tag: "", showExcerpt: true, showBanner: false, showDate: true, card: "bare" },
    ] as Section[],
    article: { showBanner: true, showMeta: true, showTags: true, showRelated: true, showBackLink: true, dropCap: true },
  }),
};

export const SIGNATURE_B_PRESETS: readonly Preset[] = [vernissage, gravure, mimeo, coverStory];
