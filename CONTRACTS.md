# Vellum — module contracts

Read this whole file before writing code. `shared/types.ts` is the wire contract; import from it with
`import type { ... } from "../shared/types.ts"` (server) / `"../../shared/types.ts"` (client). All
imports use explicit `.ts`/`.tsx` extensions (tsconfig has `allowImportingTsExtensions` + `verbatimModuleSyntax`;
type-only imports must use `import type`). TS strict. **Node ≥ 24** (`engines` in package.json, and the README says the same number):
Node runs `.ts` directly there with no flag, so server code must use only erasable TS (no
enums/namespaces/parameter-properties). The floor is 24 rather than 22.6 because three things on
the boot path need more than type stripping: `node:sqlite` is imported unconditionally by
`server/comments.ts` (flagged before 22.13), every npm script passes `--env-file-if-exists` (22.9+),
and type stripping itself is only on by default from 22.18 — a clean clone on the number the docs
used to print died at `npm start` on an unknown flag.

## Identity & design language

Vellum: a candlelit manuscript room. Dark theme "iron-gall" (near-black warm ink background,
warm off-white text), light theme "parchment" (warm paper background). Accent: gold-leaf
`#c9a227` (dark) / `#7a5f14` (light — darkened from `#8a6d1a`, which sat at 4.13:1 and
therefore failed AA as link text and as the lit mode pill; see the contrast gate below). Serif display font for headings in rendered markdown
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

## API (all JSON; errors -> `{ error: string, code?: string }` with 4xx/5xx)

`error` is English prose written for a log and for `curl`. It is NOT a string any UI may print —
and it was being printed: `client/api.ts` wraps every failure body in an `ApiError` carrying that
text, and every `catch` in the app toasts `err.message`, so an Arabic-only operator rejecting a
mistyped font file read "Not a recognized font file (woff2, woff, ttf, otf)" inside a fully
Arabic panel while the `fontUploadFailed` translation written for the moment was dead code.
`VaultError(status, message, code?)` may name a STABLE code; `onError` echoes it, `ApiError`
carries it, and a caller that can translate the code must prefer it and keep the generic
localized line — never `err.message` — as the fallback. Falling back to the prose was considered
and rejected: it is English by construction, so showing it is the bug. The font routes are the
first users (`font_unrecognized`, `font_damaged`, `font_too_large`, `font_no_file`,
`font_bad_body`, `font_not_found`, `font_bad_name`, `font_no_free_name`, `font_in_use` →
`FONT_ERROR_KEYS` in `SettingsModal.tsx`), because the commonest failure of that feature is one
an Arabic-only owner hits constantly. The rest of the app's 12 call sites still print `message`;
that is the pre-existing pattern, and the door is now open.

- `GET  /api/tree` → `TreeNode` (root folder node, path ""). Admin: notes **and** attachments (see "Attachments in the tree"). Visitor: the flat published-note list, notes only.
- `GET  /api/note?path=a/b.md` → `NoteData`
- `PUT  /api/note?path=` body `{ content: string }` → `NoteData` (writes file; creates parent dirs)
- `POST /api/note` body `{ path: string }` → `NoteData` (create empty; 409 if exists)
- `POST /api/rename` body `{ path, toPath }` → `{ ok: true }` (also rewrites `[[wikilinks]]` in other notes that pointed at the old name)
- `DELETE /api/note?path=&permanent=<bool>` → `{ ok: true, trashPath?: string }` (default MOVES to `.trash/`; see "Note deletion")
- `POST /api/folder` body `{ path }` → `{ ok: true }`
- `GET  /api/search?q=` → `SearchHit[]` (max 50, minisearch, prefix+fuzzy)
- `GET  /api/graph` → `GraphData` (nodes = all md files, edges = resolved wikilinks)
- `GET  /api/backlinks?path=` → `Backlink[]`
- `GET  /api/tags` → `TagCount[]` (from `#tag` inline + frontmatter `tags:`)
- `GET  /api/events` → SSE stream of `VaultEvent` (chokidar watcher; debounced 100ms; events named `message`, JSON data)

Path safety: every path param normalized, must resolve inside vault, must not contain `..`; only
`.md` files served/written by note endpoints (400 otherwise).

**Containment is checked against the FILESYSTEM, not against the string — on reads as well as
writes.** `safeAbs()` resolves the path with `realpath` (falling back to the deepest existing
ancestor for a file about to be created, and refusing a DANGLING symlink outright, since a write
would follow it) and requires the result to sit inside the vault's own realpath; anything else is a
`404`, never a message that would confirm the link exists. The lexical `startsWith` check that used
to stand alone answered a different question — "does this STRING stay inside the vault" — while
every `fs` call under it followed links, so one `ln -s /etc evil` in the vault turned
`/api/file?path=evil/passwd` into an anonymous filesystem reader (the publish allowlist admits any
path a published note embeds), and `note-link.md → /etc/passwd` into a readable *and writable* note.
Pointing such a link at `VELLUM_DATA` exfiltrated `git-credentials.json`, whose `0600` mode is
irrelevant when the server reads it for you. Three layers now hold, and each is independently
sufficient: `safeAbs()` realpath containment; `statAttachment()` uses **`lstat` + `isFile()`** (the
same rule the two font routes already followed); and the tree walk, the index walk and the chokidar
watcher (`followSymlinks: false`) all skip links, so an escaping link never enters the index and
therefore never enters the publish allowlist. Consequence, by design: a symlink pointing OUT of the
vault is invisible to the whole app and cannot be read, written or deleted through any API — remove
it with the filesystem. A symlink pointing back INSIDE the vault still resolves and still works.

