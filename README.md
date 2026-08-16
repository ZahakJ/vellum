<p align="center"><img src="docs/gh-hero.png" alt="Vellum" width="720"></p>

# Vellum

**Your Obsidian-style vault, self-hosted — and, when you want it, published as a beautiful blog. One small Node process.**

<p align="center"><a href="https://zahakj.github.io/vellum/"><strong>✦ Visit the project site ✦</strong></a></p>

[![License: MIT](https://img.shields.io/badge/license-MIT-b8912f.svg)](LICENSE)
[![Node ≥ 24](https://img.shields.io/badge/node-%E2%89%A5%2024-339933?logo=node.js&logoColor=white)](package.json)

> A *vellum* was the candlelit room where manuscripts were copied and illuminated. This one runs on `localhost`.

![The live-preview editor: callouts, tasks, wikilinks, KaTeX math, outline, local graph, and backlinks](docs/screenshots/hero-editor.png)

## Why Vellum

Obsidian is excellent — and if it fits, use it. Vellum exists for the gap it leaves: a vault you can open **from any browser** on your network, served by **one small Node process you host yourself**, with no desktop install, no sync subscription, and no plugin sprawl. It is local-first in the strictest sense: your notes are ordinary markdown files in an ordinary folder, readable and writable by every other tool you own. Point Vellum at an existing Obsidian vault and both keep working — it never converts, wraps, or databases your files, ignores `.obsidian/` entirely, and serves your existing attachments in place. If you delete the app tomorrow, your notes don't notice. And when some of those notes deserve readers, flip on [blog mode](docs/blog-mode.md): the same vault becomes a public site with articles, topics, RSS and reader comments — `publish: true` is the only frontmatter it asks for.

| | |
| --- | --- |
| ![Blog dashboard home](docs/screenshots/blog-dashboard.png)<br>*Blog mode's dashboard home — posts as cards, each with a generated gradient until you set a banner.* | ![Blog article with comments](docs/screenshots/blog-article.png)<br>*An article page: related posts, then "Marginalia" — built-in, rate-limited reader comments.* |
| ![Graph view](docs/screenshots/graph.png)<br>*Graph view — a hand-rolled canvas force simulation; drag nodes, click to open.* | ![The fifteen themes](docs/screenshots/themes.png)<br>*Fifteen hand-tuned themes — eleven dark, four light — each defining its whole palette.* |

## Quickstart

Needs **Node ≥ 24** (`node --version`).

```sh
git clone https://github.com/ZahakJ/vellum.git
cd vellum
npm install
npm start
```

Open **http://localhost:6801**. On first launch Vellum creates `./vault` and seeds it with
interlinked starter notes that double as the user manual.

### Point it at your own notes

Any folder of `.md` files is a vault — including a real Obsidian vault:

```sh
VELLUM_VAULT=~/notes npm start
# or:  npm start -- --vault ~/notes
```

What carries over: `[[wikilinks]]` (aliases, `#heading` links, rename-safe), `![[embeds]]`,
callouts, `$…$`/`$$…$$` math, `#tags` and frontmatter `tags:`, properties, highlights, comments,
footnotes, daily notes, and your Templates folder. Nothing is converted or moved, `.obsidian/` is
ignored everywhere, and attachments are served in place — the same vault keeps working in
Obsidian. ([Details](OBSIDIAN-COMPAT.md).)

### Publish it

Three steps from a private vault to a public site.

**1. Set an admin password**, so strangers read and only you write:

```sh
cp .env.example .env
npm run hash-password        # prompts, prints an argon2id hash
```

Put the hash in `.env` (single-quoted — it contains `$`), plus a cookie-signing secret:

```sh
ADMIN_PASSWORD_HASH='$argon2id$v=19$m=65536,...'
SESSION_SECRET=some-long-random-string   # e.g. openssl rand -hex 32
```

Visitors now get a read-only view; a "Sign in" link in the status bar unlocks editing for you.

**2. Mark a note as public** — add `publish: true` to its frontmatter, or press `Ctrl/Cmd Shift P`
with it open. Nothing else is visible to anyone.

**3. Turn on the blog**, in `.env` or live from Settings → Publishing & comments:

```sh
PUBLIC_LAYOUT=blog
SITE_NAME=Night Garden
```

Restart, and `/` is a blog: masthead, topic nav, article pages, RSS at `/feed.xml`, a sitemap at
`/sitemap.xml` and a `/robots.txt` that points at it. Put it on the
internet behind any HTTPS reverse proxy pointed at `localhost:6801` — see
[Publishing & access](docs/publishing.md).

## What's in it

- **[A live-preview editor](docs/editor.md)** — CodeMirror 6, wikilinks with autocomplete, hover previews, callouts, KaTeX, transclusions, slash commands, vim mode
- **[Backlinks, outline, graph and instant search](docs/editor.md#navigating)** — a hand-rolled canvas force simulation, MiniSearch over the whole vault, live file watching
- **[Templates and banners](docs/templates-and-notes.md)** — Obsidian's own template syntax, a `banner:` hero on any note, drag-to-move sections, a trash you can restore from
- **[LaTeX notes](docs/latex.md)** — `.tex` files are notes: edited, searched, linked and published like any other, and they still compile
- **[Publishing](docs/publishing.md)** — one frontmatter flag, a real server-side visitor preview, rate-limited reader comments with built-in moderation
- **[Blog mode](docs/blog-mode.md)** — masthead, topic nav, dashboard home, hover previews, RSS, sitemap/robots and server-injected SEO meta
- **[Designed mode](docs/designer.md)** — compose your own homepage from sections, fifty-nine shipped presets, with the stock blog kept as an always-working fallback
- **[Fifteen themes](docs/theming.md)** — eleven dark, four light, every one gated at WCAG AA, plus a custom-theme builder and `custom.css`
- **[Real typography](docs/typography.md)** — a self-hosted font catalog and your own uploads, with per-character Arabic that sets correctly inside an English sentence
- **[Arabic & RTL](docs/arabic-and-rtl.md)** — the whole interface mirrored and translated, an optional visitor `EN`/`ع` switch, a language filter, Hijri dates
- **[Backup & sync](docs/backup-and-sync.md)** — commit the vault to a private git remote you own, manually or on a timer, fast-forward only
- **Zero CDN requests.** No webfonts, no analytics, no telemetry, nothing phoning anywhere

## Documentation

| | |
| --- | --- |
| [Configuration](docs/configuration.md) | Every `.env` key, the Settings panel, every settings key |
| [Publishing & access](docs/publishing.md) | Passwords, sessions, the `publish:` flag, comments, HTTPS |
| [Blog mode](docs/blog-mode.md) · [Designed mode](docs/designer.md) | The two public shells |
| [The editor & reading view](docs/editor.md) | Live preview, rendering, navigation |
| [Templates, banners & notes](docs/templates-and-notes.md) · [LaTeX notes](docs/latex.md) | Authoring |
| [Theming](docs/theming.md) · [Typography](docs/typography.md) | The look |
| [Arabic & RTL](docs/arabic-and-rtl.md) | Language, direction, the filter, Hijri dates, tag labels |
| [Backup & sync](docs/backup-and-sync.md) · [Keymap](docs/keymap.md) · [Development](docs/development.md) | Operating and hacking on it |

Also in the repo: [`DESIGN.md`](DESIGN.md) (the rules a change is judged against),
[`CONTRACTS.md`](CONTRACTS.md) (the invariants the code has committed to), and
[`.env.example`](.env.example).

## Requirements

**Node ≥ 24**, and nothing else — no database, no build toolchain for the server. Three things set
that floor: type stripping on by default (22.18), `--env-file-if-exists` (22.9), and an unflagged
`node:sqlite` for the comments database (22.13). They line up at 24, the first LTS line carrying
all three. `engine-strict=true` is in `.npmrc`, so a clone on an older Node **fails at
`npm install`** with the required and actual versions in the message, rather than dying later with
a syntax error from inside a `.ts` file.

## Architecture

One process, one port, one origin. The **server** (`server/`) is Hono running on Node's native
TypeScript support — no build step — watching the vault with chokidar, keeping an in-memory
MiniSearch index plus a wikilink graph, streaming change events over SSE, and serving attachments
with ETags. Nothing is ever written outside the vault. The **client** (`client/`) is React +
zustand with a CodeMirror 6 live-preview plugin, a standalone reading-view renderer that shares the
editor's link/embed resolve logic, and a canvas graph view; Vite builds it into `dist/`, which the
same server serves statically. `shared/` holds the wire contract both sides import. Your notes stay
ordinary files on disk the entire time.

## License

[MIT](LICENSE) © 2026 avicenna
