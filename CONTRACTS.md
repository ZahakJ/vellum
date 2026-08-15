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
external font/CDN fetch ever reaches a VISITOR's browser: the defaults are system stacks, and the
opt-in webfont catalog is SELF-hosted — the server fetches once at save time, the instance serves
forever after (see "Typography" at the end of this file); the Arabic naskh faces sit at the END of the UI
and serif stacks, where they catch only the codepoints no Latin face covers. Density: calm, generous line-height (1.6 editor),
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
  // Shell layout, all persisted (see "Shell layout" below):
  sidebarSide: "left" | "right";       // "vellum.sidebarSide"
  sidebarCollapsed: boolean;           // "vellum.sidebarCollapsed"
  panelCollapsed: boolean;             // "vellum.panelCollapsed"
  zen: boolean;                        // "vellum.zen"
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

## Shell layout (sidebar side, collapse, zen)

Four persisted preferences live on the app root as classes: `s-app--flip`, `s-app--nosidebar`,
`s-app--zen` (plus the pre-existing `s-app--drawer`/`s-app--visitor`). The panel's own collapse
stays on `.s-panel--collapsed`, as it always did.

- **Side is PHYSICAL, direction is LOGICAL.** `sidebarSide` stores `"left"`/`"right"` because it
  is a window preference, not a language one: it must survive a language change, and the palette
  command that sets it names a screen edge in both languages. The grid areas
  (`"sidebar main panel"`) already follow the inline direction, so the stylesheet only needs the
  *disagreement*: `flipped = (lang === "ar") === (side === "left")` — an XOR — swaps the two grid
  areas and hands each pane the other's separator. Only the DEFAULT follows the language
  (`loadMe()` sets it when nothing is stored), exactly like `DEFAULT_THEME`.
- **That XOR is also the icon rule.** The pane chevrons (panel header toggle, both reopen
  handles) point at a physical edge, so they answer to *both* switches: `[dir="rtl"]` flips them,
  `.s-app--flip` flips them, and both together cancel. That is why they cannot be a plain
  `[dir="rtl"]` rule like the other mirrored SVGs, and why the `[dir="rtl"] .s-app--flip` rule
  that resets them to `none` has to exist.
- **Collapse animates a width, never `display`.** `.s-sidebar` carries the width
  (`--sidebar-w` + 1px for its border) and `overflow: hidden`; its children are pinned to
  `--sidebar-w` so the rows do not reflow to a narrower measure while the pane closes. Same
  pattern the backlinks panel already used. 180ms, both directions, zen included.
- **A collapsed pane leaves a door.** `.s-reopen--sidebar` / `.s-reopen--panel` are 14px
  full-height strips on the respective edges — always visible while collapsed (not hover-
  revealed), hidden on phones, hidden in zen.
- **Zen hides chrome; it does not disable behavior.** Editor shortcuts, `Ctrl/Cmd S`, publish
  and the palette all keep working. `Esc` leaves — unless something else owns Esc (a modal, the
  palette, a text field, or vim inside the editor), which is the same precedence Ctrl+D
  established. The ✕ fades after ~2s and returns on mouse movement; while faded it is also
  `pointer-events: none`, so there is no invisible hit target.
- **Anything that reveals results must reveal its pane — and focus AFTER the reveal lands.**
  `Ctrl/Cmd+K` and the editor's tag-pill click both push into the sidebar's search box; both
  first leave zen and un-collapse the sidebar, because focusing a field the reader cannot see
  swallows every keystroke after it. But a collapsed pane is `visibility: hidden` until React
  commits the class removal, and **a hidden element cannot take focus** — `focus()` in the same
  tick as the un-collapse silently does nothing, which is the *same* failure the rule exists to
  prevent, only quieter (the field is now visible and empty, and the typing went to the page).
  So `Sidebar.revealSidebar()` reports whether it had to open anything and the focus waits for
  the commit (an effect on `zen`/`sidebarCollapsed`); only an already-visible pane is focused
  synchronously.
- **The tree's context menu is clamped into the viewport, and opens toward the reading
  direction.** It is `position: fixed` at the pointer, and the pointer is now regularly at the
  *trailing* screen edge — the sidebar sits there by default in Arabic and whenever a reader
  moves it there in English. A menu that only ever grew toward the trailing edge lost its last
  item (which is "Delete folder") off-screen. A layout effect measures the rendered menu, opens
  it from the pointer toward the inline direction, folds it back when that edge has no room, and
  clamps both axes to an 8px margin.
