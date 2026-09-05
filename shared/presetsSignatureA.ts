// THE SIGNATURE COLLECTION, STUDIO A — THE PRESS.
//
// The fifty-nine designs on the other shelves were composed against an engine
// that had one list, one card, one ground and three mastheads. They are good
// designs and they are all, at bottom, the same page in different type: a
// river of titles under a centred wordmark on a flat ground, ending in a grid
// of columns. Print the shelf and read the column of shapes — every row says
// `*/flat/columns`, and every list says `river`. That is not a criticism of
// the fifty-nine. It is what the engine could draw.
//
// A SIGNATURE TEMPLATE IS ONE YOU CANNOT LEAVE. The bar these four are written
// to is not "another good page": it is that applying one has to feel like
// moving into a different house — different floor, different light, different
// rules about shoes — so that choosing between them costs the owner something.
// Four presets that could be told apart by their font size are four presets;
// four that argue with each other are a collection.
//
// THE PRESS is the studio these four come out of, and the argument they share
// is that TYPE IS A MACHINE FOR PUBLISHING rather than a decoration on top of
// one. A newspaper, a console, a scholarly journal and a poster: four things
// that were printed before they were designed, each of which solved the same
// problem — get a great many words in front of a stranger, in an order, on a
// deadline — and arrived somewhere completely different.
//
// So they do not share a skeleton, and the divergence is deliberate at every
// level the engine has:
//
//   · MASTHEAD   rule · inline · stackedStart · banner   (four of the five)
//   · GROUND     flat · ruled · tinted · grid            (four of the five)
//   · END        columns · columns · colophon · grand
//   · MENU       underline · brackets · plain · pills    (all four)
//   · RUN        dateline · index · numbered+ledger · —  (four of the five)
//   · CARD       bare+art · — · — · bare
//   · OPENING    nameplate · printout · title page · bill (all four bands,
//                each drawn into something else by signature-studio-a.css)
//   · MEASURE    1240 · 780 · 860 · 1400 px
//   · FACE       merriweather/source-serif · ibm-plex-mono (everything) ·
//                crimson-pro/literata · work-sans/ibm-plex-sans
//
// `check-presets` reports shape collisions and there is not one inside this
// file, which is the mechanical half of the bar. The other half is a person
// looking at four screenshots and being unable to say which two are cousins.
//
// THE HOUSE RULES OF THE OTHER SHELVES STILL HOLD, all of them. Every word on
// these pages is the owner's (`heading`, `sub`, `body`, `label`, `copyright`
// are empty and the renderers know what empty means); nothing here names a
// note, a tag or an image, because a shipped design cannot know what is in a
// stranger's vault; each names one built-in theme, because a look is a theme
// plus a layout. What is new is only that a design may now name a FACE, and
// these four do — ahead of the instance's own stack, never instead of it, so an
// instance that never fetched Merriweather gets Late Edition in its own serif
// and the page is still the page.
//
// A NOTE ON THEME PAIRINGS. Each blurb sells a life and each design names the
// one room it was drawn in, but three of the four have obvious second homes —
// Late Edition on `parchment` or `linen`, Fascicle on `porcelain`, Klaxon on
// `void` — and those are carried in `tags`, where the gallery's search box can
// find them, rather than in `themes`. `Preset.themes` is not a list of
// alternates: it is the envelope's CUSTOM-theme payload (`{ base, tokens }`
// records an import merges under fresh slugs), and putting the string
// "parchment" in it would ship a malformed custom theme to every install.

import type { Section } from "./design.ts";
import { presetChrome as chrome, presetDesignPart as design, type Preset } from "./presets.ts";

