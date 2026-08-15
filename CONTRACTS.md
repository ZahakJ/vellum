# Vellum — module contracts

Read this whole file before writing code. `shared/types.ts` is the wire contract; import from it with
`import type { ... } from "../shared/types.ts"` (server) / `"../../shared/types.ts"` (client). All
imports use explicit `.ts`/`.tsx` extensions (tsconfig has `allowImportingTsExtensions` + `verbatimModuleSyntax`;
type-only imports must use `import type`). TS strict. Node ≥ 22.6 runs `.ts` directly (type stripping):
server code must use only erasable TS (no enums/namespaces/parameter-properties).

## Identity & design language

Vellum: a candlelit manuscript room. Dark theme "iron-gall" (near-black warm ink background,
warm off-white text), light theme "parchment" (warm paper background). Accent: gold-leaf
`#c9a227` (dark) / `#8a6d1a` (light). Serif display font for headings in rendered markdown
(Georgia/serif stack), system sans for UI, monospace (ui-monospace stack) for raw markdown/code. No
external font/CDN fetches — system stacks only. Density: calm, generous line-height (1.6 editor),
subtle 1px borders using `var(--border)`, minimal chrome. Everything themeable via the CSS custom
properties listed in the styles contract; components must use tokens, never hard-coded colors.

## Runtime layout

- Server: Hono on port **6801** (`PORT` env overrides). Vault directory resolved in this order:
  `--vault <dir>` CLI arg, `VELLUM_VAULT` env, `./vault`. Created + seeded from `vault-seed/`
  if missing.
- Dev: vite on **5801** proxies `/api` → 6801. Prod: server statically serves `dist/`.
- SPA fallback: non-`/api` GETs serve `dist/index.html` when dist exists.

## API (all JSON; errors -> `{ error: string }` with 4xx/5xx)

- `GET  /api/tree` → `TreeNode` (root folder node, path "")
- `GET  /api/note?path=a/b.md` → `NoteData`
- `PUT  /api/note?path=` body `{ content: string }` → `NoteData` (writes file; creates parent dirs)
- `POST /api/note` body `{ path: string }` → `NoteData` (create empty; 409 if exists)
- `POST /api/rename` body `{ path, toPath }` → `{ ok: true }` (also rewrites `[[wikilinks]]` in other notes that pointed at the old name)
- `DELETE /api/note?path=` → `{ ok: true }`
- `POST /api/folder` body `{ path }` → `{ ok: true }`
- `GET  /api/search?q=` → `SearchHit[]` (max 50, minisearch, prefix+fuzzy)
- `GET  /api/graph` → `GraphData` (nodes = all md files, edges = resolved wikilinks)
- `GET  /api/backlinks?path=` → `Backlink[]`
- `GET  /api/tags` → `TagCount[]` (from `#tag` inline + frontmatter `tags:`)
- `GET  /api/events` → SSE stream of `VaultEvent` (chokidar watcher; debounced 100ms; events named `message`, JSON data)

Path safety: every path param normalized, must resolve inside vault, must not contain `..`; only
`.md` files served/written by note endpoints (400 otherwise). Wikilink resolution: `[[Name]]`
matches file basename (no `.md`, case-insensitive); shortest-path winner on duplicates;
`[[Name|alias]]` and `[[Name#heading]]` variants parse (link target is `Name`).

## Server modules (server agent owns `server/`)

- `server/vault.ts` — vault root resolution, safe path helpers, tree/read/write/create/rename/delete/mkdir, chokidar watcher exposing `onEvent(cb)`.
- `server/indexer.ts` — in-memory index rebuilt incrementally from watcher: minisearch (fields title+content), link graph, backlinks, tags. Exports `search(q)`, `graph()`, `backlinks(path)`, `tags()`, `resolveLink(name): string | null`.
- `server/api.ts` — `export const api: Hono` implementing routes above.
- `server/index.ts` — arg/env parsing, seed-on-missing (copy `vault-seed/` → vault), mount `api` at `/api`, static `dist/` + SPA fallback, listen 6801 with startup banner.

## Client state (shell agent owns; file `client/state.ts`)

zustand store `useStore`:

```ts
interface State {
  tree: TreeNode | null;
  openPath: string | null;      // current note
  openTabs: string[];           // ordered open note paths
  dirty: Record<string, boolean>;
  view: "editor" | "graph";
  theme: "iron-gall" | "parchment";   // persisted localStorage "vellum.theme"; sets data-theme attr on <html>
  vimMode: boolean;                    // persisted "vellum.vim"
  paletteOpen: boolean;
  backlinks: Backlink[];        // for openPath
  // actions:
  loadTree(): Promise<void>;
  openNote(path: string): void;        // adds tab, sets openPath, view="editor"
  closeTab(path: string): void;
  setView(v: State["view"]): void;
  setTheme(t: State["theme"]): void; toggleVim(): void;
  setPaletteOpen(b: boolean): void;
  refreshBacklinks(): Promise<void>;
  createNote(path: string): Promise<void>;
  renameNote(path: string, toPath: string): Promise<void>;
  deleteNote(path: string): Promise<void>;
}
```

