# Vellum

**A self-hosted Obsidian-style vault and publish site for a folder of plain Markdown — live-preview editor, wikilinks, backlinks, graph view, embeds, callouts, math, a full reading view, and full-text search, all served by one small Node process.**

> A *vellum* was the candlelit room where manuscripts were copied and illuminated. This one runs on `localhost`.

![Live preview: KaTeX math, callouts, highlighted code, tasks, outline](docs/live-preview-dark.png)

## Why not just Obsidian?

Obsidian is excellent — and if it fits, use it. Vellum exists for the gap it leaves: a vault you can open **from any browser** on your network, served by **one small Node process you host yourself**, with no desktop install, no sync subscription, and no plugin sprawl. It is local-first in the strictest sense: your notes are ordinary markdown files in an ordinary folder, readable and writable by every other tool you own. Point Vellum at an existing Obsidian vault and both keep working — Vellum never converts, wraps, or databases your files, ignores `.obsidian/` entirely, and serves your existing attachments in place. If you delete the app tomorrow, your notes don't notice.

## Quickstart

```sh
git clone https://github.com/avicenna/vellum.git
cd vellum
npm install
npm start
```

Open **http://localhost:6801**. On first launch Vellum creates `./vault` and seeds it with seven interlinked starter notes that double as the user manual.

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

To put it on the internet, run Vellum behind any HTTPS reverse proxy (Caddy, nginx, a Cloudflare tunnel, …) forwarding to `localhost:6801` — the app is a single origin (API + static client on one port), so no special proxy rules are needed; just make sure it is only reachable over TLS so the login password and session cookie stay private. When you do sit it behind a proxy, also set `TRUSTED_PROXIES` to the proxy's address (e.g. `TRUSTED_PROXIES=127.0.0.1,::1`) so the login rate limit keys off the real client IP from `X-Forwarded-For` instead of lumping everyone together as the proxy's IP. The header is only ever trusted when the connection comes from a listed address — otherwise it is ignored, since clients can forge it.

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

### Dev mode

```sh
npm run dev
```

Runs the API server and Vite with hot reload side by side.

| Port | What | When |
| ---- | ---- | ---- |
| 6801 | Hono server (API + built client) | `npm start` / always |
| 5801 | Vite dev server (proxies `/api` → 6801) | `npm run dev` only |

`PORT` overrides the server port. `npm run typecheck` keeps the strict TypeScript build honest.
`scripts/shoot.mjs` is the screenshot harness used for visual review: point it at a running
server (`node scripts/shoot.mjs http://localhost:6801 shots`) and it captures the editor, graph,
and palette in both themes — it needs `npm i -D playwright` plus either
`npx playwright install chromium` or a system browser via `CHROMIUM=/usr/bin/chromium`.

## Features

### Writing

- **Live-preview editor** (CodeMirror 6) — markdown syntax hides itself except on the line you're editing; headings set in serif, clickable checkboxes, gold `[[wikilinks]]`, tag pills
- **Wikilinks with autocomplete** — type `[[` and pick any note; `[[Name|alias]]` and `[[Name#heading]]` supported (type `#` inside the brackets to complete headings); heading links render as `Note › Heading` and jump straight to the heading; renames rewrite every link that pointed at the old name
- **Click to follow, click to create** — plain click follows a rendered link; clicking an unresolved (dashed) link creates the note, Obsidian-style
- **Frontmatter properties card** — YAML frontmatter collapses to a neat key/value card with clickable tag pills while your cursor is outside it
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
- **Command palette** — fuzzy over notes and commands, including "Toggle reading view", "Open daily note", themes, vim
- **Live vault watching** — edit a file in any other editor and the app updates within ~100 ms (chokidar + SSE)
- **Two hand-tuned themes** — *iron-gall* dark and *parchment* light, gold-leaf accent, zero external fonts or CDN requests

## Keymap

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd P` | Command palette (open note, run command) |
| `Ctrl/Cmd E` | Toggle reading view ⇄ editor |
| `Ctrl/Cmd D` | Open today's daily note |
| `Ctrl/Cmd N` | New note |
| `Ctrl/Cmd G` | Toggle graph view |
| `Ctrl/Cmd S` | Save now (autosave runs regardless) |
| Click | Follow a rendered wikilink (create it if unresolved) |
| `Ctrl/Cmd`-click | Follow a wikilink on the line you're editing |
| `↑` `↓` `Enter` `Esc` | Navigate / confirm / dismiss the palette |

In vim mode, `Ctrl D` inside the editor keeps its half-page scroll; use the palette's "Open daily note".

## Screenshots

| | |
| --- | --- |
| ![Editor, iron-gall dark](docs/editor-dark.png) | ![Editor, parchment light](docs/editor-light.png) |
| ![Note transclusion card](docs/transclusion-dark.png) | ![Graph view](docs/graph-dark.png) |

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
