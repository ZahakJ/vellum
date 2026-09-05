# Designed mode

*The third public shell: a homepage you compose from sections, plus navigation, header, footer, typography and static pages.*

← [Back to the README](../README.md) · [All docs](README.md)

---

`PUBLIC_LAYOUT=designed` (or **Settings → Publishing & comments → Public layout → Designed**) is
the third visitor shell: instead of the [built-in blog](blog-mode.md)'s fixed page, your homepage
is **composed from a design you author** — a hero, blocks of markdown, a note pulled in whole, a
grid or a list of posts, a topic cloud, a call to action, rules and space — plus site-level
choices (masthead or a single bar or nothing at all, the reading measure, density, which article
furniture shows).

Open it from the command palette: **Design site**.

## The built-in blog does not move

It is a separate, pristine, always-working code path that the designer never touches: designed
mode is a *second* renderer that composes its own page, not a re-styling of the first. Which is
what makes the switch worth having —

**Flipping between stock and designed is instant and lossless, both ways.** Your designs live in
`VELLUM_DATA/designs.json` and are not consulted while the layout is anything else, so switching
back to `blog` deletes nothing and switching forward again returns your site exactly as it was.
Going back to stock is a rescue, not a decision.

## A broken design is your visitors' non-event

If the config is invalid, if a section points at a note you deleted, or if anything throws while
rendering, **visitors are dropped to the built-in blog automatically** — never a blank page, never
a stack trace. You get told instead: a notice in the app naming the failing section, and one click
back to the stock blog. `npm run check-design` is the gate that keeps that promise honest — it
breaks the site all three ways on purpose and measures what a visitor and an owner each get. See
[Development](development.md).

## Sections

A design's homepage is an ordered list of sections. Each one can be hidden without being deleted —
the same "retained while inactive" rule the whole design file follows, one level down.

| Kind | What it puts on the page |
| --- | --- |
| `hero` | Heading, sub-heading and an optional image (https URL or vault attachment); `start` or `center` aligned, `short` or `tall`. An empty heading falls back to the site name and tagline, so a hero costs no typing to be useful |
| `richText` | A block of markdown, rendered through the reading renderer — same sanitizer, same wikilink resolution, same callouts |
| `note` | One published note pulled in whole, or just its first paragraph with a link through |
| `postGrid` | The newest published posts as cards: heading, limit, column count, an optional tag filter, and switches for excerpt / banner / date |
| `postList` | The same as a river: heading, limit, tag filter, excerpt and date switches |
| `topics` | A topic cloud from your published tags, capped by a limit |
| `cta` | Heading, body, and a button whose target must be site-relative (`/topic/x`) or an absolute https URL — a homepage button is not a place to accept `javascript:` |
| `divider` | A rule, a row of dots, or plain vertical air, in px |

> **A post section has no offset.** `postGrid` and `postList` both read the newest published posts
> and cap them, so two post sections in one design print the same posts twice. A design may carry
> **one** post section, or a *feature* of one to four posts over a *long index* of twenty or more,
> where an archive that begins with the piece above it is what a reader expects. Two grids of
> similar size stacked is the arrangement that reads as a bug.

The section board offers three ways to move a row — the ↑/↓ buttons, a pointer drag, or a keyboard
lift (`Space` to lift, arrows to move, `Space` to drop, `Esc` to cancel) — and shows the drop
position before you commit. `Ctrl/Cmd S` saves the draft. `npm run check-board` gates all three.

## Site chrome

Beyond the sections, a design carries the frame:

- **Header** — `stacked`, `stackedStart` or `inline` layout; `compact` / `regular` / `tall`
  density; sticky nothing, sticky nav or sticky header; logo, site name, tagline and a divider,
  each on its own switch.