/**
 * LATE EDITION — the broadsheet the engine could not draw until now.
 *
 * The four things a newspaper front page is made of, and none of them existed
 * a release ago: a NAMEPLATE BETWEEN TWO RULES with the menu centred beneath it
 * (`header.layout: "rule"`), three LEADS WITH PICTURES AND NO BOXES across the
 * top (`card: "bare"` — newsprint has no tiles; a border around a story is a
 * web habit), a run of writing BROKEN INTO THE DAYS IT WENT OUT ON
 * (`layout: "dateline"`, whose kicker is the date in tracked small uppercase),
 * and — the one that finally makes the shape read — THAT RUN SET IN COLUMNS
 * WITH A RULE BETWEEN THEM.
 *
 * THE FILE IS THE PAPER, AND IT TOOK TWO GOES. The first cut ran twenty-eight
 * headlines down the middle of a 1240px page, each with "1 min read" under it,
 * which is a page that bought a broadsheet's width and then set a blog in it —
 * and shot beside `broadsheet` at the same fold it was that preset with the
 * card borders taken off. Both halves of that are fixed in the engine rather
 * than here, because both were wrong for every design and not only for this
 * one: a dateline row now prints a HEADLINE and nothing else (the day above it
 * is the meta line; see Sections.tsx), and a dateline run sets itself in
 * columns as wide as the page allows with a hairline between them (design.css).
 * At 1240 that is two tracks of headlines under a ruled nameplate, which is
 * a front page. At 640 it is one, which is a phone.
 *
 * `regular` RATHER THAN `tall` ON THE PLATE, and a screenshot decided it: the
 * genuinely new thing on this page is the file, and at `tall` the file began
 * below 900px — a reader at 1440 saw the leads, the sections bar and nothing
 * else, which is to say they saw the old preset. The nameplate is still the
 * biggest thing on the page; it is no longer the only thing above the fold.
 *
 * 1240px because a paper is wide and because three leads across a narrow column
 * are three thumbnails. Merriweather over Source Serif 4: a heavy text serif
 * for the headlines and a quieter one underneath, which is the pairing every
 * paper on a newsstand is a variation of. The menu takes the accent RAIL under
 * the section the reader is in, because that is what a section header does in
 * print and because pills under a nameplate look like an app.
 *
 * `divider: false` on the header is not a preference — the rule masthead's
 * bottom hairline already answers, and the switch is out of play by design
 * (see design.css). It is written out so the intent is on the page.
 */
const lateEdition: Preset = {
  id: "late-edition",
  name: { en: "Late Edition", ar: "الطبعة الأخيرة" },
  blurb: {
    en: "For writing that is dated: a nameplate between rules, one lead across two columns, then the day file.",
    ar: "للكتابة المؤرّخة: اسمٌ بين مسطرتين، خبرٌ رئيسي على عمودين، ثم أرشيف الأيام.",
  },
  family: "signature",
  tags: [
    "newspaper", "dateline", "rule", "masthead", "kicker", "serif", "wide",
    "news", "daily", "press", "sandstone", "parchment", "linen",
  ],
  design: design({
    theme: "sandstone",
    site: { width: 1240, density: "regular" },
    chrome: chrome({
      signature: "late-edition",
      typography: {
        baseSize: 17,
        scale: 1.34,
        measure: 64,
        lineHeight: 1.55,
        headingWeight: 700,
        headingCase: "uppercase",
        tracking: 0.02,
        headingFamily: "serif",
        bodyFamily: "serif",
        headingFont: "merriweather",
        bodyFont: "source-serif-4",
        rhythm: 1,
      },
      header: {
        layout: "rule",
        density: "regular",
        sticky: "none",
        // THE NAMEPLATE MOVED INTO THE PAGE. The opening below prints the
        // site's name and tagline as a broadsheet nameplate, so the masthead
        // gives both up on the front page (it takes them back on an article,
        // where there is no opening; see printsSiteName). What is left of the
        // rule masthead on the front page is its centred menu, which the
        // studio sheet keeps as the thin sections strip a paper runs ABOVE
        // its nameplate.
        showName: false,
        showTagline: false,
        divider: false,
      },
      nav: { style: "underline", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "columns", align: "start", showRss: true, showSearchHint: true },
      surface: "flat",
    }),
    sections: [
      // THE NAMEPLATE, and it is a section rather than a masthead because a
      // masthead is type and a nameplate is a PLATE: a heavy rule across the
      // top, two ruled ears either side of the name (the boxes a front page
      // keeps its weather and its price in), the name at a size no h1 field
      // allows, and the tagline set as the dateline strip underneath, tracked
      // caps between two leaders, closed by an Oxford rule. All of it is drawn
      // in the studio sheet on a band with a blank heading, which is the one
      // opening that prints the site's own name and tagline and invents no
      // picture (see design.css, "A BAND IS GROUND AND TYPE").
      { id: "nameplate", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "short", treatment: "band" },
      // THE LEAD SPANS TWO COLUMNS. Three equal leads across the top are three
      // thumbnails; a front page has ONE lead, with the picture, and two
      // secondaries stacked beside it under a rule, and the studio sheet lays
      // the same three cards out that way above 900px. The section is still
      // three bare cards with pictures on, so the phone gets three leads in a
      // stack and the engine keeps one grid.
      { id: "leads", kind: "postGrid", heading: "", limit: 3, columns: 3, tag: "", showExcerpt: true, showBanner: true, showDate: true, card: "bare" },
      // A hairline with no air around it, hard against the leads: the rule that
      // ENDS the front page.
      { id: "fold", kind: "divider", style: "rule", space: 0 },
      // THE SECTIONS BAR, and it is here rather than at the foot for a reason a
      // screenshot gave. A post section has no offset, so the day file below
      // opens on the same three stories the leads carry — unavoidable, bounded
      // by the catalog's own index ≥ 2 × feature rule, and still the one place
      // this page repeats itself. A band of topic chips between two hairlines
      // puts the paper's own section index between the two, which is where a
      // broadsheet has always kept it, and moves the repeat off the fold at
      // 1440 into the bargain. The page then ENDS in the file, running down to
      // the footer, which is what a paper does.
      { id: "sections", kind: "topics", heading: "", limit: 16 },
      { id: "rule", kind: "divider", style: "rule", space: 0 },
      // NO EXCERPT UNDER THE FOLD, and it is the one setting on this page that
      // was decided from a screenshot rather than from an argument. With
      // excerpts on, the three leads and the first day of the file printed the
      // same three stories with the same opening lines 200px apart, which is
      // the stutter `check-presets` warns about arriving as a look rather than
      // as a count. Off, the leads carry the writing and the file carries the
      // HEADLINES — which is what the two halves of a front page are for, and
      // it is also what lets the file set itself in two columns: a column of
      // headlines is a column, and a column of excerpts on a 24rem track is a
      // paragraph six words wide.
      { id: "file", kind: "postList", heading: "", limit: 28, tag: "", showExcerpt: false, showDate: true, layout: "dateline" },
    ] as Section[],
  }),
};

