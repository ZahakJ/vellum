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
external font/CDN fetches — system stacks only; the Arabic naskh faces sit at the END of the UI
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

Intended UI copy (client wiring still to do — sidebar folder context menu / command palette):
confirm modal titled **"Move folder to .trash (N notes)?"** with a *Delete permanently* checkbox
(unchecked by default) that switches the copy to **"Permanently delete folder (N notes)? This cannot
be undone."**; on success toast `Moved "<name>" to .trash` (or `Deleted "<name>"` when permanent),
close any open tabs whose path starts with `<folder>/`, then `loadTree()`.

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