- **Keyboard.** `Ctrl/Cmd+B` (sidebar) and `Ctrl/Cmd+Shift+B` (panel) are `preventDefault`-ed in
  the capture-phase handler next to `Ctrl+P`/`Ctrl+K` — Chrome's bookmark bar (`Ctrl+Shift+B`)
  and Firefox's bookmarks sidebar (`Ctrl+B`) must never fire. Plain `Ctrl+B` inside the editor
  yields to vim's page-up and to macOS's emacs-style char-left (`Cmd+B` still toggles there);
  `Ctrl/Cmd+Shift+Z` (zen) `stopPropagation`s so CodeMirror cannot redo on the same keystroke —
  except on macOS inside the editor, where `Mod-Shift-z` is the *only* redo binding and keeps it.

## CSS tokens (tokens.css must define exactly these on `:root` / `[data-theme="parchment"]`)

`--bg`, `--bg-raised`, `--bg-hover`, `--text`, `--text-muted`, `--text-faint`, `--accent`,
`--accent-soft` (translucent accent for backgrounds), `--border`, `--danger`, `--font-ui`,
`--font-serif`, `--font-mono`, `--radius` (6px), `--sidebar-w` (292px), `--font-scale`/`--prose-scale` (per-language type-scale
multipliers, 1 by default; `:root[lang="ar"]` raises them because naskh reads smaller than
Georgia at the same px — consumers must multiply, never replace, so a `custom.css` override of
the sizes survives), `--font-base` (15.5px —
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

## Folder deletion (server, shipped)

`DELETE /api/folder?path=<rel>&permanent=<bool>` → `{ notes: number, trashPath?: string }`

- **Admin only.** Guarded by the standard `authGuard` rule (every non-GET 401s without an admin
  session) — visitors and admin sessions sending `X-Vellum-Preview: visitor` both get
  `401 {"error":"Admin session required"}`.
- **Default (Obsidian-safe):** the folder is *moved* to `.trash/` at the vault root (created on
  demand). Name collisions get a counter: `guides`, then `guides-2`, `guides-3`… `.trash` is a
  dot-dir, so it is already invisible to the tree, indexer and watcher — trashed notes vanish from
  search/graph/backlinks/tags but the files are recoverable from disk.
- **`permanent=true`** (also `1`/`yes`/`on`) → `fs.rm` recursive; no `trashPath` in the response.
- `notes` = count of `.md` files that were inside (recursive, ignore rules applied) — for the UI copy.
- Errors: `400` missing/empty `path`, traversal (`..`), ignored trees (`.trash`, `.obsidian`, …),
  or a path that is a file; `404` when the folder does not exist.
- **Events:** exactly one synthetic `VaultEvent` `{kind:"deleted", path:"<rel>", dir:true}` on
  `/api/events`; the watcher's per-file `unlink`/`unlinkDir` echoes for the same removal are
  suppressed. The index (minisearch, graph, backlinks, tags, publishedSet) is updated *before* the
  response returns (`await whenIndexed()`), so a `/api/tree` + `/api/graph` refetch straight after
  the 200 is already correct — no debounce race.
- Vault API: `deleteFolder(rel, opts?: { permanent?: boolean }): Promise<{ notes, trashPath? }>`
  in `server/vault.ts`; trash dir name exported as `TRASH_DIR`.

**Client wiring (shipped).** `api.deleteFolder(path, permanent)` → `state.deleteFolder(path,
{permanent})`, offered as "Delete folder" on folder rows of the sidebar context menu (admin
only, never on the root row — the server 400s an empty path). The store action closes every open
tab whose path starts with `<folder>/` **before** `loadTree()`, then toasts (`folderTrashedToast`
naming .trash recovery, or `folderDeletedToast`).

The two speeds are two dialogs rather than the checkbox sketched here originally: the default
confirm ("Move “name” to .trash?" / "N notes will move… recoverable from disk", danger button
*Move to .trash*) carries a third, deliberately quiet route — `ConfirmOptions.extraLabel`, which
resolves `confirmModalEx()` as `"extra"` — and that opens a SECOND confirm with the permanent
copy. A checkbox would have let one click arm an irreversible erase of a whole subtree; a
quiet-affordance-then-confirm makes the reader say "permanently" twice. The note count comes
from the client's own tree (`countNotes`), which counts exactly what the server counts: the
tree holds `.md` files only and applies the same ignore rules.

**The second dialog must LOOK like the second dialog.** `ConfirmOptions.grave` (Confirm.tsx) is
what carries the escalation, and it is safety, not styling: the danger button is filled
`--danger` **at rest** instead of wearing the brand gold, the panel takes a red-tinted hairline,
and the button is **not pre-focused** — a `grave` dialog opens on Cancel and answers Enter only
from the danger button itself. Saying "permanently" twice does nothing if both dialogs are
pixel-identical gold-outlined buttons that Enter confirms; the one that erases 1,214 notes from
disk must never be one stray keypress away. `Rename` is offered on FILE rows only — `/api/rename`
is a note route and 400s on a folder — so the folder menu holds only actions that work.

Server side, `deleteFolder` lstats before it counts: a symlinked folder is a link, `fs.rename` /
`fs.rm` unlink it without touching the target, so it reports `notes: 0` rather than describing a
tree outside the vault that the call will not touch.

## Localization & RTL (client)

`client/i18n.ts` is the only place chrome copy lives. It is a plain module, not a React
context: a module-level `current: Lang` plus a `DICT` of `{ en, ar }` entries.

- `t(key)` → the string for the active language; `tf(key, vars)` substitutes `{name}`
  placeholders; `countPhrase(n, unit)` renders "3 notes" / "٣ ملاحظات" with correct Arabic
  plural agreement (1 / 2 / 3–10 / 11+ forms). Keys are typed (`I18nKey`), so a typo is a
  compile error and every key must define both languages.
- **`tf()` bidi-isolates every value it substitutes** (`isolate()` → U+2068 FSI … U+2069 PDI).
  The values are note-derived — a path, a title, a tag — so their direction is unknown, and a
  Latin path spliced raw into an Arabic sentence reorders against it (worst in the delete
  confirmation, where the reader must be able to tell which folder holds which note). The
  isolate is what `dir="auto"` does in the DOM, expressed in the string itself because a toast
  and a confirm body are one text run. Never hand-build an interpolated sentence around a note
  path without it.
- `localeDigits(locale)` is the single numeral policy for **dates**: Arabic locales that name no
  numbering system get `numberingSystem: "arab"` (Eastern Arabic digits). Every date formatter
  goes through it — blog post dates, moderation rows, marginalia timestamps — so the product
  never shows two numeral systems for the same day. Counters (`countPhrase`) stay Western.
- `setLang()` is called by `client/state.ts` only, from `loadMe()`, **before** it commits the
  new `language` to the store — so components re-rendering off that store update already see
  the new dictionary.
- Because `t()` reads module state rather than a hook, any component rendering chrome copy
  must subscribe to `language` (`useStore((s) => s.language)`) so a live settings change
  re-renders it. Memoized row components (`TreeRow`, `PubRow`, `TopicSection`) take `lang` as
  a **prop** instead: it busts `memo()` exactly when the language changes without paying for a
  store subscription on every row of a 1.4k-note vault.
- Module-level tables that hold copy (the command palette's `COMMANDS`) store **thunks**
  (`label: () => t(...)`), never strings — the table is built once at import, the language is
  not fixed until runtime.

`state.ts::applyLanguage()` sets `<html dir="rtl" lang="ar">` (and removes `dir` for English).
Everything visual follows from that attribute:

- **Layout mirrors for free.** The app shell is CSS grid and the panels are flexbox; both
  follow the inline direction, so the sidebar moves to the right and the backlinks panel to the
  left with no RTL-specific rule at all.
- **All five stylesheets use logical properties throughout** — `app.css`, `blog.css`,
  `comments.css`, `reading/reading.css` and `preview.css`: `margin-inline-*`,
  `padding-inline-*`, `inset-inline-*`, `border-inline-*`, `text-align: start`. New rules must
  too; a physical `left`/`right`/`margin-left` on a directional edge is a bug. (Genuinely
  symmetric values — `left: 0; right: 0` pairs, `translateX(-50%)` centering — stay physical.)
  In `reading.css`/`preview.css` this matters twice over: those rules decorate rendered note
  blocks, which carry their own `dir="auto"`, so a logical `border-inline-start` puts the
  callout/blockquote bar on the correct side of *each block independently* — an Arabic callout
  barred on the right, an English one beside it barred on the left. A `[dir="rtl"]` override
  could never express that, because it keys off the shell, not the block.
- **`[dir="rtl"]` overrides are the last resort**, confined to one commented block at the end
  of the stylesheet, and only for what logical properties cannot express: inset `box-shadow`s
  (no logical form — the active-row accent bar in the tree, publist and outline) and **SVG**
  icons whose geometry encodes a direction (panel toggles, the sign-out arrow, the
  properties-card chevron).
- **Do not mirror a directional *glyph*.** `›` (U+203A), `‹`, `«`, `»` are `Bidi_Mirrored`:
  the browser already draws them flipped under `dir="rtl"`, so adding `scaleX(-1)` flips them
  back to pointing the wrong way. Tree chevrons and the breadcrumb separator are glyphs and
  therefore need **no** rule at all; the only glyph rule that survives is the *open* chevron's
  `rotate(-90deg)`, because rotating the already-mirrored glyph the base `+90deg` would aim it
  up instead of down. SVG paths are geometry, not text — bidi never touches them, so those do
  need explicit `scaleX(-1)`. Arrows (`←` `→`, U+2190/2192) are *not* mirrored either, so the
  blog's prev/next and back arrows keep their `scaleX(-1)`.
- **Canvas has no `dir="auto"`.** The graphs draw note titles with `fillText`, which would
  otherwise inherit the shell's RTL direction and reorder trailing punctuation (`What is the
  Republic about?` → `?What is the Republic about`). `GraphView`/`LocalGraph` therefore set
  `ctx.direction = autoDir(title)` per label; `autoDir()` lives in `i18n.ts` and implements the
  same first-strong-character rule the HTML attribute uses.

**Note content is never localized or re-directed.** It renders as authored, per block, with
`dir="auto"`. The same applies to note-derived text shown inside the chrome — tree labels, tab
titles, outline entries, search hits and snippets, backlink titles/contexts, palette rows,
status-bar crumb segments, moderation rows, and reader comment names/bodies: each picks its own
direction. Without it, `1 - Source Material` renders as `Source Material - 1` in an RTL shell.

**Direction is per content; ALIGNMENT is per chrome.** `dir="auto"` on a full-width block sets
both, which is wrong for a chrome row: an English outline entry left-aligned itself inside a
right-aligned Arabic panel, dragging its indent and detaching the active-row accent bar from the
row it marks. The rule: the row keeps the shell's direction and `text-align: start`, and only
the label is isolated — `<bdi>` (or an inner `dir="auto"` span) around the note-derived text,
with any chrome ornament (count badge, ✦ published star, tag count) left OUTSIDE the isolate so
it stays on the chrome's side. `dir="auto"` directly on the element is right only where the
element *is* the content: a rendered note block, a comment body, a search snippet, an inline
flex item whose alignment comes from the flex container.

Server side: `siteLanguage()` in `server/site.ts` merges `settings.language` over `SITE_LANG`
(default `en`); `/api/me` sends `language` to **every** session (visitors included), and
`blogLocale()` falls back to the site language when neither `settings.blogLocale` nor
`BLOG_LOCALE` is set.

**`languageFilter` covers every visitor discovery surface.** `server/indexer.ts` caches an
`arabic` flag per note record and `languageHidden(record)` consults it *at query time*, so
flipping the setting takes effect without a reindex. Every function that enumerates notes for a
visitor applies it: `posts()`, `search(publishedOnly)`, `graph(publishedOnly)` (both edge
endpoints, not just nodes), `backlinks(publishedOnly)` (**the target as well as the sources** —
answering with backlinks confirms the target exists and is published), `tags()`, the RSS feed,
**`resolveLink()/resolveEmbed(publishedOnly)`, which back `GET /api/resolve`** — that route takes
a guessable TITLE and answers with a PATH, so gating it on publication alone turned it into a
title→path existence oracle for the filtered set, a strictly bigger leak than the by-design
`/api/note` allowance, which requires the exact path the caller is trying to learn — **and
`publishedNotes()`, which backs the visitor sidebar tree** — an unfiltered tree would list the
titles and paths of exactly the notes every other surface is hiding — **and the `/api/events`
SSE stream**, via `isNoteVisibleToVisitor()`: a push channel that announced a hidden note's
creation, edit or deletion would leak its existence, full vault path and edit timing unprompted,
which is precisely what the filter must not do. In that stream a note that becomes hidden reads
as `deleted` and one that becomes visible as `created`, the same mapping publish/unpublish uses.
**And `/api/me`'s home-note gate** (`homeNoteVisible()` in `server/auth.ts`): both halves ask
`isNoteVisibleToVisitor`, the name-resolving one via `resolveLink(ref, true)` and the exact-path
fallback directly. The fallback used to ask `isNotePublished` alone, so an Arabic instance whose
`HOME_NOTE`/`settings.home.note` named an English published note put that note's title and full
vault path into the anonymous payload (`homeNote` **and** `home.note`) — the one name the tree,
posts, search, RSS and the injected `<head>` were all hiding — and then rendered it as the public
homepage. An *unpublished* home note was already withheld; the filtered one must be too.

**A folder delete fans out into per-note `deleted` events on the visitor stream.** Visitors have
no folder structure, so `visitorEvents()` drops every `dir` event — but dropping the *delete*
outright left a visitor's sidebar holding live links to notes the site now 404s (`client/App.tsx`
only reloads the tree on an event). It samples `visibleNotesUnder(path)` **synchronously** — the
synthetic dir event is emitted before the chained reindex removes the records — and emits one
`{kind:"deleted"}` per note that was visible. Hidden and unpublished notes under the folder are
never named, so the fan-out says nothing `/api/tree` did not already.

**The served `<head>` is a discovery surface too.** `server/blog.ts` has two exported entry
points — `renderFeed()` (RSS) and `injectHead()` (the crawler-facing `<title>`/`og:`/canonical
block on the served SPA shell) — and both resolve notes through `posts(true)`, the visitor list.
The head injection is the loudest of the two: it is what puts a note into Google and into social
cards, `og:description` carries a 220-character excerpt of the body, and `og:image` carries its
banner. A `matchPublished()` iterating the admin `posts()` handed all of that to any anonymous
crawler that guessed the deep link while `/feed.xml`, one function below, correctly hid it.
Filtering costs nothing: the permalink itself keeps working because the client fetches
`/api/note` directly.

Attachments are deliberately NOT language-filtered (`resolveEmbed`'s attachment half stays on the
publish allowlist): an image belongs to no language, and a hidden note's still-working permalink
must keep rendering its own figures.

`POST /api/comments` and `GET /api/comments?path=` gate on `isNotePublished()`, **not**
`isNoteVisibleToVisitor()` — a deliberate divergence under the same "permalinks must keep
working" clause that exempts `/api/note`: a reader who reaches a filtered-out note by its
permalink can still read and leave marginalia there. Comment COUNTS never travel on a filtered
surface (every blog count derives from the filtered post list), so this reveals nothing the
permalink did not already.

Admin surfaces are never filtered.

**Routes that write a note must emit their own event BEFORE reindexing.** `visitorEvent()` in
`server/api.ts` samples `isNoteVisibleToVisitor()` synchronously, then awaits `whenIndexed()` and
samples again — that before/after pair is the whole created/deleted mapping. A route that
reindexes first and lets the watcher's debounced echo arrive afterwards makes both samples read
the POST-edit state, which silently collapses every transition: the hidden-becoming edit emitted
nothing at all (leaving a visitor's sidebar holding a live link to a note the site now hides,
since `client/App.tsx` only reloads the tree on an event) and the reverse emitted `changed` where
the contract requires `created`. So `PUT /api/note` — the editor's own save path — does what
`/api/publish` and `/api/frontmatter` do: `suppressWatcherEcho(path)`, write, `emitEvent(...)`,
*then* `indexFile(path)`.

`detectArabic(body)` decides the flag: Arabic-block codepoints ≥ 40% of the letter codepoints in
the note's **prose**, sampled over the first 64 KB. Prose is the body (frontmatter already
split off) minus what no one reads as language — fenced and inline code, HTML comments and tags,
markdown/reference link destinations and bare URLs (`proseOnly()`); link *text* is kept. Counting
markup instead was a real misclassification, not a nicety: a Readwise export of an Arabic book is
one `readwise.io` URL per highlight and scored 18–33% Arabic. The flag is tri-state — `null` when
the prose holds no letters at all, and a note with no language is hidden from neither site.

`/api/note` is never filtered: direct URL access to any published note stays allowed, and BOTH
shells must resolve an article route from the URL itself (`urlToNoteGuess()` → `/api/note`) when
the tree has no match, never from the tree alone — the tree is a discovery surface and is
filtered, so routing through it would 404 exactly the permalinks the filter is not allowed to
break. The filter is curation, not access control — but it must not *leak* what it curates away.

**`settings.languageToggle` (default false) is a VISITOR override, and it moves two things
only: the chrome dictionary and `<html dir>`.** `client/langPref.ts` owns the stored value
(`localStorage["vellum.lang"]`), `state.ts::loadMe()` applies it over `me.language` — and only
while `me.languageToggle` is true, so turning the setting off restores the site language for
everyone regardless of what their browser remembers. What it must NOT touch is `blogLocale`:
dates and numerals are one system per instance chosen by the date locale (see the numerals note
above), and letting a visitor's chrome choice re-pick the numbering system would reintroduce
exactly the two-numeral-systems-on-one-line bug that rule exists to prevent. Note content is
untouched for the usual reason — it was never localized in the first place.

`settings.language` is parsed leniently — `settings.ts` trims and lowercases before matching, so
`"AR"` and `" ar "` are accepted and stored as `"ar"`. `languageFilter` is the opposite: strict
`boolean | null`, no coercion. The asymmetry is deliberate (an enum has an obvious canonical
form; a boolean typed as a string is a mistake worth rejecting) and is noted here so it does not
read as an oversight.

`scripts/check-i18n.mjs` is the guard for chrome copy — but note *which* half of it answers
*which* question. Diffing dict-against-used (every `t()`/`tf()` key exists, every entry defines
both `en` and `ar`, every `ar` value actually contains Arabic script, `{placeholder}` sets match,
no key is dead) only proves the dictionary is tidy; it is structurally blind to a string that
never went near `t()`, and it once printed `PARITY OK / 290 of 290` while `btn.title = "Fold
section"` shipped to Arabic instances. The half that answers "is the translation complete" is the
source-against-dict scan, and it must cover **`.ts` as well as `.tsx`**: the editor's chrome
(fold chevrons, embed cards, upload pills, transclusion cards) is `createElement` +
`textContent`, not JSX, which is exactly where the survivors hid. Run it with `npx tsc --noEmit`
on any change to chrome copy.

**Numerals are one system per instance, chosen by the date locale** (`shared/numerals.ts`, shared
by client and server). `localeDigits()` pins an Arabic locale that names no numbering system to
`arab`; `localeNum()`/`countPhrase()` and the server's footer year render every other number in
that same system. Splitting the decision — Arabic-Indic dates, Western counts — is what produced
`٩ يناير ٢٠٢٦ · 3 دقائق قراءة`: two numeral systems inside one line, on the first screen of the
public site. Any new number the chrome prints goes through `localeNum()` or `countPhrase()`; a
bare `{count}` in JSX is a bug.

**Untrusted text is stripped of bidi controls at the boundary** (`shared/bidi.ts`: U+202A–U+202E,
U+2066–U+2069). The chrome's isolation (`tf()` FSI…PDI, `<bdi>`, `dir="auto"`) stops an override
from reordering the sentence *around* a value, and it works — but it cannot stop the value from
lying about *itself*: an anonymous comment author of `Ali<RLO>rotartsinimd` renders as
`AliAdministrator`, cleanly inside its own byline, and reads as genuine. `POST /api/comments` —
the one unauthenticated channel that renders into the public page — strips author and body at
write time, the same way `/api/frontmatter` strips C0 controls. Note TITLES are normalized on
display (`server/indexer.ts` for `/api/posts`, RSS and the `<head>`; the client's own
path→title derivations for the H1, tabs and `document.title`), while the wikilink RESOLUTION key
keeps the raw basename so links written with the same characters still resolve.

**Arabic font stacks are Arabic-first under `:root[lang="ar"]`, not Latin-first with the naskh
faces appended.** Font fallback is per character, and Segoe UI (Windows) and Arial (macOS) both
carry full Arabic coverage — at the end of the stack the named naskh faces were dead entries on
both platforms. Same key as the Arabic type-metric compensation at the bottom of `tokens.css`:
this is a language decision, not a direction one.

## Typography (self-hosted webfont catalog)

`server/fonts.ts` is the whole machinery — catalog, cache, CSS generator — and it never reads
`settings.json`; `settings.ts` and the routes call *in*.

- **`settings.fonts = { prose, ui, mono, arabic }`**, each a catalog id or `"system"` (the
  default; all-system stores nothing at all). Validation is a **strict allowlist and it is
  slot-aware**: an unknown id is a 400, a proportional face in `mono` is a 400, a face with no
  Arabic coverage in `arabic` is a 400. Lookups go through `catalogEntry()` (own-property only) —
  a bare `FONT_CATALOG[id]` would resolve `constructor`/`toString` up the prototype chain and let
  them name a cache directory, the same trap `patchSettings` avoids on its handler table. Absent
  slots in a PATCH keep their stored value (it merges, like `home`).
- **The faces are on disk BEFORE settings names them.** `PATCH /api/settings` validates the ids,
  then `ensureFontsCached()` fetches whatever is missing, and only then writes the file. So a
  network failure is a clean **502 with a message** and `settings.json` is untouched — never a
  site linking a stylesheet with no faces behind it. Two hosts are reachable, ever
  (`fonts.googleapis.com`, `fonts.gstatic.com`), enforced on the PARSED url (https, exact
  hostname, no credentials) with `redirect: "error"`, per-request timeouts and per-file /
  per-family byte caps. `meta.json` is written last, atomically: an interrupted download leaves
  junk the next attempt overwrites, never a half-registered family. `cacheFamily()` is
  deduplicated by id (one in-flight download per family, process-wide), and the per-family byte
  budget is CLAIMED before each fetch rather than totted up after it — a limit checked after the
  count went up let five more of the six concurrent faces land past it, so the real ceiling was
  16 MB + 5 × FONT_MAX_BYTES. A worker that finds nothing left waits for the others to refund
  instead of failing: most woff2 subsets are tens of KB, and six worst-case reservations at once
  would otherwise starve every family.
- **`GET /api/site-fonts.css` is generated, open (OPEN_PATHS) and contains no external URL by
  construction** — every `src:` is `/api/fonts/catalog/<id>/<file>` on this server, served by a
  route that allowlists the id against the catalog and the filename against the shape this module
  generates. It is open for custom.css's reason: the login page of a `PUBLIC=false` vault should
  render in the instance's type.
- **The Arabic faces carry a measured `size-adjust`, and only in the Arabic role.** Picking the
  right face is half of "a mixed paragraph sets correctly"; the other half is at what SIZE. Two
  faces at one `font-size` are not two faces at one apparent size — Amiri's base letters stand at
  ~0.35 em against Lora's 0.51 em x-height — so each Arabic catalog entry has an optional
  `sizeAdjust` percent (Amiri 138, Scheherazade New 136, Lateef 150, Noto Kufi Arabic 90; Cairo,
  Almarai, Reem Kufi and Noto Sans Arabic none), measured as the height of ه at a 100px em
  against that same 51, damped 15% toward 100. `faceBlock()` emits it and `composite()` passes it
  ONLY on the Arabic half: the number describes this family against a Latin text face, so it is
  meaningless on the Latin one. Because it rides on the FACE it applies per character, in every
  slot, on an English instance too — which the `--font-scale`/`--prose-scale` multipliers under
  `:root[lang="ar"]` can never do: they scale both scripts equally, so the ratio between them
  never moves, and on an English instance they never run at all. Those multipliers are untouched;
  this is the other axis.
- **Three COMPOSITE families, and the Arabic slot goes first.** `VellumProse`/`VellumUI`/
  `VellumMono` each list the Arabic face's `@font-face` blocks narrowed to the Arabic unicode
  blocks, then the Latin face's with those same ranges carved out. The two sets are **disjoint**,
  which is the point: per-character font matching then needs no tie-break and no source-order
  luck, and a mixed Arabic/Latin paragraph sets correctly **on an English instance too**. Google's
  `arabic` subset also carries shared punctuation (`U+200C-200E`, `U+2010-2011`, `U+204F`,
  `U+2E41`) that its `latin` subset covers — those chunks are dropped, and Presentation Forms-B
  stops at `U+FEFE` so the BOM does not drag a whole extra face in.
- **`--font-*-system` in `tokens.css` is what the composites fall back to**, which is why
  `tokens.css` holds the stacks in those tokens and defines `--font-ui`/`--font-serif`/
  `--font-mono` as `var(--font-*-system)`. The generated sheet re-defines the three consumers at
  plain `:root` specificity: later in the cascade than `tokens.css`, and still *below* a
  `custom.css` `:root` rule (its link is appended after) — the escape hatch outranks the catalog.
  `:root[lang="ar"]` must therefore keep redefining the `*-system` holders and **never**
  `--font-serif` itself, or its higher specificity would beat both. The Arabic type-metric
  multipliers there are untouched.
- **`/api/me.fonts` is a signature, not a boolean** (`"lora.inter.system.amiri"`): its presence
  makes the client link the stylesheet, and its value is the `?v=` on that link, so a changed pick
  gives the browser a new URL instead of a cached sheet naming the old families.
- **`GET /api/font-preview.css`** is the settings panel's live specimen: the same generator under
  a `VellumPreview…` prefix and with no `:root` block, so a reader sees faces they have picked but
  not saved. Admin-eyes-only (it can trigger a download) — 404 to visitors like `/api/settings` —
  debounced client-side, and its failures are silent: a specimen falling back to the system stack
  is a fine specimen; a toast per keystroke is not.

## Backup & sync (server/gitSync.ts)

`settings.gitSync { enabled (default FALSE), remote, branch (default "main"), intervalMinutes
(0–1440, 0 = manual), pullFirst (default true), authMode "ssh"|"token" }`, plus two WRITE-ONLY
PATCH keys — `gitToken`, `gitUser` — that never reach `settings.json`. Routes, all admin-only
(`GET /api/sync/status` gates on `isPublishLimited` like `/api/settings`, so an admin previewing
as a visitor is refused too; the POSTs are mutations the auth guard already 401s):
`POST /api/sync/init`, `POST /api/sync/now` (409 while one is running), `GET /api/sync/status`.

- **Never a shell.** Every git call is `execFile("git", [fixed, argument, array], { cwd: vaultRoot })`.
  The remote is validated to `^https://` / `^ssh://` / `git@host:path` with no whitespace, no shell
  metacharacters, no leading `-`, and **no credentials in the URL** — a password is a 400 on either
  scheme, and a bare `user@` is a 400 on `https://`, which is exactly the shape a pasted token
  takes. `ssh://git@host/you/vault.git` is *accepted*: it is git's own spelling of the scp-style
  `git@host:you/vault.git` the same validator allows, that `user@` is not a secret, and refusing it
  while accepting its twin — with a message naming a token field SSH never consults — was a dead
  end for the commonest paste. But a `user@` that IS a secret is refused on every scheme: the same
  known token prefixes `scrub()` redacts on the way out (`gh[pousr]_`, `github_pat_`, `glpat-`)
  are tested against `url.username` and against the scp-style user part on the way in, raw and
  percent-decoded. The rationale for allowing `user@` was that it carries no secret; where that
  stops being true, so does the permission. The branch is a conservative `check-ref-format`
  subset. Neither can be an option, a command, or a second argument.
- **The git child's environment is scrubbed, not just its cwd.** `gitEnv()` deletes `GIT_DIR`,
  `GIT_WORK_TREE`, `GIT_INDEX_FILE` and the object-directory variables so the server's own
  environment cannot point git at another repository — and, for the same reason one level up,
  `GIT_CONFIG*` (including the indexed `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`
  family), `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_PROXY_COMMAND` and `GIT_EXTERNAL_DIFF`: redirecting
  config redirects `core.hooksPath` and `url.*.insteadOf`, and redirecting the transport replaces
  the program git executes. The one legitimate use of the last group gets an explicit door instead
  of ambient inheritance: `VELLUM_GIT_SSH_COMMAND` is copied to `GIT_SSH_COMMAND` for the child,
  and nothing else is.
- **The token is a file, not a setting.** `VELLUM_DATA/git-credentials.json`, `0600`, asserted with
  `chmodSync` after the atomic rename (the create mode is masked by umask). `settings.ts::persist()`
  gets the same treatment for `settings.json` next door — mode on open plus an explicit `chmodSync`
  after the rename — because it holds operator-private configuration (the backup remote, the
  branch) and no reader but this process. It reaches git through
  `GIT_ASKPASS` + an env var on that one child — never argv (`ps` is world-readable), never the
  remote URL, never `.git/config` — and every network call carries `-c credential.helper=` so the
  machine's own credential store cannot cache it. Reads answer `effective.gitSync.tokenSet` only.
  `scrub()` redacts the stored token, any URL userinfo and known token shapes from every string
  that leaves the module: client errors, toasts and log lines alike.
- **A settings PATCH stays all-or-nothing across two files.** `gitToken`/`gitUser` validate during
  the patch and are *staged*; `patchSettings()` discards leftovers at the start and writes them
  only after `persist()` succeeds. A patch that 400s on a later key must not have changed the
  credential.
- **VELLUM_DATA never reaches the repo, and that is enforced against git's answer.** The token
  file lives in the instance data directory, which is outside the vault by default — but when it
  is INSIDE one, `seedGitignore()` runs unconditionally in `initRepo()` (not only when the vault
  was not already a repository) and APPENDS the data-directory rule to an existing `.gitignore`
  rather than returning early. The two commonest real vaults, "already a git repository" and
  "already has a .gitignore", used to get no rule at all and `git add -A` then committed and
  pushed `git-credentials.json` in plaintext. Belt and braces: `protectDataDir()` runs before
  every `git add -A` in both `initRepo()` and `syncNow()` — it re-seeds, evicts anything already
  tracked (`git rm -r --cached --ignore-unmatch`) and then asks `git check-ignore -q --no-index`,
  refusing the whole pass with a 400 if the answer is still "not ignored". `--no-index` is
  load-bearing: without it check-ignore answers "not ignored" for anything in the index, which is
  exactly the case being repaired.
- **Divergence fails; it never merges.** The pull half is `fetch` + `merge --ff-only`, not
  `git pull` — so no `pull.rebase` in the operator's gitconfig can turn it into a rebase, and a
  history that cannot fast-forward stops **before the working tree is touched**. Conflict markers
  written into a thousand notes by an unattended job are a worse outcome than a missed backup.
  Nothing here ever force-pushes.
- **`busy` is claimed in the same synchronous step as the check.** Every `await` is a yield point:
  a guard that sat before the first one let four concurrent clicks past it and into a fight over
  `.git/index.lock`. The final `gitStatus()` is sampled *after* the flag clears, so a successful
  answer never reports itself busy.
- **The timer is inert by default.** One 60s tick (unref'd), doing nothing unless enabled with a
  remote and a non-zero interval, skipping while busy, and logging a repeated failure **once**
  (`loggedFailure`) rather than once per tick, forever.
- **`ahead`/`behind` are `number | null`, and null is not zero.** `gitStatus()` can only count
  against `refs/remotes/origin/<branch>`, which does not exist until a fetch or a push has
  succeeded once — precisely the never-backed-up case. Leaving the `0` initializers there made
  that case read "0 ahead · 0 behind", character-for-character what a fully synced vault reads,
  in the one panel whose whole job is answering "is my writing somewhere else yet". The clients
  render null as "nothing has reached the remote yet".
- Client: `client/sync.ts` holds one shared status + subscribers (the status-bar badge, the
  settings block and the palette command all read it) plus `syncWhen()` and `syncCause()`, so the
  badge and the panel never drift on either the timestamp format or the diagnosis; the badge
  renders only for an admin session on an instance where sync is on and a remote is set. Our own
  success sentence is localized from `last.committed`; a FAILURE line is git's own words, shown
  verbatim — that text is the diagnosis, so it is rendered in its OWN `dir="ltr"` block with the
  localized timestamp and cause in their own `<bdi>` isolates beside it (one `dir="auto"` span
  over "date — message" takes its direction from the date and reorders git's English around it),
  and it is selectable text with a copy button, never a `title` tooltip. Counts and dates in these
  lines are separated by a hairline rule, never by a "·": the Eastern Arabic zero is itself a
  raised dot.