/**
 * TELETYPE — the console site, which was hard-blocked in three separate places
 * and is now one decision.
 *
 * `headingFamily` and `bodyFamily` both go to MONO and `monoFont` names IBM
 * Plex Mono, so every heading, every paragraph, every date and every fragment
 * of code on the site is one face at one width — that is the whole look, and
 * before the mono choice existed the terminal died at the first paragraph.
 * `lineHeight: 1.25` is the second unlock: a monospaced line is short, its
 * glyphs are already spaced, and the 1.4 floor made a console read like a tax
 * form. The third is `[ brackets ]` on the menu, which mirror themselves —
 * both characters are `Bidi_Mirrored` and the link is `dir="auto"`, so an
 * Arabic instance gets `[ الأرشيف ]` opening at the reading start with no rule
 * of its own.
 *
 * The ground is `ruled`: faint horizontal baselines at the design's OWN line
 * height, which on `phosphor` at 1.25 lands as scan lines. That is a joke the
 * surface is allowed to make because it is made of `color-mix(--text)` and
 * costs the same nothing in the other twenty rooms.
 *
 * The opening is a `band` hero — a field of ground and type, no picture — which
 * is a login banner, and the run underneath is `index`: title, dotted leader,
 * date, forty of them, nothing else. A terminal does not show you excerpts.
 * 780px, compact, no tagline, and the search box stays because Ctrl-K is the
 * one piece of chrome a console reader will actually use.
 */
