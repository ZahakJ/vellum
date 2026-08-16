<p align="center"><img src="docs/gh-hero.png" alt="Vellum" width="720"></p>

# Vellum

**Your Obsidian-style vault, self-hosted — and, when you want it, published as a beautiful blog. One small Node process.**

<p align="center"><a href="https://zahakj.github.io/vellum/"><strong>✦ Visit the project site ✦</strong></a></p>

[![License: MIT](https://img.shields.io/badge/license-MIT-b8912f.svg)](LICENSE)
[![Node ≥ 24](https://img.shields.io/badge/node-%E2%89%A5%2024-339933?logo=node.js&logoColor=white)](package.json)

> A *vellum* was the candlelit room where manuscripts were copied and illuminated. This one runs on `localhost`.

![The live-preview editor: callouts, tasks, wikilinks, KaTeX math, outline, local graph, and backlinks](docs/screenshots/hero-editor.png)

## Why Vellum

Obsidian is excellent — and if it fits, use it. Vellum exists for the gap it leaves: a vault you can open **from any browser** on your network, served by **one small Node process you host yourself**, with no desktop install, no sync subscription, and no plugin sprawl. It is local-first in the strictest sense: your notes are ordinary markdown files in an ordinary folder, readable and writable by every other tool you own. Point Vellum at an existing Obsidian vault and both keep working — Vellum never converts, wraps, or databases your files, ignores `.obsidian/` entirely, and serves your existing attachments in place. If you delete the app tomorrow, your notes don't notice. And when some of those notes deserve readers, flip on [blog mode](#blog-mode): the same vault becomes a public site with articles, topics, RSS, and reader comments — `publish: true` is the only frontmatter it asks for.

## Gallery

| | |
| --- | --- |
| ![Blog dashboard home](docs/screenshots/blog-dashboard.png)<br>*Blog mode's dashboard home — posts as cards, each with a generated gradient until you set a banner.* | ![Blog article with comments](docs/screenshots/blog-article.png)<br>*An article page: related posts, then "Marginalia" — built-in, rate-limited reader comments.* |
| ![Graph view](docs/screenshots/graph.png)<br>*Graph view — a hand-rolled canvas force simulation; drag nodes, click to open.* | ![Command palette](docs/screenshots/palette.png)<br>*The command palette fuzzy-matches notes and commands alike.* |
| ![The fifteen themes](docs/screenshots/themes.png)<br>*Fifteen hand-tuned themes — eleven dark, four light — each defining its whole palette.* | <img src="docs/screenshots/mobile.png" alt="Blog home on a phone" width="320"><br>*The public site, phone-sized.* |

## Quickstart

**Node ≥ 24** (`node --version`). Vellum's server is TypeScript that Node runs directly, with no
build step and no transpiler, and three separate things set that floor: type stripping on by
default (flagged before 22.18), `--env-file-if-exists`, which every npm script here passes
(added in 22.9), and an unflagged `node:sqlite` for the comments database (22.13). They line up
at 24, which is the first Node that carries all three in an LTS line — so 24 is the real number,
not a rounded-up one. It is declared in `package.json` under `engines` and this repo ships
`engine-strict=true` in `.npmrc`, so a clone on an older Node **fails at `npm install`** with
the required and actual versions in the message, rather than dying later at `npm start` with a
syntax error from inside a `.ts` file.

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

With a hash set, visitors get the **reading view**: fully rendered notes, search, graph, backlinks — but no editor and no create/rename/delete anywhere. A quiet "Sign in" link in the status bar opens the login modal; a correct password sets a signed, httpOnly session cookie and unlocks editing on the spot, no reload. Set `PUBLIC=false` to require login even for reading, and `HOME_NOTE` to pick the note fresh visitors land on.

**`PUBLIC=false` requires a password, and says so by refusing to start.** Without
`ADMIN_PASSWORD_HASH` there is no session for the flag to require, so "private" would have meant the
opposite of itself: every anonymous request treated as a full admin. Rather than boot into that,
Vellum prints the `npm run hash-password` line and exits. (Running deliberately open on a trusted
network is still fine — just don't also claim to be private.) For the same reason, **backup & sync
needs a password in every mode**: without one, anyone who can reach the port could point the remote
at their own server and push your whole vault to it.

**Sessions.** The cookie is httpOnly, `SameSite=Lax`, `Secure` whenever the request arrives over
HTTPS (directly, or via `X-Forwarded-Proto` from an address listed in `TRUSTED_PROXIES` — set
`SECURE_COOKIES=true`/`false` to decide it yourself, e.g. `false` for LAN-over-http), and lives
**7 days**, renewed automatically while you are using the app. **Signing out signs you out
everywhere**, on every device, immediately: sessions carry an epoch stored in `VELLUM_DATA`, and
logging out bumps it. **Changing `ADMIN_PASSWORD_HASH` does the same** — every cookie issued under
the old password stops working the moment the new one is in place, which is the whole point of
changing it after a laptop goes missing. (Upgrading Vellum also invalidates existing sessions once;
you sign in again.)

**Login rate limit.** 10 failed attempts per minute per IP, plus a global ceiling, and the slot is
taken *before* the password is checked — so a thousand simultaneous guesses are still ten guesses.
At most two password verifications run at once (each argon2id hash costs 64 MB by design), so login
traffic can't starve the process that is also serving your notes.

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
| `PUBLIC` | `false` requires login even to read (default: reading is public). Refuses to start without `ADMIN_PASSWORD_HASH` |
| `TRUSTED_PROXIES` | Comma-separated IPs/CIDRs allowed to set `X-Forwarded-For` / `X-Forwarded-Proto` (e.g. `127.0.0.1,::1`); unset → both headers ignored, rate limit uses the socket address |
| `SECURE_COOKIES` | `true`/`false` to force the session cookie's `Secure` flag; unset → derived from the request scheme (and `X-Forwarded-Proto` from a trusted proxy) |
| `HOST` | Bind address (default `0.0.0.0`). A non-loopback bind with no password prints a loud warning: everyone who can reach the port is an admin |
| `HOME_NOTE` | Vault-relative note fresh visitors land on, e.g. `index.md` |
| `COMMENTS` | `on` enables reader comments under published notes (default off) |
| `VELLUM_DATA` | Server data directory — the comments SQLite db, your `custom.css`, and `fonts/` (your own files, plus the self-hosted catalog cache in `fonts/catalog/`; default `./data`) |
| `SITE_NAME` | Site name shown in the sidebar wordmark, page titles, and the login modal (default `Vellum`) |
| `DEFAULT_THEME` | Theme for visitors who haven't picked one — any of the fifteen (see [Theming](#theming)); unknown names are ignored with a warning |
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

### Settings

Most of the site-identity keys above can also be changed **at runtime, from the app** — no
`.env` edit, no restart. As admin, open **Settings** (the gear in the status bar, or the
command palette): a panel with six tabs, each opening with its name and one sentence saying what
it decides —

- **Site identity** — site name, tagline, footer line, a **logo** image (replaces the text
  wordmark in the sidebar and the blog masthead), and a **favicon** (served at `/favicon.ico`
  with its real content type and injected into every page's `<link rel="icon">`).
- **Appearance & language** — the default theme visitors arrive on, **your own** theme (this
  browser only, with *Themes*), the **language** (English / العربية), which edge the
  **notes sidebar** sits on (*Auto* follows the language — Arabic carries it to the right — or
  pin it to a screen edge for good), the date locale, the language filter and the optional
  **visitor switch** — plus the three localization rows below it: the **date calendar**
  (Gregorian / Hijri / both, with a live specimen of today), the **note layout** pair (text
  direction and alignment for note prose, which any note may override from its own
  frontmatter), and the **tag labels** table — display names for canonical tags, for a front
  end that should read «برمجيات» over a vault that keeps `#software`. See
  [Hijri dates](#hijri-dates), [Note direction & alignment](#note-direction--alignment) and
  [Localised tag labels](#localised-tag-labels).
- **Publishing & comments** — public layout (`app`/`blog`), excluded tags, the comments and
  share-button toggles, and the home page visitors land on at `/`: classic `note` mode with a
  chosen home note, or the `dashboard` magazine layout, plus an optional hero banner. The last
  two are read by the **blog** layout and by nothing else, so with `Public layout: app` the
  panel greys them and says so — an app-layout instance opens the home note at `/`.
- **Typography** — four font slots (text / interface / code / Arabic script) over a curated,
  self-hosted catalog *or* faces you upload yourself, with a live specimen that stays on screen
  while you choose. See [Typography](#typography).
- **Backup & sync** — commit the vault and push it to a private git remote you own, manually or
  on a timer. Off until you turn it on. See [Backup & sync](#backup--sync).
- **About** — the version, the vault's counts, and the absolute paths named below.

Image fields reuse the banner machinery: pick from the vault's attachments or upload right
there (drag & drop; bytes are sniffed; lands in `ATTACHMENTS_DIR`).

**Every control in the panel is drawn by Vellum**, not by your operating system. Lists are a
themed popover anchored to their trigger and kept inside the panel — height capped to the room
available, flipping above the trigger when there is none, arrow keys and type-ahead, `Enter` to
commit, `Esc` to put the value back; switches are switches; three-way rows (*inherit* / on / off)
show all three states at once; numbers carry their unit inside the field. A native `<select>`
opens an OS-drawn window that no theme can reach and no panel can contain, which is exactly what
a twenty-seven-face font list must never do.

**Where it all lives** is answered in the panel itself: the **About** tab prints the absolute
paths of the vault, the instance data directory, `settings.json` and the uploaded-fonts folder,
beside the version and the vault's counts.

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

Set `SITE_LANG=ar` (or pick **العربية** in Settings → Language) and Vellum becomes an
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

Give any note a hero image with a `banner:` frontmatter line. It renders as a wide hero above
the note in the editor and reading view, and in blog mode as the article hero and a
right-aligned thumbnail in the post list. A published note's banner attachment is automatically
visitor-fetchable; unpublished notes' attachments stay invisible as always.

**Four forms are accepted, tried in this order** — the same ladder every image reference in
Vellum climbs, including the site logo and the dashboard hero:

| What you write | What it finds |
| --- | --- |
| `banner: https://example.com/cover.jpg` | the URL itself (https only — an `http://` banner would be mixed content, so it is refused rather than rendered) |
| `banner: Media/cover.png` | that exact path from the vault root |
| `banner: cover.png` *(note in `Trips/`)* | `Trips/cover.png` — beside the note, where Obsidian keeps a note's own images. `img/cover.png` and `../shared/cover.png` work the same way |
| `banner: cover.png` *(no such neighbour)* | any `cover.png` in the vault, resolved exactly as `![[cover.png]]` resolves it: case-insensitive, shortest path wins |

A **bare filename is the form most people write**, and it used to be the one form that did not
work — it was sent to the vault root and 404'd — while wikilinks and embeds had always found a
file by name from anywhere. It works now, and so does the note's own folder.

If the value names nothing, **you are told**. As the signed-in admin the hero is replaced by a
dashed card naming the value that failed, with **Set banner…** beside it. Visitors see nothing
at all: a stranger cannot fix your typo, and blog posts fall back to the generated gradient.
(Before this, a broken banner deleted itself, which made a typo and "no banner" identical.)

As admin you rarely touch the YAML: the command palette's **Set banner…** (also a quiet button
on the properties card) opens a modal to paste a URL, pick from the vault's image attachments,
or upload a file (drag & drop or picker; png/jpeg/webp/gif/svg, 10 MB max, bytes are sniffed —
the upload lands in `ATTACHMENTS_DIR`). The write is a surgical one-line frontmatter edit —
the rest of the file is untouched. Posts without a banner get a subtle generated gradient in
the blog list and article hero (`BANNER_FALLBACK=none` turns that off).

### Templates

Point Vellum at a folder of template notes and it fills them in for you — the same syntax
Obsidian's core Templates plugin uses, so **the templates in a vault you brought over work
unmodified**.

The folder is `Settings → Publishing → Templates folder`. Leave it empty and Vellum finds one
itself, as long as the answer is unambiguous: a folder called `Templates`, `_templates` or
`قوالب`, with a leading ordering prefix allowed (`4 - Templates`, `04. Templates`). Two
plausible candidates and no root-level tie-break means it stays unset rather than guessing —
a wrong guess would hide real posts from your blog. **Notes in the templates folder never
appear in the post list** (or RSS, or the dashboard), even when they carry `publish: true`
so the notes made from them inherit it.

Two commands, both in the palette, both on a keystroke, and "New note from template…" is also
in the tree's right-click menu on any folder (where it creates *into that folder*):

| | |
| --- | --- |
| **Insert template…** (`Ctrl/Cmd Alt T`) | drops the template's body at the cursor of the open note |
| **New note from template…** (`Ctrl/Cmd Alt Shift T`) | asks for a name, creates the note with the template applied, and opens it |

Both open a picker that **previews the template with its placeholders already filled** — what
is about to land, not what the file says. (`Ctrl/Cmd Alt` rather than the obvious `Ctrl/Cmd T`:
that one is the browser's new tab, and `Ctrl/Cmd Shift T` reopens a closed one. Neither is
takeable.)

**Placeholders** — Obsidian's, plus two:

| Placeholder | Becomes |
| --- | --- |
| `{{date}}` | `2026-08-16` |
| `{{time}}` | `05:23` |
| `{{date:FORMAT}}` / `{{time:FORMAT}}` | moment-style tokens: `YYYY MM DD HH mm ss`, `MMMM`/`MMM` month names, `dddd`/`ddd` weekdays, `A`/`a`, and `[literal text]` in brackets. Named formats too: `{{date:long}}`, `full`, `medium`, `short` |
| `{{title}}` / `{{Title}}` | the new note's filename, as typed and in Title Case |
| `{{hdate}}` / `{{date:hijri}}` | the Umm al-Qura Hijri date |

Anything else is **left exactly as written** — `{{cursor}}`, a Templater expression, a stray
`{{`. Blanking a token Vellum does not implement would destroy text you typed and hide the
fact that the template expects something we do not do.

Dates follow the site's settings where a reader can see them and stay machine-shaped where
something has to parse them: the named formats (`{{date:long}}`) and `{{hdate}}` use
`settings.dateCalendar` and the instance's numeral system, while the token formats stay
Gregorian and Western-digit — `{{date}}` is `YYYY-MM-DD` by Obsidian's definition, and it
lands in `date:` frontmatter lines and filenames where `١٤٤٨-٠٢-١٣` parses as nothing.

**Frontmatter is merged, never stacked, and identity is never copied.** Inserting into a note
that already has a `---` block folds the template's keys into it — one block, no key twice,
and **the note's own values win** (its `publish:`, its `date:`, its `tags:` are facts about
that note; the template's are defaults). Identity keys (`id`, `uuid`, `guid`, `permalink`,
`slug`) are **minted fresh**, in the same shape as the template's own value: a uuid stays a
uuid, a 16-digit timestamp stays 16 digits. A template carrying `id:` used to hand the same id
to every note ever made from it.

**Template for new notes** (also in Settings) applies one template to every note created from
inside Vellum — `Ctrl/Cmd N`, the sidebar's `+`, the tree menu. Off by default: new notes are
born empty, as they always were.

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

**Dashboard home.** Prefer a magazine front page over the note-style home? (Blog mode only —
in the default `app` layout `/` opens the home note and this setting is inert, which the
settings panel says on the row itself.) Set
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

Vellum speaks Arabic. `SITE_LANG=ar` (or **Settings → Language → العربية**, applied live
without a restart) does two things at once:

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

`SITE_LANG` picks the language *you* publish in. **Settings → Visitor switch** (settings key
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

A bilingual vault often wants a monolingual public site. `LANGUAGE_FILTER=true` (**Settings
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

#### Hijri dates

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

#### Note direction & alignment

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

#### Localised tag labels

A vault's tags are English because tags are addresses: `#software` is in your files, in your
links, in `EXCLUDE_TAGS`, in every URL you have shared. But an Arabic front end should say
«برمجيات». Both are true at once, because a label is **display only** — nothing here ever
rewrites a note.

There are two places to put a label, and the first one is better:

**1 — the tag's own page**, so the naming travels with the vault. Put a note at
`tags/<tag>.md` (the folder is **Settings → Tags folder**, `tagsFolder`, default `tags`; nested
tags nest, so `#lang/arabic` is `tags/lang/arabic.md`) and give it a `labels:` map:

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

### Theming

If Vellum is replacing a blog, you probably want it to stop saying "Vellum" and start looking
like *your* site. Three env-driven hooks cover that, no fork required:

**Name it.** `SITE_NAME=Night Garden` rebrands every visible surface — the `✦` wordmark in the
sidebar, the browser tab titles (`Note · Night Garden`), and the sign-in modal.

**Pick the default look.** Vellum ships **fifteen** themes — eleven dark rooms and four lit
ones. Every one of them defines the whole palette for itself (ground, type, accent, selection,
focus ring, graph, all thirteen callout hues, all eight syntax colors), so none of them is
another theme wearing a different background.

![The fifteen themes](docs/screenshots/themes.png)

| Dark | | Light | |
| --- | --- | --- | --- |
| `iron-gall` | warm near-black, gold leaf — **the default** | `parchment` | warm paper, gold leaf |
| `cinnabar` | neutral graphite, vermilion type | `sandstone` | dry desert paper, burnt orange |
| `sumi` | ink-stick grey, aizome indigo | `solar` | brightest white paper, burnt gold |
| `void` | true black, cold signal cyan | `linen` | cool daylight, ink blue |
| `basalt` | cool blue-grey stone, pale sky | | |
| `nocturne` | blue-black night, periwinkle | | |
| `lapis` | deep lapis blue-black, brightened gold | | |
| `verdigris` | green-black, oxidized copper | | |
| `moss` | olive-black forest floor, lichen | | |
| `porphyry` | purple-black stone, dusty rose | | |
| `tallow` | warm brown paper, candle-flame amber | | |

Every reader picks their own from the **theme picker** — the theme control in the status bar
opens it, and so does *Themes* in Settings → Appearance & language. Each row is a
miniature of the room — its ground carrying a heading rule, a line of type and an accent chip —
next to a human name and a one-line description, both localized; the raw id (what `DEFAULT_THEME`
and the palette take) is in the row's tooltip. It is a grouped, keyboard-driven
list: `↑↓←→` moves the highlight and applies that theme live to the whole app behind the panel,
`Enter` keeps it, `Esc` puts back the theme you started with. (The mouse never moves the keyboard
highlight — only a click picks.) The palette carries ONE route to all fifteen: *Themes*
opens the same panel, with a dot showing the theme you are in. (It used to carry sixteen —
that row plus a `Theme: <id>` command per theme, 15 of 41 entries spent on one preference,
every one of them a blind jump into a room you had not seen. A parameter with fifteen values
belongs behind the surface that shows the values.) A
reader's choice sticks in their own browser; `DEFAULT_THEME=cinnabar` — or Settings → Appearance & language
→ *Default theme* — sets what first-time visitors see before they choose. An unknown
`DEFAULT_THEME` is ignored with a line on stderr at startup rather than silently.

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
| `--accent` / `--accent-soft` | Brand color (links, wikilinks, active marks) / its translucent wash |
| `--selection-bg` / `--focus-ring` | Text-selection wash / the 2px `:focus-visible` ring |
| `--graph-node` / `--graph-edge` / `--graph-vignette` | Graph disc color / idle edge stroke / the canvas's edge wash |
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

### Typography

The catalog is the no-CSS version of the escape hatch above — and its point is **Arabic**.
Open **Settings → Typography** and you get four pickers:

| Slot | Drives | Offers |
| --- | --- | --- |
| **Reading text** | `--font-serif` — reading column, editor prose, headings | Lora, EB Garamond, Crimson Pro, Literata, Source Serif 4, Merriweather, Inter, Source Sans 3, IBM Plex Sans, Work Sans |
| **Interface** | `--font-ui` — sidebar, tabs, panels, status bar | the same Latin list |
| **Code** | `--font-mono` — code blocks, raw markdown, inline code | JetBrains Mono, IBM Plex Mono, Fira Code, Source Code Pro |
| **Arabic face** | the Arabic letters in **all three** of the above | Amiri, Scheherazade New, Noto Naskh Arabic, Markazi Text, Lateef, Aref Ruqaa · Noto Kufi Arabic, Noto Sans Arabic, IBM Plex Sans Arabic, Cairo, Tajawal, Reem Kufi, Almarai |

Every slot also takes **system**, the default: the built-in stacks, nothing downloaded, nothing
served — and every slot also offers **your own uploads** (below). **Reset fonts** puts all four
back to `system`.

**The picker draws every option in the face it names.** A list of family names set in the
interface font is a list of trademarks: nobody chooses between Literata and Source Serif by
reading the words. So each row renders in its own typeface, Arabic faces carry an Arabic sample,
and the rows are grouped (serif / sans / monospace / naskh / modern & kufi / *your fonts*) with a
filter field over them. The faces are fetched a **group at a time**, as that group first appears,
so opening the Code picker never downloads the Arabic ones.

**The specimen stays on screen while you choose.** A live sample block — one mixed line per slot,
Latin and Arabic in the same run, so per-character selection is visible at a glance — is pinned to
the top of the tab and updates *before* you save, including the size dial below. Choosing type is
a compare-and-adjust loop; a preview the picker covers up previews nothing.

**Self-hosting is the whole design.** When you save, the *server* fetches the chosen families
once from Google Fonts (a `woff2` request, so you get `woff2` back), parses the `@font-face`
blocks, downloads each face into `VELLUM_DATA/fonts/catalog/<id>/`, and records the parsed
`unicode-range`s in a `meta.json` beside them. From then on the browser only ever sees your
server: `GET /api/site-fonts.css` is generated from the cache and every `src:` in it points at
`/api/fonts/catalog/…` on this instance. **No visitor's browser contacts an external host, ever**
— not for the fonts, not for the stylesheet. Only two hosts are ever reachable from the fetch
side (`fonts.googleapis.com`, `fonts.gstatic.com`), enforced as a hard allowlist on the parsed
URL with redirects refused, timeouts and per-file/per-family size caps. A download that fails is
a clean **502 with a message** and `settings.json` is left exactly as it was — so an offline box
keeps serving whatever it has already cached, and a save that only re-picks cached families
still works with no network at all.

**The Arabic slot is per character, not per language.** The generated stylesheet does not define
three families and hope; it defines three *composites* — `VellumProse`, `VellumUI`, `VellumMono` —
and lists the Arabic face's `@font-face` blocks **first**, narrowed to the Arabic unicode blocks,
with the Latin face's blocks after and those same ranges carved out of them. The two sets are
disjoint, so the browser's per-character font matching does the rest: in

> A mixed line is where the trick shows: the word خط sits inside an English sentence.

the Latin runs render in Lora and the Arabic word in Amiri — in one paragraph, with no markup,
no `lang` attribute and no direction involved. That works on an **English** instance too, which
is the point: a vault with Arabic quotations in English notes has never had a good answer before.

**And at the right size.** Picking the right face is only half of "sets correctly"; the other
half is *how big it comes out*. Two faces at one `font-size` are not two faces at one apparent
size: Amiri's base letters stand at about 0.35 em where Lora's x-height is 0.51 em, so an
unadjusted Arabic run beside Lora reads roughly a third smaller — a footnote dropped into a
paragraph. Each Arabic catalog entry therefore carries a measured **`size-adjust`** (Amiri 138%,
Scheherazade New 136%, Lateef 150%, Noto Kufi Arabic 90%, Cairo and Almarai none), emitted on
that family's `@font-face` blocks in the composite. Because it rides on the *face*, it applies
per character, in every slot, on an English instance as much as an Arabic one — which the
whole-UI `--font-scale` multiplier under `:root[lang="ar"]` can never do, since it scales both
scripts equally and so never moves the ratio between them.
The composites finally fall back to `var(--font-*-system)`, so any codepoint neither face covers
still lands on the stack the instance would have used — including the Arabic-first reorder and
the Arabic type-metric compensation that `:root[lang="ar"]` applies.

#### Your own fonts

A catalog of twenty-seven Google families cannot be the whole answer for typography, and for
Arabic it is not even close: the face a serious instance wants is usually one its owner licensed,
and it is on nobody's CDN. So **Settings → Typography → Your own fonts** takes an upload.

| | |
| --- | --- |
| **Formats** | `.woff2`, `.woff`, `.ttf`, `.otf` |
| **Size** | 5 MB per file |
| **Stored in** | `VELLUM_DATA/fonts/custom/` — outside the vault, and `VELLUM_DATA` is gitignored, so an uploaded face never lands in your notes repo or in a backup push |
| **Served from** | `GET /api/fonts/custom/<file>` on this instance — same terms as the catalog cache: self-hosted, no external host, immutable caching |
| **Offered in** | all four slots, under **Your fonts** |

The **format is decided by the file's magic bytes** (`wOF2`, `wOFF`, `0x00010000`, `true`,
`OTTO`) — never by the extension and never by the upload's content type, both of which are
attacker-controlled text. A PNG renamed `.woff2` is a `400`, which matters because the file is
about to be served back with a font MIME type. The header is then read for **structure**: a
plausible table count and a table directory that fits inside the file it came in. That check
costs nothing and turns a file that could never render — magic bytes followed by five million
zeroes — into a `400` at upload time instead of a face that silently never draws.

Anything the server *decompresses* out of an uploaded file is **bounded before it is read**. A
`name` table sits behind one brotli pass in WOFF2 and behind per-table zlib in WOFF1, and both
of those are decompression bombs unless the output is capped: an 800-byte file whose stream holds
900 MB of zeroes will otherwise allocate all 900 MB, synchronously, from a request. Each call is
now held to the length the file's own directory claims, itself clamped to a hard 32 MB ceiling.
A file that breaks the bound is not an error — it simply falls back to the filename-derived
family, which is what an unreadable font has always done.

The stored filename is a slug this server builds (lowercase ASCII, collision-suffixed), so nothing
you type reaches a path, a route parameter or a `url()`. When your filename leaves nothing — which
is what `خط-عربي.otf` does to an ASCII slug — the **font's own family name is used instead**, so
that file is stored as `amiri.otf` rather than as `font.otf`, `font-2.otf`, `font-3.otf`. The
**family name** itself comes from the font's `name` table where the file allows it, falling back
to the filename, so your picker says *Kitab* rather than *upload-3*.

Concurrent uploads are safe: filename allocation and the sidecar index are serialized, and the
index is written through a per-writer temporary file. (Four parallel uploads of four different
faces used to leave two files on disk, one of them labelled with another font's family, and three
`500`s — while the bytes were on disk all along.)

Uploaded faces are emitted into `/api/site-fonts.css` as ordinary self-hosted `@font-face`
blocks, and they take the **same per-slot `unicode-range` discipline** as the catalog: in the
Arabic slot a custom face is narrowed to the Arabic blocks, and a custom face in a Latin slot
standing beside an Arabic one has those blocks carved out of it. The two sets stay disjoint, so
per-character matching works with your own type exactly as it does with ours.

Uploads are admin-only (`POST /api/fonts/upload`; an admin previewing the public site is refused
like any other visitor), and **removing** a face is guarded twice: a font a slot still names shows
which slot instead of a delete button, and the server refuses the delete with a `409` regardless.

**Arabic size match.** The catalog's Arabic entries carry a *measured* `size-adjust`; an uploaded
face cannot. So when an Arabic face is chosen the tab grows one more control — a percentage with
its unit in the field — which overrides the compensation for whatever is in the Arabic slot,
catalog or upload. It is set by eye against the specimen two rows above it, which is the only way
this number is ever really set. Stored as `settings.fonts.arabicSizeAdjust` (50–300, absent =
the catalog's own value, or none).

**Escape hatch, unchanged.** For anything neither the catalog nor the uploader covers — a
variable font you want to drive with a custom axis, a script-specific stack, a face you would
rather wire by hand — drop the file in `VELLUM_DATA/fonts/` and name it from `custom.css` exactly
as shown above. That link is injected *after* the generated stylesheet, so a `custom.css` rule on
`:root` wins over the catalog, the uploads and the defaults alike.

### Backup & sync

Your vault is a folder of markdown files, so the oldest, most portable backup there is also the
best one: **git**. Vellum can commit the vault and push it to a remote you own — by hand, or
every few minutes — and it stays completely off until you switch it on.

**1. Have a remote to push to.** Create an **empty, private** repository on whatever host you
use (a self-hosted Forgejo/Gitea/GitLab, or one of the big ones). Empty matters: Vellum only
ever fast-forwards, so a remote that already has commits of its own will refuse to sync until
you reconcile the two histories yourself. Copy its clone URL — either form works:

```
https://git.example.com/you/vault.git      # HTTPS: needs a token (below)
git@git.example.com:you/vault.git          # SSH: needs a key on this machine
```

**2. Choose how this server signs in.**

- **SSH keys (recommended).** Vellum stores **no secret at all**; it runs `git` as the user your
  server runs as, and that user's own SSH key or agent does the authentication. Generate a key
  for the server (`ssh-keygen -t ed25519`), add the **public** half to your remote as a deploy
  key with write access, and confirm it works from a shell first — `ssh -T git@git.example.com`
  and one manual `git push` — because a key with a passphrase and no agent will simply fail
  under the server too.
- **Access token.** For HTTPS remotes. Create a **fine-grained** token scoped to that one
  repository with contents read/write and the shortest expiry you can live with — never a
  full-account classic token. Paste it into Settings → Backup & sync → Access token, with
  the username it pairs with (many hosts ignore the username; put anything non-empty).

**Where the token lives.** In `VELLUM_DATA/git-credentials.json`, mode `0600`, owned by the
server user. It is **never** written into `settings.json`, never into the vault, never into
`.git/config`, and never into the remote URL — which is why the remote field refuses a URL with
credentials baked in (`https://user:token@host/…`). At push time it reaches git through
`GIT_ASKPASS` and an environment variable on that one child process, so it never appears in a
command line (`ps` is readable by every user on the box) and never lands in your machine's own
credential store (each network call runs with `-c credential.helper=` to empty the helper list).
The API never gives it back: `GET /api/settings` answers `tokenSet: true` and nothing else, and
any git error shown to you or written to the log is scrubbed of the stored token and of any URL
userinfo first. **Clear token** deletes the file.

**3. Turn it on.** Settings → **Backup & sync**: switch Backup on (everything below that
switch stays disabled until you do), paste the remote URL, pick the branch (default `main`), and
pick an **Automatic sync** period — *Manual only* through *Once a day* (the timer skips a tick
while a sync is still running). If the vault is not a git repository yet, press **Initialize
repository**: that runs `git init`, makes the first commit, writes or extends `.gitignore` so
your instance data directory can never be committed, and points `origin` at your remote. The
button disappears once the vault is a repository.

**4. Sync.** The status bar shows a quiet branch glyph while backup is on: plain when everything
is committed, with a count when it is not, gold while a sync runs, red when the last one failed.
Click it for a small panel carrying the branch, the ahead/behind counts, the last result and —
on a failure — git's own error line as selectable text with a **Copy the error** button and a
one-click jump to the settings section. **Sync now** is in that panel and in the command palette.
One pass is:

1. optionally `fetch` + `merge --ff-only` — see below;
2. `git add -A`, then `.trash/` (and `VELLUM_DATA`, if you put it inside the vault) are dropped
   back out of the index — see **What sync never stages** below;
3. commit `vellum sync: <ISO timestamp>`, **skipped entirely when nothing changed**;
4. `git push`.

**Why pulls are fast-forward-only.** Because the alternative can corrupt your notes. A real
merge of two diverged histories writes `<<<<<<<` conflict markers *into the markdown files*, and
an unattended background job that does that to a thousand notes is a worse outcome than any
missed backup. So Vellum never merges and never rebases (a `pull.rebase = true` in your own
gitconfig cannot change that — no `git pull` runs at all): if the remote has commits you do not
have, the sync stops **before touching the working tree** and tells you the histories diverged.
Nothing is committed, nothing is pushed, no note is modified. You then reconcile in a terminal,
which is where a human belongs for that decision. Vellum never force-pushes.

**What sync never stages.** Two paths are removed from the index on every single pass, before
anything is committed, **whatever your vault's own `.gitignore` says about them**:

| Path | Why |
| --- | --- |
| `.trash/` | Deleting a note or a folder *moves* it here, and the whole promise of that is that it is a **local** bin — something you can dig through, restore from, or empty without consequence. Committing it makes every deletion permanent remote history, which is the opposite guarantee. |
| `VELLUM_DATA`, when it is inside the vault | It holds `settings.json`, the comments database and your git **access token**. |

This is enforced with `git rm --cached` against the index, not with an ignore rule, and the
difference matters. An ignore rule is your file and your opinion: git's *last matching rule*
wins, so a vault whose `.gitignore` carries `.trash/` and then `!.trash/` un-ignores it again,
and a build that only checked "is there a `.trash/` line?" saw nothing to do and pushed the
trash. The index eviction asks no ignore file anything. It also **repairs** a vault that an
older build already pushed: the first sync after upgrading stages the removal, so the trash
leaves the tip of your branch on its own (it stays in the *history* — see the note about
rewriting below).

Vellum still *appends* `.trash/` and `.obsidian/workspace*.json` to your `.gitignore` if they
are missing, so a `git status` in a terminal is quiet too — but that is a courtesy, not the
mechanism.

**.gitignore advice.** Beyond those two, the vault is committed as it stands, so decide what
does *not* belong in a backup before the first push:

```gitignore
.obsidian/workspace*    # Obsidian's per-machine window state, if you also use Obsidian
.DS_Store
*.pdf                   # large attachments, if your remote has a size limit
```

Keep `.obsidian/` itself if you want your Obsidian settings backed up; drop the whole directory
if you do not. **Never commit your instance data directory.** `VELLUM_DATA` (default `./data`)
holds `settings.json`, comment data and the git token, so keep it *outside* the vault — that is
the default, and this repository's own `.gitignore` already excludes `data/`.

If you have pointed `VELLUM_DATA` inside the vault anyway, Vellum defends it four ways, and all
four run on an existing repository with an existing `.gitignore` (which is the normal case, not
a special one): **Initialize repository** creates `.gitignore` or *appends* the data-directory
rule to the one you already have; every sync re-checks the rule with `git check-ignore` and
**refuses to run** if the directory is still not ignored; anything an older build already
committed is dropped from the index (`git rm --cached`); and the same eviction runs again after
`git add -A` on every pass, so the directory is out of the index no matter which ignore rule
matched last. A sync never stages your credentials. Note that files already pushed stay in the remote's *history* —
if that happened, rotate the token and rewrite the history in a terminal.

**Things worth knowing.**

- Every git invocation is an `execFile` with a fixed argument array. No shell is involved
  anywhere, and the remote URL and branch name are validated (scheme, no shell characters, no
  embedded credentials, safe ref name) before they are ever handed over. A `user@` that is
  *token-shaped* (`ghp_…`, `github_pat_…`, `glpat-…`) is refused on every scheme, including the
  scp-style `git@host:path` and `ssh://` forms where a plain username is fine.
- The git child process gets a **scrubbed environment**: `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_INDEX_FILE`, the object-directory variables, `GIT_CONFIG*` (including
  `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`), `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_PROXY_COMMAND` and
  `GIT_EXTERNAL_DIFF` are all removed, so nothing in the server's own environment can point git
  at another repository, another config, or another transport. If you *need* a custom SSH
  invocation — a specific deploy key, say — set **`VELLUM_GIT_SSH_COMMAND`** (e.g.
  `VELLUM_GIT_SSH_COMMAND="ssh -i /home/vellum/.ssh/vault_ed25519 -o IdentitiesOnly=yes"`) and
  Vellum passes exactly that to git as `GIT_SSH_COMMAND`.
- "Ahead / behind" has a third state. Until a fetch or a push has succeeded once there is no
  remote-tracking ref to compare against, and the panel says **"Nothing has reached the remote
  yet"** rather than "0 ahead · 0 behind" — which is what a fully backed-up vault reads.
- Sync is admin-only, including for an admin previewing the public site. Visitors cannot even
  read the status — the branch, the dirty count and the remote host say too much about you.
- Only one sync runs at a time: a second request while one is in flight answers `409`.
- A failing scheduled sync is logged **once**, not once per tick.
- If the machine has no git identity configured, commits are made as `Vellum
  <vellum@localhost>`; set `user.name`/`user.email` in the vault (or globally) to use your own.
- The API, for anyone scripting it (admin-only): `GET /api/sync/status`, `POST /api/sync/init`,
  `POST /api/sync/now`.

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
their `{placeholders}`. "Dead" is counted from the call sites only: the dictionary file is
excluded from the usage scan, because a key whose English value happens to be its own name
(`read: { en: "read" }`) otherwise matches inside its own definition and reports itself used.
`npm run check-contrast` holds every one of the fifteen themes to WCAG on the four text tokens
against both grounds (`--bg` and the raised surfaces), including `--text-faint` at the 3:1
non-text bar.
`scripts/shoot.mjs` is the screenshot harness used for visual review: point it at a running
server (`node scripts/shoot.mjs http://localhost:6801 shots`) and it captures the editor, graph,
and palette in both themes — it needs `npm i -D playwright` plus either
`npx playwright install chromium` or a system browser via `CHROMIUM=/usr/bin/chromium`.
Two narrower harnesses sit beside it for the admin chrome, which the first one never signs in to
see: `node scripts/shoot-settings.mjs <url> <password> <outdir>` logs in, opens Settings and
captures every section through the rail (printing the panel's scroll geometry and the specimen
font sizes), and `node scripts/shoot-sync.mjs <url> <password> <outdir>` captures the Backup &
sync section plus the status badge's detail panel. Both take `THEME=parchment` and
`LANGSET=ar` to check a theme or the right-to-left mirror.
`node scripts/check-caret.mjs <url> [outdir]` is the **click-to-caret** gate. Live preview replaces
markdown source with rendered boxes of a different width *and* a different length — eighteen
characters of `$7.7\ \text{km/s}$` standing under seven glyphs of KaTeX — so any pointer→document
mapping that reasons about geometry instead of about the DOM drifts by exactly that difference. It
writes its own note (inline math, inline code, wikilinks, tags, highlights and an image, in English
and Arabic, on lines long enough to wrap several times), runs the whole matrix once in each shell
direction, and requires every clicked glyph to take the caret **within one character**. Before the
fix it reported misses up to **82 characters** — the owner's "click near the start of a line, the
caret lands about 25 words in"; after it, zero. Needs an admin session (open local mode is fine)
and `CHROMIUM=/usr/bin/chromium`; it restores the instance language and deletes its fixture
however the run ends.
`npm run check-sections` (`node scripts/check-sections.mjs`) is the **section-surgery** gate, and
it needs no browser and no server. Dragging a heading in the outline rewrites the note — a block of
lines leaves one place and arrives in another, with the moved subtree re-levelled — which is the
most destructive operation in the product that is not called "delete": it runs on a keyless
gesture, it is one 4px slip away by accident, and the reader is looking at a forty-row outline
rather than at the 1,200 lines it is rearranging, so a single dropped paragraph would be invisible
until the day it was needed. The gate generates thousands of documents out of the shapes that break
naive implementations — YAML frontmatter, code fences whose bodies contain `### ` lines, headings
that skip levels, empty sections, a section at end of file, CRLF, no trailing newline — and asserts
the reorder is a **permutation**: it may change the order of a note's lines and the depth of the
moved subtree's own headings, and it may add a blank line at a seam; it may never lose a line and
never duplicate one. It also asserts that a section cannot be dropped inside itself, that a
zero-distance move is a no-op, and that extraction's two halves cover the original exactly.
`SEED=…` replays a failure, `ROUNDS=…` sets the sample size.
`node scripts/check-contrast.mjs` is the accessibility gate for `client/styles/tokens.css`:
every theme must keep body text ≥ 4.5:1, secondary text ≥ 3:1, and the accent ≥ 4.5:1 against
the page — the accent pair is read as text twice over (wikilinks and tag pills in the prose, and
the lit mode pill, which is the same two colors swapped). Run it after touching theme tokens.
It also holds the **text-colour palettes** (`shared/textColors.ts`, `client/styles/textcolor.css`),
which exist in two tiers for an arithmetic reason: against `void`'s `#050508` a colour needs
relative luminance ≥ 0.186 and against `solar`'s `#ffffff` it needs ≤ 0.183, so **no single colour
clears AA on all fifteen themes**. The theme-aware tier (`var(--vc-*)`, the default) therefore
carries one value per theme *group* and is held to 4.5:1 against every ground in its group; the
fixed-ink tier carries one hex for all fifteen and is held to 3:1, WCAG 1.4.11's non-text floor,
which is the most a fixed colour can promise. The gate prints both, and checks the stylesheet's
values against the module's.
`node scripts/check-excerpt.mjs <url>` is the **tag-in-prose** gate. DESIGN.md's hard rule is that
a snippet outside the editor either STRIPS markdown or RENDERS it; removing a `#` and leaving the
word standing in the sentence is neither, and it shipped — a post ending "…it buys the reader a
breath. #design #typography" printed on the front page as "…it buys the reader a breath. design
typography". The three surfaces that flow through one stripper (`stripInlineMd`) are all walked
from one fixture whose body **ends** in a tag line: the post excerpt (`/api/posts` — blog cards,
RSS, `og:description`), the search snippet (`/api/search`), and the backlink context line
(`/api/backlinks`). It also checks the other direction — that the stripped sentence survives and
that the tags still appear where tags belong (`post.tags`, and the search index still matches
them) — so a stripper that passes by deleting everything fails too. Needs an admin session (open
local mode, or `VELLUM_PASSWORD` for an instance with `ADMIN_PASSWORD_HASH`); it deletes both
fixtures however the run ends. No browser needed.

## Features

### Writing

- **Live-preview editor** (CodeMirror 6) — markdown syntax hides itself except on the line you're editing; headings set in serif, clickable checkboxes, gold `[[wikilinks]]`, tag pills
- **Wikilinks with autocomplete** — type `[[` and pick any note; `[[Name|alias]]` and `[[Name#heading]]` supported (type `#` inside the brackets to complete headings); heading links render as `Note › Heading` and jump straight to the heading; renames rewrite every link that pointed at the old name
- **Click to follow, click to create** — plain click follows a rendered link; clicking an unresolved (dashed) link creates the note, Obsidian-style
- **Frontmatter properties card** — YAML frontmatter collapses to a neat key/value card with clickable tag pills while your cursor is outside it
- **Templates, Obsidian-compatible** — `{{date}}`, `{{time}}`, `{{title}}`, `{{date:FORMAT}}` (plus `{{hdate}}` for the Hijri date); insert one at the cursor or start a new note from one, with a picker that previews the filled result. Frontmatter merges into the note's own block instead of stacking a second one, and an `id:` in the template is minted fresh rather than copied into every note — see [Templates](#templates)
- **Paste or drop images** — an image on your clipboard (or dragged from a file manager) uploads into `ATTACHMENTS_DIR` and lands as `![[name.png]]` at the cursor, with an "Uploading…" placeholder holding the spot while it's in flight
- **Slash commands** — type `/` at the start of a line for a fuzzy menu of inserts: callout, code fence (with language search), table skeleton, task list, math block, divider, today's date, daily-note link
- **Callout & fence autocomplete** — `> [!` suggests every callout type with its icon and color; ` ``` ` suggests languages as you type
- **Hover previews** — rest on a `[[wikilink]]` and a floating card shows the target note's rendered opening (`[[Note#Heading]]` previews from that heading); footnote refs preview their definition
- **Heading folding** — a chevron sits beside every heading (visible at rest, not on hover — a control nobody can see is a control nobody finds, and there is no hover on a phone); click it, or `Ctrl/Cmd Shift [` / `]`, to fold a section down to a "N folded lines" chip. `Ctrl/Cmd Alt [` / `]` folds or opens everything
- **Section actions on every heading** — a ⋯ beside the fold chevron (and a right-click on any heading line, or on any outline row) opens one menu: copy a `[[Note#Heading]]` link to the section, copy the section as Markdown, **extract it into a new note** with a `[[link]]` left standing where it was, fold or unfold everything below it, select it, focus it
- **Drag a heading in the outline to move that whole section** — heading, body and every subheading travel as one block, with a drop rule showing the depth it will land at *before* you let go; drag toward the reading direction to nest deeper, or rest on a row for a moment to drop inside it. One transaction, so `Ctrl/Cmd Z` takes it back — and the toast carries an Undo button too. `npm run check-sections` property-tests the rewrite against frontmatter, nested headings and code fences containing `###` lines
- **Focus one section** — `Ctrl/Cmd Alt F` collapses everything except the section your cursor is in; `Esc` puts the note back exactly as it was, folds and all. `Ctrl/Cmd Alt ↑` / `↓` jump to the previous or next heading (they scroll, in reading view). Fold state is remembered per note across reloads
- **Auto-numbered headings** — off by default; the outline's `1.` button turns them on for reading view, and `numbered: true` in a note's frontmatter numbers it for everyone, including on the blog. Nothing is written into your markdown
- **List/quote continuation** — `Enter` continues `-` lists, `- [ ]` tasks, numbered lists, and `>` quotes; `Enter` on an empty item exits. `Ctrl/Cmd ↑/↓` moves the current line. Pasting a URL over selected text makes a markdown link
- **Folder delete, Obsidian-safe** — right-click a folder in the sidebar: "Delete folder" *moves* the whole subtree to the vault's `.trash/`, so it is recoverable from disk (the dialog names the folder and counts the notes first); a quieter "Delete permanently" beside it erases instead, behind its own confirmation
- **Text formatting on the keys you already know** — `Ctrl/Cmd B` / `I` / `U`, plus strikethrough (`Ctrl/Cmd Shift X`) and highlight (`Ctrl/Cmd Shift H`) on Obsidian's own bindings. Every one toggles, works with no selection (markers inserted, caret between them), and applies per line across a multi-line selection
- **Selection menu and floating toolbar** — right-click a selection (or `Shift F10`) for the whole vocabulary, grouped: text style, structure, insert, colour. It is keyboard-complete, never overflows the viewport, and mirrors in Arabic. A Notion-style strip with the six most-used actions floats over every selection unless you turn it off from the menu's last row (the palette turns it back on)
- **Coloured text in two tiers** — the default writes `var(--vc-blue)`, a *meaning* that every one of the fifteen themes resolves to something clearing AA on its own ground, light or dark; a fixed-ink palette writes a literal hex when you mean *that* colour. Both render identically in the editor, the reading view and the blog, and the sanitizer admits `style` on a `<span>` for `color`/`background-color` only — no `url()`, no other properties
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

### LaTeX notes (`.tex`, `.latex`)

A `.tex` file is a **note**, not an import. It is in the tree, in search, in
the graph, in the backlinks panel, in the tag counts, in the post list and in
the RSS feed, and it publishes to the blog exactly as a `.md` note does — same
typography, same themes, same visitor scoping, both languages. And it still
compiles: everything Vellum adds is a LaTeX comment or a macro you can ship
beside the file.

- **Live-preview editor** — the CodeMirror `stex` mode themed to whichever of
  the fifteen rooms you are in, with the same bargain the markdown editor
  makes: the caret's line shows raw TeX, every other line reads as the thing it
  becomes. Sectioning is set in serif, `\emph`/`\textbf`/`\texttt` render,
  `\item` becomes a bullet or its number, `$…$` and display environments are
  set by KaTeX, `\cite` is a chip, and `\begin{figure}` shows **your vault's
  actual image** with its caption. (Section and equation *numbers* are the
  reading view's — they are a property of the whole document, and a number that
  renumbered itself as you typed above it would be a distraction rather than a
  preview; the outline panel beside the editor prints them.) Fold any
  environment or section from the chevron beside it. Autocomplete covers
  `\note{`, `\ref{`, `\cite{` and `\begin{` (which writes the matching `\end`)
- **The formatting keys write LaTeX here** — `Ctrl/Cmd B` in a `.tex` note is
  `\textbf{…}`, not `**…**`; `Ctrl/Cmd I` is `\emph{…}`, inline code is
  `\texttt{…}`, "Heading 2" is `\subsection{…}`, a bulleted list is an
  `itemize` environment and a wikilink is `\note{…}`. Strikethrough, highlight,
  the task list and the colour swatches are **absent** from the menu in a
  `.tex` note rather than approximated: LaTeX cannot spell them without a
  package your document may not load, and a key that quietly writes something
  neither Vellum nor `pdflatex` can render is worse than a key that does
  nothing
- **Reading & publishing** — rendered in the same visual language as markdown:
  numbered sections, numbered equations, "Figure 1" captions, theorem boxes,
  resolved cross-references, a `\bibitem` bibliography, footnotes. The outline
  panel follows the `\section` hierarchy
- **Frontmatter that pdflatex ignores** — a leading comment block:
  ```latex
  %---
  % publish: true
  % tags: [physics, fourier]
  % banner: "Media/heat.png"
  %---%
  ```
  or, if you would rather write a macro, `\vellum{publish=true, citekey=fourier1822}`
- **Links, three ways** — `\note{Fourier Transform}` and
  `\note[the transform]{Fourier Transform}` are Vellum's own macro (ship
  [`vellum.sty`](#latex-linking) beside the file and it compiles anywhere);
  `%% [[Private Scratch]] %%` is a link the PDF never shows; and an existing
  project lights up **unmodified**, because `\input`, `\include`, `\cite`,
  `\ref` and `\eqref` already say what they mean — Vellum simply extends their
  search path to the vault, local definitions first, so importing a project can
  never change how it compiles
- **One anchor space** — a markdown heading and a LaTeX `\label` are the same
  kind of thing, so `[[Heat Equation#eq:fourier]]` and `\note{Notes\#Derivation}`
  are one lookup in either direction, and `![[Heat Equation#eq:fourier]]`
  transcludes **just that equation**, rendered by KaTeX, into a markdown note

<a id="latex-linking"></a>
**`vellum.sty`** — the dozen lines that make `\note{…}` compile outside Vellum.
Download it from your own instance at `/api/vellum.sty` (or "LaTeX: download
vellum.sty" in the command palette), drop it beside your document, and
`\usepackage{vellum}`. Without it the file still opens in Vellum; with it,
`pdflatex` renders the very same file.

#### What renders, and what does not

An honest boundary beats a leaky claim of "full LaTeX". Anything not listed
below is **passed through as a quiet inline marker** — never as raw source,
never as a crash — and an unparseable document still opens, lists, publishes
and searches by its title.

| | |
| --- | --- |
| **Structure** | `\part` `\chapter` `\section` `\subsection` `\subsubsection` `\paragraph` `\subparagraph` (starred forms unnumbered), `\appendix`, `\maketitle` with `\title`/`\author`/`\date`, `abstract`, `\tableofcontents`, `\label` anywhere |
| **Text** | `\emph` `\textit` `\textbf` `\texttt` `\textsc` `\textsf` `\underline`, `\footnote`, `\\` breaks, `~`, `--`/`---`, ` ``…'' ` quotes, accents (`\'e` `\"o` `\c{c}` …), `\LaTeX` and the common symbol macros, `\url` and `\href` |
| **Lists** | `itemize`, `enumerate` (numbered), `description` |
| **Maths** | `$…$`, `\(…\)`, `\[…\]`, `$$…$$`, `equation` `align` `gather` `multline` `alignat` `flalign` `eqnarray` `displaymath` and their starred forms, `aligned` `gathered` `split` `cases` `array` and the matrix family — all through KaTeX, with **Vellum's own equation numbering** (KaTeX restarts its counter per block, which would print "(1)" for every equation in a paper) and `\nonumber`/`\notag` honoured |
| **Floats** | `figure` with `\includegraphics` (extension optional, resolved against your vault) and `\caption`; `table` with `tabular`/`tabularx`/`longtable`, `\multicolumn`, alignment from the column spec |
| **Blocks** | `quote` `quotation` `verse`, `center`, `verbatim` `lstlisting` `minted` (highlighted), `thebibliography` with `\bibitem` |
| **Theorems** | `theorem` `lemma` `proposition` `corollary` `definition` `remark` `example` `proof` and friends, numbered, with the optional `[title]` |
| **Macros** | `\newcommand`/`\renewcommand` with up to nine arguments and an optional default — expanded in text, and handed to KaTeX for maths |
| **Ignored** | preamble furniture (`\documentclass`, `\usepackage`, `\setlength`, `\hypersetup`, spacing commands, `\index`, `\nocite`) — consumed silently, never printed |

Known simplifications, stated rather than discovered: numbering is
article-style (`1`, `1.1`, `1.1.1`) whatever the document class; `\ref` prints a
number for a local label and the target's *title* across a note boundary,
because a bare "1" means nothing in someone else's paper; and BibTeX is not
run — `\cite` resolves against a `\bibitem` in the document or a note carrying
that `citekey:`, and is otherwise left alone.

### Navigating

- **Backlinks panel** — every note shows who links to it, with the sentence that did
- **Outline (TOC) panel** — the open note's headings, tracking your scroll position; click to jump
- **Graph view** — hand-rolled canvas force simulation; drag nodes, hover to highlight neighbors, click to open
- **Full-text search** — prefix + fuzzy (MiniSearch), highlighted snippets with markdown syntax stripped, instant
- **Tags** — `#inline` and frontmatter `tags:`, counted and clickable in the sidebar
- **Attachments are in the tree** — your vault is not only `.md`, and the sidebar says so: images, PDFs, audio, video and everything else sit under their folder beneath the notes, each with a type glyph, and the footer counts both ("1,388 notes · 1,176 files"). Clicking an image opens a lightbox — natural size capped to the viewport, filename, pixel dimensions and file size, `←`/`→` through the rest of that folder ("3 / 47"), `Esc` or a click outside to leave. PDFs open in a browser tab, audio and video get an inline player, anything else offers a download. The paperclip in the sidebar footer hides them all again, and remembers
- **Reorganize by dragging** — drag a note or a whole folder onto any folder row, onto an ancestor, or onto the vault's name to send it back to the top level. The valid target lights up in the accent; one it cannot take — a folder onto its own descendant, or the folder it is already in — is refused in red rather than staying quiet. Hovering a collapsed folder mid-drag **springs it open** after a beat so you can drill into a nested destination without letting go, the tree auto-scrolls near either edge, and dropping onto a folder that is still shut works fine. **Every link follows**: `[[wikilinks]]` written as paths, `[markdown](links)`, and the relative `![embeds](../Media/x.png)` inside the notes that moved — a folder move of 1,214 notes repairs 246 notes' links and is indexed before the request answers, so search, the graph and the public site are correct the moment it lands. A name collision asks for another name instead of overwriting, and every move raises a toast naming both ends **with Undo**. No mouse? "Move to…" in a row's right-click menu and in the command palette opens a filterable folder picker that does exactly the same thing — as does dropping images straight from your desktop onto a folder row
- **Daily notes** — `Ctrl/Cmd D` opens (or creates) `daily/YYYY-MM-DD.md`
- **A shell that gets out of the way** — collapse either pane (`Ctrl/Cmd Alt B`, `Ctrl/Cmd Alt Shift B`) down to a slim reopen handle, or go **zen** (`Ctrl/Cmd Shift Z`): sidebar, panel, tabs and status bar step aside and the prose centers on a wide measure. `Esc` (or the faint ✕) comes back. Every state is remembered across reloads — and **folding a pane never moves the note**: the column stays optically centred in the window whichever panes are open, with deliberate air beside a closed pane's reopen handle
- **Notes sidebar on either side** — three states, in the palette and in Settings → Appearance & language: *follow the language* (the default — left in English, right in Arabic, re-evaluated whenever the language changes) or pin it to the left or right screen edge for good
- **Command palette** — fuzzy over notes and commands, including "Toggle reading view", "Open daily note", "Zen mode", themes, vim
- **Live vault watching** — edit a file in any other editor and the app updates within ~100 ms (chokidar + SSE)
- **Fifteen hand-tuned themes** — eleven dark (*iron-gall*, *cinnabar*, *sumi*, *void*, *basalt*, *nocturne*, *lapis*, *verdigris*, *moss*, *porphyry*, *tallow*) and four light (*parchment*, *sandstone*, *solar*, *linen*), no two of them the same room (`scripts/check-contrast.mjs` holds every accent 4.5:1 against its ground **and** 18 ΔE clear of its own body text), browsed from a keyboard-driven picker that previews live; zero CDN requests (webfonts are opt-in and self-hosted — see [Typography](#typography))
- **A font catalog with real Arabic** — four slots over 27 curated faces, fetched once and served from your own machine; the Arabic face answers per *character*, so mixed Arabic/Latin paragraphs set correctly in either language
- **Arabic & RTL** — `SITE_LANG=ar` localizes every chrome string and mirrors the entire interface right-to-left (app *and* blog), with Arabic-locale dates; an optional language filter keeps the public blog monolingual on a bilingual vault, and an optional visitor `EN`/`ع` switch lets readers pick for themselves
- **Modes you cannot sit in by accident** — reading, vim and visitor preview each light a pill in the status bar (accent-filled, clickable to leave, tooltip naming the shortcut), and a mode that takes typing away also states itself *in the workspace*: a one-line strip above the note ("Reading — this note is read-only" + an **Edit** button) plus an accent rule down the column's leading edge. Vim gets the same treatment one level deeper, because "vim is on" is not the trap — "the keys under your fingers are commands right now" is: the pill carries the live sub-mode (**VIM │ NORMAL**, **│ INSERT**, **│ VISUAL**, **│ REPLACE**), vim's own `-- INSERT --` line and `:` / `/` command line sit at the foot of the editor, and in zen — where the whole status bar is at zero height — the strip says it instead. Visitor preview is a strip at the top that pushes the page down — it never covers the layout you opened it to judge — and it never survives a reload
- **Blog hover previews** — resting on any post link floats a scrollable preview of that note, rendered by the reading renderer: it opens into whichever room the viewport has, fades at whichever edge has more prose past it, and answers the keyboard too (a Tab-focused link gets the same card). The topic nav never wraps, and a ✦ carries long reads back to the top

## Keymap

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd /` | Keyboard shortcuts — every binding, grouped and searchable |
| `Ctrl/Cmd P` | Command palette (open note, run command) |
| `Ctrl/Cmd K` | Search — focuses the sidebar search in the app; opens a centered search overlay on the public blog |
| `Ctrl/Cmd E` | Toggle reading view ⇄ editor |
| `Ctrl/Cmd D` | Open today's daily note |
| `Ctrl/Cmd N` | New note |
| `Ctrl/Cmd G` | Toggle graph view |
| `Ctrl/Cmd B` | **Bold** |
| `Ctrl/Cmd I` | *Italic* |
| `Ctrl/Cmd U` | Underline (`<u>`) |
| `Ctrl/Cmd Shift X` | Strikethrough |
| `Ctrl/Cmd Shift H` | Highlight |
| Right-click / `Shift F10` | Formatting menu for the selection — text style, structure, insert, colour |
| `Ctrl/Cmd Alt T` | Insert template… at the cursor |
| `Ctrl/Cmd Alt Shift T` | New note from template… |
| `Ctrl/Cmd Alt B` | Collapse / reopen the **Notes sidebar** |
| `Ctrl/Cmd Alt Shift B` | Collapse / reopen **Outline & backlinks** |
| `Ctrl/Cmd Shift Z` | Zen mode — all chrome steps aside (`Esc` returns) |
| `Ctrl/Cmd S` | Save now (autosave runs regardless) |
| `Ctrl/Cmd ↑` / `↓` | Move the current line up / down |
| `/` at line start | Slash menu (callout, code fence, table, …) |
| Click | Follow a rendered wikilink (create it if unresolved) |
| `Ctrl/Cmd`-click | Follow a wikilink on the line you're editing |
| `↑` `↓` `Enter` `Esc` | Navigate / confirm / dismiss the palette (`Enter` always runs the keyboard's row, never whatever the mouse happens to rest on) |
| `Esc` | Out of visitor preview, out of zen, and back to the note from `Ctrl/Cmd K` |
| `←` `→` `Esc` | Previous / next file in the attachment viewer, and out of it |

The five formatting keys are Obsidian's, checked against its shortcut tables rather than guessed —
except underline, which Obsidian has no command for at all (markdown has no underline; Vellum's
emits `<u>`, which the sanitizer already admitted and the reading view already rendered). All five
**toggle**: press twice and the markers come off. With nothing selected they insert the pair and
park the caret between them, so bold-then-type works. Across a multi-line selection they apply
**per line** — markdown emphasis cannot cross a blank line, and one `**` at the top of three
paragraphs is two stray asterisks, not bold text.

**`Ctrl/Cmd B` used to fold the notes sidebar.** Formatting won it: it is the binding every reader
arrives with, and a key that bolds a word in one half of the window and folds a pane in the other
is a key nobody can describe. The two pane toggles kept their shape — one key, `Shift` picks the
second pane — and moved one modifier out, so the only thing to re-learn is "add `Alt`". Outside the
editor `Ctrl/Cmd B` and `Ctrl/Cmd Shift B` are still swallowed, because Firefox's bookmarks sidebar
and Chrome's bookmark bar must never open over the app.

In vim mode, `Ctrl D` and `Ctrl B` inside the editor keep their half-page scroll and page-up, and
`Esc` stays vim's mode key — use `Cmd`, the palette, or zen's ✕ instead. On macOS, `Cmd Shift Z`
inside the editor stays redo; `Ctrl Shift Z` enters zen there.

## Architecture

```
┌────────────────────────────┐        ┌─────────────────────────────┐
│  Client — React + CM6      │  HTTP  │  Server — Hono (Node ≥ 24)  │
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
