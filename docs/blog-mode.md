# Blog mode

*The stock blog: masthead and topic nav, article pages, the dashboard home, RSS and SEO.*

← [Back to the README](../README.md) · [All docs](README.md)

---

`PUBLIC_LAYOUT=blog` (or **Settings → Publishing & comments → Public layout → Blog**) re-dresses
the visitor-facing site as a classic blog: a masthead with the site name and `SITE_TAGLINE`, a
horizontal nav of topic categories, article pages with title, date, word count, reading time and
tags, comments below (with `COMMENTS=on`), and a footer (`SITE_FOOTER`, default
`© <year> <SITE_NAME>`; `{year}` and `{siteName}` placeholders are substituted). Arabic and other
RTL content renders per-article in its natural direction — and `SITE_LANG=ar` mirrors the whole
blog shell to match (see [Arabic & RTL](arabic-and-rtl.md)). Signed-in admins are unaffected — the
full app, sidebar and all, stays exactly as it is; the blog shell exists only for visitors. Post
dates are formatted in `BLOG_LOCALE` (any BCP47 tag, default `en`).

![Blog dashboard home](screenshots/blog-dashboard.png)

The home page opens with `HOME_NOTE` rendered as an intro section (when that note is
published) above the reverse-chronological post list. Topic pages live at `/topic/<tag>`;
article deep links keep their normal note URLs.

## What counts as a post

Every note with `publish: true`, newest first. A post's date comes from
frontmatter — `date:`, `created:`, or `published:`, the first that parses wins (bare YAML dates
like `2024-05-01` and quoted/ISO strings both work); otherwise the file's creation/
modification time — so if you migrated a vault by copying files (which resets file times), add
`date:` frontmatter to your posts or they will all sort as "created the day of the copy". The
excerpt is the first real paragraph of prose (markdown stripped, template furniture like bare
timestamps and `Tags: #a #b` lines skipped), cut at ~220 characters on a word boundary.
`GET /api/posts` serves the list.

Notes in the [templates folder](templates-and-notes.md#templates) never appear in the post list,
RSS or the dashboard, even when they carry `publish: true` so the notes made from them inherit it.

> **Set `EXCLUDE_TAGS` before you go live.** The topic nav is built from the tags of published
> notes — including workflow tags (status markers like `#draft`/`#seedling`, zettel maturity,
> todo states), which would otherwise surface as public categories. List them in
> `EXCLUDE_TAGS` and they disappear from the nav, topic pages, and article tag chips; your
> vault and the admin view are unaffected.

## The nav is always one line

However many topics your published tags add up to, the row measures itself and folds whatever will
not fit into an inline "More ▾" menu beside the topics that do — re-measured on every resize, in
either direction, so it never wraps into a second ragged line. Below ~840px it collapses into the
usual burger panel, which shows every topic at once.

Topic names are the [localised label](arabic-and-rtl.md#localised-tag-labels) where one exists;
the URL stays the canonical slug.

## Hover previews

Resting the pointer on any post link — a list entry, a dashboard card, a related or prev/next
link, a search result — floats the opening of that note, rendered by the same reading renderer the
article page uses. The card *scrolls*, so a reader can skim well past the excerpt without leaving
the page they are on; it flips above the link near the bottom of the viewport and stays put while
the pointer travels into it. It opens into whichever room the viewport has, fades at whichever
edge has more prose past it, and answers the keyboard too — a Tab-focused link gets the same card.
Touch devices and readers who ask for reduced motion get no card at all, and the fetch is the
ordinary visitor-scoped one — an unpublished note has nothing to preview.

## Back to top

After a viewport of scrolling, a small ✦ appears in the trailing corner (the leading one under
RTL) and carries the reader back up with a gold shimmer; it lifts itself out of the way of the
footer and the comment box rather than sitting on them, and jumps instantly with no shimmer when
`prefers-reduced-motion` is set.

## Dashboard home

Prefer a magazine front page over the note-style home? Set **Settings → Publishing & comments →
Home page → Dashboard** (settings key `home.mode: "dashboard"`, also reachable as
`{ "home": { "mode": "dashboard" } }` in `VELLUM_DATA/settings.json` or through
`PATCH /api/settings`, and picked up live) and `/` becomes:

- a full-width hero carrying the site name (or logo) and tagline over a banner image
  (`home.banner` — an https URL or a vault attachment; without one, a generated gradient seeded
  from the site name);
- a responsive card grid of the latest posts (1/2/3 columns by viewport; banner thumbnails with
  the same generated fallback, excerpts, tag chips);
- and — when readers have been talking — a slim "Most discussed" row ranked by comment count.

As admin, enter **Preview as visitor** and hover the hero for a "Change banner…" button that opens
the usual picker (paste a URL, choose a vault attachment, or upload). `home.mode: "note"` (or
leaving it unset) keeps the classic home. With `COMMENTS=on`, `GET /api/posts` carries a
`commentCount` per post — visitors count visible comments only.

The home rows are read by the `blog` and `designed` layouts and by nothing else, so in the default
`app` layout they are inert — which the settings panel says on the row itself, greying them. An
app-layout instance simply opens the home note at `/`.

## Article furniture

![Blog article with comments](screenshots/blog-article.png)

Each article ends with share links (Settings → Publishing & comments can turn the row off), prev/
next posts, a "Related" list (published notes wikilinked from/to it), and
[comments](publishing.md#comments). The footer carries a quiet RSS link, a sign-in link, and a
tiny "powered by Vellum" credit — hide it with `.s-blog-powered { display: none }` in your
[`custom.css`](theming.md#restyle-it) if you prefer.

## RSS and SEO

Two crawler-facing surfaces come along regardless of layout (both respect `PUBLIC=false` and
speak only in published notes — unpublished paths are indistinguishable from unknown ones):

- **RSS** at `/feed.xml` — RSS 2.0, advertised on every page via
  `<link rel="alternate" type="application/rss+xml">`, items linking to each note's deep-link
  URL with the excerpt as description. `<pubDate>`s are always RFC-822 Gregorian, whatever the
  [date calendar setting](arabic-and-rtl.md#hijri-dates) says — that is a wire format an
  aggregator parses, not a date a person reads.
- **SEO meta** — the served HTML shell carries server-injected `<title>`, `meta description`,
  Open Graph (`og:type=article` on note pages) and canonical tags; note deep links get the
  note's own title and excerpt, everything else the generic site meta.

Absolute URLs in both are built from `SITE_URL` when set, else derived from the request's
`Host`/`X-Forwarded-*` headers.

Vellum serves no `sitemap.xml` and no `robots.txt` of its own — the feed and the in-page links are
the whole crawler surface. Add either at your reverse proxy if you want them.
