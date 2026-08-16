# Arabic & RTL

*Vellum in Arabic: a mirrored interface, the visitor language switch, the four-value language filter, Hijri dates, note direction and localised tag labels.*

← [Back to the README](../README.md) · [All docs](README.md)

---

Vellum speaks Arabic. `SITE_LANG=ar` (or **Settings → Appearance & language → العربية**, applied
live without a restart) does two things at once.

**It translates the chrome.** Every label, button, placeholder, menu item, toast and confirm
dialog in both shells — sidebar, tabs, status bar, command palette, backlinks/outline/local-graph
panels, settings, and the whole blog (masthead, topic nav, article furniture, share row,
prev/next, Marginalia) — comes from a single dictionary in `client/i18n.ts`. Counts agree
properly in Arabic (`حاشية واحدة`, `حاشيتان`, `3 حواشٍ`, `40 حاشية`), not by bolting an "s" on.

**It mirrors the interface.** The document becomes `<html dir="rtl" lang="ar">` and the layout
follows: the notes sidebar moves to the right and the outline/backlinks panel to the left — and
it keeps following, because the side is a **three-state** preference. *Follow the language* is
the default and is re-evaluated every time the language changes; *pin to the left edge* and *pin
to the right edge* name a screen edge in both languages and outrank the direction for good. All
three sit in the palette and as a segmented control in **Settings → Appearance & language**,
directly under the row that moves it — where *Auto* also names the edge it has landed on, so the
default state is never a silent one. (The third state is how you get back to automatic.) Tree
indentation and chevrons flip, the active-note accent bar moves to the other edge, the status
bar and blog nav reverse, and "older/newer" arrows point the way you actually read. Because the
panes swap ends, nothing in the interface calls either of them "the left one": the toggles, the
palette and the shortcut sheet say **Notes sidebar** and **Outline & backlinks**, in both
languages, with the keystroke in the tooltip. This is
built on CSS logical properties (`margin-inline-*`, `inset-inline-*`, `text-align: start`), so
it is the same stylesheet in both directions — `[dir="rtl"]` overrides exist only where no
logical property can express the idea, such as flipping an arrow glyph or a gradient's angle.

On a phone the sidebar drawer slides in from the right. Every modal — settings, banner picker,
moderation, login, confirm — lays out right-to-left, and the blog shell mirrors the same way.

**Your notes are left alone.** Note content is never translated and never re-flowed: each block
picks its own direction from its own text (`dir="auto"`), which is why a vault that mixes Arabic
and English reads correctly under either setting — and why Arabic notes already rendered
right-to-left before you touched this switch. The same rule applies to note-derived text that
appears inside the chrome (tree rows, tab titles, outline entries, search hits, backlink cards,
breadcrumbs): each picks its own direction, so a vault mixing `مكاتيب` and `1 - Source Material`
reads correctly in either language.

**Dates.** With `BLOG_LOCALE` unset, `SITE_LANG=ar` formats post dates and comment timestamps in
Arabic with Eastern Arabic numerals (`١٤ يوليو ٢٠٢٦`, `قبل ٧ دقائق`) — every date in the
product, blog and admin panels alike, from one rule. Set `BLOG_LOCALE` explicitly to override —
`BLOG_LOCALE=ar-u-nu-latn` keeps Arabic month names with 1/2/3 digits. Counters elsewhere in the
chrome (word counts, reading minutes) stay in Western numerals.

