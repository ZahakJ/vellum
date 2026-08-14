# Vellum

**A self-hosted, clone-and-run Obsidian-style markdown vault — live-preview editor, wikilinks, backlinks, graph view, and full-text search over a plain folder of `.md` files.**

> A *vellum* was the candlelit room where manuscripts were copied and illuminated. This one runs on `localhost`.

## Why not just Obsidian?

Obsidian is excellent — and if it fits, use it. Vellum exists for the gap it leaves: a vault you can open **from any browser** on your network, served by **one small Node process you host yourself**, with no desktop install, no sync subscription, and no plugin sprawl. It is local-first in the strictest sense: your notes are ordinary markdown files in an ordinary folder, readable and writable by every other tool you own. Point Vellum at an existing Obsidian vault and both keep working — Vellum never converts, wraps, or databases your files. If you delete the app tomorrow, your notes don't notice.

## Quickstart

```sh
git clone https://github.com/avicenna/vellum.git
cd vellum
npm install
npm start
```

Open **http://localhost:6801**. On first launch Vellum creates `./vault` and seeds it with seven interlinked starter notes that double as the user manual.

### Point it at your own notes

Any folder of `.md` files is a vault:

```sh
VELLUM_VAULT=~/notes npm start
# or
npm start -- --vault ~/notes
```

### Dev mode

```sh
npm run dev
```

Runs the API server and Vite with hot reload side by side.

| Port | What | When |
| ---- | ---- | ---- |
| 6801 | Hono server (API + built client) | `npm start` / always |
| 5801 | Vite dev server (proxies `/api` → 6801) | `npm run dev` only |

`PORT` overrides the server port.

## Features

- **Live-preview editor** (CodeMirror 6) — markdown syntax hides itself except on the line you're editing; headings set in serif, clickable checkboxes, gold `[[wikilinks]]`, tag pills
- **Wikilinks with autocomplete** — type `[[` and pick any note; `[[Name|alias]]` and `[[Name#heading]]` supported; renames rewrite every link that pointed at the old name
- **Backlinks panel** — every note shows who links to it, with the sentence that did
- **Graph view** — hand-rolled canvas force simulation; drag nodes, hover to highlight neighbors, click to open
- **Full-text search** — prefix + fuzzy (MiniSearch), highlighted snippets, instant
- **Tags** — `#inline` and frontmatter `tags:`, counted and clickable in the sidebar
- **Live vault watching** — edit a file in any other editor and the app updates within ~100 ms (chokidar + SSE)
- **Two hand-tuned themes** — *iron-gall* dark and *parchment* light, gold-leaf accent, zero external fonts or CDN requests
- **Vim mode**, autosave, command palette, and a keyboard-first surface

## Keymap

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd P` | Command palette (open note, run command) |
| `Ctrl/Cmd N` | New note |
| `Ctrl/Cmd G` | Toggle graph view |
| `Ctrl/Cmd S` | Save now (autosave runs regardless) |
| `Ctrl/Cmd`-click | Follow a wikilink |
| `↑` `↓` `Enter` `Esc` | Navigate / confirm / dismiss the palette |

## Architecture

```
┌────────────────────────────┐        ┌─────────────────────────────┐
│  Client — React + CM6      │  HTTP  │  Server — Hono (Node ≥22.6) │
│  live preview · graph      │◄──────►│  /api: tree · note · search │
│  palette · zustand store   │  SSE   │  graph · backlinks · tags   │
└────────────────────────────┘        │  in-memory index (MiniSearch│
                                      │  + link graph) ← chokidar   │
                                      └──────────────┬──────────────┘
                                                     ▼
                                          your vault: plain .md files
```

- **Server** (`server/`) — Hono on Node's native TypeScript support (no build step for the backend). Watches the vault with chokidar, keeps an in-memory MiniSearch index plus a wikilink graph, and streams change events to the client over SSE.
- **Client** (`client/`) — React + zustand, CodeMirror 6 editor with a custom live-preview decoration plugin, canvas graph view. Built by Vite into `dist/`, statically served in production.
- **Shared** (`shared/types.ts`) — the wire contract both sides import.

Screenshots: *coming soon.*

## License

[MIT](LICENSE) © 2026 avicenna
