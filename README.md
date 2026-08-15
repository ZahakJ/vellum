<p align="center"><img src="docs/gh-hero.png" alt="Vellum" width="720"></p>

# Vellum

**Your Obsidian-style vault, self-hosted — and, when you want it, published as a beautiful blog. One small Node process.**

<p align="center"><a href="https://zahakj.github.io/vellum/"><strong>✦ Visit the project site ✦</strong></a></p>

[![License: MIT](https://img.shields.io/badge/license-MIT-b8912f.svg)](LICENSE)
[![Node ≥ 22](https://img.shields.io/badge/node-%E2%89%A5%2022-339933?logo=node.js&logoColor=white)](package.json)

> A *vellum* was the candlelit room where manuscripts were copied and illuminated. This one runs on `localhost`.

![The live-preview editor: callouts, tasks, wikilinks, KaTeX math, outline, local graph, and backlinks](docs/screenshots/hero-editor.png)

## Why Vellum

Obsidian is excellent — and if it fits, use it. Vellum exists for the gap it leaves: a vault you can open **from any browser** on your network, served by **one small Node process you host yourself**, with no desktop install, no sync subscription, and no plugin sprawl. It is local-first in the strictest sense: your notes are ordinary markdown files in an ordinary folder, readable and writable by every other tool you own. Point Vellum at an existing Obsidian vault and both keep working — Vellum never converts, wraps, or databases your files, ignores `.obsidian/` entirely, and serves your existing attachments in place. If you delete the app tomorrow, your notes don't notice. And when some of those notes deserve readers, flip on [blog mode](#blog-mode): the same vault becomes a public site with articles, topics, RSS, and reader comments — `publish: true` is the only frontmatter it asks for.

## Gallery

| | |
| --- | --- |
| ![Blog dashboard home](docs/screenshots/blog-dashboard.png)<br>*Blog mode's dashboard home — posts as cards, each with a generated gradient until you set a banner.* | ![Blog article with comments](docs/screenshots/blog-article.png)<br>*An article page: related posts, then "Marginalia" — built-in, rate-limited reader comments.* |
| ![Graph view](docs/screenshots/graph.png)<br>*Graph view — a hand-rolled canvas force simulation; drag nodes, click to open.* | ![Command palette](docs/screenshots/palette.png)<br>*The command palette fuzzy-matches notes and commands alike.* |
| ![The four themes](docs/screenshots/themes.png)<br>*Four hand-tuned themes: iron-gall, void, lapis, and parchment.* | <img src="docs/screenshots/mobile.png" alt="Blog home on a phone" width="320"><br>*The public site, phone-sized.* |

## Quickstart

```sh
git clone https://github.com/ZahakJ/vellum.git
cd vellum
npm install
npm start
```

Open **http://localhost:6801**. On first launch Vellum creates `./vault` and seeds it with eight interlinked starter notes that double as the user manual.

### Point it at your own notes

Any folder of `.md` files is a vault — including a real Obsidian vault:

```sh
VELLUM_VAULT=~/notes npm start
# or
npm start -- --vault ~/notes
```

What carries over from Obsidian: `[[wikilinks]]` (aliases, `#heading` links, rename-safe),
`![[embeds]]` (images, PDFs, note transclusions), callouts, `$…$`/`$$…$$` math, `#tags` and
frontmatter `tags:`, frontmatter properties, highlights, comments, footnotes, daily notes.
The `.obsidian/` config directory is ignored everywhere (tree, index, graph, watcher), nothing
is ever converted or moved, and attachments are served in place — the same vault keeps working
in Obsidian.

### Share it: public reading, admin editing

Out of the box Vellum runs in **open local mode** — no password, every visitor is an admin (a warning is printed at startup). To put a vault on a network you don't fully trust, set an admin password:

```sh
cp .env.example .env
npm run hash-password        # prompts for a password, prints an argon2id hash
```

Put the printed hash in `.env` (single-quoted — it contains `$`), plus a cookie-signing secret:

```sh
ADMIN_PASSWORD_HASH='$argon2id$v=19$m=65536,...'
SESSION_SECRET=some-long-random-string   # e.g. openssl rand -hex 32
```

With a hash set, visitors get the **reading view**: fully rendered notes, search, graph, backlinks — but no editor and no create/rename/delete anywhere. A quiet "Sign in" link in the status bar opens the login modal; a correct password sets a signed, httpOnly 30-day session cookie and unlocks editing on the spot, no reload. Login attempts are rate-limited (10/min/IP). Set `PUBLIC=false` to require login even for reading, and `HOME_NOTE` to pick the note fresh visitors land on.

As the signed-in admin you can **preview as visitor** at any time — the eye icon in the status bar, or "Preview as visitor" in the command palette. It is not a client-side imitation: every request is re-scoped server-side through the exact code path a stranger's request takes (published-only tree, search, graph, feed of events), so what you see is byte-for-byte what the public site serves. A slim gold banner marks the mode; "Exit preview" returns you to the full app on the same note.

To put it on the internet, run Vellum behind any HTTPS reverse proxy (Caddy, nginx, a Cloudflare tunnel, …) forwarding to `localhost:6801` — the app is a single origin (API + static client on one port), so no special proxy rules are needed; just make sure it is only reachable over TLS so the login password and session cookie stay private. When you do sit it behind a proxy, also set `TRUSTED_PROXIES` to the proxy's address (e.g. `TRUSTED_PROXIES=127.0.0.1,::1`) so the login rate limit keys off the real client IP from `X-Forwarded-For` instead of lumping everyone together as the proxy's IP. The header is only ever trusted when the connection comes from a listed address — otherwise it is ignored, since clients can forge it.

Request bodies are capped server-side before any parsing buffers them: 10 MB on any `/api` request, and a much tighter 64 KB on the anonymous surfaces (comment posts and login), so oversized uploads are rejected (HTTP 413) instead of occupying memory. A matching cap at the proxy is still a sensible extra layer — e.g. nginx `client_max_body_size 10m;`.

All `.env` keys (npm scripts load the file automatically via `node --env-file-if-exists=.env`; see `.env.example` for the full annotated list):

| Key | What |
| --- | ---- |
| `PORT` | Server port (default 6801) |
| `VELLUM_VAULT` | Vault directory (default `./vault`) |
| `ADMIN_PASSWORD_HASH` | argon2id hash from `npm run hash-password`; unset → open local mode |
| `SESSION_SECRET` | Signs session cookies; unset → ephemeral, sessions die on restart |
| `PUBLIC` | `false` requires login even to read (default: reading is public) |
| `TRUSTED_PROXIES` | Comma-separated IPs/CIDRs allowed to set `X-Forwarded-For` (e.g. `127.0.0.1,::1`); unset → header ignored, rate limit uses the socket address |
| `HOME_NOTE` | Vault-relative note fresh visitors land on, e.g. `index.md` |
| `COMMENTS` | `on` enables reader comments under published notes (default off) |
| `VELLUM_DATA` | Server data directory — the comments SQLite db, your `custom.css`, and `fonts/` (default `./data`) |
| `SITE_NAME` | Site name shown in the sidebar wordmark, page titles, and the login modal (default `Vellum`) |
| `DEFAULT_THEME` | Theme for visitors who haven't picked one: `iron-gall`, `void`, `lapis`, or `parchment` |
| `EXCLUDE_TAGS` | Comma-separated tags hidden from the visitor site's topic sections and tag pills (workflow/status tags like `baby,child,adult`); admin views unaffected |
| `PUBLIC_LAYOUT` | `blog` gives visitors a classic blog layout instead of the app shell (see [Blog mode](#blog-mode)); default `app` |
| `SITE_TAGLINE` | Masthead subtitle under the site name (blog mode) |
| `SITE_FOOTER` | Blog footer line; `{year}`/`{siteName}` substituted (default `© {year} {SITE_NAME}`) |
| `BLOG_LOCALE` | BCP47 locale for post dates and the RSS channel language (default: follows `SITE_LANG`) |
| `SITE_LANG` | Interface language: `en` (default) or `ar`. `ar` localizes every chrome string and mirrors the whole UI right-to-left (see [Arabic mode](#arabic-mode)) |
| `LANGUAGE_FILTER` | `true` limits the public blog surfaces to notes written in `SITE_LANG`'s script (default off) |
| `SITE_URL` | Canonical origin for RSS/canonical links, e.g. `https://notes.example.com`; unset → derived from request headers |
| `ATTACHMENTS_DIR` | Vault-relative directory the in-app image upload writes into (default `attachments`), created on demand |
| `BANNER_FALLBACK` | Blog hero for posts without a `banner:` — `generated` (default; a deterministic abstract gradient from the note title) or `none` |

### Site settings

Most of the site-identity keys above can also be changed **at runtime, from the app** — no
`.env` edit, no restart. As admin, open **Site settings** (the gear in the status bar, or the
command palette): a panel with three groups —

- **Identity** — site name, tagline, footer line, a **logo** image (replaces the text wordmark
  in the sidebar and the blog masthead), and a **favicon** (served at `/favicon.ico` with its
  real content type and injected into every page's `<link rel="icon">`).
- **Home page** — what visitors see at `/`: classic `note` mode with a chosen home note, or the
  `dashboard` magazine layout, plus an optional hero banner.
- **Site behavior** — default theme, public layout (`app`/`blog`), **language** (English /
  العربية) with its language filter and the optional **visitor switch**, date locale, excluded
  tags, and the comments toggle.

Image fields reuse the banner machinery: pick from the vault's attachments or upload right
there (drag & drop; bytes are sniffed; lands in `ATTACHMENTS_DIR`).

Everything is stored in `VELLUM_DATA/settings.json` (written atomically — a crash can't tear
it). **Precedence:** a value saved there overrides its env counterpart; clearing a field in
the panel falls back to the env default (shown greyed as the field's placeholder). Changes
apply live — the wordmark, layout, theme default, excluded tags, comments routes, and favicon
all update without a restart. If the file is ever corrupted, the server logs one warning and
runs on env defaults.

Security-sensitive keys are deliberately **env-only forever** and never readable or writable
through the panel or `/api/settings`: `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`,
`TRUSTED_PROXIES`, `PORT`, `HOST`, `VELLUM_VAULT`, `VELLUM_DATA`, `PUBLIC`.

The API mirror (admin-only; visitors get a 404): `GET /api/settings` answers the stored keys
plus `effective` (the merged values in use); `PATCH /api/settings` takes a partial object —
only named keys change, `null` clears one — validates strictly (unknown keys are a 400), and
answers the same shape.

### Arabic mode

Set `SITE_LANG=ar` (or pick **العربية** in Site settings → Language) and Vellum becomes an
Arabic application, not an English one with translated labels. The document goes
`<html dir="rtl" lang="ar">` and the **entire** interface mirrors: the sidebar moves to the
right, the outline/local-graph/backlinks panel to the left, tree indentation and disclosure
chevrons flip, the active-note accent bar moves to the row's other edge, the status bar and
command palette reverse, and every modal — settings, banner picker, moderation, login,
confirm — lays out right-to-left. On a phone the sidebar drawer slides in from the right.
The blog shell mirrors the same way.

Every chrome string is translated into real Arabic — بحث في الملاحظات، وسوم، روابط راجعة،
مخطط محلي، نشر، تسجيل الدخول — including counts, which take proper Arabic plural agreement
(ملاحظة واحدة / ملاحظتان / ٣ ملاحظات / ١١ ملاحظة). With `BLOG_LOCALE` unset, `ar` also formats
dates in Arabic, which renders them in Eastern Arabic numerals.

**Your notes are never translated or re-directed.** Note content renders exactly as authored,
per block, with `dir="auto"` — so an Arabic paragraph flows right-to-left and an English one
left-to-right inside the same note. The same rule applies to note-derived text that appears
inside the chrome (tree rows, tab titles, outline entries, search hits, backlink cards,
breadcrumbs): each picks its own direction, so a vault mixing `مكاتيب` and
`1 - Source Material` reads correctly in either language.

Switching the language from the settings panel applies **live** — no reload.

Optionally, `LANGUAGE_FILTER=true` limits the public blog surfaces (post lists, topics, graph,
search, prev/next, RSS, and the live event stream) to notes actually written in the site's
language, detected from the script of the note's prose. Admin views are never filtered, and a
direct link to a filtered-out note still opens it — see [Language filter](#language-filter).

### Note banners

Give any note a hero image with a `banner:` frontmatter line — a vault-relative attachment
path (`banner: attachments/cover.png`) or an https URL. It renders as a wide hero above the
note in the editor and reading view, and in blog mode as the article hero and a right-aligned
thumbnail in the post list. A published note's banner attachment is automatically
visitor-fetchable; unpublished notes' attachments stay invisible as always.

As admin you rarely touch the YAML: the command palette's **Set banner…** (also a quiet button
on the properties card) opens a modal to paste a URL, pick from the vault's image attachments,
or upload a file (drag & drop or picker; png/jpeg/webp/gif/svg, 10 MB max, bytes are sniffed —
the upload lands in `ATTACHMENTS_DIR`). The write is a surgical one-line frontmatter edit —
the rest of the file is untouched. Posts without a banner get a subtle generated gradient in
the blog list and article hero (`BANNER_FALLBACK=none` turns that off).

### Comments

Set `COMMENTS=on` and every **published** note grows a quiet "Marginalia" section under its
reading view: visitors can leave a plain-text note (name optional — "Anonymous" otherwise).
Off (the default), the feature is completely dark — no UI, and the API routes answer 404.

Moderation is built in for admins. On each comment: a quiet delete `×` (confirmed before it
does anything irreversible) and an eye toggle that **hides** the comment instead — hidden
comments vanish for visitors but stay in the database, rendered ghosted with a "hidden" chip
for the admin, and can be unhidden at any time. The command palette's **"Moderate comments"**
opens a panel of the newest comments across every note — each row shows author, snippet and
the note it belongs to (click to jump there), with the same hide/delete controls.

Comments are stored in an SQLite file at `VELLUM_DATA/comments.db` (default `./data/`, created
on demand, gitignored) using Node's built-in `node:sqlite` — no extra dependencies. Abuse
controls are built in: post requests over 64 KB are rejected before any parsing touches
them, posting is rate-limited to 5 comments/min/IP (honoring
`TRUSTED_PROXIES` for the real client address, same as login), bodies are capped at 2000
characters of plain text (always rendered escaped, never as HTML/markdown), names at 40, and
the form carries a hidden honeypot field that silently swallows bot submissions. Comments can
only ever be read or written on notes with `publish: true` — for anything else the API answers
the same 404 a missing note would, so unpublished paths stay unguessable. With `PUBLIC=false`
(fully private vault), visitors can neither read nor post comments at all.

### Blog mode

`PUBLIC_LAYOUT=blog` re-dresses the visitor-facing site as a classic blog: a masthead with the
site name and `SITE_TAGLINE`, a horizontal nav of topic categories, article pages with title,
date, word count, reading time and tags, comments below (with `COMMENTS=on`), and a footer
(`SITE_FOOTER`, default `© <year> <SITE_NAME>`; `{year}` and `{siteName}` placeholders are
substituted). Arabic and other RTL content renders per-article in its natural direction — and
`SITE_LANG=ar` mirrors the whole blog shell to match (see [Arabic & RTL](#arabic--rtl)).
Signed-in admins are unaffected — the full app, sidebar and all, stays exactly as it is; the
blog shell exists only for visitors. Post dates are formatted in `BLOG_LOCALE` (any BCP47 tag,
default `en`).

The home page opens with `HOME_NOTE` rendered as an intro section (when that note is
published) above the reverse-chronological post list. Topic pages live at `/topic/<tag>`;
article deep links keep their normal note URLs.

**The nav is always one line.** However many topics your published tags add up to, the row
measures itself and folds whatever will not fit into an inline "More ▾" menu beside the topics
that do — re-measured on every resize, in either direction, so it never wraps into a second
ragged line. Below ~840px it collapses into the usual burger panel, which shows every topic at
once.

**Hover previews.** Resting the pointer on any post link — a list entry, a dashboard card, a
related or prev/next link, a search result — floats the opening of that note, rendered by the
same reading renderer the article page uses. The card *scrolls*, so a reader can skim well past
the excerpt without leaving the page they are on; it flips above the link near the bottom of the
viewport and stays put while the pointer travels into it. Touch devices and readers who ask for
reduced motion get no card at all, and the fetch is the ordinary visitor-scoped one — an
unpublished note has nothing to preview.

**Back to top.** After a viewport of scrolling, a small ✦ appears in the trailing corner (the
leading one under RTL) and carries the reader back up with a gold shimmer; it lifts itself out
of the way of the footer and the comment box rather than sitting on them, and jumps instantly
with no shimmer when `prefers-reduced-motion` is set.

**Dashboard home.** Prefer a magazine front page over the note-style home? Set
`home.mode: "dashboard"` in `VELLUM_DATA/settings.json` (`{ "home": { "mode": "dashboard" } }`,
picked up live — or via the admin `PATCH /api/settings` endpoint) and `/` becomes: a full-width hero carrying the site name (or
logo) and tagline over a banner image (`home.banner` — an https URL or a vault attachment;
without one, a generated gradient seeded from the site name), a responsive card grid of the
latest posts (1/2/3 columns by viewport; banner thumbnails with the same generated fallback,
excerpts, tag chips), and — when readers have been talking — a slim "Most discussed" row
ranked by comment count. As admin, enter **Preview as visitor** and hover the hero for a
"Change banner…" button that opens the usual picker (paste a URL, choose a vault attachment,
or upload). `home.mode: "note"` (or leaving it unset) keeps the classic home. With
`COMMENTS=on`, `GET /api/posts` carries a `commentCount` per post — visitors count visible
comments only. Each article ends with share links, prev/next
posts, a "Related" list (published notes wikilinked from/to it), and comments. The footer
carries a quiet RSS link, a sign-in link, and a tiny "powered by Vellum" credit — hide it with
`.s-blog-powered { display: none }` in your [`custom.css`](#theming) if you prefer.

What counts as a post: every note with `publish: true`, newest first. A post's date comes from
frontmatter — `date:`, `created:`, or `published:`, the first that parses wins (bare YAML dates
like `2024-05-01` and quoted/ISO strings both work); otherwise the file's creation/
modification time — so if you migrated a vault by copying files (which resets file times), add
`date:` frontmatter to your posts or they will all sort as "created the day of the copy". The
excerpt is the first real paragraph of prose (markdown stripped, template furniture like bare
timestamps and `Tags: #a #b` lines skipped), cut at ~220 characters on a word boundary.
`GET /api/posts` serves the list.

> **Set `EXCLUDE_TAGS` before you go live.** The topic nav is built from the tags of published
> notes — including workflow tags (status markers like `#draft`/`#seedling`, zettel maturity,
> todo states), which would otherwise surface as public categories. List them in
> `EXCLUDE_TAGS` and they disappear from the nav, topic pages, and article tag chips; your
> vault and the admin view are unaffected.

Two crawler-facing surfaces come along regardless of layout (both respect `PUBLIC=false` and
speak only in published notes — unpublished paths are indistinguishable from unknown ones):

- **RSS** at `/feed.xml` — RSS 2.0, advertised on every page via
  `<link rel="alternate" type="application/rss+xml">`, items linking to each note's deep-link
  URL with the excerpt as description.
- **SEO meta** — the served HTML shell carries server-injected `<title>`, `meta description`,
  Open Graph (`og:type=article` on note pages) and canonical tags; note deep links get the
  note's own title and excerpt, everything else the generic site meta.

Absolute URLs in both are built from `SITE_URL` when set, else derived from the request's
`Host`/`X-Forwarded-*` headers.

### Arabic & RTL

Vellum speaks Arabic. `SITE_LANG=ar` (or **Site settings → Language → العربية**, applied live
without a restart) does two things at once:

**It translates the chrome.** Every label, button, placeholder, menu item, toast and confirm
dialog in both shells — sidebar, tabs, status bar, command palette, backlinks/outline/local-graph
panels, settings, and the whole blog (masthead, topic nav, article furniture, share row,
prev/next, Marginalia) — comes from a single dictionary in `client/i18n.ts`. Counts agree
properly in Arabic (`حاشية واحدة`, `حاشيتان`, `3 حواشٍ`, `40 حاشية`), not by bolting an "s" on.

**It mirrors the interface.** The document becomes `<html dir="rtl" lang="ar">` and the layout
follows: the sidebar moves to the right and the backlinks/outline panel to the left (that is the
*default* — "Move sidebar to the left/right" in the palette overrides it, and the choice, being a
window preference rather than a language one, survives a language change), tree
indentation and chevrons flip, the active-note accent bar moves to the other edge, the status
bar and blog nav reverse, and "older/newer" arrows point the way you actually read. This is
built on CSS logical properties (`margin-inline-*`, `inset-inline-*`, `text-align: start`), so
it is the same stylesheet in both directions — `[dir="rtl"]` overrides exist only where no
logical property can express the idea, such as flipping an arrow glyph or a gradient's angle.

**Your notes are left alone.** Note content is never translated and never re-flowed: each block
picks its own direction from its own text (`dir="auto"`), which is why a vault that mixes Arabic
and English reads correctly under either setting — and why Arabic notes already rendered
right-to-left before you touched this switch.

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
`--font-base` you set in `custom.css` is multiplied, not overwritten.

#### Visitor language switch

`SITE_LANG` picks the language *you* publish in. **Site settings → Visitor switch** (settings key
`languageToggle`, **off by default**) adds a small `EN` / `ع` control at the edge of the public
nav so a reader can pick the other one for themselves. Their choice lives in their own browser's
`localStorage` and survives return visits; nobody else's site changes.

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

#### Language filter

A bilingual vault often wants a monolingual public site. `LANGUAGE_FILTER=true` (**Site settings
→ Language filter**) narrows the public blog to notes actually written in the site language:

| | `SITE_LANG=ar` | `SITE_LANG=en` |
| --- | --- | --- |
| Shown | notes whose letters are ≥ 40% Arabic-script | notes that are majority non-Arabic |

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

### Theming

If Vellum is replacing a blog, you probably want it to stop saying "Vellum" and start looking
like *your* site. Three env-driven hooks cover that, no fork required:

**Name it.** `SITE_NAME=Night Garden` rebrands every visible surface — the `✦` wordmark in the
sidebar, the browser tab titles (`Note · Night Garden`), and the sign-in modal.

**Pick the default look.** Vellum ships four themes: `iron-gall` (warm near-black, the default),
`void` (neutral cool black with a starlight-steel accent — the one theme without gold), `lapis`
(deep blue-black), and `parchment` (warm paper light).
Every reader can switch themes from the status bar or command palette and their choice sticks
in their browser; `DEFAULT_THEME=parchment` sets what first-time visitors see before they choose.

**Restyle it.** Drop a `custom.css` into your data directory (`VELLUM_DATA`, default `./data/`)
and Vellum serves it at `/api/custom.css` and loads it after its own stylesheets — for every
visitor and for you, in dev and prod, no rebuild, no restart. Because it loads last, your rules
win. The whole UI is driven by CSS custom properties on `:root` (and per-theme overrides via
`html[data-theme="…"]`), so most re-skins are a handful of token lines:

```css
/* data/custom.css — a green-accented reading room */
:root,
html[data-theme="lapis"] {
  --accent: #5da06b;
  --accent-soft: rgba(93, 160, 107, 0.14);
  --font-serif: "Iowan Old Style", Georgia, serif;
}
```

The token API (define them on `:root` for all themes, or under `html[data-theme="void"]` etc.
for one):

| Token | Drives |
| ----- | ------ |
| `--bg` / `--bg-raised` / `--bg-hover` | Page background / sidebar & panels / hover rows |
| `--text` / `--text-muted` / `--text-faint` | Body text / secondary text / hints & counts |
| `--accent` / `--accent-soft` | Gold-leaf brand color (links, wikilinks, active marks) / its translucent wash |
| `--border` | The 1px hairlines everywhere |
| `--danger` | Destructive actions, broken-link tint |
| `--font-ui` / `--font-serif` / `--font-mono` | UI chrome / prose & headings / code |
| `--font-base` | Root type size — the entire UI is sized in `rem`, so this one token scales all chrome (default 15.5px) |
| `--font-prose` | Editor / reading prose size (default ≈18px; the blog article body sits a step above it) |
| `--radius` | Corner rounding (default 6px) |
| `--sidebar-w` | Sidebar width (default 292px) |
| `--callout-note`, `--callout-tip`, … | Per-type callout hues (see `client/styles/tokens.css`) |
| `--syn-keyword`, `--syn-string`, … | Code-highlighting palette |

**Bring your own fonts.** Vellum ships zero webfonts by design, but your instance doesn't have
to. Drop font files into `VELLUM_DATA/fonts/` (default `./data/fonts/`) and they are served at
`/api/fonts/<file>` — `woff2`, `woff`, `ttf`, and `otf` only, strictly by basename, with ETags
and immutable year-long cache headers. Wire them up with an `@font-face` in `custom.css`:

```css
/* data/custom.css — serve data/fonts/MyFont.woff2 as the prose face */
@font-face {
  font-family: "MyFont";
  src: url("/api/fonts/MyFont.woff2") format("woff2");
  font-display: swap;
}
:root {
  --font-serif: "MyFont", Georgia, serif;
}
```

Anything beyond tokens is fair game too — every element carries a stable `s-` prefixed class
(`.s-sidebar`, `.s-rv-p`, `.s-statusbar`, …), so `custom.css` can restyle specific components.
If you keep body text ≥ 4.5:1 contrast against `--bg`, the whole app stays readable.

### Dev mode

```sh
npm run dev
```

Runs the API server and Vite with hot reload side by side.

| Port | What | When |
| ---- | ---- | ---- |
| 6801 | Hono server (API + built client) | `npm start` / always |
| 5801 | Vite dev server (proxies `/api` → 6801) | `npm run dev` only |

`PORT` overrides the server port. `npm run typecheck` keeps the strict TypeScript build honest,
and `npm run check-i18n` keeps the chrome dictionary honest — it fails if any `t()` key is
missing, untranslated, dead, or if the English and Arabic sides of an entry disagree about
their `{placeholders}`.
`scripts/shoot.mjs` is the screenshot harness used for visual review: point it at a running
server (`node scripts/shoot.mjs http://localhost:6801 shots`) and it captures the editor, graph,
and palette in both themes — it needs `npm i -D playwright` plus either
`npx playwright install chromium` or a system browser via `CHROMIUM=/usr/bin/chromium`.
`node scripts/check-contrast.mjs` is the accessibility gate for `client/styles/tokens.css`:
every theme must keep body text ≥ 4.5:1 and secondary text ≥ 3:1 — run it after touching
theme tokens.

## Features

### Writing

- **Live-preview editor** (CodeMirror 6) — markdown syntax hides itself except on the line you're editing; headings set in serif, clickable checkboxes, gold `[[wikilinks]]`, tag pills
- **Wikilinks with autocomplete** — type `[[` and pick any note; `[[Name|alias]]` and `[[Name#heading]]` supported (type `#` inside the brackets to complete headings); heading links render as `Note › Heading` and jump straight to the heading; renames rewrite every link that pointed at the old name
- **Click to follow, click to create** — plain click follows a rendered link; clicking an unresolved (dashed) link creates the note, Obsidian-style
- **Frontmatter properties card** — YAML frontmatter collapses to a neat key/value card with clickable tag pills while your cursor is outside it
- **Paste or drop images** — an image on your clipboard (or dragged from a file manager) uploads into `ATTACHMENTS_DIR` and lands as `![[name.png]]` at the cursor, with an "Uploading…" placeholder holding the spot while it's in flight
- **Slash commands** — type `/` at the start of a line for a fuzzy menu of inserts: callout, code fence (with language search), table skeleton, task list, math block, divider, today's date, daily-note link
- **Callout & fence autocomplete** — `> [!` suggests every callout type with its icon and color; ` ``` ` suggests languages as you type
- **Hover previews** — rest on a `[[wikilink]]` and a floating card shows the target note's rendered opening (`[[Note#Heading]]` previews from that heading); footnote refs preview their definition
- **Heading folding** — a chevron appears beside each heading on hover; fold a section down to a "N folded lines" chip (click to reopen)
- **List/quote continuation** — `Enter` continues `-` lists, `- [ ]` tasks, numbered lists, and `>` quotes; `Enter` on an empty item exits. `Ctrl/Cmd ↑/↓` moves the current line. Pasting a URL over selected text makes a markdown link
- **Folder delete, Obsidian-safe** — right-click a folder in the sidebar: "Delete folder" *moves* the whole subtree to the vault's `.trash/`, so it is recoverable from disk (the dialog names the folder and counts the notes first); a quieter "Delete permanently" beside it erases instead, behind its own confirmation
- **Vim mode**, autosave (600 ms debounce + `Ctrl/Cmd S`), and a keyboard-first surface

### Rendering

- **Image embeds** — `![[image.png]]`, `![[image.png|300]]`, and standard `![alt](path)` render inline from your vault's attachments; broken embeds get a dashed placeholder
- **Note transclusions** — `![[Note]]` renders the target note as a full-fidelity card (callouts, math, code highlighting included), with an "Open note" affordance when the excerpt overflows
- **PDF & attachment cards** — `![[file.pdf]]` (mp4, mp3, zip, …) becomes a card that opens the file in a new tab
- **Callouts** — `> [!note]`, `[!tip]`, `[!warning]`, `[!danger]` and friends, tinted and iconed, foldable with `-`
- **Math** — `$inline$` and `$$block$$` via KaTeX
- **Code highlighting** — fenced blocks highlight for all common languages, themed to match
- **Highlights, comments, footnotes** — `==mark==`, `%%hidden comment%%`, `[^1]` superscript refs that jump to their definitions
- **Reading view** — `Ctrl/Cmd E` flips the note to a fully rendered, read-only page (tables included), sharing the editor's resolve logic

### Navigating

- **Backlinks panel** — every note shows who links to it, with the sentence that did
- **Outline (TOC) panel** — the open note's headings, tracking your scroll position; click to jump
- **Graph view** — hand-rolled canvas force simulation; drag nodes, hover to highlight neighbors, click to open
- **Full-text search** — prefix + fuzzy (MiniSearch), highlighted snippets with markdown syntax stripped, instant
- **Tags** — `#inline` and frontmatter `tags:`, counted and clickable in the sidebar
- **Daily notes** — `Ctrl/Cmd D` opens (or creates) `daily/YYYY-MM-DD.md`
- **A shell that gets out of the way** — collapse either pane (`Ctrl/Cmd B`, `Ctrl/Cmd Shift B`) down to a slim reopen handle, or go **zen** (`Ctrl/Cmd Shift Z`): sidebar, panel, tabs and status bar step aside and the prose centers on a wide measure. `Esc` (or the faint ✕) comes back. Every state is remembered across reloads
- **Sidebar on either side** — "Move sidebar to the right/left" in the palette; the default follows the language direction (left in English, right in Arabic) and your choice sticks
- **Command palette** — fuzzy over notes and commands, including "Toggle reading view", "Open daily note", "Zen mode", themes, vim
- **Live vault watching** — edit a file in any other editor and the app updates within ~100 ms (chokidar + SSE)
- **Four hand-tuned themes** — *iron-gall*, *void*, and *lapis* dark, *parchment* light; gold-leaf accent, zero external fonts or CDN requests
- **Arabic & RTL** — `SITE_LANG=ar` localizes every chrome string and mirrors the entire interface right-to-left (app *and* blog), with Arabic-locale dates; an optional language filter keeps the public blog monolingual on a bilingual vault, and an optional visitor `EN`/`ع` switch lets readers pick for themselves
- **Blog hover previews** — resting on any post link floats a scrollable preview of that note, rendered by the reading renderer: it opens into whichever room the viewport has, fades at whichever edge has more prose past it, and answers the keyboard too (a Tab-focused link gets the same card). The topic nav never wraps, and a ✦ carries long reads back to the top

## Keymap

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd P` | Command palette (open note, run command) |
| `Ctrl/Cmd K` | Search — focuses the sidebar search in the app; opens a centered search overlay on the public blog |
| `Ctrl/Cmd E` | Toggle reading view ⇄ editor |
| `Ctrl/Cmd D` | Open today's daily note |
| `Ctrl/Cmd N` | New note |
| `Ctrl/Cmd G` | Toggle graph view |
| `Ctrl/Cmd B` | Collapse / reopen the sidebar |
| `Ctrl/Cmd Shift B` | Collapse / reopen the backlinks panel |
| `Ctrl/Cmd Shift Z` | Zen mode — all chrome steps aside (`Esc` returns) |
| `Ctrl/Cmd S` | Save now (autosave runs regardless) |
| `Ctrl/Cmd ↑` / `↓` | Move the current line up / down |
| `/` at line start | Slash menu (callout, code fence, table, …) |
| Click | Follow a rendered wikilink (create it if unresolved) |
| `Ctrl/Cmd`-click | Follow a wikilink on the line you're editing |
| `↑` `↓` `Enter` `Esc` | Navigate / confirm / dismiss the palette |

In vim mode, `Ctrl D` and `Ctrl B` inside the editor keep their half-page scroll and page-up, and
`Esc` stays vim's mode key — use `Cmd`, the palette, or zen's ✕ instead. On macOS, `Cmd Shift Z`
inside the editor stays redo; `Ctrl Shift Z` enters zen there.

## Architecture

```
┌────────────────────────────┐        ┌─────────────────────────────┐
│  Client — React + CM6      │  HTTP  │  Server — Hono (Node ≥22.6) │
│  live preview · reading    │◄──────►│  /api: tree · note · file   │
│  view · graph · palette    │  SSE   │  search · graph · backlinks │
│  outline · zustand store   │        │  tags · resolve             │
└────────────────────────────┘        │  in-memory index (MiniSearch│
                                      │  + link graph) ← chokidar   │
                                      └──────────────┬──────────────┘
                                                     ▼
                                     your vault: .md files + attachments
```

- **Server** (`server/`) — Hono on Node's native TypeScript support (no build step for the backend). Watches the vault with chokidar (ignoring `.obsidian`, `.git`, dotfiles), keeps an in-memory MiniSearch index plus a wikilink graph, streams change events over SSE, and serves attachments (`/api/file`) with ETags. Nothing is ever written outside the vault.
- **Client** (`client/`) — React + zustand, CodeMirror 6 editor with a custom live-preview decoration plugin, a standalone reading-view renderer that shares the editor's link/embed resolve logic, canvas graph view. Built by Vite into `dist/`, statically served in production.
- **Shared** (`shared/types.ts`) — the wire contract both sides import.

## License

[MIT](LICENSE) © 2026 avicenna