**Every response below `/api` is `Vary: Cookie, X-Vellum-Preview` and, unless the route said
otherwise, `Cache-Control: private, no-store`** (one middleware in `api.ts`, above the auth routes
so `/api/me` is covered). Every one of these bodies differs by session cookie AND by the preview
header, and none of them said so; the README recommends nginx in front, where a shared cache may
hand an admin's whole vault tree to the next anonymous visitor. Routes that set their own
`Cache-Control` keep it, and anything marked `immutable` (the content-addressed font routes, which
hold no session-varying byte) is skipped entirely so a CDN can still cache it. The SPA shell,
`/feed.xml` and the static assets get the same treatment in `index.ts`, plus the origin's security
headers: `Content-Security-Policy` (`script-src 'self'`, `frame-ancestors 'none'`, `object-src
'none'`, `base-uri 'none'`; `style-src` keeps `'unsafe-inline'` because React style props, KaTeX and
the generated banner gradients are inline by design; `img-src`/`media-src` allow remote https/http
because `banner:` URLs and raw `<img>` in notes are documented features), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`. Without those the admin UI —
permanent delete, publish, settings PATCH, sync — was framable and clickjackable, and the
hand-rolled HTML sanitizer in `client/reading/rawHtml.ts` had no backstop behind it. Wikilink resolution: `[[Name]]`
matches file basename (no `.md`, case-insensitive); shortest-path winner on duplicates;
`[[Name|alias]]` and `[[Name#heading]]` variants parse (link target is `Name`).

## Server modules (server agent owns `server/`)

- `server/vault.ts` — vault root resolution, safe path helpers, tree/read/write/create/rename/delete/mkdir, chokidar watcher exposing `onEvent(cb)`.
- `server/indexer.ts` — in-memory index rebuilt incrementally from watcher: minisearch (fields title+content), link graph, backlinks, tags. Exports `search(q)`, `graph()`, `backlinks(path)`, `tags()`, `resolveLink(name): string | null`.
  **A note over `MAX_INDEXED_MD_BYTES` (2 MB) gets a MINIMAL record — path, title, publish flag,
  banner, date, frontmatter tags, read from the file's first 64 KB — never a dropped one.** It used
  to be removed from the index entirely, and `/api/note`'s visitor gate reads `publishedSet`: a note
  its owner had marked `publish: true` answered **404 to visitors** while the admin's own request
  succeeded, and it was absent from the tree, `/api/posts`, RSS and the injected `<head>` — with
  nothing logged and a comment claiming the opposite ("still readable via /api/note"). Now only
  full-text search and the link graph degrade (no body is read, so no minisearch entry, no links, no
  excerpt); the skip is `console.warn`ed once per file and counted in the boot line
  ("N by metadata only").
- `server/api.ts` — `export const api: Hono` implementing routes above.
- `server/index.ts` — arg/env parsing, seed-on-missing (copy `vault-seed/` → vault), mount `api` at `/api`, static `dist/` + SPA fallback, listen 6801 with startup banner.

## Auth & sessions (server/auth.ts)

- **`PUBLIC=false` without `ADMIN_PASSWORD_HASH` is a `ConfigError` and the process exits** (see
  README). `authGuard` short-circuits on `if (!config.passwordHash) return next()` and `isAdmin()`
  answers true unconditionally in that mode, both *before* the `publicReads` check — so the one flag
  an operator sets meaning "lock this down" was the flag that was silently inert, on an instance
  that answered `/api/me` with `{"admin":true,"protected":false}` and accepted anonymous
  `PUT /api/note`, `GET /api/settings` and `PATCH gitSync` → `POST /api/sync/now`. A non-loopback
  `HOST` with no hash is a loud warning, not a refusal: open-on-the-LAN is a documented use.
- **Backup & sync needs a real credential in EVERY mode** (`isProtected()`): `POST /api/sync/init`,
  `POST /api/sync/now`, `GET /api/sync/status` and any `PATCH /api/settings` carrying
  `gitSync`/`gitToken`/`gitUser` answer `403 sync_needs_password` in open local mode. "Everyone is
  admin" is defensible for editing notes on a trusted LAN; it is not defensible for "send my vault
  to an address the caller chose".
- **The session token is `v2.<epoch>.<expiry>.<hmac>`**, still stateless, with two revocation
  inputs baked into the signature: a `sessionEpoch` integer in `VELLUM_DATA/session-epoch`, and a
  fingerprint of the password hash (derived through `SESSION_SECRET`). `POST /api/logout` bumps the
  epoch, so signing out ends every session on every device — it used to only `deleteCookie()`,
  leaving a captured cookie valid for 30 days after logout *and* after a password change, with the
  only real revocation being an `.env` edit plus a restart. Changing `ADMIN_PASSWORD_HASH` now
  invalidates every token by itself. TTL is **7 days with sliding refresh** (reissued by `authGuard`
  once past half-life, so an active admin never meets the login modal), and the cookie carries
  `Secure` derived from `X-Forwarded-Proto` — honored only from `TRUSTED_PROXIES`, exactly like
  `X-Forwarded-For` — or the request's own scheme, with a `SECURE_COOKIES` override for
  LAN-over-http.
- **The login rate-limit slot is consumed BEFORE the argon2 verify and refunded on success.** The
  old order (read window → `await argon2.verify` → record failure) meant every request in a
  concurrent volley read the window before any of them wrote it: measured, one 200-way parallel
  burst evaluated **200/200 guesses against a limit of 10 per minute**. It was also an
  unauthenticated amplifier — each in-flight verify is argon2id m=65536 p=4, 64 MiB and four
  threadpool jobs, on the same libuv pool every `fs` call shares. There is now a global window
  (`GLOBAL_MAX_ATTEMPTS`) behind the per-IP one and a semaphore of `VERIFY_MAX_CONCURRENT` = 2
  verifies with a bounded queue (a full queue is a `429`, never a park). `POST /api/comments` always
  had this shape; the login route now matches it.
- **`/api/me` never names the home note to a caller who could not read it.** `homeNoteVisible()`
  gated on publication and the languageFilter but not on `publicReads`, so `me.homeNote` (and
  `home.note`) travelled to anonymous callers on a `PUBLIC=false` vault whose entire premise is that
  nothing is readable without a session — one clause short of the leak the function exists to close.

## Client state (shell agent owns; file `client/state.ts`)

zustand store `useStore`:

```ts
interface State {
  tree: TreeNode | null;
  openPath: string | null;      // current note
  openTabs: string[];           // ordered open note paths
  dirty: Record<string, boolean>;
  view: "editor" | "graph";
  theme: Theme;                 // one of shared/themes.ts THEMES (15); persisted localStorage "vellum.theme"; sets data-theme attr on <html>
  vimMode: boolean;                    // persisted "vellum.vim"
  paletteOpen: boolean;
  // Shell layout, all persisted (see "Shell layout" below):
  sidebarSidePref: "auto" | "left" | "right"; // "vellum.sidebarSide" (default "auto")
  sidebarSide: "left" | "right";       // DERIVED: the pref with "auto" resolved
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

- **Side is PHYSICAL, direction is LOGICAL — and the preference behind it is THREE-state.**
  `sidebarSidePref` is `"auto"` (the default), `"left"` or `"right"`; `sidebarSide` is the
  resolved edge and is derived, never persisted. `"auto"` means "the reading direction's leading
  edge" and is re-evaluated on **every** language change — `loadMe()` and `setVisitorLang()` both
  end with `set({ sidebarSide: effectiveSide(pref, language) })`. A pin names a screen edge in
  both languages and outranks the direction forever.
  Two-state was a trap: the side followed the language only while NOTHING was stored, so the
  first use of the palette command pinned it for good, a later switch to Arabic no longer moved
  it, and there was no way back short of clearing localStorage. A value written by an older
  build is a bare `"left"`/`"right"` — it was an explicit act then and it stays an explicit pin
  now, which is the whole migration: nothing is rewritten.
  The store action is `setSidebarSidePref(pref)` — one action for the palette's three commands
  and for a Settings → Appearance segmented control. The grid areas (`"sidebar main panel"`)
  already follow the inline direction, so the stylesheet only needs the *disagreement*:
  `flipped = (lang === "ar") === (side === "left")` — an XOR — swaps the two grid areas and hands
  each pane the other's separator.
- **Panes are named by WHAT THEY ARE, never by the edge they are on.** "Notes sidebar"
  (`paneNotes`) and "Outline & backlinks" (`paneOutline`), in the status-bar toggles, the palette
  commands, the shortcut sheet, both reopen handles and each pane's own `aria-label` — with the
  keystroke in the tooltip. In Arabic the notes sidebar sits right and the outline panel left, so
  "the left bar" names a different pane in each language, and `Ctrl/Cmd B` looked like it folded
  the wrong one. A reader of a live Arabic instance asked why "the left bar cannot be folded".
- **That XOR is also the icon rule.** The pane chevrons (panel header toggle, both reopen
  handles) point at a physical edge, so they answer to *both* switches: `[dir="rtl"]` flips them,
  `.s-app--flip` flips them, and both together cancel. That is why they cannot be a plain
  `[dir="rtl"]` rule like the other mirrored SVGs, and why the `[dir="rtl"] .s-app--flip` rule
  that resets them to `none` has to exist.
- **Collapse animates a width, never `display`.** `.s-sidebar` carries the width
  (`--sidebar-w` + 1px for its border) and `overflow: hidden`; its children are pinned to
  `--sidebar-w` so the rows do not reflow to a narrower measure while the pane closes. Same
  pattern the backlinks panel already used. 180ms, both directions, zen included.
- **THE NOTE'S TWO MARGINS ARE EQUAL IN EVERY FOLD STATE.** The owner's request was "make sure
  that the margin between open note and left/right bar is correct and nice looking even when bar
  is closed/folded" — a statement about the two margins AGREEING, and the thing to measure is the
  gap from the prose to the furniture beside it, not to the window edge.
  An earlier build pinned the column to the WINDOW's centre line instead, padding `.s-main` to
  compensate for whichever pane was heavier (`--balance`/`--slack`, both gone now). It read well
  in the two SYMMETRIC states and failed in the two that matter. Measured at 1440 with the notes
  sidebar folded: the prose sat **47px** from the panel it was pressed against and **327px** from
  the far side of the window — a third of the screen empty on one side, the text jammed against a
  wall of chrome on the other; the same 280px skew with the panel folded instead. Both-folded
  looked balanced only because the two voids happened to be equal. Single-fold is the common
  case: a reader folds ONE bar.
  So the column centres inside the box the grid actually gave it — the shell is
  `auto minmax(0,1fr) auto`, so that box already ends exactly at each pane's inner edge — and the
  ONLY padding `.s-main` keeps is `--fold-gutter` (**14px**, the width of a collapsed pane's
  reopen handle) on whichever side is folded, since the handle stands where the pane was and is
  the furniture on that side. Door and pane are then measured the same way. Two tokens on
  `.s-app` carry it, `--fold-sidebar`/`--fold-panel`, aliased into `--fold-lead`/`--fold-trail`,
  which `.s-app--flip` swaps. The padding transitions on the panes' own 180ms curve: the column
  does move when a pane folds — it must, the room it is centred in just changed size — but it
  moves as one movement and it lands centred rather than landing shoved.
  `.s-app--nopanel` exists for this and only this: the panel's collapse lives on
  `.s-panel--collapsed`, and a sibling's class is not something CSS can ask about. `.s-app--zen`
  and the ≤700px drawer breakpoint zero `--fold-gutter` (no panes in the grid, no handles), and
  `.s-main:has(.s-graph)` drops the padding outright — the graph is a canvas that wants every
  pixel, not a column. Measured at 1440, all 16 combinations of side × sidebar × panel × dir:
  the two gaps agree to **1px** (that 1px being the collapsed pane's own border), against a worst
  skew of **287px** before.
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

## CSS tokens (tokens.css defines the FULL set on `:root` and on every `[data-theme="…"]`)

`--bg`, `--bg-raised`, `--bg-hover`, `--text`, `--text-muted`, `--text-faint`, `--accent`,
`--accent-soft` (translucent accent for backgrounds), `--border`, `--danger`, `--font-ui`,
`--font-serif`, `--font-mono`, `--radius` (6px), `--sidebar-w` (292px), `--font-scale`/`--prose-scale` (per-language type-scale
multipliers, 1 by default; `:root[lang="ar"]` raises them because naskh reads smaller than
Georgia at the same px — consumers must multiply, never replace, so a `custom.css` override of
the sizes survives), `--font-base` (15.5px —
drives `html { font-size }`; ALL chrome is sized in rem so this one token scales the whole UI),
`--font-prose` (1.161rem ≈ 18px — editor/reading prose), `--selection-bg` + `--focus-ring`
(the selection wash and the `:focus-visible` ring — per theme, because an accent tuned for type
is not always visible as a ring), `--graph-node`/`--graph-edge`/`--graph-vignette` (the graph
canvas). Default (no attr) = iron-gall dark. `data-theme` attr lives on `<html>`. app.css: layout grid, sidebar, tabs, panels,
palette, scrollbars (thin, themed), `::selection` gold. Class names are BEM-ish plain CSS,
prefix `s-` (e.g. `.s-sidebar`, `.s-tab`, `.s-palette`). Components must use these exact class
names where they exist in app.css; anything extra styled inline is a bug — put it in app.css.

Two stylesheets are linked AFTER app.css (`client/index.html`), and the order is load-bearing:
`styles/themes.css` (the theme library — the per-theme retunes of `::selection`, `:focus-visible`
and the graph vignette, the `--sw-*` swatch machinery, the picker panel) and `styles/settings.css`
(the settings surface over app.css's base panel rules).

## The theme library (15 themes)

- **`shared/themes.ts` is the one list.** `THEMES` (15 ids, `THEMES[0]` = `iron-gall` = the
  product default), `DARK_THEMES`/`LIGHT_THEMES`, `isTheme()`, `themeGroup()`. Both sides
  validate against it: the client's picker/palette/store and the server's `settings.defaultTheme`
  validator plus `DEFAULT_THEME` at startup (`server/site.ts` warns on an unknown name instead of
  passing it through). `client/themes.ts` re-exports it and adds `THEME_GROUPS` (the picker's
  grouping) and `counterpartTheme()` (the ☾/☀ pairing — with fifteen themes a light/dark button
  cannot mean "next in the list"). `client/state.ts` re-exports `THEMES`/`Theme`/`isTheme` so the
  store's published surface is unchanged.
- **Every theme defines the WHOLE token set**, solved against its own `--bg` (all callout and
  syntax colors clear 4.8:1 there). A theme that omits one inherits the previous block's value —
  iron-gall's amber warning on a green ground — which is why `scripts/check-contrast.mjs` walks
  every block in `tokens.css` and why no two themes share a hex outside the `--danger` family.
- **The gate also asserts an accent-vs-TEXT delta, and it is not a contrast ratio.** Two colors of
  equal luminance and opposite hue pass every contrast formula while being perfectly
  distinguishable, so the question "does this theme HAVE an accent channel" needs a perceptual
  distance: `check-contrast.mjs` requires **ΔE (CIE76) ≥ 18** between `--accent` and `--text`.
  `sumi` shipped `--text #e4e4e6` beside `--accent #f5efe3` — 8.5 ΔE, 1.11:1 — so tag pills, the
  `#` glyph, the active-row bar, wikilinks, the publish star and the graph nodes all rendered as
  body text, and the lit READING pill (an `--accent` fill carrying `--bg` letters) read as a text
  selection rather than an alarm. The whole mode-pill argument below rests on that pair being
  loud. It now carries an indigo; the next-closest theme sits at 23.9 ΔE, which is where the 18
  floor comes from.
- **"No two themes share a hex" is satisfiable and visually meaningless; the real test is whether
  two swatches are separable at a glance.** Three pairs failed it and were retuned: `void`
  (#101014 / pale steel) was basalt with less character — it is a true black under a cold signal
  cyan now; `tallow` was iron-gall with the lamp turned up (2.4 ΔE of ground) — its ground climbs
  to real brown paper and its amber warms into candle flame, which cost six mid-tone callouts
  ~0.35:1 and so they were re-solved rather than left to slide under the 4.8:1 bar; `solar` was
  `sandstone` with the hexes nudged (4.1 ΔE ground, 11.7 ΔE accent) — two of only FOUR light
  themes in one room — and now opens on the brightest paper in the set under a yellower burnt
  gold.
- **`--text-faint` against `--bg` and `--bg-raised` is a PASS in that gate too, at the 3:1
  non-text bar.** It printed "(info)" against a minimum of ZERO — a number the gate could never
  enforce, which reads like coverage and is worse than printing nothing: parchment shipped at
  2.50:1, and text kept being moved onto the one token nothing could fail (attachment filenames
  at 14.4px, the sidebar footer counts, the tag counts). The floor is what makes the token's
  remit real: **`--text-faint` is for UI glyphs and for deliberately de-emphasized machine
  bookkeeping — never for a name, a count or a label the reader must read**, which is
  `--text-muted` (4.5:1 or better everywhere) or `--text`. Parchment's faint was retuned
  `#a2947c` → `#8d7f66` (3.30:1 / 3.60:1). And **opacity is invisible to the gate**: a 0.85 fade
  over a token already at its floor is a way of failing the floor without failing the check, so
  glyph fades were replaced by token steps.
- **`--accent` against `--bg` is a PASS in that gate, not an "(info)" line.** That pair is read as
  type twice over: wikilinks and tag pills are `--accent` on `--bg` inside the prose, and the lit
  mode pill is an `--accent` fill carrying `--bg` letters — the same two colors, swapped. While it
  printed as information only, parchment (4.13:1), sandstone (4.17:1) and solar (4.24:1) all
  shipped below AA, which is how the loudest control in the product came to be the least legible
  one on the warm light themes. Their accents were darkened to 5.09 / 5.32 / 5.40; `--accent-soft`,
  `--selection-bg` and `--swatch-<id>-accent` moved with them, since those are the same color
  under other names.
- **`--swatch-<id>-bg/-text/-accent` are CONSTANT across themes.** A preview of a theme painted
  in the theme currently on screen is not a preview. `styles/themes.css` maps each id to
  `--sw-bg/--sw-text/--sw-accent` on `[data-theme-swatch]` (picker) and `[data-theme-dot]`
  (palette), so both surfaces are generic — a sixteenth theme needs one rule, not two.
- **`client/components/ThemePicker.tsx` owns browsing, and all three doors are wired.** The
  status-bar ☾/☀ button, the palette's *Browse themes…* command and Settings → Appearance's
  *Browse themes…* button all call `openThemePicker()`. The status-bar button is the one that
  mattered: it used to call `nextTheme()`, stepping blindly through fifteen looks with no way to
  see what was available or to get back — the same invisible state as a silent reading mode, and
  it contradicted this file, the picker's own header comment and the README, all three of which
  already said the button opens the panel. **A row is a miniature of the ROOM plus a human name**:
  three 10px dots previewed the tokens, and at that size sumi, void and basalt were the same
  swatch three times over (dark dot, white dot, pale dot), so each row now draws the theme's
  ground carrying a heading rule, a line of type and an accent chip — still from the CONSTANT
  `--swatch-*` values — beside a localized label and a one-line description (`THEME_LABELS` in
  `client/themes.ts`). Fifteen rooms identified by fifteen obscure Latin pigment nouns was not a
  naming scheme in English and was untranslated in Arabic; the raw id is still the value
  `DEFAULT_THEME`, `settings.defaultTheme` and the palette take, and it lives in the row's
  `title`. `nextTheme()` survives in `state.ts` as a keyboard-only
  "next look" helper; no chrome calls it. The glyph reads `themeGroup(theme)`, not
  `theme === "parchment"` — there are four light themes and the moon was drawn on three of them.
  The overlay carries **no scrim and no blur** (`styles/themes.css`): every other overlay dims the
  app because the app is not what the reader is looking at, and this one exists so they can look
  at it — stacked under the settings panel's own `.s-palette-overlay` the two washes made the live
  preview a guess, so the settings overlay also steps back to 10% opacity while the picker is up
  (`body:has(.s-tpick-host)`), without unmounting: Esc must return to the panel as it was.
  `openThemePicker()` mounts it on `<body>` (like `toast.ts`) so the status bar, the settings
  panel and the palette can all open the same panel from two component trees; `isThemePickerOpen()` exists because a capture-phase
  Esc listener registered EARLIER (the settings panel's) would otherwise close the panel
  underneath it. Arrow keys move the highlight and APPLY it live (`data-theme` only — not the
  store, not localStorage), Enter commits through `setTheme`, Esc and unmount both restore the
  theme in force when it opened. **Hover never moves the keyboard highlight** — that is the
  palette's Enter-follows-the-mouse bug, and it must not be reproduced here.

## Settings panel (SettingsModal)

SIX TABS, not one scroll: Site identity / Appearance & language / Publishing & comments /
Typography / Backup & sync / About. It was seven, and *Appearance* did not earn one: three
controls in a panel fixed at 740px, measured body 609/609, ~500px of dead space — while *Public
layout* sat under "looks" when it is a publishing decision. So the two theme rows joined the
language ones (both answer "what does this instance look and sound like to a reader", and the
merged tab scrolls at 833/609 rather than standing empty) and Public layout moved to Publishing.
The FIXED height is not what was wrong and does not change: sizing to content moved the rail
under the pointer, so a click opened a tab nobody chose. The rail is `role="tablist"` (↑↓/Home/End walk it), each tab
opens with its name and ONE sentence (`intro` on the `TABS` table), and switching tabs resets the
body scroll — carrying a long tab's offset into a short one lands the reader past its end.
**The panel is ONE height for all six** (`height: min(740px, 100vh - 40px)` in `settings.css`),
not a height per tab. Sizing to the content stood it at 467px on Appearance and 855px on
Typography, and because it is centred, every click moved the RAIL as well as the body: the row
under the pointer became a different tab, and the next click opened a section nobody chose. The
two tall tabs scroll, which they always did; short tabs carry empty space, and a tab strip that
stays put is worth it.
**Every control in the panel is OURS** (`client/components/controls/*`, `styles/controls.css`).
The panel was built out of native `<select>`/`<input type=checkbox>`, which draw the operating
system's widget inside a candlelit manuscript room — and, with twenty-seven fonts, opened an
OS-drawn *window* that no theme can reach and no panel can contain. The set is `Select`
(styled trigger + themed popover), `Toggle`, `SegmentedControl`, `TextInput` and `NumberInput`;
zero native select/checkbox chrome is left anywhere in settings.

**And zero `window.*` dialogs are left anywhere in the app.** `Confirm.tsx` now hosts a
`promptModal()` beside `confirmModal()` — same panel, same focus trap, one field — because the
four creation flows (`Ctrl/Cmd+N`, the sidebar's New note, the tree's "New note here", New
folder) were still drawing `window.prompt()`. An OS box takes neither the theme, the type scale
nor RTL mirroring, and its OK/Cancel were the only untranslated chrome on an Arabic instance;
it is also a functional risk, because once a browser's "prevent additional dialogs" box is
ticked `prompt()` returns `null` forever and there is no working new-note path left, silently.
The prompt's own rule: `check(raw)` is the caller's entire naming rule (`client/prompts.ts`),
run on every keystroke, and the dialog PRINTS what it makes of the text — "Creates
ideas/Deep Work.md" — then resolves with exactly that string. The `.md` and the folder used to
be appended in silence, so "I typed Ideas" was answered in the tree rather than in the dialog.
The field is `dir="auto"`; traversal (`..`) and dot-names are refused in the dialog, in the
instance's language, instead of arriving as an English 400 in a toast.

- **The popover is a PORTAL on `<body>`, positioned per open from the trigger's rect.** The panel
  is `overflow: hidden` and its body is a scroller, so an in-flow popover would be clipped by one
  and dragged by the other. Portals bubble React events through the COMPONENT tree, so the
  popover stops its own mouse events; outside-clicks are a DOM capture listener.
- **The BOUNDS are the scrolling region, not the dialog** (`[data-popbounds]`, which
  `SettingsModal` puts on `.s-smodal__body`), intersected with the viewport — the owner's words
  were "fits correctly within the settings screen bounds". Clamping to `[role="dialog"]` met that
  only in the middle: measured at 1440, five popovers reached **58–192px past the footer's top
  edge**, over the divider and the Close / Save row, which are chrome the reader has to be able to
  reach WHILE choosing. `[role="dialog"]` remains the fallback for a Select outside the panel.
- **A STICKY BLOCK IS NOT ROOM** (`[data-popclear]`, on `.s-smodal__specwrap`). At 1280×800 in
  Arabic the Arabic-face picker flipped above its trigger and covered the live specimen's last
  line — defeating the preview that is the entire justification for applying the value on
  highlight. The room above a trigger now starts below any keep-clear block inside the bounds.
- **Three placements, tried in order: below, flipped above, and OVER THE TRIGGER.** The third is
  what a native select has always done and it is what makes the first two affordable: clamping to
  the panel body leaves a picker near the foot of a tab barely 150px on its best side while 340px
  of clear region sits unused. When neither side can hold a usable list, the list takes the whole
  clear region. The trigger is the one thing safe to cover — its value is the ticked row inside
  the list, and the specimen is `[data-popclear]` and therefore outside the region.
- **TAB COMMITS AND THEN ADVANCES.** It used to `close(true)` and stop, and `close` returns focus
  to the trigger, so Tab was Enter wearing another key's name: it committed and left the reader on
  the control they had just finished with. (Shift+Tab was not handled at all, and since the
  popover is a portal on `<body>`, the browser's own Tab from inside it would have walked off the
  end of the document rather than through the panel.) It now commits, then steps to the next
  tabbable inside the same bounds once the trigger has taken focus back.
- **`grid` is the font picker and nothing else.** Its rows are two lines tall — the specimen IS
  the option — so a 27-family catalog was judged **three and a half faces at a time** against a
  340px popover, and the filter only helped a reader who already knew the name they wanted, which
  is not what a picker is for. `.s-ctl-pop--grid` lays each GROUP's options out in columns (never
  across a group heading, or "Arabic — naskh" ends up beside a serif face) as **specimen-led
  cards**: the family name is a small overline and the sample takes the type size, because the
  question being answered is "what does this look like". Measured: 5–7 whole cards visible at once
  where the column showed 3. `MIN_GRID_WIDTH` is 540 — at 460 the wider Latin faces ellipsized the
  specimen, which is a specimen of the ellipsis.
- **`isSelectOpen()` exists for the same reason `isThemePickerOpen()` does.** The panel's Esc
  listener is a capture-phase `window` handler registered earlier, so it must stand down while a
  list is open — Esc there means "put the value back", not "close the settings".
- **The popover renders only once it has been PLACED**, and everything that reaches into its DOM
  waits for that pass, not merely for `open`. Focusing on `open` alone silently did nothing (the
  element did not exist yet), left focus on the trigger, and took the keyboard contract with it:
  Esc landed outside the popover and never closed it. Same failure as the shell's "focus AFTER the
  reveal lands" rule, one component down. The trigger also routes its keydown into the popover's
  handler while open, so Esc cannot be lost to a stray focus.
- **↑↓ apply the value LIVE** (the theme picker's rule — the specimen is the reason the list is
  open), **Enter commits the highlighted row**, Esc and an outside click restore the value the
  popover opened with. **A row CLICK passes the value it won with**, because `activeRef` is
  assigned during RENDER: a handler that calls `setActive(v)` and closes in the same tick still
  reads the PREVIOUS highlight, so `close(true)` set the value and then immediately put it back
  and **every pointer pick in the panel silently did nothing** — only the keyboard worked, since
  ↑↓ commit on a later keystroke by which time the render has landed. `close(commit, chosen?)`
  takes the winning row from the caller that already knows it. A control that answers the
  keyboard and ignores the mouse is worse than the native select it replaced. Filtering moves the highlight to the first match **without** applying it:
  four keystrokes of "amir" must not be four value changes. Hover never moves the highlight
  without the pointer actually moving (`mousemove`, not `mouseenter`) — the palette's bug.
- **Three-way rows are SegmentedControls, not selects**: *Inherit* (carrying the value in force as
  its note) / On / Off, all three visible. A checkbox cannot express "not set", and a list you must
  open to learn it holds three items is the wrong shape for three words. **Its HORIZONTAL arrows
  answer the inline direction** — the segments are laid out by it, so in an Arabic panel
  `ArrowRight` walks backward and the reader's finger and the highlight move the same way; ↑↓ are
  direction-free and always mean next/previous. The test is `closest("[dir]")`, not `<html>`, so a
  control inside an explicitly LTR island (`NumberInput`'s field) is read by the direction it is
  actually drawn in.
- **The notes sidebar's edge is a row in Appearance, directly under Language.** Three segments
  (*Auto* / *Left* / *Right*) on `setSidebarSidePref` — the same action the palette's three
  commands call, which is the whole point of there being one action. It is a DEVICE preference
  like *Your theme*: it commits on click and is never part of the Save diff. The *Auto* segment
  carries the edge it RESOLVED to as its note (the panel's inherit-names-its-source convention),
  because the default state of a three-state preference must not be the invisible one — and
  because the row above it is what moves it: switching the instance to Arabic carries the pane to
  the right while the reader is looking at both rows. Segment labels name a PHYSICAL edge in both
  languages, exactly as the palette commands do. Two-state rows (Backup,
  Pull first) are `Toggle`s, and a DISABLED toggle keeps its position (a reader must still be able
  to read what is configured) but loses its colour — lit, an inert "Pull first · on" was the
  brightest thing in a column of greyed rows.
- **`NumberInput` carries its unit INSIDE the field** ("142 %"), with steppers of our own rather
  than `<input type="number">`'s browser spinners. The field is `dir="ltr"` as a whole: with only
  the input LTR inside an RTL panel, the logical padding and the logical unit inset resolved to
  opposite edges and the "%" landed on the digits. *Automatic sync* deliberately stays a closed set
  of SENTENCES (see below) — the unit control is for the Arabic size match, where a number really
  is the value.
- **The panel's fixed measures are in REM, not px.** `:root[lang="ar"]` multiplies `--font-scale`
  and 1rem is `--font-base × that scale`, so a px rail and a px label column hold ~6% less Arabic
  than English: tab names wrapped, labels collided with their controls, and the panel lost its
  rhythm in Arabic — the "weird margin/padding in Arabic mode" report. In rem they grow with their
  own type.

**A FIELD'S `dir` FIXES ITS ORDER; IT MUST NOT ALSO FIX ITS ALIGNMENT.** This is the `<bdi>` rule
Select.tsx already applied to the popover rows — "two things being compared have to start at the
same place" — and the plain inputs in the same panel never got it. Machine text (a URL, a branch,
a vault path, a BCP-47 tag) is `dir="ltr"` and stays so: `git@host:path` reordered by an RTL
paragraph is a different string. But `text-align: start` then resolved against the FIELD's
direction rather than the PANEL's, so in an Arabic panel the logo and favicon paths sat flush LEFT
while the site name and tagline directly above them sat flush RIGHT — a ~400px jump between
adjacent rows of one form. Measured across all six tabs in Arabic: **seven fields aligned to the
opposite edge of the column from their neighbours**, now zero. Two rules in `controls.css` flush
any disagreeing field to the panel's start edge; `.s-ctl-num__input` is the one deliberate
exception (its field is an LTR island with the unit pinned at its inline end, so aligning the
digits to the panel's start would park "142" on the "%").

**The site FOOTER field is `dir="auto"`, because its content is a TEMPLATE.** `© {year}
{siteName}` is machine syntax, and an RTL field laid it out as `{siteName} {year} ©` — measured,
the three tokens at x 538 / 628 / 679 — so the operator was shown one token order and had to type
another, which is the one place a wrong order silently teaches wrong syntax. It cannot be pinned
`ltr` either: this is also the site's footer PROSE, and an Arabic instance writes it in Arabic.
`auto` lets the first strong character decide, so the default template renders exactly as it must
be typed and an Arabic footer stays Arabic. Its ALIGNMENT still follows the panel, per the rule
above. (The sync tab's `https:// or git@host:path` hint was checked the same way and is already
correct: its LRM marks put the runs in authored order under an RTL base — measured x 905 / 894 /
809, reading right-to-left.)

**A NOTE THAT ONLY REPEATS ITS LABEL IS NOISE.** The default-theme rows carry the raw id as a
muted note because that is what `DEFAULT_THEME` and `settings.defaultTheme` take. In Arabic it
earns its place twice over (Arabic name, Latin id); in English it printed Iron gall / iron-gall,
Cinnabar / cinnabar, Sumi / sumi and five more — the same word twice, ~230px apart at the far edge
of the row. The note is dropped exactly when it is DERIVABLE from its label (lowercase, non-alnum
→ `-`), which is a property of the pair and not of the language: 0 notes in English, 15 in Arabic.

**"Your theme" and "Default theme" answer the same question and wear the same face.** *Your theme*
was a 58px swatch and a "Browse themes…" text link flung to opposite ends of the control column
with ~280px of nothing between, one row under a full-width Select — the least finished-looking row
in the panel, in both languages. It is one `.s-ctl-select`-shaped trigger now: same measure, same
border, same chevron, carrying the miniature the picker itself draws. What it opens is a browsing
panel rather than a list, which is the honest difference — fifteen rooms are chosen by looking at
them.

**A row that is inheriting NAMES its source, and one disabled state wears one face.** Every
select read `inherit (en)` / `inherit (off)` / `inherit (iron-gall)` — honest about precedence,
opaque about where the value came from — so `Row` takes an `env` prop and renders
`inherited from SITE_LANG` under the control while (and only while) the row is empty. The env
name is a literal to be typed into a shell, so it is a mono `<bdi>` rather than a `tf()`
interpolation. And with Backup=off the three `<select>`s took the browser's own greying ON TOP
of `.s-smodal__row--off`'s 0.5 while the Remote URL and Branch `<input>`s took only the row's, so
`:disabled` inside `.s-smodal__control` now neutralises the UA opacity and sets one
`--text-muted` on `--bg-raised` treatment for both shapes.

**A row that does nothing HERE says so, in the same voice.** `settings.home.mode` and
`settings.home.banner` are read by the blog shell alone — `/api/me` sends `me.home` inside
`if (publicLayout() === "blog")` and `BlogDashboard` mounts only from `BlogShell` — but the Mode
segmented control and the home-banner `ImageField` were offered live, ungated and unannotated,
under copy promising the opposite. `PUBLIC_LAYOUT` defaults to `app`, so the ordinary case was:
pick Dashboard, upload a hero, get a success toast, and the site does not change. Both rows now
take `off` + `disabled` (`ImageField` grew a `disabled` that reaches its field AND its Pick/×
buttons — a live "Pick…" beside a dimmed field is the same bug wearing a badge) whenever the
effective public layout is not `blog`, with one `.s-smodal__offnote` above them naming the
switch: the Backup=off idiom, applied to the row that needed it just as much. The gate reads the
FORM, like `syncOff` does, so flipping Public layout to blog lights the rows up in the same
breath, before the save. The Home NOTE row between them stays live on purpose — the app shell
opens it at boot.

**The panel is called "Site settings", full stop.** It used to read "Site settings —
settings.json": an implementation file in the title bar of a settings screen, naming a path
without saying where that path is. Where the file lives is a FACT about the instance, so About
prints `settingsPath` and `customFontsPath` (both on `AboutInfo`) beside the vault and data
directories, with one sentence saying that deleting the file returns the instance to its env
defaults.

`settings.defaultTheme` is parsed leniently like `settings.language`: trimmed **and lowercased**.
`DEFAULT_THEME` is lowercased by `readEnvTheme()` before validation, so trimming without
lowercasing meant `DEFAULT_THEME=SOLAR` started the instance on solar while
`PATCH {"defaultTheme":"SOLAR"}` was a 400 — the same value accepted through one door and refused
at the other.

`GET /api/settings` carries `about` (`AboutInfo`: version, node, vault path, data path, note /
published / attachment / tag counts) — admin-only by construction, since the route 404s to
visitors, which is what lets it name absolute paths.

## Conventions

- No default exports except React components. No `any` unless unavoidable. Small files > clever files.
- Errors surface to the user via `console.error` + a transient `.s-toast` div helper in
  `client/toast.ts` (`export function toast(msg: string)`) — shell agent owns it. The MESSAGE is
  `t()`/`tf()`, keyed off `ApiError.code` where the server names one; see the API section.
- **A SCROLL BOUNDARY FADES; IT DOES NOT GUILLOTINE.** `client/scrollFade.ts`
  (`attachScrollFade(el)`) maintains `data-more-above`/`data-more-below`, and `.s-scrollfade`
  (app.css) masks an 18px alpha ramp at whichever end actually has content beyond it — so a list
  short enough to fit keeps full contrast at both ends, and with neither attribute set the mask is
  a fully opaque gradient. It replaced two absolutely-positioned gradient `<span>`s over the
  settings body: a gradient laid OVER content only hides what it exactly matches, and it did not —
  a segmented pill still came through the top edge cut across its middle with its accent border
  flat-cut, which reads as a rendering fault rather than as "there is more above", and the same
  slice happened at the foot against the footer rule. A mask removes the alpha, so the row
  genuinely dissolves and nothing has to be colour-matched. The popover list wears it too (rows
  were sliced mid-glyph under the sticky filter field). It is OFF at the top of a body that holds
  a sticky block (`.s-smodal__body:has(.s-smodal__specwrap)`): the specimen owns that edge, paints
  the panel's own ground and carries its own gradient tail, and fading it would fade the live
  preview the whole tab is built around. A STICKY BLOCK'S GROUND MUST COVER EVERY PIXEL IT
  OCCUPIES — `.s-smodal__specwrap` spent 6px of its gap on `margin-bottom`, which is outside the
  painted box, so the tops of the rows scrolling underneath showed through as a band of
  disconnected glyph and diacritic fragments (conspicuous in Arabic, where the tashkeel ride high
  enough to be exactly what survives a 6px window). It is padding now.

## Note deletion (server, shipped)

`DELETE /api/note?path=<rel>&permanent=<bool>` → `{ ok: true, trashPath?: string }`

- **The safety gradient used to run backwards.** Deleting a FOLDER — rare, two dialogs deep, up to
  1,214 notes at once — moved to `.trash/` and was recoverable; deleting ONE note — the
  high-frequency, one-click operation on a tree row and in the command palette — was an
  unconditional `fs.rm` with no trash and no undo anywhere in the product. The irreversible
  operation was the cheap one. Obsidian trashes single files by default; so does this now.
- **Default:** the note is *moved* to `.trash/` at the vault root (created on demand), with the
  same counter the folder route uses — placed before the extension, so `draft.md` becomes
  `draft.md`, then `draft-2.md`, `draft-3.md`… and a trashed note is still an openable `.md` file.
  `EXDEV` (a bind-mounted sub-tree) falls back to copy-then-remove.
- **`permanent=true`** (also `1`/`yes`/`on`, parsed exactly as on `DELETE /api/folder`) → `fs.rm`;
  no `trashPath` in the response. This is the escalated path the client asks a second question for.
- Errors: `400` non-`.md` path or traversal, `404` when the note does not exist.
- **Events:** the watcher's own `unlink` for the moved file carries it (`{kind:"deleted"}`, 100 ms
  debounce, as before); `.trash` is ignored everywhere, so the arrival at the far end is silent.
- Vault API: `deleteNote(rel, opts?: { permanent?: boolean }): Promise<{ trashPath? }>`.

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
from the client's own tree (`countNotes`), which counts exactly what the server counts: **file
nodes with no `attachment` marker**, under the same ignore rules. (It used to count every file
node, which was the same thing until the tree started carrying attachments; a plain count would
now promise to move "1,214 notes" when it meant 800 notes and 414 images.)

**A single note deletes at the same two speeds, from both surfaces.** `DELETE /api/note` grew
the folder route's `?permanent=` (same `1/true/yes/on` parsing, same `.trash/` destination),
and the client side is the folder pattern verbatim: `api.deleteNote(path, permanent)` →
`state.deleteNote(path, {permanent})`, driven by `confirmModalEx` with `extraLabel: Delete
permanently` and a second, `grave` dialog behind it. Both entry points — the tree's context menu
and the palette's *Delete note* — run the identical pair, because a command must not be the
harsher one merely because it was reached from the palette. Until this landed, one dialog said
"This cannot be undone" over an `fs.rm` while the folder one line above it in the same context
menu promised `.trash` — the same gesture, two different guarantees, and the harsher one applied
to the object an owner deletes most often. The store action closes the tab, reloads the tree,
refreshes backlinks, refreshes publish state (a published note leaving the vault changes the
public site) and toasts `noteTrashedToast` / `noteDeletedToast`.

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

## Attachments in the tree (server tree + sidebar + viewer)

A vault is not only `.md`. The tree used to list markdown and nothing else, so `Media/` — 1,158
images in the fixture this was built against — appeared as a folder that expanded to **nothing**,
and the owner of a real instance read that as lost files. Fixing it is three pieces:

- **`TreeNode.attachment?: AttachmentInfo`** (`shared/types.ts`) — present on non-markdown FILE
  nodes only: `{ kind: "image"|"pdf"|"audio"|"video"|"other", ext, size }`. **Its absence is the
  definition of "note"**, and every consumer that wants notes only says so: `countNotes()` in the
  sidebar checks the marker, `collectNotes()` in `client/editor/links.ts` filters on the `.md`
  suffix of `path` (which is why the palette, router, daily notes, wikilink resolution and the
  published-filter list needed no change at all). Anything new that walks the tree must pick one
  of those two filters deliberately.
- **`buildTree()` sorts folders → notes → attachments**, alphabetical within each band, so a
  folder still opens onto its writing. Attachments cost one `fs.stat` each — for `size`, which the
  viewer prints — and the stats of one directory run concurrently; the full 1,388-note /
  1,176-attachment fixture serves `/api/tree` in ~60 ms.
- **The visitor tree carries none of it.** `publishedTree()` is built from `publishedNotes()`, so
  no filename outside the published set is ever named to a visitor or to an admin previewing as
  one — whatever the sidebar filter is doing at the time. Attachment BYTES stay gated where they
  always were, on `/api/file`'s `isAllowedAttachment()` check: a visitor asking for a real but
  un-allowlisted file gets the same `404 {"error":"File not found: <path>"}` a missing file gets.
  The viewer only ever fetches that route, so it cannot show what the server will not serve.
- **The publish allowlist covers BOTH embed syntaxes.** `allowedAttachments()` built the visitor
  allowlist from `record.links` + the banner, and `parseLinks()` fills `links` from
  `wikilinkRegex()` alone — so `![[x.png]]` was allowlisted and `![alt](Media/x.png)` never was,
  while the renderer turns the second straight into `/api/file?path=Media/x.png`
  (`resolveRelative()` in `client/editor/embeds.ts`, used by `client/reading/render.ts`). Every
  standard-markdown image in a published note 404'd to every visitor: the admin saw the picture,
  the visitor saw a placeholder, and nothing said why — a silent public-site breakage of exactly
  the invisible-state kind, against a promise `OBSIDIAN-COMPAT.md` and `README.md` both make.
  `NoteRecord.assets` now holds those destinations, resolved against the note's own folder by
  `parseAssets()` — the server-side twin of `resolveRelative()`, matching the SAME regex shape the
  two renderers use, so the allowlist covers exactly what the page will ask for and no more.
  External schemes are skipped and a path that climbs above the vault root is dropped rather than
  clamped. It still fails CLOSED: an attachment no published note points at stays a 404.

Client side (`Sidebar.tsx`, `AttachmentViewer.tsx`, `styles/attachments.css`):

- **Attachment rows are quieter than note rows STRUCTURALLY, not by contrast.** They carry a 14px
  type glyph in the chevron's slot, keep their extension in the label (it is half of what the
  name says), sit under the folder's notes, answer to the paperclip filter, and carry the full
  name as a `title` — the pane is 292px and these names are not. The NAME itself rests on
  `--text-muted` (`--text` on hover), like a note row: a filename is text, it is 14.4px, and on
  `--text-faint` it measured 3.3:1 at best and 2.50:1 on parchment. Only the type glyph is
  `--text-faint`, and at full opacity — the 0.85 fade it used to carry put it at 2.56:1, under
  the same 3:1 bar the fold chevron is held to. Same for the extension badge (10px uppercase,
  `--text-muted`) and the footer counts.
- **The filter is visible in both states.** "Show attachments" lives in the sidebar footer as a
  paperclip beside the counts (`localStorage["vellum.show-attachments"]`, default ON, admin only)
  and in the tree's context menu. ON: gold clip, "1,176 files". OFF: grey clip, "**1,176 files
  hidden**" — in words. A filter that removes a thousand rows and says nothing is the bug this
  round is about, so a folder the filter has emptied also grows one italic row, *"18 files
  hidden"*, which turns the filter back on when clicked. No folder ever opens onto nothing again.
- **One level of the tree renders at most `CHUNK` (300) rows**, then a "Show N more" row.
  `TreeChildren` owns the filter, the cap and the `siblings` array (memoized, so it does not bust
  `memo()` on rows that did not change); `TreeRow` renders one row. Expanding the 1,158-image
  folder measures ~70 ms end to end. This applies to notes too — the same fixture has a 715-note
  folder.
- **The nav handles sit on a fixed `rgba(0,0,0,.72)` scrim, so they cannot be painted as if they
  were on the page.** `--bg-raised` is a near-black on eleven of the fifteen themes, which made
  the only way to walk a 60-image folder the lowest-contrast control in the product: dark circles
  on a dark wash. They take an accent-tinted ground, a lit rim and a `--text` glyph, and fill with
  the accent on hover. The `N / M` position indicator had two `.s-att-view__pos` blocks, the
  second overriding the first down to `--text-faint`, so the one number answering "how much more
  is there" was fainter than the filename beside it; one block, `--text-muted`.
- **The viewer is a portal onto `<body>`**, not a child of the sidebar: the sidebar is a grid pane
  that animates its own width and clips its overflow. It shows the image at natural size capped to
  the viewport (never upscaled), one caption line — name · `PNG · 1,045 × 657 · 92 KB` · position
  · open-in-tab · download · close — and `←`/`→` walk the folder with wrapping. Pixel dimensions
  come from the loaded `<img>`; the byte size comes from the tree, so the viewer makes no second
  request. **Esc and the arrows are bound in the CAPTURE phase**, like the confirm dialog, so the
  viewer outranks zen's Esc and every editor binding while it is open.
- **PDFs never enter the carousel.** A click opens `/api/file` in a new tab (browsers render PDFs
  better than we can), so a PDF is also skipped by the arrows rather than appearing as a card the
  arrows can land on. Audio and video get an inline player; anything else shows an extension card
  with a download.
- **RTL:** the caption bar and nav buttons are logical (`inset-inline-*`), the `‹`/`›` glyphs are
  `Bidi_Mirrored` and therefore carry **no** transform, and the arrow KEYS answer the physical
  layout — in an RTL shell `ArrowLeft` is *next*. Sizes print through `localeNum()`, with the
  Arabic decimal separator (U+066B) on the one decimal `formatSize()` emits.

## Mode visibility (status bar, workspace, preview)

A mode that removes the ability to TYPE must be impossible to sit in unknowingly. Three surfaces
carry that, and none of them may be quiet:

- **A mode with STATES must show the state, not the mode.** VIM told the reader the extension was
  loaded; it never told them the keys under their fingers were currently COMMANDS, which is the
  actual trap — and reading mode had three surfaces to vim's one. Two pieces carry it now.
  `vim({ status: true })` (`client/editor/setup.ts`) mounts vim's own panel at the foot of the
  editor: that panel draws `-- INSERT --` / `-- NORMAL --` **and** hosts the `:` and `/` command
  line, so a modal editor finally has a command line. `client/editor/vimStatus.ts` forwards vim's
  `vim-mode-change` into `state.vimSubMode` (`"normal" | "insert" | "visual" | "replace" | null`,
  never persisted, written only by that module) and the pill renders it as a second word behind a
  hairline — **VIM │ INSERT**. It attaches on `setVim(view, true)` and on mount (the module may
  already be cached, in which case setVim's async path never runs), and detaches on unmount and
  on switching vim off. Nothing imports `@replit/codemirror-vim` statically for this: `getCM(view)`
  is `view.cm`, and the load must stay on demand.
- **The status-bar cluster is switches, not labels.** `.s-modes` holds a `ModePill` per mode —
  READING, VIM (admin) and PREVIEW (while previewing). ON is `--accent`-filled with `--bg` text, a
  dot and a glow (that pairing clears 4.5:1 in every built-in theme: the dark themes carry a light
  accent, parchment a dark one); OFF is a calm outline. Each pill LEAVES its own mode on click and
  its `title` names the keystroke. Every rule is scoped `.s-statusbar .s-mode…` — `.s-statusbar
  button` is `(0,1,1)` and would otherwise repaint the pills with the muted button color, the same
  trap the sync badge documents.
- **In zen the strip is the ONLY place a mode can live**, because zen takes the status bar — and
  with it the whole pill cluster — to zero height. Reading already survived into zen; vim did not,
  so ZEN + VIM was a modal editor with nothing on screen at all. `.s-modebar--vim` renders on the
  same terms as the reading strip but **only in zen** (outside it the pill carries the sub-mode,
  and a permanent second row would push every note down for every vim user). The two are mutually
  exclusive by construction — reading unmounts the editor, so there is no vim to report — which is
  why the zen ✕ offset keys off `.s-app--modebar` (either strip, one row's worth) rather than
  `.s-app--reading`.
- **The workspace says it too.** `.s-app--reading` (admin, editor view, note open, not previewing)
  draws `.s-modebar` — one line, IN the flex column above `.s-view`, so it pushes the note down
  instead of floating over it — plus an accent rule on `.s-view::before` at `inset-inline-start`
  (a pseudo-element, not a border: a border would shift the prose 2px every time the mode flips,
  and a physical `left` would land on the wrong edge in Arabic).
- **A 404 inside visitor preview is the CORRECT answer, and must not be dressed as a fault.**
  `setPreviewVisitor(true)` cannot scope the open tabs until `loadTree()` answers, and in the
  meantime the reading view refetched the open note with the visitor header on — so the eye
  button, whose entire job is letting the owner inspect his own site, opened by announcing
  "Failed to open <path>" about a site that was fine. Two halves: `openPath` goes to **null** for
  the length of the transition (drop the tab before the view refetches, restore it if it
  survives), and when the note does NOT survive the scoping the store says why in its own words
  — `previewNotPublishedNamed`, naming the note. Independently, `client/api.ts` throws
  `ApiError` carrying the STATUS and exports `isNotPublishedError()`, so `ReadingView`/`Editor`
  answer a preview 404 with the calm `previewNotPublished` instead of the generic
  `openFailed`. `toast(msg, "error")` finally applies `.s-toast--error`, which existed in
  app.css and was never once set.
- **Inside preview the tail control is "Exit preview", not "Sign in".** The session IS still an
  admin one — the shell is only wearing a visitor's clothes — so `signInTitle` ("Sign in to edit
  this vault") was a promise the product could not keep: the modal opened, the password was
  accepted, and the shell stayed a visitor shell.
- **Visitor preview is a TOP strip that offsets the page, and it is never persisted.** In the app
  shell `.s-app--preview` adds a `notice` grid row above every pane (the flipped variant carries
  both classes so it outranks `.s-app--flip`), and the reopen handles start below it. In the blog
  shell the strip is the first child of `#root`, which becomes a flex column (`:has()`) so
  `.s-blog`'s own scroller takes what is left — the blog's sticky nav then sticks to the top of
  THAT scroller and the two can never share a band. Nothing may overlay the site at either edge:
  preview exists so the owner can judge his own layout. `Esc` exits, the store no longer writes
  `vellum.preview`, and boot clears any value an older build left behind — a reload always returns
  the admin to the app.
- **Discoverability is chrome, not folklore.** The status bar carries icon toggles for the
  sidebar, the right panel, zen and `Ctrl/Cmd+/`; a collapsed pane's reopen handle sits at a
  visible rest contrast (accent-tinted ground + a lit edge facing the content), never a
  hover-reveal. **The heading fold chevron answers to the same rule** (`preview.css`
  `.cm-s-foldbtn`): it rested at `opacity: 0` and rose to 0.6 only on `.cm-line:hover`, so only
  the hovered heading ever showed one, nothing on screen said a document folds at all, and on a
  touch device folding was unreachable. Naming it in the `Ctrl/Cmd+/` sheet was documenting an
  invisible control, not fixing one. It rests at full strength in `--text-faint` (a UI glyph,
  held to the 3:1 non-text bar — a bar `check-contrast.mjs` now ENFORCES, on both grounds, which
  is what made parchment's 2.50:1 faint a failure instead of a footnote), steps to `--text-muted`
  on the line and to `--accent` on itself.
  The sheet now names the KEYSTROKE too (`Ctrl/Cmd Shift [` / `]`, `Ctrl/Cmd Alt [` / `]`).
- **`ShortcutsHelp` rows that light up must DO something.** Every row carried a hover highlight
  while being a plain `div` — an affordance lie that read as a selection. Rows with a `run`
  (palette, quick search, graph, daily note, reading, zen, vim, preview, themes, settings, both
  pane toggles) are `<button>`s that close the sheet and then run the command; rows that only
  document an editor keystroke are inert and carry no highlight at all. Search is RANKED, not
  substring-filtered: "fold" used to put *Next / previous file in the folder* above *Fold a
  section* under a NAVIGATION heading, so a word that opens a row's own label outweighs one
  buried inside another word, and the GROUPS sort by their best row (otherwise the winning row
  is still under whichever heading the authored order happens to put first). `\b` is ASCII-only
  in JS, so the word-boundary test is a `\p{L}\p{N}` lookbehind done by hand — this sheet is
  searched in Arabic.
  **Rows are filtered by SHELL as well as by session.** The blog visitor was being served the
  app's sheet: `admin` dropped the write rows, but Command palette (Ctrl/Cmd+P — nothing
  mounted), Graph view, Zen mode, Browse themes "via Status bar" (a surface the blog has not
  got) and both pane toggles survived — six rows naming controls that are not on the page, three
  of them `<button>`s firing commands into a shell that holds none of that state. So `Binding`
  carries `shell?: "app" | "blog"`, filtered exactly like `admin`, and `App.tsx` mounts
  `<ShortcutsHelp shell="blog" />` in the blog branch. What survives there is what is true
  there: Ctrl/Cmd+K (the blog's own search overlay answers it), a click on a wikilink, Esc and
  Ctrl/Cmd+/ itself — which is why `scHelp` moved to the end of NAVIGATION, the one group both
  shells have. **And the keyboard follows the same line**: `App.tsx` swallowed `p`/`k`/`b`
  unconditionally, ahead of every shell check, so an anonymous reader lost the browser's print
  dialog and Firefox's bookmarks sidebar to two commands that do not exist for them. Only `k` is
  taken in the blog shell; everything else returns before it acts.
- **The bar's order of sacrifice is written down, it is MONOTONIC, and it ends in a scroll.**
  `.s-statusbar` is `overflow: hidden`, so anything past its width vanishes with no scrollbar and
  no hint. At ≤1280px the two counts go; at ≤640px the pane cluster, the crumb trail and the
  separator dots go **and the bar becomes `overflow-x: auto`** (scrollbar hidden), because a phone can always be
  narrower than the controls that must stay — sign-out was falling off that hidden overflow, and
  there is no other way out of a session on a phone. The MODE PILLS never go. Each of those rules
  is scoped `.s-statusbar .s-…`: the base `.s-statusbar .s-statusbar__panes` is (0,2,0), so a bare
  `.s-statusbar__panes { display: none }` in a media query loses to it however late it sits — the
  same specificity trap the pills and the sync badge document. The bar's own padding is logical
  (`padding-inline: 14px 10px`); the `0 10px 0 14px` shorthand it replaced put the wider pad on
  the screen's left in both directions.

  **Identity outranks trivia at every width**, and the order above is only half of what enforces
  it. `.s-statusbar__crumbs` carried `min-width: 0`, so at 1024px the trail was crushed to
  `1 - … › Re…` while "140 words · 2,012 chars" AND "18 published notes" both rendered at full
  width — the bar was strictly WORSE at 1024 than at 900, where the counts finally dropped and
  the trail came back whole. So the crumb takes a floor of `min(20ch, 32%)`, released again at
  ≤900px once there is nothing ambient left to spend. The counts' threshold had to clear 1100
  rather than sit on it for the same reason: with the crumb no longer absorbing every overflow,
  an admin bar carrying the counts at ~1120px pushed sign-out onto the hidden overflow instead,
  which is trading one silent loss for a worse one. Measured on the 1,389-note fixture with
  publish, the published-note filter and both mode pills up.

  **A floor alone is not enough, because the trail's natural width is a VAULT PATH.** The crumb
  was the only unbounded item in the bar, so flexbox took every shortfall out of it. A
  two-segment crumb (223px) first gives ground at 1160px — safely under the 1200px step, which
  is why the ladder read as correct. A THREE-segment one (`1 - Source Material › Wiki › Nobel
  Prize in Physiology or Medicine`, 408px) first gives ground at **1340**: between 1200 and 1340
  the trail was crushed to make room for "140 words · 2,012 chars" and then sprang back to full
  at 1200 when the counts left. The bar was better at 1200 than at 1280 — the same
  non-monotonicity the floor was added to fix, moved to another width by a deeper path. So the
  trail takes a CEILING as well, `max-width: min(44ch, 36%)`: it can no longer be the fat item,
  the counts' departure hands it nothing back, and the ladder is path-INDEPENDENT.
  A ceiling worth having (~340px, most of that three-segment path) puts the first crush at ~1277
  in English and ~1224 in Arabic, so **the ambient pair now drops at ≤1280 rather than ≤1200** —
  a character count at 1280 traded for a hundred more pixels of the note's own name at every
  width, which is the trade this bar exists to make. Re-measured 1440→640 in both languages with
  the sync badge, publish, the published filter and both mode pills up: the crumb's width is
  monotonically non-increasing at every step (en 334·334·334·334·334·334·311·271·231·191·131·0,
  ar 354·…·254·214·154·0) and nothing ever lands on the hidden overflow.

  **When the trail must give, the FOLDERS give — never the note.** Segments shrank equally, so
  `1 - Source Material › Wiki › Nobel Prize in Physiology or Medicine` truncated to
  `1 - Source Material › Wiki › Nobel Pri…`: two folder names intact and the one string that
  answers "which note am I in" cut off. `StatusBar` renders the ancestors and their separators
  as ONE ellipsizing run (`.s-statusbar__crumbpath`, shrink factor 12) beside the leaf (shrink
  1), so the path thins to `1 - Sourc…`, then to `…`, then to nothing before the note's name
  loses a character. Grouping is what keeps that honest: per-segment shrinking left the elided
  ancestors behind as bare `› ›` chevrons, because a separator between two collapsed spans is
  still a separator. Each segment keeps its own `dir="auto"` inside the run.

  **The right cluster is GROUPS, marked once each by a hairline** — `.s-statusbar__group` for
  admin tools (gear, eye), for the view controls (theme, graph) and for the session control
  (sign-out / exit-preview), plus the existing `.s-statusbar__panes`. Separator dots between some
  neighbours and not others made eleven controls read as one undifferentiated icon strip; the
  hairline is the same separator the sync lines already use, and it drops on phones where the
  groups are neighbours anyway.

**`Ctrl/Cmd+/` opens `ShortcutsHelp` (`shortcutsOpen` in the store).** Searchable, grouped
Navigation / Editing / Modes / Publishing / Panels, `Esc` closes, also reachable from the palette
and the status-bar `?`. Rows with no keystroke still appear, naming the surface that carries them
("Command palette", "Status bar", "Click") — the reader is asking "how do I do X".

**Pointer hover must never decide what `Enter` runs.** The palette (and the blog search overlay)
open under wherever the cursor is resting, and `mouseenter` on the row that materializes there used
to move the selection silently. So hover is IGNORED until the pointer actually moves: a list-level
`mousemove` arms the rows only when its coordinates differ from the previous one (browsers emit a
synthetic move after layout/scroll changes, and one of those must not count), every keystroke and
every query change disarms it and resets the selection to row 0, and rows select on `mousemove`
rather than `mouseenter`. Clicking always activates regardless.

**`Ctrl/Cmd+K` remembers where it came from.** App records the focused element before dispatching
`vellum:quicksearch`; `Esc` inside `.s-search` returns focus to it (falling back to `.cm-content`,
and to a plain blur when the reading view has nothing focusable), because a search box on the far
side of the screen that only closes leaves the next keystroke nowhere. The blog overlay does the
same with its own ref.

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

**A text FIELD that holds note-derived text takes the value's direction, not the chrome's — but
only once it has a value.** The command palette's input is the case that bit: in an Arabic shell
the rename prompt opened pre-filled with `1 - Source Material/Research Page.md` and DREW it as
`Source Material/Research Page.md - 1`, because the leading digits are bidi-weak and the RTL
paragraph swept them to the far end. That is the string the reader is about to rename a file to.
`dir={query === "" ? undefined : "auto"}` is the shape: empty, the field inherits the shell's
direction so the Arabic placeholder still sets right-aligned — `dir="auto"` reads the VALUE, and
an empty one resolves to `ltr` in Chrome, which left-aligned «اكتب أمرًا أو ابحث في الملاحظات…»
inside an RTL panel. Palette hints are `<bdi>` for the same reason (they are localized words, raw
keystrokes and a real vault path in one column), and `.s-palette-item`'s padding is
`padding-inline: 14px 12px` — the `0 12px 0 14px` shorthand it replaced put the wider pad on the
screen's left in both directions, i.e. away from the icon and the selected row's accent bar in
Arabic.

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

**A `#tag` CHIP is one of those: the chip IS its content, so the isolate goes on the chip.** Both
properties-card renderers (`livePreview.ts` and `reading/render.ts`, one `makeTag` each) built the
label as a bare `#${value}` text node with no isolation, and `#` is bidi-neutral: under an RTL base
direction the paragraph swept it to the display end and every Latin tag rendered **`matrix#`** — in
the editor and in the reading view, collapsed and expanded. Measured with Range geometry, the hash
sat at x 918 against the `m` at 873. The chips take `dir="auto"` (never `ltr`: a tag can be Arabic,
and an Arabic tag must keep its hash on the RIGHT), which is what the sidebar's `<bdi>` tag pill
had right all along. Property KEYS and VALUES are isolated for the same reason, each value in its
own `<bdi>` — `aliases: [مقال, Essay]` is a list of runs, not one string, and joined into a single
text node an RTL base reorders the runs around the commas. `check-i18n` reads dictionaries and the
DOM reads correct in source order, so **both are blind to this whole class**: the guard is
`scripts/shoot-rtl.mjs`, which measures rendered glyph x in both surfaces and exits 1.

**The editor's hover previews resolve the pointer through the DOM, never `posAtCoords`.**
`hoverPreview.ts` runs its own rest timer and a `showTooltip` StateField instead of CodeMirror's
`hoverTooltip`, because `hoverTooltip` uses `posAtCoords` — the call `livePreview.ts::posFromEvent`
was written to replace on the click path, since it maps through the vertical line layout and drifts
by whole lines in a note carrying a block widget (frontmatter card, `$$` math, an image). The
drifted position lands on a line with no link and the card silently never opens; measured on the
1,389-note fixture, stock `hoverTooltip` opened 4 of 7 hovered links across the first four notes
with frontmatter, against 7 of 7 now. Guard: `scripts/shoot-hover.mjs`, which hovers EVERY visible
link in several notes WITH frontmatter — a bare note, and a single link, are exactly the cases that
kept passing while the feature was dead.

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

**…which is why the admin's publish state has its own route.** `GET /api/published` →
`{ paths }` is the unfiltered publish set, gated exactly like `/api/attachments` (a 404 for
anyone the publish limit applies to, because a language-hidden published note's path is
precisely what every public surface withholds). It replaces a trick: the client used to learn
which notes were published by fetching `/api/tree` with `credentials: "omit"` — its own session
dropped so the server would answer as if to a stranger. That handed an ADMIN surface the
visitor's `languageHidden()` rule, so a just-published Arabic note on an `en` instance lit its
star optimistically and had it removed again by the next refresh, with no message; and it made
the whole feature conditional on `authProtected && publicReads`, so an open local vault and
every `PUBLIC=false` instance had no publish marks and no published filter at all — while the
publish TOGGLE beside them stayed, still toasting "live for visitors". A session must never
impersonate another session to read its own state: `X-Vellum-Preview` exists so that the one
place which *does* want the visitor's view says so out loud and keeps its cookie.

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
  is a fine specimen; a toast per keystroke is not. It takes `sizeAdjust` too: the dial changes
  what the specimen LOOKS like without changing a single id.
- **`GET /api/font-faces.css?ids=…` is the PICKER's own faces** — one `@font-face` per pickable
  id under a `VellumOpt-…` family (`shared/fonts.ts::optionFamily`, imported by both sides so the
  generated sheet and the element naming it cannot drift). A list of family NAMES set in the
  interface font is a list of trademarks; every option row is drawn in the face it names, and the
  Arabic ones carry an Arabic sample. Regular upright only, no range narrowing (one row must set
  its Latin name and its Arabic sample from one declaration), asked for a GROUP at a time as that
  group first appears — twenty-seven families at once is a megabyte of downloads to draw a menu.
  Admin-eyes-only and forgiving, exactly like the preview sheet. `client/fontFaces.ts` owns the
  `<link>`s and drops them all when the panel unmounts.

**The specimen block leads the Typography tab and is STICKY.** It sat under the four pickers,
where the last picker's popover covered it — a preview a control hides previews nothing, which a
gate has already called. It is now one MIXED line per slot (Latin and Arabic in one run: that
single line IS the feature) rather than two, because a 305px block inside a 609px body cannot
also stay on screen. Rows in that tab carry `scroll-margin-top` for it.

## Uploaded fonts (server/customFonts.ts)

The catalog answers "one of ours"; this answers "the face I licensed", which for a serious Arabic
instance is the only possible answer. Ids are `custom:<file>` (`shared/fonts.ts`), valid in
**every** slot.

- **The format comes from the MAGIC BYTES** — `wOF2` / `wOFF` / `0x00010000` / `true` / `OTTO` —
  never from the extension and never from the multipart content type, both of which are
  caller-controlled text. A PNG renamed `.woff2` is a 400, which matters because the file is about
  to be served back with a font MIME. `ttcf` (a collection) is refused: `@font-face` cannot name
  one face inside one.
- **The header is also read for STRUCTURE** (`hasPlausibleTableDirectory`): a table count in
  1…512 and a table directory that fits inside the file carrying it. Magic bytes say "claims to be
  a font", not "a browser can use this" — a 4.9 MB file of the literal `wOF2` plus 4,900,000 zero
  bytes passed the sniff, was stored, was served with a font MIME and rendered nothing, which the
  operator has no way to diagnose. Anything that survives is still only *probably* a font (the
  browser stays the authority); anything that fails cannot possibly be one, so it is a `400`
  (`font_damaged`) at upload time rather than a mystery afterwards. No decompression happens here.
- **EVERY DECOMPRESSION IS A BOMB UNTIL IT IS BOUNDED.** `brotliDecompressSync` and `inflateSync`
  allocate whatever the stream expands to, synchronously, on the event loop, from uploaded bytes.
  Verified: an 800-byte file claiming one `name` table over a brotli stream of 900 MB of zeroes
  drove RSS from **189 MB to 2.96 GB** and answered `200` — a ~1.9-million-to-one amplification
  the 5 MB body cap does nothing about, and a handful in parallel is an OOM kill on any 1–2 GB
  VPS. The WOFF1 path was the same class (`origLength` is caller-controlled and was never used as
  a bound; a 917 KB `.woff` expanded to 900 MB). Both calls now take `maxOutputLength`, bounded by
  the file's OWN arithmetic first — a WOFF2 stream is exactly the concatenation of its tables, so
  the directory states its length; a WOFF1 entry states its `origLength` — and clamped by a
  32 MB `MAX_DECOMPRESSED_BYTES`. Node throws before the allocation, and both calls already sit
  inside `nameTableBytes()`'s try/catch, so a bomb degrades to the filename-derived family exactly
  as an unreadable font always has. Re-measured after: **RSS +120 KB, 10 ms**, still a 200.
- **The stored NAME is a slug this module builds** (lowercase, `[a-z0-9-]`, collision-suffixed,
  known extension) and every entry point re-checks that shape, so no caller string is ever joined
  into a path, a route param, or the unencoded `url()` in the generated stylesheet. That ASCII
  constraint stays; what changed is the FALLBACK. `slugify` answering the literal `"font"` was
  paid for by exactly the reader this feature exists for: `خط-عربي.otf` kept nothing and became
  `font.otf`, then `font-2.otf`, `font-3.otf`. `storedStem()` asks the font's own family name next,
  so that file is stored `amiri.otf`; `"font"` is the third answer, not the first.
- **Concurrent uploads are SERIALIZED, and the index tmp file is per WRITER.** `writeIndex()` used
  a fixed `index.json.tmp` for every writer, and `saveCustomFont()` did a non-atomic
  read/await/write around it. Verified with four parallel POSTs of four distinct faces all named
  `race.ttf`: three `500`s (`ENOENT: rename index.json.tmp -> index.json`) whose bytes were on
  disk anyway — the admin told the upload failed while the font appeared on refresh — and only
  **two files** left of four, one of them labelled with a different font's family, because
  `access`-then-`write` let several writers pick the same free name. The tmp name now carries
  pid + random, and the whole critical section (pick a free name, write the bytes with `wx`, merge
  the index row) runs behind one promise chain that never rejects. `deleteCustomFont` shares it.
  Re-measured: 4/4 `200`, four files, four correct family names, zero server errors.
- **The two font READ routes `lstat`, not `stat`.** `stat` follows symlinks: a link named
  `symlink.woff2` planted in `VELLUM_DATA/fonts/custom` served `/etc/passwd` to an anonymous
  request, `200`, `Content-Type: font/woff2`, on a route deliberately exempt from the auth guard.
  Nothing in the API can create such a link — names are generated — but both directories are also
  written by hand (the `custom.css` escape hatch is the whole point of one of them), and
  lstat-and-reject costs one letter. `listCustomFonts` and `customFontExists` follow suit, so a
  link is not advertised in a list that the route would 404.
- **`POST /api/fonts/upload` is admin-only**, capped at 5 MB on the wire (`bodyLimit`,
  `shared/limits.ts`) and again on the decoded bytes.
- **The FAMILY name is read from the font's own `name` table** where the file allows it: sfnt
  directly, WOFF1 through its per-table zlib, WOFF2 through one brotli pass over the compressed
  stream (only `glyf`/`loca` are ever transformed, so `name` sits at the sum of the preceding
  stored lengths). Anything unreadable falls back to the filename stem — a picker row saying
  "upload-3" is not a picker row. Failure is never an error: the upload succeeds either way.
- **`/api/fonts/*` is open for READS ONLY.** That prefix is exempt from the auth guard so a
  visitor's browser can fetch the face BYTES (the same reason `custom.css` is open) — once fonts
  could be uploaded and deleted under it, a path-only exemption would have handed an anonymous
  caller `POST /api/fonts/upload` and `DELETE /api/fonts/custom/<file>`. The guard now scopes the
  exemption to GET/HEAD, and `GET /api/fonts/custom` (the inventory, as opposed to the bytes)
  gates itself with `isPublishLimited` like `/api/settings`.
- **Deleting is guarded twice**: a face a slot still names shows which slot instead of a delete
  button, and `DELETE /api/fonts/custom/:file` 409s that case regardless of what the panel
  believes. The confirm dialog is the ordinary `confirmModal`.
- **A custom face gets the unicode-range its ROLE implies.** A catalog family arrives pre-sliced
  by Google with a range per subset; an upload is one file with no range at all, and "no range"
  means "answers for every codepoint" — which would make the two halves of a composite OVERLAP and
  hand the pick to declaration order. So the Arabic slot narrows a custom face to the Arabic
  blocks and a Latin slot standing beside an Arabic face carves those blocks out (the complement
  is computed from the same `ARABIC_BLOCKS` table). The disjointness invariant holds for uploads
  exactly as for the catalog.
- **`settings.fonts.arabicSizeAdjust`** (50–300, or null) overrides the measured `size-adjust` for
  whatever is in the Arabic slot. The catalog's numbers were measured against Lora; an uploaded
  face cannot be, so the operator gets the dial — set by eye against the specimen, which is the
  only way this number is ever really set. It rides in `fontsSignature()`, so a changed dial gives
  the browser a new stylesheet URL like a changed pick does.
- **Slot rules are relaxed for uploads, deliberately.** `slotAllows` knows a catalog face is
  monospace or covers Arabic because we chose it; it knows nothing about a file that arrived this
  morning, and refusing an operator his own naskh face on a guess ("does not cover Arabic") would
  be worse than letting the specimen answer. Existence on disk IS checked, next to the catalog
  download in `PATCH /api/settings`, under the same "the faces are on disk before settings.json
  names them" rule.

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
- **`.trash/` NEVER REACHES THE REMOTE.** The `.gitignore` seed used to write `.trash/` only when
  it created the file, and the append path for an EXISTING `.gitignore` bailed at
  `if (rel === null) return;` — `rel` being the data directory's path inside the vault, which is
  null in the default arrangement (`./data`, next to the app). So on the two commonest real vaults,
  "already a git repository" and "already has a .gitignore", `.trash/` was never ignored and
  `git add -A` committed and pushed it: deleting a 1,214-note folder became permanent history on
  the operator's remote, and the entire justification for the trash model ("recoverable from disk",
  "invisible to tree/indexer/watcher", *local*) quietly stopped holding. The base rules
  (`.trash/`, `.obsidian/workspace*.json`) are now appended unconditionally to an existing file,
  `seedGitignore()` runs on every pass rather than only when VELLUM_DATA is inside the vault, and
  a trash that an older build already committed is un-tracked (`git rm -r --cached
  --ignore-unmatch -- .trash`) before anything is staged — a rule alone changes nothing about what
  git already tracks. The eviction stages a deletion, so the next commit removes the trash from the
  tracked tree; anything an older build already PUSHED stays in the remote's history until the
  operator rewrites it, which is theirs to do and not something a backup tool may do for them.
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