**Type.** Arabic gets its own type stack and its own scale. The font tokens name naskh faces
(`Noto Naskh Arabic`, `Amiri`, `Scheherazade New`) after the Latin ones, so Latin text still
renders in Georgia / system-ui and only Arabic characters — which no Latin face covers — fall
through to them; nothing is fetched from a CDN. Because a naskh face reads perceptibly smaller
than Georgia at the same pixel size, `lang="ar"` also multiplies the two type-scale tokens
(`--font-scale`, `--prose-scale`), which lifts the whole UI ~6% and the reading column ~10%. A
`--font-base` you set in `custom.css` is multiplied, not overwritten. For per-character Arabic
face selection — an Arabic word inside an English sentence, set correctly, on an English
instance — see [Typography](typography.md#the-arabic-slot-is-per-character-not-per-language).

## Visitor language switch

`SITE_LANG` picks the language *you* publish in. **Settings → Appearance & language → Visitor
switch** (settings key `languageToggle`, **off by default**, no env counterpart) adds a small
`EN` / `ع` control at the edge of the public nav so a reader can pick the other one for
themselves. Their choice lives in their own browser's `localStorage` and survives return visits;
nobody else's site changes.

It moves exactly two things: the **chrome strings** and the **text direction**. Note content is
untouched — it renders as authored, per block, the way it always does — and so are dates and
numerals, which stay on the instance's `BLOG_LOCALE` so a page never shows two numbering systems
at once. Leave the switch off (the default) and the public site has no language chrome at all.

> **If you turn the switch on, set `BLOG_LOCALE` deliberately.** Dates are per *instance*, not
> per visitor — that is what keeps one line from mixing `١٤` with `14`. So an English-locale
> instance whose visitor picks Arabic reads `١١ دقيقة قراءة · August 15, 2026`: Arabic chrome,
> English dates. Nothing is broken, but the first screen reads half-translated. If your audience
> is mostly Arabic, `BLOG_LOCALE=ar` (or `ar-u-nu-latn` for Arabic months with Latin digits) is
> usually the tag you want; if it is mostly English, expect the reverse for readers who switch.

## Language filter

A bilingual vault often wants a monolingual public site — or, better, a bilingual one that
gives each reader their own language. **Settings → Appearance & language → Language filter**
(`LANGUAGE_FILTER`) is a four-value enum:

| Value | Who decides | What the public site shows |
| --- | --- | --- |
| `off` *(default)* | nobody | every published note |
| `follow` | **the reader** | only notes in the language that reader is reading in |
| `ar` | you | only notes whose letters are ≥ 40% Arabic-script |
| `en` | you | only notes that are majority non-Arabic |

**`follow` is the one that makes the visitor switch mean something.** With **Visitor switch** on,
a reader who taps ع gets Arabic chrome *and* the Arabic writing; tapping EN brings
back the English. Without it — chrome in one language, posts in the other — the switch was
half a feature. A reader who never touches it gets the site language. (With the visitor switch
*off*, `follow` has no reader to follow and behaves exactly like pinning to `SITE_LANG`; the
settings panel says so in those words rather than letting the setting mean something other than
its name.)

> **Legacy booleans still parse.** `LANGUAGE_FILTER=true` means "`SITE_LANG`, pinned", which is
> what it always meant, and `false` means `off`. A stored `true` in `settings.json` is migrated at
> startup to the matching `"ar"`/`"en"` — never to `"follow"`, because upgrading must not change
> what a live site shows.

**It tells you what it will cost, before you save it.** The row prints the consequence in real
counts from your own vault — *"Pinned to Arabic: 3 of your 22 published notes qualify; 19 would
be hidden from every visitor"* — warns harder when that is most of the site, and refuses to be
quiet about it afterwards: while a filter is materially reducing what visitors see, the status
bar carries a standing `3/22 public` beside the published count. The two numbers disagreeing is
the state worth noticing, and before this round there was nowhere in the product that showed it.
The same treatment covers every other setting that can shrink the public site — excluded tags,
the blog front door, and `PUBLIC=false`.

**It will not hand anyone an empty site.** If the language in force matches no published note at
all, the filter stands down for that request: the reader gets the whole collection with one
quiet line explaining why they are seeing both languages, and you get the loud version.

Detection runs in the indexer, is cached per note, and refreshes incrementally as notes change —
no configuration, no frontmatter to maintain. The filter applies to every public discovery
surface: the post list, the dashboard grid and "Most discussed" row, topic pages *and the topic
nav itself*, the graph, search, prev/next links, and the RSS feed. A topic carried only by
filtered-out notes disappears entirely rather than leading to an empty page. Admin sessions are
never filtered — signed in, you always see the whole vault.

**What it counts.** Only the note's *prose*: fenced and inline code, HTML tags and comments, and
link destinations (markdown, reference and bare URLs) are stripped before the letters are
counted, so an Arabic article does not read as English because every highlight carries a
`readwise.io` URL or because it embeds one YouTube player. Link *text* still counts — it is what
a reader reads. A note whose prose has no letters at all (an image-only or numbers-only page)
belongs to no language and is shown under either setting rather than guessed at.

> **The filter is curation, not access control.** A published note it hides from the lists is
> still served on its own URL: `/api/note` is never filtered, and both shells resolve an article
> route from the URL itself rather than from the (filtered) tree, so every permalink you have
> already shared keeps working after you flip the switch — the note simply stops appearing in
> the lists, topics, graph, search and feed. What the filter must never do is *leak* what it
> curates away, so the surfaces that enumerate notes — including the `/api/events` push stream,
> which would otherwise announce a hidden note's path the moment it changed — all apply it. If a
> note should not be public at all, unpublish it (`publish: false`); that is the switch with
> teeth.

## Hijri dates

An Arabic site often dates its writing by the Hijri calendar, and until now Vellum could only
print Gregorian. **Settings → Appearance & language → Date calendar** (settings key
`dateCalendar`) takes three values:

| | prints |
| --- | --- |
| `gregorian` *(default)* | `15 August 2026` / `١٥ أغسطس ٢٠٢٦` |
| `hijri` | `٢ صفر ١٤٤٨ هـ` |
| `both` | one with the other parenthesised beside it |

`both` is ordered by the **site language**: an Arabic instance leads with the Hijri date and
puts the Gregorian one in brackets, an English instance does the reverse. The panel prints a
live specimen of today under whichever segment is highlighted, so you can see the answer before
you save it.

The Hijri calendar is **Umm al-Qura** (`islamic-umalqura`). Intl offers four Islamic calendars:
`islamic` is observational and its answer drifts by a day between platforms; the two tabular
variants never drift but are not what anyone's wall calendar says. Umm al-Qura is both stable
and recognisable, so it is the one Vellum uses — this is a display convention, not a preference
with a long tail. Month names come from `Intl` and digits from the same numeral rule everything
else uses (`BLOG_LOCALE`), so nothing is hand-spelled and one instance never mixes two numbering
systems on a line.

It reaches **every human-facing date**: blog post meta and dashboard cards, comment timestamps
(the relative "5 minutes ago" keeps its wording and gains the absolute date in its tooltip),
the moderation rows, the backup badge and the settings panel. **Daily notes keep their ISO
filenames** — `daily/2026-08-16.md` still sorts, still resolves as `[[2026-08-16]]`, still opens
in Obsidian — but outside Gregorian mode the status bar names the open one in the calendar you
chose.

> **RSS is deliberately untouched.** `/feed.xml` keeps RFC-822 Gregorian `<pubDate>`s whatever
> this setting says. That is a wire format an aggregator parses, not a date a person reads.

## Note direction & alignment

Two settings under **Appearance & language → Note layout**, applied identically in the editor,
the reading view and blog articles:

- **Text direction** (`textDirection`): `auto` *(default)*, `ltr`, `rtl`. `auto` is what shipped
  before — every block takes its own direction from its own first strong letter, which is what a
  bilingual vault wants. Pinning one makes the whole document read that way.
- **Text alignment** (`textAlign`): `start` *(default)*, `left`, `right`, `center`, `justify`.

**Any note overrides both from its own frontmatter**, and the note wins:

```yaml
---
dir: rtl
align: justify
---
```

(`direction:` and `text-align:` are accepted as spellings of the same two keys, as are
`centre`/`centered` and `justified`.)

A note that disagrees with the site default **says so**: a chip in its properties card, beside
the tag pills where the frontmatter is, and a quiet segment in the status bar. Both carry the
same tooltip, which names each half and where it came from — *Direction: RTL — set by this
note · Alignment: Justified — the site default*. A setting that silently changes how the text
under your caret behaves is the trap the mode pills exist to close, and this is the same rule.

**Code blocks, tables and display maths never take a centred or justified measure**, and never
take a pinned direction either: `const x = 1;` inside a right-to-left document renders as
`;const x = 1`, and a `|---|---|` table rule stops lining up with its own header. They keep the
reading direction's leading edge and resolve their own direction per line, in the editor and in
the rendered view alike. Callouts, quotes and lists are prose and follow the note. A `.tex`
note takes the direction (an Arabic paper is written right to left) and refuses the measure —
its source is markup end to end.

## Localised tag labels

A vault's tags are English because tags are addresses: `#software` is in your files, in your
links, in `EXCLUDE_TAGS`, in every URL you have shared. But an Arabic front end should say
«برمجيات». Both are true at once, because a label is **display only** — nothing here ever
rewrites a note.

There are two places to put a label, and the first one is better.

**1 — the tag's own page**, so the naming travels with the vault. Put a note at
`tags/<tag>.md` (the folder is **Settings → Appearance & language → Tags folder**, `tagsFolder`,
default `tags`; nested tags nest, so `#lang/arabic` is `tags/lang/arabic.md`) and give it a
`labels:` map:

```markdown
---
labels:
  ar: برمجيات
  en: Software
---

Notes about software: the craft, not the industry.
```

Clone the vault, sync it, open it in Obsidian — the label is still there, because it is a note.
A bare `labels: برمجيات` is read as the Arabic label, which is what a hand-written Arabic tag
page actually says.

**2 — `settings.tagLabels`**, for tags with no page of their own: a compact table in
**Settings → Appearance & language → Tag labels**, one row per tag with a column per language.
A tag page outranks it, per language, so a page naming only an Arabic label does not erase an
English one set here.

Every tag surface uses the label: the blog's topic nav and topic pages, post chips, the
dashboard cards, the sidebar tag cloud and topic sections, the properties card in the editor
and the reading view, and the hover previews. Everything else stays **canonical**:

- **URLs keep canonical slugs.** `/topic/software` is what the site draws and what your links
  point at. The localised spelling is accepted as a redirect — `/topic/برمجيات` lands on the
  same page and quietly rewrites the address — because a reader copies the word they can see.
- **Frontmatter is untouched**, `EXCLUDE_TAGS` and the language filter keep matching the real
  value, and the tooltip on a labelled chip names the canonical tag.
- **Search answers to both spellings.** Typing «برمجيات» finds the notes tagged `#software`, and
  typing `software` still does. The query is expanded, not the index — so editing a label takes
  effect immediately, with no reindex.