const teletype: Preset = {
  id: "teletype",
  name: { en: "Teletype", ar: "التلكس" },
  blurb: {
    en: "For a site that opens like a printout: paper tape, a typed name, a cursor, then the index.",
    ar: "لموقعٍ يُفتح كورقة طابعة: شريطٌ مثقّب، اسمٌ مرقون، مؤشّر، ثم الفهرس.",
  },
  family: "signature",
  tags: [
    "terminal", "console", "mono", "monospace", "brackets", "index", "dense",
    "code", "scanline", "phosphor", "void", "basalt",
  ],
  design: design({
    theme: "phosphor",
    site: { width: 780, density: "compact" },
    chrome: chrome({
      signature: "teletype",
      typography: {
        baseSize: 15.5,
        scale: 1.18,
        measure: 80,
        lineHeight: 1.25,
        headingWeight: 500,
        headingCase: "uppercase",
        tracking: 0.05,
        headingFamily: "mono",
        bodyFamily: "mono",
        // One face, named once. Both roles resolve THROUGH `monoFont` because
        // neither names a face of its own — see TypographyDesign — so this
        // single id dresses the masthead, the prose and the code alike.
        monoFont: "ibm-plex-mono",
        rhythm: 0.85,
      },
      // `showName: false`: the transmission header below prints the name, and
      // for one release the inline bar printed it too, forty pixels above. The
      // bar keeps the brackets menu and the search box, which is all a console
      // wants at the top of the window. The article route brings the name
      // back into the bar itself.
      header: { layout: "inline", density: "compact", sticky: "nav", showName: false, showTagline: false, divider: true },
      nav: { style: "brackets", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "columns", align: "start", showRss: true, showSearchHint: true, showPoweredBy: false },
      surface: "ruled",
    }),
    sections: [
      // THE TRANSMISSION HEADER. A band with a blank heading is the login
      // banner the comment above describes, and for one release it was a blank
      // one: two double rules with the name between them. The studio sheet
      // makes it a printout. A strip of punched paper tape runs across the top
      // of the band (feed holes and five channels of data holes, drawn in
      // radial gradients from the theme's own tokens), the name is typed after
      // a prompt with a cursor block after it, and the tagline follows as a
      // comment line. The page itself gets tractor feed strips down both
      // edges, sprocket holes and a perforation, in place of the dotted
      // borders it had. The run underneath gets line numbers, because a
      // listing on a console is numbered.
      { id: "banner", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "short", treatment: "band" },
      { id: "rule", kind: "divider", style: "rule", space: 14 },
      { id: "ls", kind: "postList", heading: "", limit: 40, tag: "", showExcerpt: false, showDate: true, layout: "index" },
      { id: "air", kind: "divider", style: "blank", space: 22 },
      { id: "tags", kind: "topics", heading: "", limit: 14 },
    ] as Section[],
    // No banner image on a console page, and no drop cap: a terminal does not
    // illuminate its first letter.
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/**
 * FASCICLE — the scholarly offprint, and the one design on this shelf that
 * carries TWO runs of writing on purpose.
 *
 * A journal's front page has always been two lists and never one: WHAT IS IN
 * THIS ISSUE, counted, and then THE FILE, ruled. So the top is `numbered` —
 * six entries with oversized faint ordinals hanging beside them, which is a
 * table of contents that looks like a table of contents — and the bottom is
 * `ledger`, twenty-four rows with the date hanging in a fixed column of its own
 * and a hairline under every one. Six over twenty-four satisfies the catalog's
 * anti-stutter rule with room to spare (`index ≥ 2 × feature`) and, more to the
 * point, it reads as an archive that BEGINS with the issue above it, which is
 * what a reader of journals expects.
 *
 * Small caps at 600 on a 62-character measure — the narrowest column on this
 * shelf — with Crimson Pro over Literata: a Renaissance text face for the
 * headings and a screen-drawn book face underneath, which is the pairing an
 * academic press would arrive at if it had to ship to a browser. The ground is
 * `tinted`, a different sheet of paper rather than a pattern, and the end of
 * the page is a `colophon`: one centred small-caps block set the way a book's
 * last page is. A journal's last page IS a colophon. It always was.
 *
 * The menu stays `plain`. Three of these four decorate their navigation and
 * this one refuses to, because a scholarly page that is shouting anywhere has
 * already lost the argument it is making.
 */
const fascicle: Preset = {
  id: "fascicle",
  name: { en: "Fascicle", ar: "الكرّاسة" },
  blurb: {
    en: "For work published in instalments: a title page, then the new number set apart from everything filed.",
    ar: "لعملٍ يصدر على أجزاء: صفحة عنوان، ثم العدد الجديد منفصلًا عن الأرشيف كلّه.",
  },
  family: "signature",
  tags: [
    "academic", "journal", "ledger", "numbered", "smallcaps", "colophon",
    "scholarly", "issue", "offprint", "narrow", "palimpsest", "porcelain", "linen",
  ],
  design: design({
    theme: "palimpsest",
    site: { width: 860, density: "regular" },
    chrome: chrome({
      signature: "fascicle",
      typography: {
        baseSize: 17.5,
        scale: 1.148,
        measure: 62,
        lineHeight: 1.6,
        headingWeight: 600,
        headingCase: "smallcaps",
        tracking: 0.01,
        headingFamily: "serif",
        bodyFamily: "serif",
        headingFont: "crimson-pro",
        bodyFont: "literata",
        rhythm: 0.95,
      },
      // The title page below prints the name and the tagline, so the masthead
      // prints neither on the front page and the studio sheet folds the empty
      // block away, leaving the plain menu as the only chrome above the frame.
      // No divider: the menu bar carries its own hairline, and a second one
      // above an empty masthead is a rule with nothing under it.
      header: { layout: "stackedStart", density: "regular", sticky: "none", showName: false, showTagline: false, divider: false },
      nav: { style: "plain", fallback: "topics", showSearch: true, showThemeToggle: true },
      footer: { form: "colophon", align: "center", showRss: true, showSearchHint: false },
      surface: "tinted",
    }),
    sections: [
      // THE TITLE PAGE. An issue of a journal opens on a page that is all
      // frame: a double ruled border, a head rule and a tail rule, the
      // ornament, the title set large in small caps, a short rule, and the
      // subtitle in italic. The band prints the name and the tagline and the
      // studio sheet draws the rest of the page around them, in `--border`
      // and `--text` and nothing else, so the frame is the same frame on
      // `porcelain` and `linen`.
      { id: "title-page", kind: "hero", heading: "", sub: "", image: null, align: "center", height: "short", treatment: "band" },
      // THE NEW NUMBER IS SET APART. The first entry of the issue is the
      // instalment that has just come out, and the studio sheet gives it a
      // raised panel of its own, its ordinal in the accent and its title a
      // step larger, so the issue reads as ONE new number followed by the five
      // before it, and then the file.
      { id: "issue", kind: "postList", heading: "", limit: 6, tag: "", showExcerpt: true, showDate: true, layout: "numbered" },
      { id: "rule", kind: "divider", style: "rule", space: 0 },
      { id: "file", kind: "postList", heading: "", limit: 24, tag: "", showExcerpt: false, showDate: true, layout: "ledger" },
      { id: "air", kind: "divider", style: "blank", space: 24 },
      { id: "subjects", kind: "topics", heading: "", limit: 18 },
    ] as Section[],
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: true, showBackLink: true },
  }),
};

/**
 * KLAXON — the poster, and the loudest page this engine will lay out.
 *
 * `concrete` (presetsMinimal's wide half) was as far as the old engine could go
 * toward a poster: 1400px, weight 800, scale 1.414, uppercase, no artwork. It
 * still drew a centred wordmark on a plain ground over bordered tiles, ending
 * in a meta line. Every one of those four is now a decision, and Klaxon takes
 * the other answer to all four.
 *
 * The masthead is a BANNER — a field of `--bg-raised` running the full width of
 * the window behind the identity, the one masthead that is a ground rather than
 * type on the page, at `tall`. The page is printed on GRAPH PAPER (`grid`),
 * which is the only surface that reads as a drawing rather than as a stock. The
 * cards are BARE and carry no pictures at all, so twelve titles at weight 800
 * are the artwork. And the end of the page is GRAND: the site's own name at
 * display size across the foot, with the footer's entries run together
 * underneath it — a poster signs itself.
 *
 * THE WALL IS THE LOUDEST THING ON THE PAGE, and for one round it was not. Shot
 * beside `concrete` this was the QUIETER of the two: twelve titles at 22px in a
 * three-across grid, their dates at three different heights per row, and the
 * only thing on the page set at size was the footer. Three engine faults, all
 * of them general and all of them fixed at the root rather than argued around
 * here — a card with no picture on it now takes the design's h2 rather than its
 * h4, because there is nothing else on the card to be bigger than (which on
 * this design is 38px of 800-weight uppercase on 0.135em, and is the poster);
 * a bare card's meta is pushed to the FOOT of its track, so twelve dates land
 * on four baselines instead of twelve; and a card resolves its direction ONCE,
 * for the whole card, so an Arabic entry stops setting its title at one edge
 * and its date at the other. The graph paper got a cell twice the size for the
 * same ink, because at 25px on `murex` it was a wash rather than a drawing.
 * None of those were Klaxon's decisions to make. They were the engine's, and
 * this is the design that had to be shot before anybody could see them.
 *
 * Tracking is `0.09em` on top of the 0.045 that uppercase carries anyway, which
 * is 0.135 on a 53px h1 — a value the old engine had no field for and the one
 * that separates a big heading from a poster. Work Sans over IBM Plex Sans: a
 * grotesque with real weight at 800 and an industrial companion for the body.
 * Pills on the menu, because at this size a menu is a row of blocks.
 *
 * `murex` because a poster is printed in ONE ink and murex is the loudest one
 * on the shelf; `void` is the other answer and is in the tags.
 */
const klaxon: Preset = {
  id: "klaxon",
  name: { en: "Klaxon", ar: "البوق" },
  blurb: {
    en: "For one voice pasted on a wall at the size of a bill, with no interest in being agreeable about it.",
    ar: "لصوتٍ واحد مُلصق على الجدار بحجم إعلان، لا يعنيه أن يكون لطيفًا.",
  },
  family: "signature",
  tags: [
    "brutalist", "poster", "huge", "uppercase", "grid", "banner", "grand",
    "loud", "wide", "sans", "murex", "void", "cinnabar",
  ],
  design: design({
    theme: "murex",
    site: { width: 1400, density: "compact" },
    chrome: chrome({
      signature: "klaxon",
      typography: {
        baseSize: 19,
        scale: 1.412,
        measure: 72,
        lineHeight: 1.3,
        headingWeight: 800,
        headingCase: "uppercase",
        tracking: 0.09,
        headingFamily: "sans",
        bodyFamily: "sans",
        headingFont: "work-sans",
        bodyFont: "ibm-plex-sans",
        rhythm: 0.8,
      },
      // THE BANNER GIVES THE NAME TO THE BILL. The opening below prints the
      // site's name at bill size, so the banner masthead prints neither name
      // nor tagline on the front page and the studio sheet folds its field
      // away to nothing, leaving the pills as a bar across the top of the
      // wall. `tall` still matters: an article has no bill, the banner takes
      // the name back there, and it should be the wall it always was.
      header: { layout: "banner", density: "tall", sticky: "none", showName: false, showTagline: false, divider: false },
      nav: { style: "pills", fallback: "topics", showSearch: false, showThemeToggle: true },
      footer: { form: "grand", align: "center", showRss: false, showSearchHint: false, showPoweredBy: false },
      surface: "grid",
    }),
    sections: [
      // THE BILL. For one release this page had NO opening section, on the
      // argument that a band with a blank heading prints the site's name and
      // the banner masthead 200px above had just printed it at display size:
      // shot at 1440 the page read "THE COMPOSITOR" three times before it read
      // a headline. The argument was right and the answer was wrong. The name
      // is printed once at the top, still, but by the bill and not by the
      // masthead (`showName: false` above), and the bill is the thing a
      // banner masthead could never be: the name at the size of a wall, in an
      // opaque block pasted a degree off true, a hard offset shadow behind it
      // in the accent, the tagline reversed out in a strip, and diagonal
      // bands of the accent running behind the whole thing. The studio sheet
      // draws it. The grand footer still signs the page at the end, which is
      // what a poster does, and everything between is the work.
      { id: "bill", kind: "hero", heading: "", sub: "", image: null, align: "start", height: "tall", treatment: "band" },
      { id: "rule", kind: "divider", style: "rule", space: 0 },
      { id: "wall", kind: "postGrid", heading: "", limit: 12, columns: 3, tag: "", showExcerpt: false, showBanner: false, showDate: true, card: "bare" },
      { id: "air", kind: "divider", style: "blank", space: 32 },
      { id: "index", kind: "topics", heading: "", limit: 24 },
    ] as Section[],
    // No banner, no related run: the article page is as bare as the front one.
    article: { showBanner: false, showMeta: true, showTags: true, showRelated: false, showBackLink: true },
  }),
};

export const SIGNATURE_A_PRESETS: readonly Preset[] = [lateEdition, teletype, fascicle, klaxon];