`client/api.ts` — typed fetchers for every endpoint (`getTree`, `getNote`, `putNote`, `createNote`,
`renameNote`, `deleteNote`, `createFolder`, `search`, `getGraph`, `getBacklinks`, `getTags`,
`subscribeEvents(cb): () => void`). Shell agent owns it.

## Component contracts

- Shell agent owns `client/index.html` (already written), `client/main.tsx`, `client/App.tsx`,
  `client/state.ts`, `client/api.ts`, `client/components/Sidebar.tsx`, `Tabs.tsx`, `StatusBar.tsx`,
  `BacklinksPanel.tsx`. Layout: left sidebar (tree + search box + tags), center column (Tabs on top,
  then Editor or GraphView per `view`), right collapsible backlinks panel, bottom StatusBar
  (word count of open note, vim toggle, theme toggle). App wires keyboard: `Ctrl/Cmd+P` palette,
  `Ctrl/Cmd+G` graph toggle, `Ctrl/Cmd+N` new note. App subscribes to SSE → `loadTree()` +
  refresh open note if changed externally.
- Editor agent owns `client/editor/` and `client/components/Editor.tsx`.
  Props: `{ path: string }`. It loads the note via
  `client/api.ts` fetchers, autosaves (600ms debounce after change; also on Ctrl/Cmd+S),
  reports dirty state to store. Exports default React component.
  - `client/editor/setup.ts` — builds the CM6 `EditorState` extensions: markdown lang, history,
    search, vim (conditional), theme extension, live-preview extension, wikilink autocomplete.
  - `client/editor/livePreview.ts` — THE flagship. Obsidian-style live preview via ViewPlugin +
    Decoration: hide markdown syntax tokens (`#`, `**`, `_`, `` ` ``, link brackets) on lines the
    cursor is NOT on; style headings (sized, serif), bold/italic/strikethrough, inline code,
    blockquote bar, list bullets → `•`, checkboxes → clickable ✓ widgets that toggle `- [ ]`/`- [x]`,
    `[[wikilinks]]` → gold accent, click-with-Cmd/Ctrl (or plain click when syntax hidden) opens via
    `useStore.getState().openNote(resolveTarget(...))` — resolve by fetching graph or a
    `resolveLink` helper in `client/editor/links.ts` that matches against store tree basenames.
    `#tags` → pill styling. External urls clickable.
  - `client/editor/autocomplete.ts` — typing `[[` completes note titles from store tree.
  - `client/editor/theme.ts` — CM6 theme reading the CSS custom properties (use var() in the theme spec).
- Graph/palette agent owns `client/components/GraphView.tsx` (canvas force-directed sim,
  hand-rolled: repulsion + spring + centering, ~60fps rAF, drag nodes, click node → openNote,
  hover highlights neighbors, resize-aware, colors from CSS tokens via getComputedStyle) and
  `client/components/CommandPalette.tsx` (modal, fuzzy over: open note by title [uses
  `search` api when query nonempty, else recent/all from tree], commands: New note, Toggle graph,
  Toggle theme, Toggle vim, Delete current, Rename current [inline second input]; ↑↓ + Enter, Esc).
- Styles/vault agent owns `client/styles/tokens.css` + `client/styles/app.css`, `vault-seed/`
  (6–8 interlinked starter notes teaching the app: Welcome, Wikilinks, Graph, Editor, Tags, Daily
  Notes…, each with real `[[links]]` + `#tags`), and `README.md` (hero pitch, quickstart
  `git clone / npm install / npm start`, point-at-your-vault instructions, features, keymap table,
  screenshots placeholder, port table, license MIT). Also `LICENSE` (MIT, holder "avicenna").

## CSS tokens (tokens.css must define exactly these on `:root` / `[data-theme="parchment"]`)

`--bg`, `--bg-raised`, `--bg-hover`, `--text`, `--text-muted`, `--text-faint`, `--accent`,
`--accent-soft` (translucent accent for backgrounds), `--border`, `--danger`, `--font-ui`,
`--font-serif`, `--font-mono`, `--radius` (6px), `--sidebar-w` (292px), `--font-base` (15.5px —
drives `html { font-size }`; ALL chrome is sized in rem so this one token scales the whole UI),
`--font-prose` (1.161rem ≈ 18px — editor/reading prose). Default (no attr) =
iron-gall dark. `data-theme` attr lives on `<html>`. app.css: layout grid, sidebar, tabs, panels,
palette, scrollbars (thin, themed), `::selection` gold. Class names are BEM-ish plain CSS,
prefix `s-` (e.g. `.s-sidebar`, `.s-tab`, `.s-palette`). Components must use these exact class
names where they exist in app.css; anything extra styled inline is a bug — put it in app.css.

## Conventions

- No default exports except React components. No `any` unless unavoidable. Small files > clever files.
- Errors surface to the user via `console.error` + a transient `.s-toast` div helper in
  `client/toast.ts` (`export function toast(msg: string)`) — shell agent owns it.