- **Navigation** — an ordered list of items, each one a link to the home page, a note, a
  [static page](#static-pages), a topic, or an external URL — or a `group` holding children as a
  dropdown. Up to 20 items with 12 children each. Items can open in a new tab or be hidden.
  With no items at all, `nav.fallback: "topics"` fills the menu from the busiest published tags,
  so a fresh install gets a furnished site. The nav also carries switches for the search control,
  the theme toggle and the `EN`/`ع` [language switch](arabic-and-rtl.md#visitor-language-switch).
- **Typography** — base size, modular scale, reading measure in `ch`, line height, vertical
  rhythm, heading weight, heading case (`normal` / `smallcaps` / `uppercase`), and serif-or-sans
  for headings and body independently. Every one is a bounded dial, not a free number.
- **Footer** — columns of entries: links, plain text, or social icons (Mastodon, X, GitHub,
  LinkedIn, RSS, email).
- **Article page** — which furniture an article keeps: banner, meta line, tags, related posts,
  the back link.
- **Theme** — a design is a look, and a look is a theme plus a layout, so the design names one of
  the [twenty-one themes](theming.md) (or a custom one). It applies to visitors who have not chosen a
  theme of their own; `null` leaves `settings.defaultTheme` alone.
- **Site** — the section column's width in px, and `compact` / `regular` / `roomy` density.

## Presets

The designer ships **81 finished designs** across nine families — `editorial`, `minimal`,
`journal`, `portfolio`, `reference`, `landing`, `gallery`, `letter`, `signature` — as a starting fork rather
than a template you fill in. Three rules govern every one of them, and they are the whole contract
for adding another:

1. **A preset is pure form.** Every text field it could set — a section heading, a hero's own
   heading, a CTA's words, a footer copyright, a nav label — is left **empty**, and the renderers
   already know what empty means: a hero with no heading is the site's name and tagline, an empty
   copyright falls back to the instance's own footer line, an empty CTA label is the localized
   "Read more". A preset that typed "Latest writing" into a heading would ship an English word
   into an Arabic instance and a stranger's voice into everybody's. The shape is ours; every word
   on the page is yours.
2. **A preset names nothing in your vault.** No `note` section, no note or page nav item, no tag
   filter, no image path. A shipped design cannot know what is in somebody else's vault, and a
   preset that guessed would render as your very first error card. What it leans on instead is the
   fallback that already exists.
3. **A preset is a look, so it names a theme** — one of the built-ins, chosen because the layout was
   drawn against it. A broadsheet is a broadsheet on `parchment`.

`npm run check-presets` holds the catalog to those rules: unique ids, a bilingual name and blurb
with real Arabic, a known family, at least one preset per family, and no preset naming a note.

### Signature houses have an opening, and it travels with the design

The 21 `signature` presets carry a portable **Signature styling** choice in the **Chrome** tab.
It is what makes a house a house rather than a palette: the broadsheet nameplate with its ears and
dateline strip, the tractor feed paper and punched tape, the console's radar, the eclipse above
Deep Field, the museum wall with a piece hung on wires, the moon phases and star chart of the
register. It survives renaming, duplication and JSON export and import, so a fork of Mission
Control that you recolour and reorder is still in the console. Choose **No extra styling** to
remove it without touching your sections or typography. Older saved designs carry no signature
until you apply a preset that does.

Every opening is drawn in the theme's own tokens (gradients, rules and shadows, never an image or
a fixed colour), so it follows your palette and your light and dark themes. The drawing is a hero
section with a blank heading, which is the section that already prints your site's name and
tagline, so the masthead above it stays quiet on the front page and returns on every article.

`npm run check-signatures` runs an isolated browser fixture over the signature collection:
desktop and phone layouts, Arabic direction and collection navigation, plus galleries and hover
summaries across all 81 templates, keyboard previews, article rendering and designer parity.
`SIGNATURES=late-edition,klaxon`, `--houses-only` and `SHOTS=full` narrow it to the houses you are
drawing and write screenshots to `shots/signatures/`. It never touches a vault or a saved design.

### Blog features in every template

Configured **author-site gallery cards** now appear at the end of designed homepages,
and **published collections** appear near the opening when their home placement is
on. The navigation placement adds filled collections alongside your authored menu;
collection URLs keep the active design around their contents. These additions use
the same settings and visitor-filtered data as the stock blog and appear in the
live designer preview too.

Post links offer the stock blog's rendered summary on mouse hover or keyboard
focus, including links in cards, lists, search and related posts. Touch navigation
stays direct. Long pages also have the shared back-to-top control. Article and
static-page bodies use the shared note-format renderer and honor note alignment.

## Designs are named, versioned, and portable

Keep several, duplicate one to try something, export any of them as JSON (custom themes it uses
travel with it) and import it into another instance. Import is always *additive* — a colliding name
gets a fresh id, and nothing you already have is ever silently overwritten. "Reset to stock
defaults" is always one click away. A design written by a **newer** Vellum than the one you are
running is kept on disk and listed with the reason, never rendered half-understood.

## The live preview

The designer's preview pane is a real iframe running the real designed shell — not a mock. It
takes the instance's stylesheets and theme (including a live theme switch), and it lays out at
phone, tablet and desktop widths so you can check the fold you actually ship. Keys pressed inside
it do nothing: a preview that acted on `Enter` would be a second, silent editor.
`npm run check-preview` gates it.

## Static pages

An About, a Contact, a Colophon — notes that are part of the **site** rather than part of the
feed. The mechanism is a frontmatter flag:

```yaml
---
publish: true
page: true
---
```

`page: true` was chosen over a designated folder deliberately. A page stays an **ordinary note**:
it keeps its place in the vault next to the writing it belongs with, keeps its wikilinks and
backlinks, and is edited in the same editor. A `/pages/` folder would force a filing decision that
rewrites every `[[wikilink]]` pointing at it and breaks its permalink — for a property that has
nothing to do with where the file lives. It is also the shape the vault already uses for the same
kind of fact: `publish: true` decides visibility, `page: true` decides *kind*.

A page is still just a note, so it lives at its own clean URL (`About.md` → `/About`), and it must
still be `publish: true` to be visible to anyone — `page: true` alone publishes nothing.

What the flag changes is two things, and **only in designed mode**, so the stock blog's behaviour
is bit-for-bit what it was:

- the page leaves the post feed — `/api/posts`, the home list, topic lists and RSS. A Contact page
  is not an article and must not be the newest thing on the front page;
- it becomes offerable in the navigation builder and renders through the designed shell's *page*
  layout — no date, no reading time, no prev/next, no related posts — rather than the article
  layout.

With `publicLayout` at `app` or `blog` the flag is inert and a vault full of `page: true` notes
behaves exactly as it did before the feature existed. Switching to designed mode is what gives the
flag meaning; switching back gives it up again, losing nothing.
