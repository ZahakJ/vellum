# Configuration

*Every `.env` key, the runtime Settings panel, and how the two decide who wins.*

← [Back to the README](../README.md) · [All docs](README.md)

---

Vellum is configured in two places, and they are the same place twice: an `.env` file read at
startup, and a **Settings** panel that writes `VELLUM_DATA/settings.json` while the server runs.
Most site-identity keys exist in both. A value saved in the panel **overrides** its env
counterpart; clearing that field in the panel falls back to the env default. A handful of keys —
the security-sensitive ones — are env-only forever.

## Environment variables

npm scripts load `.env` automatically (`node --env-file-if-exists=.env`), so no `export` and no
`source` is needed. `.env.example` in the repo root is the annotated full list; this is the
summary.

| Key | What |
| --- | ---- |
| `PORT` | Server port (default 6801) |
| `HOST` | Bind address (default `0.0.0.0`). A non-loopback bind with no password prints a loud warning: everyone who can reach the port is an admin |
| `VELLUM_VAULT` | Vault directory (default `./vault`). The `--vault <path>` CLI argument outranks it |
| `VELLUM_DATA` | Server data directory — `settings.json`, the comments SQLite db, your `custom.css`, `designs.json`, the git credentials file, and `fonts/` (your own files, plus the self-hosted catalog cache in `fonts/catalog/` and uploads in `fonts/custom/`; default `./data`) |
| `ADMIN_PASSWORD_HASH` | argon2id hash from `npm run hash-password`; unset → open local mode |
| `SESSION_SECRET` | Signs session cookies; unset → an ephemeral secret is generated and sessions die on restart |
| `PUBLIC` | `false` requires login even to read (default: reading is public). **Refuses to start without `ADMIN_PASSWORD_HASH`** |
| `SECURE_COOKIES` | `true`/`false` to force the session cookie's `Secure` flag; unset → derived from the request scheme (and `X-Forwarded-Proto` from a trusted proxy) |
| `TRUSTED_PROXIES` | Comma-separated IPs/CIDRs allowed to set `X-Forwarded-For` / `X-Forwarded-Proto` (e.g. `127.0.0.1,::1`); unset → both headers ignored, rate limit uses the socket address |
| `HOME_NOTE` | Vault-relative note fresh visitors land on, e.g. `index.md` |
| `COMMENTS` | `on` (also `true`/`1`/`yes`) enables reader comments under published notes (default off) |
| `SITE_NAME` | Site name shown in the sidebar wordmark, page titles, and the login modal (default `Vellum`) |
| `SITE_TAGLINE` | Masthead subtitle under the site name (blog mode) |
| `SITE_FOOTER` | Blog footer line; `{year}`/`{siteName}` substituted (default `© {year} {siteName}`) |
| `SITE_URL` | Canonical origin for RSS/canonical links, e.g. `https://notes.example.com`; unset → derived from request headers. **Env-only — it has no Settings-panel counterpart** |
| `DEFAULT_THEME` | Theme for visitors who haven't picked one — any of the fifteen, or `custom:<name>` for one you built (see [Theming](theming.md)); case-insensitive; unknown names are ignored with one line on stderr |
| `EXCLUDE_TAGS` | Comma-separated tags hidden from the visitor site's topic sections and tag pills (workflow/status tags like `draft,seedling`); case-insensitive, a leading `#` is fine; admin views unaffected |
| `PUBLIC_LAYOUT` | `blog` gives visitors a classic blog layout instead of the app shell (see [Blog mode](blog-mode.md)); `designed` composes it from a design you author (see [Designer](designer.md)); anything else → `app` (the default) |
| `SITE_LANG` | Interface language: `en` (default) or `ar`. `ar` localizes every chrome string and mirrors the whole UI right-to-left (see [Arabic & RTL](arabic-and-rtl.md)) |
| `BLOG_LOCALE` | BCP47 locale for post dates and the RSS channel language (default: follows `SITE_LANG`) |
| `LANGUAGE_FILTER` | Which published notes the public site shows, by the language they are written in: `off` (default) · `follow` (each reader gets their own) · `ar` · `en`. Legacy `true`/`false` still parse — see [Language filter](arabic-and-rtl.md#language-filter) |
| `ATTACHMENTS_DIR` | Vault-relative directory the in-app image upload writes into (default `attachments`), created on demand |
| `BANNER_FALLBACK` | Blog hero for posts without a `banner:` — `generated` (default; a deterministic abstract gradient from the note title) or `none` |
| `VELLUM_GIT_SSH_COMMAND` | The one `GIT_*` variable Vellum passes through to the git child process, verbatim, as `GIT_SSH_COMMAND` — see [Backup & sync](backup-and-sync.md#things-worth-knowing) |

Request bodies are capped server-side before any parsing buffers them, with no env key: 10 MB on
any `/api` request, and a much tighter 64 KB on the anonymous surfaces (comment posts and login),
so oversized uploads are rejected (HTTP 413) instead of occupying memory. Uploads get their own
allowance on top. A matching cap at the proxy is still a sensible extra layer — e.g. nginx
`client_max_body_size 10m;`.

## The Settings panel

Most of the site-identity keys above can also be changed **at runtime, from the app** — no
`.env` edit, no restart. As admin, open **Settings** (the gear in the status bar, or the
command palette): a panel with six tabs, each opening with its name and one sentence saying what
it decides.

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
  frontmatter), the **tags folder**, and the **tag labels** table — display names for canonical
  tags, for a front end that should read «برمجيات» over a vault that keeps `#software`. See
  [Hijri dates](arabic-and-rtl.md#hijri-dates),
  [Note direction & alignment](arabic-and-rtl.md#note-direction--alignment) and
  [Localised tag labels](arabic-and-rtl.md#localised-tag-labels).
- **Publishing & comments** — public layout (`app` / `blog` / `designed`), excluded tags, the
  comments and share-button toggles, the **templates folder** and the **template for new notes**,
  and the home page visitors land on at `/`: classic `note` mode with a chosen home note, or the
  `dashboard` magazine layout, plus an optional hero banner. The home rows are read by the `blog`
  and `designed` layouts only, so with `Public layout: app` the panel greys them and says so — an
  app-layout instance opens the home note at `/`.
- **Typography** — four font slots (text / interface / code / Arabic script) over a curated,
  self-hosted catalog *or* faces you upload yourself, with a live specimen that stays on screen
  while you choose. See [Typography](typography.md).
- **Backup & sync** — commit the vault and push it to a private git remote you own, manually or
  on a timer. Off until you turn it on. See [Backup & sync](backup-and-sync.md).
- **About** — the version, the Node version, the vault's counts, and the absolute paths of the
  vault, the data directory, `settings.json` and the uploaded-fonts folder.

Image fields reuse the banner machinery: pick from the vault's attachments or upload right
there (drag & drop; bytes are sniffed; lands in `ATTACHMENTS_DIR`).

**Every control in the panel is drawn by Vellum**, not by your operating system. Lists are a
themed popover anchored to their trigger and kept inside the panel — height capped to the room
available, flipping above the trigger when there is none, arrow keys and type-ahead, `Enter` to
commit, `Esc` to put the value back; switches are switches; three-way rows (*inherit* / on / off)
show all three states at once; numbers carry their unit inside the field. A native `<select>`
opens an OS-drawn window that no theme can reach and no panel can contain, which is exactly what
a twenty-seven-face font list must never do.

## Settings keys

These are the keys `VELLUM_DATA/settings.json` can hold, as the panel and `PATCH /api/settings`
write them. Anything absent falls back to the env default in the table above.

| Key | Values | Default |
| --- | --- | --- |
| `siteName` | string, ≤ 80 chars | `SITE_NAME`, else `Vellum` |
| `tagline` | string, ≤ 160 | `SITE_TAGLINE`, else none |
| `footer` | string, ≤ 200 | `SITE_FOOTER`, else `© {year} {siteName}` |
| `defaultTheme` | one of the fifteen ids, or `custom:<name>` for a theme that exists | `DEFAULT_THEME`, else none |
| `publicLayout` | `app` · `blog` · `designed` | `PUBLIC_LAYOUT`, else `app` |
| `blogLocale` | BCP47 tag, ≤ 35 chars, canonicalized on save | `BLOG_LOCALE`, else `ar` when the language is Arabic, else `en` |
| `language` | `en` · `ar` | `SITE_LANG`, else `en` |
| `languageFilter` | `off` · `follow` · `ar` · `en` | `LANGUAGE_FILTER`, else `off` |
| `languageToggle` | boolean — the public `EN`/`ع` switch. **No env counterpart** | `false` |
| `excludeTags` | array of strings, ≤ 200 entries, ≤ 50 chars each | `EXCLUDE_TAGS`, else empty |
| `commentsEnabled` | boolean | `COMMENTS`, else `false` |
| `shareButtons` | boolean — the share row under blog articles | `true` |
| `favicon` | vault-relative image (`.ico .png .svg .jpg .jpeg .gif .webp .avif`) | none |
| `logo` | https URL or vault-relative image | none |
| `home.mode` | `note` · `dashboard` | `note` |
| `home.note` | vault-relative note (`.md` / `.tex` / `.latex`) | `HOME_NOTE` |
| `home.banner` | https URL or vault image | none — a generated gradient seeded from the site name |
| `templatesFolder` | vault-relative folder | auto-detected (`Templates`, `_templates`, `قوالب`), else none |
| `defaultTemplate` | vault-relative note applied to every new note | none |
| `dateCalendar` | `gregorian` · `hijri` · `both` | `gregorian` |
| `textDirection` | `auto` · `ltr` · `rtl` | `auto` |
| `textAlign` | `start` · `left` · `right` · `center` · `justify` | `start` |
| `tagsFolder` | vault-relative folder holding tag pages | auto-detected, else `tags` |
| `tagLabels` | `{ tag: { en, ar } }`, ≤ 200 tags — **replaced whole, not merged** | empty |
| `fonts.prose` / `.ui` / `.mono` / `.arabic` | a catalog id, `custom:<file>` for an upload, or `system` | `system` |
| `fonts.arabicSizeAdjust` | integer percent, 50–300 | the catalog face's own measured value, or none |
| `gitSync.enabled` | boolean | `false` |
| `gitSync.remote` | `https://…`, `ssh://…` or `git@host:path`, no embedded credentials | none |
| `gitSync.branch` | string | `main` |
| `gitSync.intervalMinutes` | integer 0–1440; `0` is *manual only* | `0` |
| `gitSync.pullFirst` | boolean — fast-forward-only pull before each sync | `true` |
| `gitSync.authMode` | `ssh` · `token` | `ssh` |

Two more keys are **write-only**: `gitToken` and `gitUser` are accepted by `PATCH /api/settings`
and stored in `VELLUM_DATA/git-credentials.json` at mode `0600` — never in `settings.json`, and
never readable back. A read answers `gitSync.tokenSet: true` and the username, nothing more.

`settings.json` is written atomically — a crash can't tear it. Changes apply live: the wordmark,
layout, theme default, excluded tags, comments routes, and favicon all update without a restart.
If the file is ever corrupted, the server logs one warning and runs on env defaults.

Security-sensitive keys are deliberately **env-only forever** and never readable or writable
through the panel or `/api/settings`: `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `TRUSTED_PROXIES`,
`PORT`, `HOST`, `VELLUM_VAULT`, `VELLUM_DATA`, `PUBLIC`. `SITE_URL` is env-only too, for the
duller reason that nothing has ever needed to change it at runtime.

## The settings API

Admin-only; visitors get a 404.

- `GET /api/settings` answers the stored keys plus `effective` (the merged values actually in
  use), the font catalog, and an `about` block (version, Node version, absolute paths, counts).
- `PATCH /api/settings` takes a partial object — only named keys change, `null` clears one and
  falls back to env — validates strictly (unknown keys are a 400), and answers the same shape.
  The git credential keys additionally require a real password on the instance.
