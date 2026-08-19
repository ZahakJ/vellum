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
- `POST /api/alias` body `{ path, alias }` → `{ ok: true, path, alias }` (admin-only; merges one name into the note's `aliases:`, preserving every other byte — the write behind "keep the old title" after a rename)
- `DELETE /api/note?path=&permanent=<bool>` → `{ ok: true, trashPath?: string }` (default MOVES to `.trash/`; see "Note deletion")
- `DELETE /api/attachment?path=&permanent=<bool>` → `{ ok: true, trashPath?: string }` (non-`.md` only; same two speeds — see "Attachment deletion")
- `GET  /api/delete-preview?path=` → `DeletePreview` (admin-only; what a delete would actually take — see "Delete previews")
- `GET  /api/trash` → `TrashEntry[]` (admin-only; newest first)
- `POST /api/trash/restore` body `{ name }` → `{ ok: true, path, renamed }`
- `DELETE /api/trash?name=` → `{ ok: true }` (erase one entry for good)
- `POST /api/folder` body `{ path }` → `{ ok: true }`
- `POST /api/folder/move` body `{ path, toPath }` → `{ ok: true, notes, rewritten }` (moves the whole subtree and repairs the links it would have broken; see "Moving notes and folders")
- `GET  /api/search?q=` → `SearchHit[]` (max 50, minisearch, prefix+fuzzy)
- `GET  /api/search/matches?path=&q=` → `SearchMatch[]` (max 100) — every line of ONE note the
  query matches, `{ line, text }`: `line` 1-based in the note's FULL source (frontmatter
  included), `text` HTML-escaped with matched terms in literal `<mark>…</mark>`. Substring
  semantics per whitespace-separated term (leading `#` stripped, `expandTagQuery` applied),
  deliberately NOT minisearch: the index answers "which notes" with fuzzy scoring, this route
  answers "where does it SAY that" — so a hit earned by fuzzy spelling, its title or an alias
  may legitimately answer `[]`. Visitor-scoped like `/api/backlinks`: a hidden or missing note
  answers `[]`, never a 404 that confirms the path exists.
- `GET  /api/graph` → `GraphData` (nodes = all md files, edges = resolved wikilinks).
  `?around=<path>` narrows it to that note, its direct wikilink neighbors in either
  direction, and the edges among that set — same shape, a fraction of the bytes, and the
  same visitor filtering (a slice of the already-filtered graph, never of the raw index).
  An unknown or filtered-away centre answers `{nodes:[],edges:[]}`, so "no neighborhood"
  and "not yours to see" are indistinguishable. Both forms are memoized per audience
  (`server/graphCache.ts`); `/api/tree` is memoized the same way (`server/treeCache.ts`).
- `GET  /api/backlinks?path=` → `Backlink[]`
- `GET  /api/tags` → `TagCount[]` (from `#tag` inline + frontmatter `tags:`)
- `GET  /api/aliases` → `AliasesResponse` (`{ alias, path, title }[]`, sorted by alias) — the name table the client cannot derive, since a tree carries filenames and an alias is frontmatter. Visitor-scoped exactly as resolution is.
- `GET  /api/events` → SSE stream of `VaultEvent` (chokidar watcher; debounced 100ms; events named `message`, JSON data)
- `POST /api/upload` (admin) multipart `file` + optional `dir` → `UploadResult` — see "Attachments"
- `GET  /api/impact?path=&kind=` (admin) → `DeleteImpact` — what a delete would really take
- `DELETE /api/attachment?path=&permanent=` (admin) → `{ trashPath? }`

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

**Every response below `/api` is `Vary: Cookie, X-Vellum-Preview, X-Vellum-Lang` and, unless the route said
otherwise, `Cache-Control: private, no-store`** (one middleware in `api.ts`, above the auth routes
so `/api/me` is covered). Every one of these bodies differs by session cookie AND by the preview
header, and none of them said so; the README recommends nginx in front, where a shared cache may
hand an admin's whole vault tree to the next anonymous visitor. Routes that set their own
`Cache-Control` keep it, and anything marked `immutable` (the content-addressed font routes, which
hold no session-varying byte) is skipped entirely so a CDN can still cache it. The SPA shell,
`/feed.xml`, `/sitemap.xml`, `/robots.txt` and the static assets get the same treatment in
`index.ts`, plus the origin's security
headers: `Content-Security-Policy` (`script-src 'self'`, `frame-ancestors 'none'`, `object-src
'none'`, `base-uri 'none'`; `style-src` keeps `'unsafe-inline'` because React style props, KaTeX and
the generated banner gradients are inline by design; `img-src`/`media-src` allow remote https/http
because `banner:` URLs and raw `<img>` in notes are documented features), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`. Without those the admin UI —
permanent delete, publish, settings PATCH, sync — was framable and clickjackable, and the
hand-rolled HTML sanitizer in `client/reading/rawHtml.ts` had no backstop behind it. Wikilink resolution: `[[Name]]`
matches file basename (no `.md`, case-insensitive), then frontmatter `aliases:` — never the
other way round; shortest-path winner on duplicates in either table; `[[Name|alias]]` and
`[[Name#heading]]` variants parse (link target is `Name`). See "Aliases — a note answers to
more than one name".

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
- **`/api/me` carries `comments: true` when marginalia are live** (`COMMENTS=on` or
  `settings.commentsEnabled`), alongside `languageToggle` and for the same reason: it describes
  the public shell, so every session gets it. The client gates `Marginalia` on it and only then
  asks `GET /api/comments?path=…`. Before, the reading view learned the answer by ASKING per note
  and reading the 404 — one bad response, and one red console line, on every note open of every
  instance with the feature off (`404 …/api/comments?path=Zombies%2FCache%20Locality.md`), which
  was the only non-2xx in an otherwise clean network sweep. One instance-wide fact belongs with
  the instance-wide facts.
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

## Several windows, one vault (client/windows/)

**Two windows on one vault is the two-writer case**, and until this round `PUT /api/note` was
unconditional last-write-wins — so the honest description of "open it in another window" was "lose a
paragraph and be told nothing". The write precondition is the net; the LEASE is what stops anyone
landing in it every few minutes.

**Two channels, one division, and it is the reason there is not a second coherence implementation.**
SSE carries FACTS ABOUT THE VAULT — a file changed, a note was deleted — from the one process that
knows. The bus carries INTENT between windows: which window is typing, that a preference changed,
that a window is closing. None of that ever touches the disk, so a server round trip is the wrong
shape and the watcher would never see it. Anything derivable from a file belongs to SSE, and nothing
on the bus is allowed to become a second way of learning it.

**The lease has no coordinator and writes nothing to disk.** Every window announces when it opened
and which notes it holds; both sides then compute the same answer from the same rule — `winsAgainst`:
the OLDEST window wins, and a same-millisecond tie (which a scripted pop-out produces every time)
goes to the smaller id, arbitrarily and, crucially, *agreed*. There is no server to ask, no lock file
to strand, and a window that is killed simply stops answering. `tests/windows.test.ts` proves the two
properties the design rests on: the relation is ANTISYMMETRIC, so two windows can never both believe
they hold the pen and manufacture the conflict the precondition exists to catch; and TRANSITIVE, so
three windows cannot form a cycle in which the note never settles.

- **`windowBornAt` and `windowId` live in `sessionStorage`**, which is per-TAB and survives a reload.
  `localStorage` would give every window the same id (it is per origin) and a module constant would
  mint a new one on every refresh — so a reloaded window would look like a stranger to its peers, and
  its lease would be held by a ghost until the heartbeat aged out. Persisting the birth time also
  means a refreshed window cannot look *older* than it is and take a note back from whoever
  legitimately holds it.
- **The loser is not locked out.** It keeps the note, keeps its text, and stops autosaving — the
  buffer's `writable` flag, which discards nothing. The pane says so and offers **Edit here**, one
  button, which takes the lease back and immediately saves whatever was typed meanwhile. Obsidian's
  answer to the same situation is `note (conflicted copy).md` and silence.
- **A takeover moves our own clock rather than adding a `force` flag.** The rule stays "oldest wins",
  one comparison, computed identically on both sides — a flag would have needed its own tie-break the
  first time two readers pressed the button at once.
- **Saving announces the new mtime** so a peer holding the same note re-bases its precondition without
  a round trip. That keeps a 409 meaning "somebody we have NOT heard from" — Obsidian, a `git pull` —
  which is the only kind worth interrupting a writer for.
- **The strip reserves its height.** It can arrive while the reader is mid-sentence, and prose that
  reflows under a live caret is how someone loses their place. It is also not painted in `--danger`:
  nothing is wrong and nothing is at risk.

**The envelope is versioned, and a mismatch is DROPPED.** Two windows can be running different builds
— one tab open since this morning, one opened after a deploy — and a message shape that changed
underneath them would otherwise be parsed as something it is not. A window that cannot understand the
room degrades to "there are other windows and I cannot talk to them", which is a state it already has
to handle: `BroadcastChannel` is absent in some browsers, and there the app behaves exactly as it did
before any of this existed.

**Preferences follow the reader, not the window.** Theme and language are DEVICE preferences and a
device with two windows open is still one device; a reader who switches to parchment in one window and
finds iron-gall in the other has two apps rather than one. Broadcast from a store SUBSCRIPTION rather
than from each setter, so a change made from the palette, the settings panel or the theme picker
travels without any of them knowing other windows exist — and guarded against the echo, or two windows
ping-pong one preference forever.

**Signing out is a barrier, not an event.** A window that kept its admin shell after another signed
out would hold a tree it may no longer read and offer writes the server will refuse.

**What is deliberately NOT mirrored is the document as it is typed.** A full-text broadcast on every
keystroke is a real cost with no bound. Inside one window a second pane reads the same buffer and is
character-live for free; across windows the peer updates when the writer SAVES — one autosave behind,
which is exactly the quality of Obsidian's own linked preview at none of the cost.

## The open document (client/editor/buffers.ts)

**A note's document lives in a refcounted registry keyed by path, not in the component that draws
it.** `Editor.tsx` owns a VIEW — the DOM, the scroll position, the vim toggle. The BUFFER owns the
`EditorState`: the text, the undo history, the selection, the folds, the dirty flag, the autosave
timer, and the `baseMtimeMs` its next write is checked against.

**The bug this fixes was in plain sight.** `App.tsx` remounts the editor on every `openPath` change,
and the editor fetched on mount and destroyed on unmount — so switching tabs threw the document away
and everything CodeMirror keeps beside it. The visible casualty was undo: leave a note, come back,
and `Ctrl+Z` had nothing to undo, in a product whose autosave writes to disk every 600ms and whose
`.trash/` catches deletes and not overwrites. The structural casualty was larger and had not happened
yet: two panes on one note would have been two documents typed into independently, and whichever
unmounted last would have won.

Four things fall out of the one change: undo survives a tab switch, two panes are one document typed
into twice, the save path finally has somewhere to keep the mtime a precondition needs, and a
document can outlive the pane that showed it.

- **Views are mirrored by CHANGES, never by selection.** `dispatchFrom()` applies a transaction to
  the originating view, stores the result as canonical, and forwards only `tr.changes` to the other
  views of that buffer, annotated so the echo is not forwarded back. Copying the selection across
  would drag the reader's caret in the pane they are *not* typing in — two panes on one note are one
  document with two carets, which is the entire point of having two.
- **An unmount does not flush, and that is the change.** Releasing a reference saves only when
  nothing holds the note any more, and keeps the buffer until that write lands: an unsaved document
  is not a cache entry. Flushing on unmount as well would race the registry's own timer and send the
  same text twice.
- **The caret is placed once per NOTE, not once per mount.** A buffer restored from the registry
  brings its own selection back, so re-running the frontmatter jump would drag the caret out of the
  reader's sentence and into the properties card every time they switched tabs and came back.
- **A rename carries the buffer** (`remapBuffer`), or the undo history of the note being renamed is
  dropped at the one moment a reader is most likely to want it back.
- **An external change is ADOPTED, not remounted.** The shell used to answer the watcher's "changed"
  event with `bumpReload()`, and with the registry in place that became the wrong mechanism: an
  unmount releases the buffer and the remount re-fetches it, so the note would come back correct and
  the reader's undo history would be gone — on an event they did not cause. `adoptExternal()` writes
  the new text through the document as an ordinary transaction, so the external change is itself
  undoable. A DIRTY buffer is never adopted: that is a real conflict and belongs to the precondition
  below. The remount survives as the fallback for the surface that has no buffer — the reading view.

### The write precondition (server/vault.ts, `PUT /api/note`, `POST /api/note/flush`)

`writeNote(rel, content, baseMtimeMs?)` refuses with **409 `code: "stale"`** when the file's current
mtime is not the one the caller was last handed. Enforced in `writeNote` rather than in the route, so
the gap between reading the mtime and replacing the file is as small as this process can make it —
and so it is testable without standing a server up (`tests/durability.test.ts`).

- **Strict equality.** The value compared against is one this server produced from its own `stat`, so
  a tolerance would only ever serve to accept a genuine conflict on a coarse-mtime filesystem, which
  is the wrong direction to fail. It stays a net rather than a lock: two writes inside one tick of a
  coarse clock are genuinely indistinguishable, and this sentence is the contract admitting it.
- **A refusal is TOTAL.** Nothing is written. A precondition that half-writes is worse than none,
  because the file it leaves is neither version.
- **A file that is GONE is written, not refused.** Recreating is kinder than refusing to save work
  into a note somebody else deleted, and the caller learns of the deletion from the watcher anyway.
- **Opt-in, deliberately.** Only the buffer registry sends `baseMtimeMs`. The publish toggle, the
  banner setter, the section writer and the rename link-rewrite each derive a whole file from the one
  they are about to replace, and keep last-write-wins.
- **A refused save loses nothing.** The buffer keeps the reader's text, stops autosaving so the next
  keystroke's timer cannot clobber the newer version, holds the disk version in `diverged`, and says
  so. `keepMine()` re-bases onto the disk version and saves; `takeDisk()` replaces the document
  through the history, so the resolution is itself undoable. The side-by-side comparison arrives with
  the pane work, which is where there is room to show both.
- **A failed save that is NOT a conflict is still said out loud.** The buffer stays dirty on purpose:
  the text is here, the tab still shows its dot, and the next edit reschedules the write.

### `POST /api/note/flush`, and closing a tab

There was no `beforeunload` anywhere in the client and `putNote` is a plain fetch, so closing a tab
mid-sentence warned about nothing and saved nothing. The loss is one sentence at a time, which is
exactly why it erodes trust rather than getting reported.

`/api/note/flush` is `PUT /api/note` reachable by `navigator.sendBeacon` — POST-only because that is
what the API requires, and it exists because a `fetch` started in `beforeunload` is cancelled with
the document while `sendBeacon` is the one transport the platform promises to deliver afterwards. It
carries the same precondition: a last-gasp save that clobbers a newer version is still a clobber, and
the reader who caused it is by definition not there to be asked.

The handler **beacons first and prompts second**, and only prompts when something was still unsaved
after the attempt. A confirmation dialog in front of a reader whose work is already on its way is a
dialog that teaches them to click through dialogs.

### `client/editor/bufferBridge.ts` — and why it exists

`buffers.ts` imports CodeMirror. `App.tsx` and `state.ts` need four things from it (flush on close,
ask what is unsaved, adopt an external change, follow a rename) and both are in the FIRST-PAINT
closure. A direct import would pull CodeMirror into the entry chunk and `npm run check-bundle` would
fail with a message about CodeMirror in first paint — a message whose stated cause has nothing to do
with the line that caused it, in a file nobody would think to open. So the registry registers itself
with a CM-free bridge and the shell calls through that. Written before the registry, on purpose: the
failure it prevents is one that misreports itself.

## The workspace (client/workspace.ts, client/state.ts)

**`state.workspace` is the truth about what is open; `openPath` and `openTabs` are a DERIVED
MIRROR of it, written by `commitWorkspace()` and by nothing else.**

That direction is what makes panes affordable. Roughly forty places in the client read `openPath` or
`openTabs` — the status bar, the router, the palette, the outline, the backlinks panel, every
publish and banner action — and not one of them has to learn what a pane is: they keep reading a
path and a list of paths and go on being right, because the mirror answers for the FOCUSED pane.
Only the dozen places that WRITE the open set changed, and they now say what they mean
(`closeOthersIn`, `pruneWorkspace`, `remapWorkspace`) instead of each filtering an array its own way.

`client/workspace.ts` is **pure** — no DOM, no store, no fetch, and no import of `state.ts`. Every
function takes a `Workspace` and returns a new one. That is not tidiness: it is what lets
`tests/workspace.test.ts` push tens of thousands of random edit sequences through the model and
assert every invariant after every step, the same shape `check-sections.mjs` uses on the section
model, before any of it is wired to a component. The property test earned itself on its first run —
at seed 0 it found that `settle()` repaired columns, weights and focus but never `active`, so a
rename that collapses two tabs onto one path left a pane pointing past the end of its own tab list.

**Two levels, never a tree.** Columns along the inline axis, at most two panes stacked in each
(`MAX_COLUMNS` 3, `MAX_ROWS` 2, `MAX_PANES` 6). A recursive split tree buys infinite layouts and no
way back to one: its drop targets cannot be enumerated by a gate, its serialization needs a version
and a migration table the first time the shape moves, and a layout space too large to name kills
presets — which are the reason to have splits at all.

**`columns[0]` is the inline-START column** — the left in English, the right in Arabic — because the
shell grid already follows the direction that way (`"sidebar main panel"` and its `--flip`
counterpart). A layout serialized on an English instance therefore opens correctly mirrored on an
Arabic one with nothing about sides stored. The single deliberate exception is `paneInDirection()`,
which resolves pane focus GEOMETRICALLY from live rects, so `←` moves to the reader's left in both
languages: a tab bar is a one-dimensional list where "next" is a fact about reading order, and a
pane grid is two-dimensional where "left" is a fact about the screen.

**`noteFocus` is not `focus`, and the difference is load-bearing.** `focus` is where the keyboard is;
`noteFocus` is the last focused pane whose active tab is a NOTE, and `openPath` derives from it. That
is what will let a book pane hold the keyboard without `StatusBar` firing `getNote()` at a `.pdf`
(which 400s on every open) and without `router.ts` pushing a PDF into the address bar as a permalink.

**`settle()` owns every invariant, and every reducer ends there.** Columns emptied by a close are
dropped, weights renormalized, `active` clamped, and `focus`/`noteFocus` re-pointed at panes that
still exist and are allowed to hold them. The bugs in a layout model are almost never in the edit —
they are in the fifth thing the edit invalidated, and one function that fixes all five is the only
version of this that stays correct.

**`parseWorkspace()` is TOTAL, and a damaged layout must never cost the reader their open notes.**
It reads rather than validates: it takes what it understands and discards the rest. A pane the
layout forgot to place has its tabs adopted by the first pane instead of vanishing with it; a
structurally broken layout collapses to a solo workspace holding every path that was still readable.
Storage is `vellum.workspace`, and **`vellum.tabs` is still written beside it** — a few bytes that
buy a downgrade nobody loses a session to, since a build without panes still finds a shape it
understands. On the way up, an instance with no workspace key has its `vellum.tabs` migrated by
`fromStoredTabs()`, so the upgrade is invisible.

### Panes (client/components/Workspace.tsx, Pane.tsx)

`Ctrl/Cmd+\` splits, `+Shift` stacks instead of sitting beside, `+Alt` closes, and
`Ctrl/Cmd+Alt+Shift+←→↑↓` moves between them. **The new pane opens on the SAME note**, because that
is what a split is for — a second view of the thing you are already reading. An empty pane beside a
note is a pane the reader then has to fill.

**A SOLO WORKSPACE RENDERS NONE OF THE GRID.** `Workspace.tsx` returns the bare `.s-view` the shell
has always returned, with no wrapper, no `data-pane` and no `.s-panes` around it. That is not an
optimization, it is what keeps the stylesheet true: every `:has()` rule, every zen selector and every
`.s-view > .s-editor` in `app.css` goes on matching exactly as it did, and a reader who never splits
pays nothing for the feature — in bytes or in behaviour. The grid appears only once there is
something to arrange.

**Each pane carries its own tab bar; the shell's bar belongs to the shell only while there is one
pane.** A tab bar names what is open HERE, and one strip above two panes cannot say which.

**Every tab action focuses its pane first.** The store's tab actions act on the FOCUSED pane, so
acting on a particular one means focusing it — which is what a click on it already means. Without
that rule a second pane's ✕ closes a tab in the first, which is the kind of bug that reads as
possession by a ghost.

**Focus is GEOMETRIC and the arrows are physical, in both languages.** `paneInDirection()` resolves
from live rects read at the moment the key is pressed — a resize, a fold and a split all move them,
so a cache would answer for a layout that is no longer on screen. This is a deliberate exception to
the logical arrow swap in `Tabs.tsx`, and the two do not conflict: a tab bar is a one-dimensional
list where "next" is a fact about reading order, and a pane grid is two-dimensional where "left" is
a fact about the screen. A reader pressing ← at a grid is pointing, not reading.

**Column order is reading order and nothing in the CSS says "left".** `columns[0]` is the
inline-START column, laid out by the grid in source order, so a layout saved on an English instance
opens correctly mirrored on an Arabic one with nothing about sides stored — the same way the shell's
own `"sidebar main panel"` areas already work. The focus mark is an accent rule on the pane's
**leading** edge (`inset-inline-start`), the same vocabulary reading mode already uses to say "this
column is in a mode", rather than a ring drawn around the whole pane, which would be on screen at
all times.

**The gap IS the divider** — one hairline of `--border` showing through `gap: 1px` on a grid whose
background is the border colour — rather than a border on each pane, which would double between two.

**Below the drawer breakpoint the INLINE axis folds and the layout is not rewritten.** There is no
room for two measures side by side; the reading column's whole argument is its width. So every column
but the focused one is `display: none` while the layout stays exactly as the reader arranged it, and
comes back on a wider viewport. A resize must never rewrite what somebody chose.

**A split that would breach the cap says so by name.** `splitPane` returns null and the shell toasts
`paneCapReached`; a keystroke that silently does nothing is indistinguishable from a broken key, and
this cap has a real reason behind it (three columns of two is the largest layout that still has a
name — see the model above).

**The graph is about the WINDOW, not about a pane.** It replaces the whole working area exactly as it
did before panes existed. The empty states are the same: a locked vault and an empty one are facts
about the session, and a pane with no tab hands them straight through rather than drawing its own.

### Tabs: two opposite promises

**A PINNED tab is a promise that nothing will take it.** A link click will not replace it, and **no
bulk close takes one** — that is the same promise in "close others", "close tabs after this one" and
"close every note in this window", so a reader never has to remember which rows respect a pin. The
one closer that ignores pins is the internal `dropTabsUnconditional`, used when the file is *gone* or
is no longer this session's to see (a delete, a sign-out, a language filter): a pin is a promise
about the reader's intent, not about the vault's contents.

**An EPHEMERAL tab is the opposite promise.** It is a preview — opened by a single click from search,
the palette or a wikilink — and the next ephemeral open in that pane REPLACES it. There is one
preview slot per pane, so forty tabs never accumulate in the first place; that is prevention, where
"close all tabs" is the cure. It commits — becomes ordinary — when the reader types in it, opens it
a second time (a revisit is intent), pins it, or opens it explicitly in a new tab. Pinned and
ephemeral are mutually exclusive by construction, and both are visible in the row rather than only
in the menu that set them: an italic title for a preview, a gold ◆ for a pin, each with real
screen-reader text beside it, because a promise the reader cannot see is one they will not rely on.

### Drag a tab: reorder, move, or SPLIT (Tabs.tsx, PaneDropZones.tsx, dragTab.ts)

Lift a tab and every pane raises five drop targets: a centre that means "join
this pane's strip", and four edges that mean "split this pane and land me on
THAT side" (the owner: "should be able to just drag and drop one of the
windows to the right or lift to trigger a split"). The solo pane raises them
too — dragging one of two tabs to an edge is exactly how the FIRST split is
made. Within a strip, hovering a tab shows an insertion caret and dropping
reorders; the caret's before/after half is resolved logically, so the leading
half of a tab is the RIGHT half in an Arabic bar — the same physical→logical
swap the tab arrow keys already make.

**The gesture is ONE reducer** (`dropTabSplit` in client/workspace.ts): take
the tab out of its pane, split the target on that edge, land the tab in the
new pane — and at a cap (MAX_COLUMNS/ROWS/PANES) it refuses WHOLE. The halves
are not independently meaningful: a close whose split then fails would eat the
tab. Living in the model puts the gesture under the same property fuzz as
every other reducer. A pane the drag emptied closes behind it — its one job
left with the tab — and `splitPane` grew `before` for the leading edges,
because an insert that only knew "after" would answer both edges with the
same geometry and one of them would feel mirrored. Edges the model would
refuse are NOT rendered: a zone that lights up and then does nothing on drop
is a broken promise, and the caps are knowable right where the zones are
drawn.

The drag itself is module state (client/dragTab.ts), not store state: it
exists between dragstart and dragend, must never persist or mirror to other
windows, and `dataTransfer.getData()` is empty during dragover by spec — so
the zones could not know what hovers them from the event alone. The payload
still rides the DataTransfer under `application/x-vellum-tab`; a drag arriving
from ANOTHER window has the MIME and no module state, and the zones simply do
not raise — the honest no-op until cross-window adoption exists. The zones'
chunk loads at the first LIFT (`React.lazy` in Pane.tsx): code that exists
only during a gesture has no business in first paint, and a drag is hundreds
of milliseconds long where the fetch is a handful. `:hover` is suppressed
during native drags, so the lit zone is a class driven by dragenter/dragleave.

### The tab context menu (client/components/ContextMenu.tsx, Tabs.tsx)

Right-click a tab, or press Shift+F10 / the Menu key on the focused one — the keyboard's right-click,
the same door the tree already has, anchored to the tab rather than to a pointer that is not
involved.

**Every row that closes more than one tab NAMES what it is about to take** — "Close others
(2 unsaved)" — in the instance's own numerals and Arabic's own plural forms, through a `countPhrase`
unit written for it. This is the honesty `GET /api/delete-preview` already brings to a delete,
applied to the one other place in the product where a single click can discard unsaved work. **The
count is computed by RUNNING the reducer and diffing `allPaths`**, never by re-deriving which tabs a
pin protects: a number that came from a second reading of the rule would eventually promise something
the reducer does not do, and the entire reason the rows carry a number is that the number is true. A
row that would take nothing is DISABLED rather than absent — a menu whose rows move between openings
is a menu you cannot aim at.

**Rows say "Close tabs after this one", never "Close to the right."** Physical right names a
different set of tabs in Arabic, exactly as "the left bar" named a different pane before the panes
were given names.

`ContextMenu.tsx` is the implementation the tree's menu and the outline's should both end up on. The
two that exist already disagree — only one restores focus, only one dismisses on a `contextmenu`
elsewhere — and two menus that look alike and behave differently in one app is a bug rather than a
duplication, because the reader learns one and is then wrong about the other. It owns the placement
argued out in `Sidebar.tsx` (open toward the reading direction, fold back, fold back again if the
fold overflows, clamp both axes, measure after mount because a menu's size is its content's), focus
restoration on **every** close path including activating a row, and dismissal on Escape (capture, and
stopped, so a menu over a dialog does not close the dialog underneath it), an outside mousedown, a
`contextmenu` elsewhere, and a resize that invalidates the geometry it just measured.

## Component contracts

- Shell agent owns `client/index.html` (already written), `client/main.tsx`, `client/App.tsx`,
  `client/state.ts`, `client/api.ts`, `client/components/Sidebar.tsx`, `Tabs.tsx`, `StatusBar.tsx`,
  `BacklinksPanel.tsx`. Layout: left sidebar (tree + search box + tags), center column (Tabs on top,
  then Editor or GraphView per `view`), right collapsible backlinks panel, bottom StatusBar
  (word count of open note, vim toggle, theme toggle). App wires keyboard: `Ctrl/Cmd+P` palette,
  `Ctrl/Cmd+G` graph toggle, `Ctrl/Cmd+N` new note. App subscribes to SSE → `loadTree()` +
  refresh open note if changed externally.

**EVERY WRITER CLAIMS ITS OWN WRITE BEFORE SENDING IT** (`state.ts::markSelfWrite` /
`recentSelfWrite`, read by App's SSE handler). The server writes the file and notifies its
subscribers while it is still handling the PUT, so the echo of a save OVERTAKES the response —
measured on the 1,388-note fixture, the SSE frame landed at t=4237ms and the PUT resolved at
t=4239ms. In those two milliseconds `dirty` is still true and no save has yet "finished", which is
exactly the state the handler reads as somebody else's edit: every autosave, on every note, raised
"changed on disk — your unsaved edits were kept" about the reader's own typing. The claim is made
BEFORE the request by the code that sends it (the editor's autosave and its unmount flush, the
outline's section write, the publish toggle, the banner setter) and it is PER PATH, so a save to
one note cannot swallow a genuine external change to another. The old dirty→clean stamp survives
as a second belt, for a writer some future path forgets to claim. The alarm itself is unchanged:
an external write to a DIRTY note still toasts, and to a clean one still reloads silently.

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
  edge" and is re-evaluated on **every** language change — `loadMe()`, `setVisitorLang()` and
  `setEditorLang()` all end with `set({ sidebarSide: effectiveSide(pref, language) })`. A pin names a screen edge in
  both languages and outranks the direction forever.
  Two-state was a trap: the side followed the language only while NOTHING was stored, so the
  first use of the palette command pinned it for good, a later switch to Arabic no longer moved
  it, and there was no way back short of clearing localStorage. A value written by an older
  build is a bare `"left"`/`"right"` — it was an explicit act then and it stays an explicit pin
  now, which is the whole migration: nothing is rewritten.
  The store action is `setSidebarSidePref(pref)` — one action for the palette's three commands
  and for a Settings → Appearance segmented control. **The three commands were audited against
  the theme family and KEPT.** The fifteen `Theme: <id>` rows went because a theme is a ROOM —
  it has to be looked at, the picker previews it live against the real app, and one row per
  value was 37% of the command list. These three are the complete enumeration of a THREE-STATE
  preference: each row is a finished end state that runs in one keystroke, and the hint marks
  the one in force, which is the same shape as publish/unpublish (two rows for two genuine
  states). Collapsing them would trade three direct actions for a modal, a tab and a scroll, the
  opposite of what the theme change bought — and it would put "follow the language" back out of
  reach, which is the bug the third row exists to fix. **The three `editor-lang-*` commands are
  the same shape and are there for a sharper reason**: they are the affordance you need exactly
  when you cannot read the interface, so they must not live only behind four words of Settings
  chrome in a script you are locked out of. Each names its language in that language's OWN
  script, which is what makes them findable from either side; they are admin-only, because a
  visitor's language belongs to the public EN/ع switch and nowhere else. The site's own language
  stays a Settings row: it is an editorial decision with an env var behind it, not a
  one-keystroke toggle. The grid areas (`"sidebar main panel"`)
  already follow the inline direction, so the stylesheet only needs the *disagreement*:
  `flipped = (lang === "ar") === (side === "left")` — an XOR — swaps the two grid areas and hands
  each pane the other's separator.
- **Panes are named by WHAT THEY ARE, never by the edge they are on.** "Notes sidebar"
  (`paneNotes`) and "Outline & backlinks" (`paneOutline`), in the status-bar toggles, the palette
  commands, the shortcut sheet, both reopen handles and each pane's own `aria-label` — with the
  keystroke in the tooltip. In Arabic the notes sidebar sits right and the outline panel left, so
  "the left bar" names a different pane in each language, and `Ctrl/Cmd Alt B` looked like it folded
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
  and the ≤700px phone breakpoint zero `--fold-gutter` (no panes in the grid, no handles), and
  `.s-main:has(.s-graph)` drops the padding outright — the graph is a canvas that wants every
  pixel, not a column. Measured at 1440, all 16 combinations of side × sidebar × panel × dir:
  the two gaps agree to **1px** (that 1px being the collapsed pane's own border), against a worst
  skew of **287px** before.
- **A collapsed pane leaves a door.** `.s-reopen--sidebar` / `.s-reopen--panel` are 14px
  full-height strips on the respective edges — always visible while collapsed (not hover-
  revealed), hidden in zen, and hidden wherever that pane is not a grid pane at all: the sidebar
  door goes at ≤999 (the drawer's ☰ button is the door there — two ways back into one pane, one
  of them 14px wide, is one too many), the outline door at ≤700 with the pane itself.
- **THE READING COLUMN IS MONOTONE IN VIEWPORT WIDTH, AND THE CHROME IS WHAT PAYS FOR IT.**
  Measured before this rule, `.cm-line` with a note open: 1440=648, **1024=319**, 900=480,
  768=348, 640=604, 480=444, 390=354 — the prose was a 45-character ribbon at iPad-landscape
  width, and the reader got MORE measure at 900, at 640 and even on a 390px phone than at 1024.
  That is the same non-monotonicity the status-bar ladder above spends four paragraphs
  eliminating, left in place for the thing the product is actually for. Two thresholds caused
  it, and both had been placed where the chrome wanted them rather than where the column could
  afford them: the sidebar held 292px down to 700, and the outline pane held 300px down to 1000.
  The rule is now arithmetic. **A pane may occupy the grid only at widths where the prose has
  already reached its 760px cap**, so the pane's arrival costs the reader nothing and there is no
  step to be on the wrong side of:
    - outline pane: 292 + 1 + 301 + 760 = 1354, so `BacklinksPanel`'s `NARROW_QUERY` is
      `(max-width: 1360px)` — it auto-collapses to its 14px door below that (as a viewport fact,
      never a stored preference; a deliberate open still wins and still persists);
    - sidebar: `--sidebar-w: clamp(224px, calc(100vw - 776px), 292px)` — 776 = the 760px box +
      that door + both panes' 1px separators — so between 1000 and 1068 the pane takes exactly
      the surplus and the column sits at its cap; and at ≤999 the sidebar leaves the grid
      entirely and becomes the overlay drawer the phone already used, so opening it costs the
      column nothing at all;
    - gutters: `--prose-gutter: min(56px, 7.37%)` (7.368% × 760 = 56) on the editor, the reading
      view and the visitor column, `min(64px, 8%)` on zen's 800px box. Exactly the shipped 56px
      wherever the measure is full, proportional below it, and CONTINUOUS — a stepped gutter
      re-introduces the non-monotonicity at its own breakpoints, which is what the old flat 56px
      (unchanged from 1440 all the way down to 768, where it was 24% of the pane) did.
  Measured after, `.cm-line` at 1600/1440/1366/1360/1359/1280/1200/1100/1024/1000/999/900/820/768/700/699/640/480/390,
  en and ar, defaults only: 648 at every width from 768 up, then 597/546/409/333 — **monotone
  non-decreasing in both languages**, document horizontal overflow 0 at every one.
- **One gesture per pane, whichever shell is on screen.** `toggleSidebar()` (state.ts) routes to
  `setSidebarOpen` below `DRAWER_QUERY` (`max-width: 999px`, the single copy of that number in
  the client) and to `setSidebarCollapsed` above it; `Ctrl/Cmd+Alt+B`, the palette row and the
  status-bar switch all go through it, and the switch reports `sidebarOpen` in drawer mode
  (tracked with a live `matchMedia` listener, because a resize crosses the breakpoint without
  touching the store). Without this the sidebar switch was a control that did nothing at 900px.
  Same reason `.s-statusbar__pane-outline` is hidden at ≤700: the pane it toggles is
  `display: none` there, while the pane cluster itself only leaves at 640.
- **A CLOSED DRAWER IS OUT OF THE TAB ORDER, NOT MERELY OFF-SCREEN.** The drawer rule carries
  `visibility: hidden` with `transition: … visibility 0s linear 0.2s` (visible, undelayed, while
  open) — the same delayed-visibility pattern the desktop collapse and the outline pane already
  use. Measured before: at 390 the closed drawer was `matrix(1,0,0,1,-329.6,0)` with
  `visibility: visible`, no `inert`, no `aria-hidden`; the FIRST Tab landed on the wordmark at
  x=-314 and 119 of 137 focusables sat outside the viewport, so a screen-reader user swiped all
  1,388 tree rows and 113 tag pills before reaching the page. After: `visibility: hidden`, and
  the first Tab lands on the ☰ button (x=4 in English, x=342 in Arabic).
- **THE TOUCH SHELL IS 44px EVERYWHERE, NOT ONLY IN THE EMPTY STATE.** `@media (max-width: 700px),
  (pointer: coarse)` — the same trigger as the empty state's keymap swap, because a tablet is
  1024px wide and still has no mouse — gives `.s-tree__item`, `.s-tag`, `.s-iconbtn`, the
  status-bar buttons and the mode pills a 44px minimum, and the bar itself `min-height: 44px`;
  the phone/touch drawer button and the tab bar it sits in are 44px too. Measured at 390 and at
  1024 with a coarse pointer, en and ar: tree rows 44, tag pills 44, sidebar icon buttons 44,
  status-bar buttons 44 (bar 45), document overflow 0. Before: 28 / 26 / 24 / 17–24 — the round
  that gave the empty state its tap targets had fixed the pane it named and not the surface that
  pane points at.
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
- **Keyboard.** The pane toggles are **`Ctrl/Cmd+Alt+B`** (sidebar) and **`Ctrl/Cmd+Alt+Shift+B`**
  (panel); they moved one modifier out when `Ctrl/Cmd+B` became bold inside the editor — see
  "Text formatting" for why formatting won it, and note that the pair KEPT ITS SHAPE (one key,
  Shift picks the second pane), so the only thing to re-learn is "add Alt". They resolve through
  `shortcutKey(e)` like every other binding — which covers both Alt rewriting `key` on macOS
  (Option+B is "∫") and the LAYOUT rewriting it (Arabic's B key types the ligature "لا") — and are
  refused while `AltGraph` is down (Right-Alt reports ctrl+alt on European layouts), a refusal the
  resolver now applies to everything rather than to these two. See "A shortcut is resolved by the
  layout first and by the physical key second".
  PLAIN `Ctrl/Cmd+B` and `Ctrl/Cmd+Shift+B` are still `preventDefault`-ed in the capture-phase
  handler next to `Ctrl+P`/`Ctrl+K` — Chrome's bookmark bar (`Ctrl+Shift+B`) and Firefox's
  bookmarks sidebar (`Ctrl+B`) must never fire — but **only OUTSIDE the editor**: CodeMirror's
  keydown pipeline opens with `if (event.defaultPrevented) break`, so swallowing them there stops
  the EDITOR as well as the browser, and the formatting binding was silently dead while that line
  stood. Inside the editor the formatting keymap's own `preventDefault: true` does the same job one
  layer down, where it can also let vim's Ctrl+B through as page-up.
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
  status-bar ☾/☀ button, the palette's *Themes* command and Settings → Appearance's
  *Themes* button all call `openThemePicker()`. **There is exactly ONE theme row in the
  palette.** It used to carry sixteen: that row plus a `Theme: <id>` command per theme, 15 of
  the table's 41 entries spent on one preference and every one of them a blind jump into a room
  the reader had not seen — the same objection that took `nextTheme()` off the status-bar
  button, printed fifteen times. The row keeps the swatch (`.s-palette-dot`, `themeDot` is a
  THUNK so it previews the theme in force rather than a value frozen at import), and the picker
  behind it is the surface that shows the values. A parameter with N values belongs behind the
  surface that shows the values; `THEMES` is no longer imported by the palette at all. The status-bar button is the one that
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
  `title`. `nextTheme()` is GONE from `state.ts`: it was blessed here as a keyboard-only
  "next look" helper, but no keybinding called it either — `grep -rn nextTheme client/` found the
  definition and nothing else, so it was unreachable code wearing an affordance's name. Cycling
  fifteen rooms blind is the gesture this section removed; there is no version of it to keep
  warm. The glyph reads `themeGroup(theme)`, not
  `theme === "parchment"` — there are four light themes and the moon was drawn on three of them.
  The overlay carries **no scrim and no blur** (`styles/themes.css`): every other overlay dims the
  app because the app is not what the reader is looking at, and this one exists so they can look
  at it — stacked under the settings panel's own `.s-palette-overlay` the two washes made the live
  preview a guess, so the settings overlay also steps back to 10% opacity while the picker is up
  (`body:has(.s-tpick-host)`), without unmounting: Esc must return to the panel as it was.
  **The arrow keys walk the GEOMETRY, not the flat list.** `rowStep()` (ThemePicker.tsx) resolves
  an index to (group, row, column) and moves a visual row at a time, entering the next group's
  first row in the same column and clamping to what that row actually holds; ←/→ still step by
  one across the whole list. Stepping ↑/↓ by ±COLS was wrong the moment a group held an ODD
  number of themes: with eleven dark rooms the column parity flips at the boundary, so ArrowDown
  from Tallow (dark, LEFT column) landed on Sandstone (light, RIGHT column) and **Parchment, the
  flagship light theme, was unreachable by ArrowDown at all**. Enter-keeps and Esc-restores are
  unchanged.
  `openThemePicker()` mounts it on `<body>` (like `toast.ts`) so the status bar, the settings
  panel and the palette can all open the same panel from two component trees; `isThemePickerOpen()` exists because a capture-phase
  Esc listener registered EARLIER (the settings panel's) would otherwise close the panel
  underneath it. Arrow keys move the highlight and APPLY it live (`data-theme` only — not the
  store, not localStorage), Enter commits through `setTheme`, Esc and unmount both restore the
  theme in force when it opened. **Hover never moves the keyboard highlight** — that is the
  palette's Enter-follows-the-mouse bug, and it must not be reproduced here.

## Which theme a reader lands on (precedence)

**THE PUBLIC SITE FOLLOWS THE BLOGGER'S EDITOR THEME BY DEFAULT.** One author writing in cinnabar
all day used to publish a blog wearing iron-gall, because `settings.defaultTheme` was a separate
field nobody set. It is now a THREE-state preference, and the third state is the default:

| `settings.defaultTheme` / `DEFAULT_THEME` | meaning |
| --- | --- |
| `"follow"` (or unset) | visitors get the theme the ADMIN is editing in — `settings.adminTheme` |
| a theme id | pinned: visitors get that theme whatever the admin is looking at |

**Precedence, highest first** — every tier only ever sets what a reader lands on with NO stored
choice of their own:

1. **an active design's own theme** (a design that carries one; nothing else may override it);
2. **the pinned `settings.defaultTheme` / `DEFAULT_THEME`**;
3. **follow-the-admin** — `settings.adminTheme`, mirrored from the admin's browser;
4. **the built-in default** (`THEMES[0]`, iron-gall).

And above all four: **a visitor who has explicitly chosen a theme keeps it.** `client/state.ts`
applies `me.defaultTheme` only when `localStorage["vellum.theme"]` is empty, and never persists
it — so a changed site default keeps reaching undecided readers, and a decided one is never
overruled.

- **Resolution lives on the server** (`server/site.ts`): `themePref()` settles the preference
  (unset → `follow`), `adminTheme()` is the mirror, and `visitorTheme()` is the answer that rides
  `/api/me` as `defaultTheme`. No client re-implements the rule.
- **MIGRATION IS A SEMANTIC, NOT A REWRITE.** An instance that already named a theme keeps it and
  its public site does not change appearance on upgrade; an instance that named none moves to
  following. Nothing is written to `settings.json` to make that true, so a downgrade is equally
  uneventful. `FOLLOW_THEME` is a STORABLE value (not merely an absent key) because an instance
  whose `.env` pins `DEFAULT_THEME` needs a way to override that pin — clearing the key would only
  fall back to it.
- **`settings.adminTheme` is stored apart from the pin** so switching modes loses neither: pin
  `solar`, keep editing in `void`, unpin, and visitors get `void` again — not the built-in default.
- **The mirror is `POST /api/theme`** (`{ theme }` → `PublicThemeInfo`), admin-gated like any
  mutation, one key, no-op when unchanged. It exists because the admin's theme has only ever lived
  in `localStorage["vellum.theme"]`, which no server can read. It is NOT `PATCH /api/settings`:
  that answers with published counts, every image attachment and the font catalog, and this fires
  on a theme click. **The client DEBOUNCES it** (`MIRROR_DELAY = 1000ms` in `client/state.ts`) and
  always sends the CURRENT theme, so walking the fifteen-theme picker costs one request naming the
  last room, not fifteen; a `pagehide` inside the window flushes it with `sendBeacon`. A visitor
  session, and an admin PREVIEWING as a visitor, never mirror (the client stands down; the guard
  401s anyway).
- **IT IS VISIBLE, NOT MAGIC.** An admin must never discover that their private browsing changed
  the public site. Both surfaces that choose a theme say what visitors get and why, in the theme's
  own name — the picker's footer strip (`.s-tpick__foot`, admin sessions only: `me.publicTheme` is
  not sent to visitors) and the Appearance row's second line (`.s-smodal__visitors`) — each with
  the one control that changes the rule ("Pin this instead" / "Follow my theme"). The picker's
  buttons act immediately (`setPublicTheme`); the panel's sets the row's own select, because the
  panel saves as a whole.
- **A CUSTOM theme is a theme here too.** `custom:<name>` is pinnable (`settings.defaultTheme`,
  `DEFAULT_THEME`) and mirrorable (`setAdminTheme` takes the same ids the picker offers), so an
  owner editing in a theme they built publishes a site wearing it — the "selectable everywhere a
  built-in is" promise reaching the follow rule. Shape is validated on the mirror path and
  EXISTENCE on `/api/me`: a `defaultTheme` naming a deleted custom theme is dropped from the
  payload, and the admin's "Visitors see …" line drops the name with it rather than reciting a
  theme this instance no longer has.

## Settings panel (SettingsModal)

**EIGHT TABS, and the first one is not about the site at all:** This device /
Identity / Language & dates / Publishing / Vault / Typography / Backup /
About. It was six, and the six were the wrong cut — not because a tab was
thin (that was the last round's complaint, and merging Appearance away fixed
it) but because ONE FORM held two kinds of row. Your theme, your editor
language and the sidebar's edge are `localStorage` preferences that commit on
click; they sat two rows from thirty-seven server settings under a footer
reading "Unsaved changes" and a Save button that does not apply to them.
Nothing on screen distinguished the two kinds, and nothing could: the
difference is not visible at row scale, which is why the panel's two commonest
questions were "did that save?" about a row that already had, and "why did
nothing happen?" about a row that had not. **The boundary is now the tab**,
because a tab is the one piece of chrome a reader reads before they read a
row. *This device* opens first and holds six preferences of the PERSON —
theme, editor language, sidebar edge, vim keys, the floating toolbar and
reading-view numbering; the last three were previously reachable only from a
status-bar pill, a palette row and an outline button, so a reader who did not
already know they existed could not find them. Everything else splits by the
QUESTION it answers rather than by the machinery behind it: what the site is
called, what it speaks and how it writes dates, what a visitor may see, which
folders it writes into, what it is set in, how it is backed up, what it IS.
"Appearance & language" is gone as a NAME: half of it was this browser's and
half of it was the site's, which is the confusion the split exists to end.
The rail stays `role="tablist"` (↑↓/Home/End walk it), each tab opens with its
name and ONE sentence (`intro` on the `TABS` table), and switching tabs resets
the body scroll — carrying a long tab's offset into a short one lands the
reader past its end.
**The panel is ONE height for all eight** (`height: min(740px, 100vh - 40px)`
in `settings.css`), not a height per tab. Sizing to the content stood it at
467px on one tab and 855px on another, and because it is centred, every click
moved the RAIL as well as the body: the row under the pointer became a
different tab, and the next click opened a section nobody chose. The tall tabs
scroll, which they always did; short tabs carry empty space, and a tab strip
that stays put is worth it.

**A LABEL THAT NEEDS A PARAGRAPH IS THE WRONG LABEL.** Every row is a label of
five words or fewer that carries its own meaning — "Numbered headings" over a
toggle, never "Heading numbering: on / off", because the control already draws
the state and a label that repeats it in words is asking the reader to
reconcile two sources. Help is exactly ONE SENTENCE of at most fourteen
English words, and it is a persistent sub-label rather than a tooltip: a
reader deciding between two options has both of them and both explanations on
screen at once. This was measured against what was there: the calendar row's
help ran to 40 words and spent 19 of them on Umm al-Qura; the tag-label note
ran to 51; the visitor-switch note to 48; the uploaded-fonts note to 40; the
reading-direction row to 35. Not one of them was wrong — all of them were the
row's own documentation printed where the row's name belonged, and a settings
panel that has to be READ is one nobody finishes. What genuinely does not fit
in a sentence belongs in the README (About names the sections) or under the ⓘ.
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
- **The notes sidebar's edge is a row in *This device*, directly under Editor language.** Three segments
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

**THE ENVIRONMENT IS AN OPERATOR'S BUSINESS, AND IT SITS BEHIND A ⓘ.** Every
row with an env variable used to carry two pieces of standing chrome: an
`inherited` badge beside its label and an `inherited from SITE_LANG` line
under its control — one mechanism, said twice, in the first place the eye
lands, to every owner of this product including the many who will never open a
shell. Both are deleted. The label now carries a ⓘ where a footnote mark would
sit, and what it discloses says MORE than the badge did: one sentence naming
which of the two sources is winning (`envDecidedBy` while the field is empty,
`envOverridden` once it holds a value), the variable's own line —
`SITE_LANG=en`, quoted when the value carries whitespace or dotenv syntax,
because a line that silently truncates at the first space is worse than no
line — and a **Copy as .env line** button that puts exactly that on the
clipboard and swaps its own label to "Copied" (SyncBadge's idiom; a toast for
a two-word action is louder than the action). The variable stays discoverable
for someone scripting a deployment, in the row that owns it, without being
the first thing an owner reads.
**It is a DISCLOSURE, not a popover and not a hover card**, and that is a
requirement rather than a preference. A hover card is unreachable by touch and
by keyboard. A positioned popover would be a FOURTH transient surface in an
Esc chain already three deep — ThemePicker → an open `Select` → `ImagePicker`
→ the panel — which is precisely how this panel starts closing itself out from
under a reader who meant to dismiss one list. The ⓘ is a named `<button>`
carrying `aria-expanded` and `aria-controls`; the region is
`role="region" aria-labelledby` pointed at that button, is always RENDERED and
hidden with the `hidden` attribute (so `aria-controls` never points at nothing
and the copy button is never a tab stop while collapsed), and lives in the
flow under the control it annotates — costing the Esc chain nothing and
scrolling with its own row.

**One disabled state wears one face.** With Backup=off the three `<select>`s took the browser's own greying ON TOP
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

**The panel is called "Settings", full stop.** It used to read "Site settings —
settings.json": an implementation file in the title bar of a settings screen, naming a path
without saying where that path is. Where the file lives is a FACT about the instance, so About
prints `settingsPath` and `customFontsPath` (both on `AboutInfo`) beside the vault and data
directories, with one sentence saying that deleting the file returns the instance to its env
defaults. And then "Site" went too: the panel also holds this BROWSER's own theme, the editor's
behavior and the backup credentials, the product has exactly one settings screen, and a
qualifier that distinguishes nothing is a longer word for the same thing. One key, `siteSettings`
(the id is kept so nothing has to be renamed twice), reaches the modal heading, the palette
command, the gear's `aria-label`, the `Ctrl/Cmd+/` row and the README section — rename the VALUE
and every surface follows. `siteSettingsTitle` is the gear's tooltip and carries the same word.
The Arabic is the dictionary's own noun (`settingsSaved`, `settingsSections`), not a new
coinage; likewise `browseThemes`, which is now *Themes* / «السمات» — `docTheming`'s word — on the
palette row, the `Ctrl/Cmd+/` row and the Settings → This device trigger. The README heading
moved with them, so `DOC_LINKS`' anchor is `#settings`.

`settings.defaultTheme` is parsed leniently like `settings.language`: trimmed **and lowercased**.
`DEFAULT_THEME` is lowercased by `readEnvTheme()` before validation, so trimming without
lowercasing meant `DEFAULT_THEME=SOLAR` started the instance on solar while
`PATCH {"defaultTheme":"SOLAR"}` was a 400 — the same value accepted through one door and refused
at the other. Both doors also take `follow` (see "Which theme a reader lands on"), on the same
terms: `DEFAULT_THEME=FOLLOW` and `PATCH {"defaultTheme":"FOLLOW"}` are one value, not two.

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

- **NOTHING INSIDE `.cm-content` MAY CARRY A VERTICAL MARGIN.** CodeMirror sizes every `.cm-line`
  and every block widget by its BORDER box (`getBoundingClientRect`), which counts padding and
  borders and does not count margins. A margin there is height the editor's height map denies
  exists, and `posAtCoords` — which resolves the pointer for CodeMirror's own mouse selection —
  then answers with a line that is not the one under the finger. This is the single cause behind
  four separate reports in this editor: click position, dead hover previews, mod-click opening the
  wrong note, and "double-clicking a paragraph selects the whole block". Measured: `margin: 0 0
  20px` on `.cm-s-props` put every line below the frontmatter card 20px out of step and six of
  nine double-clicks selected nothing at all. Put the air on a wrapper's PADDING (`.cm-s-fmblock`
  wraps the properties card and the banner hero; `.cm-s-htmlblock` pads itself) or in a
  TRANSPARENT BORDER with `background-clip: padding-box` when the element is painted and the air
  must stay outside the paint (`.cm-s-callout--first/--last`, whose radii are grown by the border
  width so the tint keeps its exact curve). Async height counts too: an embed or banner image that
  arrives after the measure must `view.requestMeasure()`. Spacing must also not acquire behavior
  on its way to becoming measurable — the 20px under the properties card belongs to no line, so
  `handleMousedown` sends a click landing in it to the line below the card, as the margin did.
- **SELECTION IS RESOLVED FROM THE DOM, AND A CLICK SEQUENCE HAS ONE ANCHOR.** `client/editor/selection.ts`
  supplies `EditorView.mouseSelectionStyle`: the pointer maps through `posFromEvent`
  (`caretPositionFromPoint` → `posAtDOM`), never the height map, and clicks 2 and 3 of a
  double/triple-click REUSE the position click 1 resolved. The second is not a nicety: live
  preview reflows between the clicks — the cursor's line reveals its markdown, and inside a fence
  its ``` markers come back — so re-resolving the second mousedown against the moved document
  selected a word two lines away. Double-click takes the rendered UNIT where there is one (a
  wikilink, `#tag`, `$math$` or inline-code chip is one object on screen and one object to
  select), identifier boundaries inside a fence, and otherwise a grapheme-cluster word, which is
  what keeps Arabic harakat and Persian ZWNJ inside the word. Triple-click takes the paragraph,
  drag extends by character, shift-click extends from the existing anchor. Navigating branches of
  `handleMousedown` (wikilink, footnote, external link, `#tag` search) fire on the FIRST click of
  a gesture only, so clicks 2 and 3 reach selection instead of searching twice or opening two
  tabs; the INERT branches (properties header, banner hero) are ungated, because they must swallow
  every click or the second one drops the cursor into raw YAML. `scripts/check-caret.mjs` gates
  all of it, in both shells.

- **A KEYBOARD BINDING EXISTS IN EXACTLY ONE PLACE, AND THAT PLACE IS `GROUPS`.** The table in
  `client/components/ShortcutsHelp.tsx` — the one `Ctrl/Cmd /` prints, in both languages — is the
  ledger; `docs/keymap.md` is a RENDERING of it, and `npm run check-keymap` fails the build when
  they stop agreeing in either direction. A colliding binding is the quietest bug this product can
  have: one handler answers the key, the other never sees the event, and neither of them knows the
  other exists, so it surfaces weeks later as "Ctrl+B does nothing", on one platform, from one
  reader, with nothing to grep for — because nothing is wrong with either binding. What is wrong is
  that there are two. Two handlers carry bindings today (the capture-phase listener in
  `client/App.tsx` and CodeMirror's keymap stack) and the desktop runtime makes three, which is why
  the `Binding` type carries `desktop?: boolean` beside `admin` and `shell`: the ledger has to be
  able to spell "desktop only" BEFORE the desktop exists, or the first collision between the two
  runtimes is discovered after it ships. The gate parses `GROUPS` out of the source TEXT and never
  imports it (the rows carry React and store closures; a gate that needs a browser is a gate nobody
  runs), the same way `check-i18n.mjs` reads the DICT block. A row resolves to a **chord** —
  modifiers in one canonical order (`Ctrl/Cmd`, `Alt`, `Shift`), one key token, `↑ / ↓` for a pair —
  and a **scope**, which is the shell (`app` / `blog`) and the runtime (browser / desktop) and
  deliberately NOT `admin`: an admin session sees the visitor's rows plus its own, so `admin` never
  keeps two bindings apart, it only names the reader a collision reaches first. Same chord,
  overlapping scope, two rows: the build fails. The one escape hatch is `RESOLVED` in
  `client/keymap.ts`, and it costs a paragraph naming where the tie is broken and by what rule —
  there is exactly one entry, `Ctrl/Cmd Shift Z`, which is zen AND CodeMirror's only macOS redo
  binding, broken by caret in `App.tsx` (`if (e.metaKey && inEditor(e.target)) return`). A declared
  overlap that stops overlapping fails the build too, for the reason a dead dictionary key does: an
  argued-out paragraph about two rows that no longer meet is a claim the next reader believes. The
  page and the sheet may still both be wrong about the world — the gate compares them to each other
  and cannot see past either into CodeMirror's own `foldKeymap`, which is why the macOS fold
  spelling is a paragraph in `docs/keymap.md` rather than a table row.

## Note writes are durable (server/vault.ts)

**Every note write is atomic: the file on disk is always either the whole old note or the whole
new one.** `writeNote()` writes into a temp file beside the target, `fsync`s it, and `rename`s it
over — and since every mutating path in the product funnels through that one function
(`createNote`, the editor's autosave, `PUT /api/note`, the publish toggle, both frontmatter
routes, the rename link-rewrite and `POST /api/folder/move`'s rewrites), fixing it once fixes all
of them.

It replaced a bare `await fs.writeFile(abs, content, "utf8")`, and the bug that call carried is
worth stating plainly because nothing about it looked wrong: **`fs.writeFile` opens with
`O_TRUNC`, so the note is zero bytes from that call until the last byte lands.** A crash, a full
disk, a `kill -9` or a laptop lid closed inside that window left an EMPTY note — not a partial
one, an empty one — and the window was opened by a 600ms autosave debounce
(`AUTOSAVE_MS`, `client/components/Editor.tsx`) every few seconds of typing, on files whose entire
promise to the reader is that they are ordinary and safe to keep for ten years. There was no
recovery path either: `.trash/` catches deletes, not overwrites.

Four details of the implementation are load-bearing, and each is a bug that the obvious
write-then-rename would have introduced instead:

- **The temp file is a SIBLING of its target.** `rename` is only atomic within one filesystem and
  a vault subfolder can be a mount point, so the temp file is never in `/tmp`.
- **It is DOT-PREFIXED** (`.Note.md.<pid>.tmp`). `isIgnoredName` skips every name beginning with
  "." for the tree walk, the indexer and the chokidar watcher alike, so a save never flickers a
  ghost note through the sidebar or leaves one in the search index. `tests/durability.test.ts`
  asserts the name this function builds is one `isIgnoredSegment` refuses, rather than trusting
  the two rules to stay in step.
- **The target is `realpath`'d first.** `safeAbs()` returns a LEXICAL path and `fs.writeFile`
  followed symlinks; renaming over the link itself would have replaced it with a regular file and
  silently broken a vault that keeps a note as a link to somewhere else inside the vault — which
  the containment rules above explicitly still support. Containment was already proven by
  `safeAbs` → `resolvesInsideVault`, so following the link here widens nothing.
- **The mode is carried across.** `writeFile` on an existing file leaves its permissions alone; a
  rename hands the target the TEMP file's. Without the `chmod` a note its owner had narrowed to
  `0600` would quietly widen to whatever the umask says, the next time they typed in it.

The directory is `fsync`ed after the rename so the rename itself survives the crash it exists to
survive — best-effort, because opening a directory for reading is a POSIX affordance that Windows
refuses, and a platform that cannot promise that must still be able to save a note.

**The one accepted regression, stated so it is a decision and not a surprise:** updating an
existing note now requires WRITE permission on its directory, because a new file has to be created
there. `fs.writeFile` needed no such thing — opening an existing file for writing never consults
the directory's mode. A vault folder set to `r-xr-xr-x` could therefore be edited before and
cannot be now. That is the correct trade: the app already needs to create notes, folders and
`.trash/` entries in that tree, and a write that fails loudly beats a write that succeeds by
destroying the previous version first.

The trash manifest (`writeManifest`) goes through the same helper, for a smaller but identical
reason: a torn manifest is how a restore forgets where an entry came from. Its reader already
degrades gracefully on a corrupt file, which is exactly the outcome the writer must stop causing.

`tests/durability.test.ts` pins what can be observed from inside the process — the previous note
survives a failed write, no temp file is left behind, the mode is preserved, a symlinked note is
followed rather than replaced, and the reported `mtimeMs` describes the file a reader would now
open. That last one matters beyond this section: it is the value a write precondition compares
against.

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
- **Events: the delete ANNOUNCES ITSELF**, exactly as `deleteFolder` does — one synthetic
  `{kind:"deleted", path}` after the fs work, with the watcher's echo of the same removal
  suppressed first. `.trash` is ignored everywhere, so the arrival at the far end is silent.
  **Leaving this to the watcher made the removal LOSABLE, and that was the bug.** `suppress()` is
  keyed on the PATH ALONE and holds for a second, so any write to the same note in the preceding
  second — the editor's own 600 ms-debounced autosave, a publish toggle, the PUT behind Ctrl+S —
  swallowed the `unlink` that was the only thing telling the indexer the note was gone. Measured:
  PUT then DELETE on one path, 0–200 ms apart, left a note in the index, the graph and the search
  results with **no file behind it**, still resolvable by `[[wikilink]]` and impossible to remove
  (a second DELETE 404s, because the file really is gone). Reachable by hand in one gesture: type
  a word into a note, then delete it. Both formats, both verbs.
- **The route awaits `whenIndexed()`** before answering, like `DELETE /api/folder`: the client
  refetches `/api/tree`, `/api/graph` and the published count on this 200, and a note still in the
  index when those answer is a note the reader sees a second time in their own search results.
- Vault API: `deleteNote(rel, opts?: { permanent?: boolean }): Promise<{ trashPath? }>`.

## Accessibility (client — normative, gated by `npm run check-a11y`)

`client/a11y.ts` holds the three shared primitives. Use them; do not re-implement them.

- **Dialogs.** Every modal surface calls `useDialog(panelRef, …)`: it traps Tab inside the panel
  and — the half that keeps getting dropped — returns focus to the control that opened it. Panels
  carry `role="dialog" aria-modal="true"` and `aria-labelledby` pointing at their own title node.
  `Confirm.tsx` keeps its own bespoke trap (it has a three-button ring and Enter semantics).
- **Motion.** `prefersReducedMotion()` / `scrollBehavior()` are the only way to ask. CSS gets the
  blanket rule in `styles/a11y.css`; anything animated in JS (the two graphs, smooth scrolls) opts
  out itself. Canvas simulations settle without painting the drift rather than freezing mid-layout.
- **Keyboard.** No control is pointer-only. Imperative DOM that is "a link" without an `href`
  (`.s-rv-wikilink`, `[data-fn]`) carries `role="link" tabindex="0"` and is activated through
  `activateOnKey`. The sidebar tree is ONE tab stop: `role="tree"` on `.s-tree__root`, rows are
  `role="treeitem"` with `aria-level/posinset/setsize`, and the current row is named by
  `aria-activedescendant` + a `.s-tree__item--cursor` class (arrows/Home/End/Enter/F2/Delete/
  Shift+F10; Left and Right are LOGICAL, so they swap in RTL). The tab bar is a roving-tabindex
  `role="tablist"`; the palette and the blog search are `combobox` + `listbox`/`option`.
  **The sidebar's tag shelf is ONE tab stop too**, for the reason the tree beside it is: on the
  1,388-note fixture it is 113 pills, and 113 plain buttons put 120 sidebar stops between the
  reader and every control after the pane (measured: the first control past the sidebar arrived at
  stop #121; it now arrives at #10). `.s-tags__list` is a single-select `role="listbox"` — which is
  what it already behaved like, one tag filtering at a time — its pills are `role="option"` with
  `aria-selected`, and the tab stop ROVES with the focus rather than living on the container:
  these are real buttons and there are a hundred of them, not a thousand, so moving the stop is one
  attribute on two nodes. Left/Right step one pill in READING order (they swap in RTL), Up/Down
  step a visual ROW of the wrapped shelf, Home/End reach its ends. Tab enters at the reader's own
  cursor, else at the tag currently filtering, else at the first pill.
- **Names.** Every icon-only control has an `aria-label`. A placeholder is never a label. Settings
  rows render a real `<label for>` and wire `aria-describedby` / `aria-invalid` onto their one
  control child (`Row` does this — call sites pass a single element).
- **Landmarks.** Both shells open with an `.s-skip` link to `#s-main` / `#s-blog-main`. Every
  repeated landmark (`aside`, `nav`, the status bar `footer`) is named. Page outlines start at `h1`.
- **State is never colour alone.** Toggles carry `aria-pressed` and a shape (the status bar's gold
  underline); the dirty tab dot has `.s-sr-only` text beside it; validation errors are `role="alert"`
  text with a `⚠` marker.
- `.s-sr-only` is the screen-reader-only utility. Waive a checker rule with a trailing
  `// a11y-ok: <reason>` on the offending line, never by loosening the rule.

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
confirm ("Move “name” to .trash?", danger button *Move to .trash*) carries a third, deliberately
quiet route — `ConfirmOptions.extraLabel`, which resolves `confirmModalEx()` as `"extra"` — and
that opens a SECOND confirm with the permanent copy. A checkbox would have let one click arm an
irreversible erase of a whole subtree; a quiet-affordance-then-confirm makes the reader say
"permanently" twice.

**The counts come from `/api/delete-preview`, and there are two of them.** The body now reads
"The folder and its contents — 0 notes and 4 files — move to the vault's .trash folder", because
counting only markdown is what cost a published essay its images: see "Delete previews" below,
which is the section that owns this number and the warning line under it. The client's own
`countNotes` is no longer consulted here — it could only ever see the half of the folder the
tree calls a note.

**A single note deletes at the same two speeds, from both surfaces.** `DELETE /api/note` grew
the folder route's `?permanent=` (same `1/true/yes/on` parsing, same `.trash/` destination),
and the client side is the folder pattern verbatim: `api.deleteNote(path, permanent)` →
`state.deleteNote(path, {permanent})`, driven by `confirmModalEx` with `extraLabel: Delete
permanently` and a second, `grave` dialog behind it. Both entry points — the tree's context menu
and the palette's *Delete note* — run the identical pair, and since "Delete previews" landed they
run the identical FUNCTION (`deleteFlow.ts`), because a command must not be the
harsher one merely because it was reached from the palette. Until this landed, one dialog said
"This cannot be undone" over an `fs.rm` while the folder one line above it in the same context
menu promised `.trash` — the same gesture, two different guarantees, and the harsher one applied
to the object an owner deletes most often. **The palette ROW says the same thing the dialog
says.** Its hint is `cmdTrashHint` — *moves to .trash* / «ينقلها إلى ‎.trash‎» — because it used
to read `cmdIrreversibleHint` (*irreversible* / «لا رجعة فيه»), left over from the `fs.rm` era:
the reader was told the gesture could not be undone one keystroke before a dialog promised
`.trash`, which is the two-guarantees-for-one-gesture defect this section exists to remove,
wearing a smaller hat. `cmdIrreversibleHint` is gone from the dictionary — no command is
unconditionally irreversible any more, and check-i18n fails a dead key. The store action closes the tab, reloads the tree,
refreshes backlinks, refreshes publish state (a published note leaving the vault changes the
public site) and toasts `noteTrashedToast` / `noteDeletedToast`.

**The second dialog must LOOK like the second dialog.** `ConfirmOptions.grave` (Confirm.tsx) is
what carries the escalation, and it is safety, not styling: the danger button is filled
`--danger` **at rest** instead of wearing the brand gold, the panel takes a red-tinted hairline,
and the button is **not pre-focused** — a `grave` dialog opens on Cancel and answers Enter only
from the danger button itself. Saying "permanently" twice does nothing if both dialogs are
pixel-identical gold-outlined buttons that Enter confirms; the one that erases 1,214 notes from
disk must never be one stray keypress away. `Rename` is offered on NOTE rows only — `/api/rename`
is a note route and 400s on a folder or an attachment — so every menu holds only actions that
work. The DELETE verb, by contrast, is now offered on all three kinds, each pointing at its own
route: *Delete* on a note, *Delete file* on an attachment (see "Attachment deletion"), *Delete
folder* on a folder, never on the root row.

Server side, `deleteFolder` lstats before it counts: a symlinked folder is a link, `fs.rename` /
`fs.rm` unlink it without touching the target, so it reports `notes: 0` rather than describing a
tree outside the vault that the call will not touch.

## Delete previews (server indexer + `/api/delete-preview` + client dialogs)

**The dialog counted markdown and the folder held images.** The owner moved a note out of its
folder, deleted the now note-less folder, read "0 notes" and shipped a published essay with four
broken embeds — the folder still held the four images that note used, and the confirm had no way
to know because it only ever counted `.md`. The indexer has always known which notes point at
which attachment (it is the same walk that decides what `/api/file` will serve an anonymous
visitor); nothing destructive was asking it.

- **`GET /api/delete-preview?path=<rel>` → `DeletePreview`** (`shared/types.ts`):
  `{ kind: "folder"|"note"|"attachment", notes, attachments, referenced, referrers[], referrerCount }`.
  Admin-eyes-only — the referrer list names vault paths, exactly what `/attachments` and
  `/published` withhold — so it takes their `404`-not-a-route gate, not a `403`.
- **`referenced` counts what a SURVIVOR still points at.** Notes *inside* the target go with it,
  so a link from one of them is not a link that will break: the folder branch subtracts its own
  notes before counting. A folder whose images only its own notes use reports `0` and gets no
  warning — a warning that is always on screen is furniture, and a reader stops reading furniture
  long before the one time it is true.
- **Counts come from the server's walk of the files the delete will actually move**
  (`listVaultFiles(relFolder)`, same ignore rules as `deleteFolder`), never from the client's
  tree. The client tree was the source of "0 notes".
- **Indexer:** `notesReferencing(attachmentRel)` (attachment → the notes that embed or link it,
  published or not) and `notesLinkingTo(noteRel)` (the `[[wikilink]]` half, one object over).
  The reverse map is lazy and cached beside `allowedAttachments()`; **both caches are dropped by
  the one `invalidateRefCaches()`**, because every mutation that changes either answer changes
  both. The per-note walk itself is `collectAttachmentTargets()`, shared by the publish allowlist
  and the reference map **so they cannot drift**: a file the allowlist serves but the delete
  dialog cannot see is the whole bug, wearing a different hat.
- **`ConfirmOptions.warn`** (Confirm.tsx) renders the collateral as its own danger-tinted line
  under the body — a different KIND of sentence from `body` (which describes the action), and it
  has to be able to look different from the calm line above it. The line's TEXT stays `--text`,
  not `--danger`: a whole paragraph in the danger hue is a colour the reader stops seeing, and
  several themes solve their danger against the ground for a button fill rather than for prose.
- **The English warnings are passive** — "Embedded by {notes}", not "{notes} still embed this
  file". `{notes}` is a count phrase as often as it is a name, so an active verb must agree with
  a number the string cannot see; the first draft shipped "“The Moved Essay” still embed this
  file" whenever exactly one note was named, which is a typo in the one sentence whose entire job
  is to be believed. Arabic keeps its verb-first form, where a non-human plural takes the
  feminine singular and both counts already agree.
- Referring notes are **named when few** (≤ 3, and only when the sample is the whole set) via
  `Intl.ListFormat` in the instance's language, each name separately bidi-isolated; past that
  they are counted. The server samples five, so a count is always available.
- **A preview failure is not fatal.** The dialog still opens, without the collateral line.
  Refusing to let someone delete a file because a preview endpoint hiccuped is a worse product
  than one that occasionally warns less.

**One implementation of every delete dialog: `client/components/deleteFlow.ts`.** Three objects
× two surfaces × two speeds is twelve dialogs, and when each surface built its own the guarantees
drifted — the palette's *Delete note* said "irreversible" over the act the identical tree menu
item promised was recoverable. `confirmDeleteNote` / `confirmDeleteAttachment` /
`confirmDeleteFolder` are the only entry points, both surfaces call them, and `twoSpeeds()` is
the single copy of the recoverable-then-`grave` shape. Titles are shared too
(`moveToTrashTitle` / `permDeleteTitle`): six near-identical strings free to drift one edit at a
time is how the stale hint happened. **The palette hint and the dialog say the same thing** —
`cmdTrashHint` is *moves to .trash*, checked against these dialogs whenever either changes.

**Store deletes toast a LOCALIZED failure.** `guarded(label, fn, failMessage?)` in `state.ts`
takes an optional localized line; without it the toast falls back to `err.message`, which
CONTRACTS says above is English log prose no UI may print — an Arabic operator whose delete
failed read "Note not found: x.md" inside a fully Arabic panel. The three delete verbs pass
`couldNotDeleteNote` / `couldNotDeleteFolder` / `couldNotDeleteFile`; the rest of the store still
rides the old fallback, which is the pre-existing pattern.

## Attachment deletion (server, shipped)

`DELETE /api/attachment?path=<rel>&permanent=<bool>` → `{ ok: true, trashPath?: string }`

- **The tree listed them and offered no verb on any of them.** A vault's images, PDFs and
  recordings have been in the tree since attachments landed; the only way to remove one stale
  upload was to delete the folder around it — which is precisely the gesture that took a
  published essay's figures with it.
- Same two speeds, same `.trash/` destination and same `1/true/yes/on` parsing as the note and
  folder routes. Admin-only via the auth guard.
- `400` on a `.md` path (`assertAttachment` — that is `/api/note`'s job) or an empty one; `404`
  when it is not there or **is not a regular file**: `lstat` + `isFile()`, so a symlink is not an
  attachment and the rename cannot move a link while the dialog described its target.
- **Events:** one synthetic `{kind:"deleted", path}` emitted by `deleteAttachment`, with the
  watcher's own unlink suppressed, and the route `await whenIndexed()`s — so the `/api/tree`
  refetch straight after the 200 is already correct. `visitorEvents()` drops non-`.md` events, as
  it always has.
- Client: `state.deleteAttachment` reloads the tree, refreshes **publish state** (a published
  note embedding the file now points at a 404 on the public site) and clears the broken-embed
  cache, then toasts `fileTrashedToast` / `fileDeletedToast` — Arabic's own pair, because a ملف
  is masculine where a ملاحظة is feminine and the note's line would print "نُقلت" over a file.

## Trash browser (server `.trash/` API + TrashModal)

**Every delete dialog promised a bin the product could not reach.** "Recoverable from disk" was
true and useless: `.trash/` is a dot-dir that the tree, the indexer and the watcher are all built
to ignore, so honouring the promise meant handing the owner a terminal. A safety net nobody can
reach is a safety net in the sense that a locked fire exit is a fire exit.

- **`GET /api/trash` → `TrashEntry[]`**, newest first:
  `{ name, origin, kind, deletedMs, notes, attachments, bytes, originTaken }`. Admin-only via the
  same `404`-not-a-route gate `/attachments` takes — the listing names deleted vault paths.
  A missing `.trash` is an **empty bin, not an error**.
- **`POST /api/trash/restore` `{ name }` → `{ ok, path, renamed }`**; **`DELETE /api/trash?name=`**.
  Both ride the auth guard (401 for visitors and preview sessions).
- **The entry NAME is an id, not a path.** `trashEntryAbs()` refuses separators, `..`, NULs, the
  empty string and anything **dot-prefixed**, then re-checks containment against the resolved
  string; the caller `lstat`s, so a symlink inside the trash is not an entry. A real vault entry
  can never begin with a dot (`isIgnoredSegment` keeps those out of the vault), so the dot rule
  costs nothing — and it is what stops the manifest itself being restorable or purgeable.
  `safeAbs()` cannot be used here: it 404s everything under `.trash` by design, which is the rule
  that makes the bin invisible everywhere else and must stay.
- **Origins are recorded, so Restore is a restore.** `.trash/.vellum-trash.json`
  (`{version, entries: {name: {origin, deletedMs, kind}}}`) is written by every trashing delete.
  Writes are serialized on one chain — two deletes in the same tick would read the same file and
  the second write would drop the first entry, losing the origin of the folder somebody is about
  to need back. A failed manifest write **never fails the delete**: it degrades that entry to
  "origin unknown" and is logged. A missing or corrupt manifest degrades the whole bin the same
  way, which is exactly the pre-manifest behaviour.
- **Restore lands at the origin, beside it, or at the vault root** — and says which. A taken
  origin gets the trash's own counter (`Linker.md` → `Linker-2.md`), an unrecorded or now-invalid
  origin falls back to the entry name at the root, and the answer's `renamed` flag drives
  `restoredRenamedToast` instead of `restoredToast`. The browser prints the destination **before**
  the click too (`trashFrom` / `trashOriginTaken` / `trashOriginUnknown`), because a "restored"
  that quietly went somewhere else is the same species of lie as a delete that quietly took four
  images with it.
- **A restored folder is indexed before the response returns.** `indexUnder(rel)` (indexer) walks
  the subtree — the mirror of `removeFolder()` — and the route emits `{kind:"created", dir:true}`.
  `visitorEvents()` **fans that out into one `created` per visible note**, sampled AFTER
  `whenIndexed()` (the mirror of the delete fan-out's sample-first discipline): without it a
  visitor's sidebar was missing published notes the site was already serving.
- **`.trash/` still never reaches the remote** — `gitSync`'s pathspec eviction covers the whole
  directory, manifest included. Nothing in this section changes that guarantee.
**Stacking: the confirm dialog is the top of the product, and it was not.** `.s-confirm-overlay`
sat at `z-index: 130` while the mobile sidebar DRAWER sits at `400` and its backdrop at `390`.
Below 1000px the sidebar is a fixed overlay and the delete dialogs are opened FROM it, from the
tree's context menu — so on a phone "Move “Essay Assets” to .trash?" rendered *underneath* the
drawer that launched it, with Cancel and the danger button both unreachable and a dimmed sliver
showing past the drawer's edge. Every `promptModal` shares that host, so New note, New folder and
Rename were in the same hole; the only escape was `Esc`, on a device with no `Esc` key. The
overlay is now **500**, above everything, which is structural rather than cosmetic: every other
layer can spawn a confirm, so anything that can paint over one is a dialog the reader cannot
answer. **Anything new that covers the viewport goes below 500** — the trash browser takes `420`
(above the drawer, below the confirm, so its purge dialog stacks on it).
*Known and deliberately not fixed here:* the command palette (`200`) and the moderation feed
(`110`) are still under the drawer, so with the drawer open on a phone they are covered the same
way. That predates this section and belongs to whoever takes the drawer's layering as its own
change; it is written down so it is not rediscovered as a surprise.

- Client: `TrashModal.tsx` + `styles/trash.css`, opened by the palette's *Open trash*
  (admin, not in preview) and cleared from the store on logout and on entering visitor preview.
  Rows carry Restore and a `grave`-confirmed erase; the header carries "Empty trash" behind the
  same `grave` dialog. In-flight names disable their own row's buttons, so a double click cannot
  fire two restores of one entry and toast a failure about something that succeeded. The list is
  **refetched from the server** after every mutation, never optimistically emptied: an entry that
  failed to go stays visible instead of vanishing from a list that lied about it.

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
  no hint. At ≤1280px the two counts go (as ONE group — `.s-statusbar__ambient`); at ≤640px the
  pane cluster and the crumb trail go, every group's hairline drops
  **and the bar becomes `overflow-x: auto`** (scrollbar hidden), because a phone can always be
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

  **And that was only four of them, so the bar shipped BOTH separator systems at once.** The
  counts, the publish toggle, the published-note count and the mode pills were still separated
  by `·` — `.s-statusbar__dot` rendered three times in `StatusBar` and a fourth inside
  `SyncBadge`, which printed its own trailing dot — so a 1440px admin bar drew three middots and
  four hairlines, which is exactly what DESIGN.md forbids. **Every right-cluster segment is a
  group now**: `.s-statusbar__panes`, `.s-statusbar__group`, `.s-modes` and `.s-syncwrap` share
  one rule, `.s-statusbar__dot` is gone from the codebase, and the mark belongs to the BAR's
  grammar rather than to whatever a segment happens to contain (which is why `.s-modes` and the
  sync badge are marked from `app.css` and not from their own components — and why it is
  `.s-syncwrap`, the root `SyncBadge` returns `null` instead of, rather than `.s-sync` inside
  it: a hairline in front of a badge that drew nothing is a rule separating nothing).
  Two gaps survive the shared rule on purpose (`.s-modes` 5px, `.s-statusbar__ambient` 10px):
  pills are not icon buttons and two runs of text at 2px are one run of text.

  **THE TWO COUNTS ARE ONE GROUP, and that is what makes the ladder safe.** `words · chars` and
  `N published notes` sit in `.s-statusbar__ambient` (the publish TOGGLE, which is an act rather
  than trivia, moved out from between them into its own group and survives to the phone). They
  are one unit of sacrifice as well as one group: the ≤1280 rule drops the GROUP, because
  hiding two members of a group individually leaves the group's own hairline and padding behind
  with nothing inside them.

  **The segment that OPENS the cluster carries no rule.** A hairline is a separator; on the
  leading edge of the first segment it has nothing on its far side but the flexible gap, and it
  reads as a stray tick floating mid-bar. Which segment is first depends on the session (a
  visitor has no publish, no modes and no admin tools; no note open means no counts), so it is
  matched positionally — `.s-statusbar .s-statusbar__spacer + *` — and never named. The `+`
  combinator still matches a `display: none` sibling, so the ≤1280 block repeats the
  suppression as `.s-statusbar__ambient + *`: without it a stray tick appears at 1280 exactly
  where one disappeared. Both selectors are (0,2,0) and sit after the group rule, which is what
  makes them win — the same specificity trap as everything else scoped to this bar.
  Measured 1440→390 in both languages with publish, the published filter, both mode pills and
  the sync badge up: `.s-statusbar__dot` count 0 at every width, exactly one segment at 0px
  border and the rest at 1px above 640, all segments at 0px below it, and nothing on the hidden
  overflow.

**A SHORTCUT IS RESOLVED BY THE LAYOUT FIRST AND BY THE PHYSICAL KEY SECOND** — `client/keys.ts`,
and the whole of it goes through `shortcutKey(e)`. `KeyboardEvent.key` is what the LAYOUT
produced, and `App.tsx` compared `e.key.toLowerCase()` to Latin letters, so on the owner's Arabic
keyboard — where the physical P key reports `"ح"`, K reports `"ن"`, G `"ل"` — **every global
shortcut in the product was dead**, in an app that ships a complete Arabic translation and mirrors
its entire layout for it. Measured by `scripts/check-layouts.mjs` before the fix: 5 of 7 bindings
dead under Arabic, Russian and Hebrew, 4 of 7 under Greek. Only two bindings carried an `e.code`
fallback, and only while Alt was held.
- **The rule.** If the layout produced a printable ASCII character, THAT is the key. Only when it
  did not — a non-Latin script, a dead key, `"Unidentified"`, an empty `key`, macOS's Alt-mangled
  `"∫"` — does the physical position (`e.code`, then legacy `e.keyCode`) answer.
- **Physical does not simply win, and that is the load-bearing half.** On Dvorak `b` is under the
  physical N key and the physical B key types `x`; on AZERTY `z` is under the physical W key, and
  Ctrl+Shift on the physical Z key there is `Ctrl+Shift+W` — *close the window*. A reader who
  learned "Ctrl+B is bold" learned it about the key that TYPES b. Resolving by `code` alone would
  bold from the wrong finger and do nothing from the right one: the same bug aimed at a different
  reader. Layout-first is the convention VS Code, Chrome and Firefox settled on, and — arrived at
  independently — the one CodeMirror's own keymap already follows.
- **AltGr returns `null`, for every binding.** On several European layouts Right-Alt reports as
  ctrl+alt, and AltGr+E on Polish is how you type `ę`. Resolving that to the physical E would
  break TYPING in order to fix commands. The two hand-written `!e.getModifierState("AltGraph")`
  guards on the pane and template toggles are gone — the resolver does it once, for everything.
- **Named keys are not resolved at all** — `Escape`, `Enter`, `Tab`, the arrows are the same key
  on every keyboard on earth, so the palette, the pickers, the blog search overlay and the
  confirm dialog match `e.key` directly and were never affected. Plain typing is likewise never
  rewritten: `Select.tsx`'s typeahead follows the layout, which is the only thing it could mean.
- **The editor agrees with the app, and reuses its own keymap to do it.** CodeMirror resolves keys
  itself (`runHandlers` → `keyName(event)`, with a `base[event.keyCode]` fallback), which is why
  Ctrl+B still bolded on Russian and Greek while nothing else worked. It has three holes: its
  fallback requires the layout's output to be ONE code point — and Arabic 101 puts the lam-alef
  ligature `"لا"`, two code points, on the physical B key — it depends on the deprecated `keyCode`,
  and on Windows it declines every ctrl+alt event as AltGr whether or not AltGr was pressed.
  `client/editor/layoutKeys.ts` closes all three WITHOUT binding anything of its own: when the
  layout produced no Latin character it synthesizes the keydown that same physical key would have
  sent on a US keyboard and pushes it back through CodeMirror's own `runScopeHandlers`, so bold,
  save, search, undo and every default answer with no second table to drift. It carries a US
  `keyCode` because that is how CodeMirror reaches a SHIFTED binding (`Mod-Shift-x` is found
  through `shift[keyCode]`, not through the key name), and it sits at `Prec.highest` — which puts
  it ahead of every keymap and still BEHIND vim, because vim arrives as a ViewPlugin and
  `InputState.runHandlers` runs plugin handlers before facet handlers whatever their precedence.
- **The gate is a layout matrix, and it is two-sided.** `tests/shortcuts.test.ts` resolves all 22
  documented character bindings under Arabic, Persian, Russian, Greek, Hebrew, US, AZERTY and
  Dvorak, and asserts the fallback does NOT fire where the layout answered.
  `scripts/check-layouts.mjs` does the same against the real app through the DevTools Protocol
  (`Input.dispatchKeyEvent`, which is the only way to set `key`, `code` and `keyCode`
  independently — Playwright's keyboard always sends the US `key` for a `code`). 65 checks.
  Cases the browser cannot deliver — Chromium flattens a two-code-point `key` to `""` — live in
  the node test. **A binding added to `ShortcutsHelp` and not to `BINDINGS` in
  `tests/shortcuts.test.ts` is a binding untested on every non-Latin keyboard on earth.**
- **Known limit, stated rather than hidden:** vim mode's own keys (`Ctrl+D`, `Ctrl+U`, and every
  normal-mode letter) still resolve through `e.key` inside @replit/codemirror-vim. Vim on a
  non-Latin layout is unusable for a larger reason — `hjkl` are Arabic letters there — so this
  is not papered over with a fallback that would only half-work.

**`Ctrl/Cmd+/` opens `ShortcutsHelp` (`shortcutsOpen` in the store).** Searchable, grouped
Navigation / Editing / Modes / Publishing / Panels, `Esc` closes, also reachable from the palette
and the status-bar `?`. Rows with no keystroke still appear, naming the surface that carries them
("Command palette", "Status bar", "Click") — the reader is asking "how do I do X".

- **The sheet does not print a letter the reader cannot type.** Every row said `Ctrl/Cmd + P`;
  on an Arabic keyboard that key types `ح` and nothing on the sheet said so. Where the browser
  will tell us — Chromium's `navigator.keyboard.getLayoutMap()` — `client/layoutMap.ts` reads the
  layout once (on open, not at module load) and the sheet prints BOTH: the position `P` and the
  character `ح` beside it, under a one-line explanation (`scLayoutNote`). Shown **only** when the
  layout types none of these letters, so a US, AZERTY or Dvorak reader sees the sheet exactly as
  before — their `b` key is labelled B, they press it, bold happens. Where the API does not exist
  (Firefox, Safari, an insecure context) the map is empty and nothing is claimed that is not
  known, which is the whole bar for a legend.
- **Letters only.** The layout map reports each key's UNSHIFTED character, and a punctuation
  binding may live behind Shift: ЙЦУКЕН has no slash on the slash key at all — it types `.`, and
  the Russian reader's `/` is Shift+Backslash, which arrives as `"/"` and is answered by the
  LAYOUT. Annotating `/` from the unshifted map would print `.` beside it and be precisely the
  lie this removes.

**A KEYMAP IS NOT AN ANSWER ON A DEVICE WITH NO KEYBOARD.** `.s-empty` (App.tsx, no note open)
showed one thing: a grid of `Ctrl`-combination chips. At 390×844 that was the first screen after
signing in — seven hints for controls the device does not have, the grid exactly as wide as the
viewport so the first chip sat flush at x=0 with no gutter, and one label wrapping inside its
cell, which makes that grid ROW taller than its neighbours and throws the legend out of true.
The empty-state rules carried no media query and no pointer query at all.
- **Both halves ship in the DOM and CSS picks**, at `@media (max-width: 700px), (pointer: coarse)`
  — the pointer half matters on its own, because a tablet in landscape is 1024px wide and still
  has no `Ctrl` key. No resize listener, no first-paint flash, nothing for JS to get wrong.
- `.s-empty__touch` offers what the legend was only NAMING: the recent notes, then New note
  (admin), Search notes and Graph view. Every target is ≥44px tall. *Search notes* goes through
  `openQuickSearch()`, which opens the mobile DRAWER before dispatching `vellum:quicksearch` —
  `Sidebar.revealSidebar()` un-collapses and un-zens, but the phone's pane is a fixed drawer
  governed by `sidebarOpen`, so a bare dispatch focuses a field parked off the screen edge and
  eats every keystroke after it. The dispatch waits one frame for the class to commit.
- **Recent notes live in App, not in the store** — `localStorage["vellum.recent"]`, ≤12 paths,
  written by a `useStore.subscribe` on real `openPath` changes (not by a render value, which
  would reorder the list on any unrelated re-render), five shown. Nothing else remembers this:
  the store persists open TABS, and by definition there are none when this pane is on screen.
  Paths are re-checked against the LIVE tree (`collectNotes`) before anything is drawn, so a
  deleted note, a sign-out and an admin previewing as a visitor each narrow the list by
  themselves rather than leaking a title to somebody who may not see it.
- The desktop legend keeps DESIGN.md's two-column grid but on `repeat(2, max-content)` with
  `white-space: nowrap` chips, dropping to one column at ≤1100px. Measured, not guessed: the
  centre column is the window minus a 280px sidebar, a 300px panel and this pane's own 24px
  gutters, which is 396px at 1024 against a legend measuring 400 in English and 423 in Arabic —
  the Arabic one sets the threshold. `.s-empty` takes `padding-inline: 24px`, because a centred
  child wider than its box overflows at BOTH ends silently, and a gutter is what turns "it does
  not fit" into something visible. `.s-empty__key` is `--text-muted`: these are labels naming a
  thing, and DESIGN.md holds those to 4.5:1. `.s-empty__glyph` lost its `opacity: 0.7` for the
  reason DESIGN.md gives — a fade over a token already at its floor fails the floor without
  failing the gate (0.7 of parchment's faint is 1.75:1).

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

## Attachments (location setting, any-file upload, delete impact)

`shared/attachments.ts` is the single policy both halves import: the four location modes, the
folder validator, and the accepted-type table. Neither side may keep its own copy.

**Where an upload lands is a setting, and it is Obsidian's setting.** `settings.attachments =
{ mode, folder }` mirrors "Default location for new attachments": `vault-root`, `same-folder`
(beside the note being edited), `subfolder` (a named subfolder OF the note's folder), and
`specified` (one fixed vault-relative folder). **`specified` + `ATTACHMENTS_DIR` is the default**,
so an upgrade changes nothing until an admin says otherwise — which is why `PATCH` *deletes*
`attachments.mode` when it is set to `"specified"` rather than storing it.

- `site.ts::attachmentLocation()` merges the stored value over the env default; `uploadDirFor(dir)`
  resolves it against the folder the upload happened in. `POST /api/upload` takes that folder as
  the optional multipart field **`dir`** — the editor sends the open note's folder, the tree drop
  sends the row it was dropped on, the pickers send the open note's folder. `dir` is untrusted:
  it is normalized, and `safeAbs` on the joined result is what actually refuses traversal and
  ignored trees (verified: `dir=../../etc` → 400, `dir=.obsidian` → 404).
- The folder value is refused for the same reasons a vault path always is (traversal, absolute,
  control characters) **plus dot-folders** — a dot-folder is invisible to the tree, the indexer
  and the watcher, so an attachment written into one would never resolve again. `folderError()`
  returns a REASON KEY, not a sentence: the server renders it into a 400, the settings panel
  into localized inline copy, and the two can never drift apart. **The RAW value is judged before
  it is cleaned.** `cleanValue()` REPAIRS control characters (every run becomes a space), so
  running it first made `FOLDER_PROBLEM.control` unreachable: `PATCH {attachments:{folder:"med\0ia"}}`
  answered 200 and stored the folder `med ia`, which is not what this line says happens. Nothing
  unsafe reached the disk either way — the bug was an API storing a folder the author never
  typed. A trailing newline is still tolerated (`folderError` trims first).
- **Existing attachments are never moved.** The setting decides where the NEXT upload goes;
  embeds resolve by basename, so nothing breaks either way. Fonts (`VELLUM_DATA/fonts`) and
  `custom.css` keep their dedicated locations.

**Every type the vault can hold, sniffed by bytes.** `sniffAttachmentType(buf, hint)` in
`server/api.ts` decides the stored extension from magic numbers — images, PDF, audio, video —
and the `hint` (the uploader's own extension) only ever picks between aliases the bytes cannot
distinguish (`jpg`/`jpeg`, `ogg`/`oga`/`opus`, `mp4`/`m4v`). The raw-MPEG-frame test for a
tagless mp3 is `0xFF 0xEx`, two weak bytes, so it is checked LAST, after every format with a
real magic number. SVG still has no magic bytes and is still scrubbed at write time.
`isAcceptedAttachment()` is the client's mirror, and it exists so a file the server would
reject is **refused before it is uploaded**, naming both what was turned away and what is
welcome; a mixed batch asks (a half-finished drop nobody agreed to is its own surprise), an
all-refused batch just says so.

**Deleting is NOT specified here.** This section was written with a `GET /api/impact` route and
an `impactSentence()` beside it, for the same reason the section above exists: a folder holding
four images and no notes truthfully answered "0 notes" and took four figures out of a published
essay. That question now has one answer — `GET /api/delete-preview` and
`client/components/deleteFlow.ts`, documented under "Delete previews" above — which covers notes,
folders AND single attachments and feeds every dialog in the product. The impact route, its
`DeleteImpact` wire type and `attachmentReferrers()` in the indexer are gone with it. Two routes
answering one question is how two dialogs come to describe one delete differently.

`DELETE /api/attachment?path=&permanent=` (admin only, documented under "Attachment deletion")
is what backs the drop's **Undo** — which trashes rather than erases, since an undo that erased
would be worse than the drop it undoes — and the × on the banner picker's rows, which routes
through `confirmDeleteAttachment()` and therefore carries the same "still embedded by…" warning.

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

**That gate now says which session it is measuring.** It never logged in, so against an instance
started WITH `ADMIN_PASSWORD_HASH` it browsed as a visitor, no CodeMirror mounted, the
`.cm-scroller` evaluate timed out, and the run reported `SKIP … browser died (TimeoutError…)`,
`the browser crashed (memory?)` and `FAIL enough links … 0 hovered` — a gate blaming the machine
for a session it had chosen itself, and a cycle spent learning the feature was fine. It now reads
`/api/me` first: with `VELLUM_PASSWORD` set it signs in through `POST /api/login` and continues;
without it, it prints *"this session is NOT an admin — no editor mounts, so there is nothing to
hover"*, the instance's `protected`/`public` flags and both fixes, and **exits 1**. The whole run
also shares ONE browser context (`browser.newPage()` makes a fresh one per call, which would have
dropped the session cookie on the first subject). Verified both ways against a
password-protected instance: refusal exit 1, `VELLUM_PASSWORD=… ` exit 0 with 10/10 links.

Server side: `siteLanguage()` in `server/site.ts` merges `settings.language` over `SITE_LANG`
(default `en`); `/api/me` sends `language` to **every** session (visitors included), and
`blogLocale()` falls back to the site language when neither `settings.blogLocale` nor
`BLOG_LOCALE` is set.

**`languageFilter` is a four-state enum, and the state is resolved PER REQUEST.**
`shared/types.ts::LanguageFilterMode` is `"off" | "follow" | "ar" | "en"`. It replaced a boolean,
and the replacement is not cosmetic: the boolean could only say "on", "on" silently meant "pin to
`SITE_LANG`", and enabling it took a live site from twenty published posts to two with no warning
before the save and no indicator after it.

`server/language.ts` owns the resolution and is the only module that reads the mode: every
visitor route calls `languageScope(c, isPublishLimited(c))` **once** at its top and passes
`scope.lang` (`"ar" | "en" | null`) down. Nothing below the routes reads the mode globally,
because a global read is exactly how a per-reader setting collapses back into a per-site one.
`scope.lang` is `null` for every admin surface, unconditionally — *admin surfaces are never
filtered* does not bend for a mode. Every indexer function that enumerates notes for a visitor
takes it as a **required** parameter with no default: a default would be a filter language chosen
by whichever module forgot to pass one, and getting it wrong means either a withheld note leaking
or a reader's language ignored.

**`"follow"` needs the reader's language, so the client declares it.** `X-Vellum-Lang: ar|en` on
every API call (`client/api.ts::withPreview` sets it beside the preview header), and `?lang=` on
the three surfaces that cannot send a header — `/api/events`, because EventSource has no header
API, and `/feed.xml` and `/sitemap.xml`, because neither a feed reader nor a crawler is our
client and `?lang=ar` is how the Arabic side of a bilingual site becomes its own subscribable and
its own submittable URL. **Validated and gated exactly
as `X-Vellum-Preview` is**: the value must be exactly `"ar"` or `"en"` (anything else is dropped,
not coerced — a mistyped scope falls back to the site language rather than to a guess), the query
form is honored only on those three paths, and the whole claim is honored **only while
`settings.languageToggle` is on**. An instance that offers readers no language switch has no
reader language to speak of, and letting a header say otherwise would be a second, undocumented
way to re-scope the public site. `X-Vellum-Lang` is therefore a `Vary` dimension on every `/api`
response, the SPA shell and the feed: under `"follow"` two readers of the same URL with the same
(absent) cookie get different post lists, topics, search results and graphs, and a shared cache
that did not know would hand one reader's collection to the other.

**The SSE stream resolves its scope once, at subscribe time, and holds it.** The reader language
arrived as `?lang=` and cannot change without a reconnect — so `client/App.tsx` lists `language`
in the subscription effect's dependencies beside `admin`. Without that, a reader who flipped the
EN/ع switch kept a stream describing the collection they had just left: announcing edits to notes
their new language hides, and silent about the ones it reveals.

**It will not serve an empty site.** Under every non-`"off"` mode, if the language in force
qualifies **no** published note, the filter stands down for that request and the full collection
is served with `MeData.languageFallback` set (a quiet line in the public shell, an XML comment in
the feed, and the loud version for the admin). This applies to pinned modes too, not only
`"follow"`: pinning to Arabic on a vault with no Arabic posts is a configuration mistake, and the
humane response to a configuration mistake on a live site is to keep serving it while saying so
to the one person who can fix it — not to blank it for everyone else.

**Migration is to the pinned value, never to `"follow"`.** A stored boolean `true` becomes `"ar"`
or `"en"` per the site language (`server/settings.ts::migrateSettings`, rewritten on disk at
startup and also coerced on read so an un-migrated file still behaves), `false` becomes `"off"`.
`"follow"` is the better setting for most bilingual sites and is deliberately **not** what an
upgrade picks: upgrading must not change what a live site's visitors can see. The env form keeps
the legacy spellings too — `LANGUAGE_FILTER=true` is held as a `"site"` sentinel resolved at read
time (it never named a language; it meant "whatever the site's language is"), while a *stored*
`true` is frozen, because otherwise an owner who later switched the chrome to English would find
their Arabic posts swapped for their English ones by a setting they never touched.

*One trap, recorded because it cost a boot:* the read-time coercion of a stored boolean runs
**inside** `getSettings()`, and `siteLanguage()` calls `getSettings()`. Reaching for the
convenient getter was infinite recursion — the server died with "Maximum call stack size
exceeded" on exactly the pre-enum files the migration existed for. `settings.ts::rawSiteLanguage`
does the same two-layer merge one level down, where no cycle is possible, and
`site.ts::envSiteLanguage()` exists solely to be its env half.

**Coverage is unchanged and total.** `server/indexer.ts` caches an
`arabic` flag per note record and `languageHidden(record, lang)` consults it *at query time*, so
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
`isNoteVisibleToVisitor`, the name-resolving one via `resolveLink(ref, true, lang)` and the
exact-path fallback directly — both now at the *reader's* scope, because under `"follow"` an
English home note is a real homepage for an English reader and a non-existent one for an Arabic
reader, and `/api/me` has to answer each of them truthfully. The fallback used to ask `isNotePublished` alone, so an Arabic instance whose
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

**The crawler gets a map, not the SPA shell.** `/sitemap.xml` and `/robots.txt` are real routes
(`server/index.ts`, rendered by `server/blog.ts`). Both used to fall through to the SPA catch-all,
so a crawler asking a *publishing* product for its sitemap got `200 text/html` — a page of
JavaScript claiming to be a site map. `/sitemap.xml` is a sitemaps.org 0.9 `urlset`: the front
door, then every note in `posts(true, scope.lang)` — the same visitor list, the same
`languageFilter`, the same `?lang=` carve-out and the same `canRead()` gate as `/feed.xml`, so it
can never name a note the site's own pages hide, and `PUBLIC=false` answers it 401. `<lastmod>` is
the note's own date in W3C form; the front door borrows the newest post's, because a `lastmod` that
is always "now" teaches a crawler to ignore the field. It diverges from the feed in exactly one
way: **static pages stay in.** The feed drops them (`staticPagesActive()`) because an About page
is not an article; a sitemap is not a timeline but the list of URLs this site serves, and About is
one of them. Topic pages are out — each is an index over URLs the file already names —
and `<changefreq>`/`<priority>` are omitted rather than invented, because no major crawler has
read either in years. The 50,000-URL protocol ceiling is enforced newest-first, with an XML
comment when it bites.

**`/robots.txt` is the one crawler surface that does NOT 401.** RFC 9309 §2.3.1.3 reads a 4xx on
`robots.txt` as *no rules exist — crawl freely*, so the gate that correctly protects the sitemap
would, on this one path, say the opposite of what `PUBLIC=false` means. A request that cannot read
gets `200` with `User-agent: *` / `Disallow: /` and **no `Sitemap:` line**; a request that can gets
`Allow: /`, `Disallow: /api/` and the sitemap. Neither body discloses anything — every real path
still enforces its own gate — and the locked one stops the crawl instead of inviting it.

**The served `<head>` is a discovery surface too.** `server/blog.ts` has four exported entry
points — `renderFeed()` (RSS), `renderSitemap()`, `renderRobots()` and `injectHead()` (the
crawler-facing `<title>`/`og:`/canonical block on the served SPA shell) — and each of the three
that names notes resolves them through `posts(true)`, the visitor list.
The head injection is the loudest of them: it is what puts a note into Google and into social
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

**THE SITE'S LANGUAGE AND THE EDITOR'S ARE TWO VALUES, AND `client/langPref.ts::chromeLang()`
is the ONLY place that decides which one a session reads in.** `settings.language` / `SITE_LANG`
is an editorial decision about what this instance *publishes* in. It is not, and must not be,
the language its owner is obliged to *work* in: an Arabic site run from an English editor (or
the reverse) changes nothing a visitor is served, and demanding a republish to get a readable
sidebar was the coupling this split ended. Two per-browser preferences sit over the site value,
each scoped to one kind of session, and neither may reach the other's:

| key | whose | honoured while | null means |
| --- | --- | --- | --- |
| `localStorage["vellum.editorLang"]` | a real admin session | always (admin only) | follow the site language |
| `localStorage["vellum.lang"]` | a visitor | `me.languageToggle` is true | follow the site language |

The split is on `me.admin`, which the **server** answers and which is `false` for an admin
under `X-Vellum-Preview` — so visitor preview shows the visitor's language, not the owner's, in
the same way `mirrorTheme()` declines to mirror from a previewing session. The store keeps both
`language` (this session's chrome) and `siteLanguage` (what the site publishes in); reading
`language` to answer "what language is this site?" is the mistake that welded them together, and
`editorLangPref` is held beside them because a pin to English and a follow of an English site
resolve alike and the three-state control has to tell them apart.

**Before this, `loadMe()` applied the visitor's stored choice over `me.language` for EVERY
session.** One tap on the public site's ع rewrote the owner's editor, sidebar, tabs, status bar
and palette — and on an instance whose `publicLayout` is `"app"` the blog shell never renders,
so `LangSwitch` (its only home outside the design canvas) does not exist anywhere in the
product: there was no way back short of clearing `localStorage` by hand. The escape hatch is now
structural rather than a promise — the three `editor-lang-*` palette commands name each language
in its **own script**, so "English" is findable from an Arabic interface and «العربية» from an
English one. `tests/langPref.test.ts` holds the whole rule as a table plus the two invariants
stated over every combination of the inputs.

**`settings.languageToggle` (default false) is a VISITOR override, and it moves two things
only: the chrome dictionary and `<html dir>`.** `client/langPref.ts` owns the stored value
(`localStorage["vellum.lang"]`), and `chromeLang()` applies it over `me.language` for visitor
sessions — and only while `me.languageToggle` is true, so turning the setting off restores the
site language for everyone regardless of what their browser remembers. What it must NOT touch is `blogLocale`:
dates and numerals are one system per instance chosen by the date locale (see the numerals note
above), and letting a visitor's chrome choice re-pick the numbering system would reintroduce
exactly the two-numeral-systems-on-one-line bug that rule exists to prevent. Note content is
untouched for the usual reason — it was never localized in the first place.

`settings.language` is parsed leniently — `settings.ts` trims and lowercases before matching, so
`"AR"` and `" ar "` are accepted and stored as `"ar"`. `languageFilter` now gets **the same**
treatment, which is the reading the old note here already argued for ("an enum has an obvious
canonical form"): trim, lowercase, then match the closed set, and anything outside it is a 400
naming the four values. `null` still clears the key back to `LANGUAGE_FILTER` — and note that
`null` and `"off"` are different statements, "take the env default" against "this site filters
nothing", which is a distinction the boolean could not make.

**`GET /api/visibility` (admin only) is the consequence engine.** `server/visibility.ts` answers,
from this vault, what the visitor-facing settings cost in notes: `published`, `visible`,
`hiddenByLanguage`, a `census` of the published set by script, `topics`, and the state of the
blog front door. Every query param — `languageFilter`, `excludeTags`, `publicLayout`, `home`,
`homeNote` — is a **hypothetical**; absent ones describe what is in force. That is what lets the
settings panel print *"Pinned to Arabic: 3 of your 22 published notes qualify; 19 would be hidden
from every visitor"* **before** the save, from the same code path that will serve the site
afterwards (the empty-set stand-down included, so the preview cannot promise something the
request path will not do). Admin-only for the reason `/api/published` is: the counts describe
exactly what the public surfaces withhold. `/api/me` embeds the current answer as
`visibility` for admin sessions, but **only while `isReducingReach()`** — an indicator that is
always lit is furniture nobody reads, so it is reserved for notes actually going missing (reads
closed, a filter standing down, any note hidden by language, a blog front door visitors cannot
see) and deliberately excludes `EXCLUDE_TAGS`, whose consequence is printed under its own control
and which would otherwise light the pill forever on any site that uses it.

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

### Spellcheck answers the LINE, not the note (client/editor/bidi.ts, shared/script.ts)

The editor is spellchecked, and **each line declares its own language**, so an Arabic paragraph
inside an English note is checked against an Arabic dictionary instead of arriving as one unbroken
red underline. Obsidian checks a note as a single language; a bilingual vault is exactly where that
fails, and it is the case this product exists to get right.

It had never been on at all. `@codemirror/view`'s default content attributes set
`spellcheck: "false"`, nothing overrode them, and the only appearances of the attribute anywhere in
`client/` were `spellCheck={false}` on chrome inputs — so the product knew the attribute existed and
had only ever used it to turn spelling off. The selection-menu contract below already declined to
put a formatting menu on an empty selection on the grounds that *"the browser's own menu (spelling,
paste, the dictionary) is the better answer and taking it would be theft"*: a menu which, with this
off, contained none of those three things.

- `.cm-content` carries `spellcheck="true"` plus the INSTANCE's language, and that is only the
  floor. `autocorrect` and `autocapitalize` stay **off**: a markdown note is not a message box, and
  a capitalized `iOS` or a "corrected" `[[wikilink]]` is a silent edit to somebody's file.
- `client/editor/bidi.ts` — already the one writer of `dir` in the editor, and already deciding
  each line's direction from its own content — stamps a narrower `lang` on any line whose SCRIPT
  disagrees with the document. One scan answers both questions; a Latin line gets no attribute at
  all and inherits, which also keeps the markup off the overwhelming majority of lines.
- **A line is checked only in a language a dictionary is KNOWN to exist for.** The first shipped
  version trusted `lang` alone, and on a system with no Arabic dictionary — which is every
  Chromium, whose hunspell set has never included Arabic — the checker fell back to English and
  underlined every correctly spelled Arabic word in the vault: the wall of red this feature exists
  to prevent, produced by the feature, found by the owner within a day. `setSpellcheckAvailable()`
  is the gate; the desktop feeds it from Electron's own resolved dictionary list ("*" on macOS,
  whose system checker reads the attribute itself), and the plain browser — which cannot ask —
  leaves RTL-script lines unchecked rather than wrongly checked. `lang` itself stays on the line
  regardless: it is true, and screen readers use it.
- The rule itself is `shared/script.ts`'s `spellcheckLang()`, deliberately a SCRIPT test and not a
  language detector: script is a property of the codepoints, cheap and total, whereas guessing
  French from Spanish out of Latin letters is a different problem with a much worse failure mode —
  and the answer there (inherit the instance's language) is already right. Persian is separated
  from Arabic on the four letters Arabic does not have (پ چ ژ گ) and the two it spells differently
  (ک ی); a Persian sentence built only from shared letters reads as Arabic, which
  `tests/script.test.ts` asserts as an accepted limit rather than leaving as a surprise.
- **Source lines get `spellcheck="false"`.** A code fence is not written in any language, and
  underlining every identifier in it in red is how a reader learns to turn spelling off entirely.
  The same `sourceLines()` set that already refuses those lines an alignment refuses them a
  dictionary.

## Blog surface (the public shell's own furniture)

- **One column per page.** `.s-blog-page` sets the measure (720px, 24px gutters; 18px on a
  phone) and everything inside it lives in that column. `.s-blog-article .s-marginalia`
  therefore clears comments.css's own `max-width: 760px` + 56px gutters, which in the app are
  the whole column and here were a SECOND column inside the first: measured at 1440 the
  marginalia block sat 435–994 against an article at 379–1050, so the MARGINALIA rule and
  heading were inset ~57px per side from the SHARE and RELATED headings directly above them,
  and at 390 the comment form threw away 28% of its width. Measured after: marginalia
  379–1051 and 18–372, identical to `.s-reading__content`, en and ar.
- **No separator before the tag chips** in `PostMetaLine`. The meta line wraps, and at 390 the
  chips went to their own line while the `·` stayed behind — every tagged card on the phone
  ending its meta line with a bare tick, the "separator with nothing on its far side" DESIGN.md
  forbids, reproduced on the marketing surface. A pill is its own boundary; `BlogDashboard`'s
  card had already made the same call. Verified at 1440/1024/768/640/480/390 × en/ar: every
  remaining `·` has something on its far side on the same line.
- **The byline follows the TITLE's script, not the chrome's.** The `h1` aligns itself with
  `dir="auto"`, so on an Arabic instance an English-titled post left the title hard left and its
  own date/word-count hard right — one heading split across 670px of empty ground. Four rules
  (chrome dir × title script) put the meta under the end of the title it belongs to;
  `flex-start` is the CONTAINER's start, which is why the RTL chrome needs the opposite keyword
  to reach the same physical edge. **The INDEX CARD gets the same four rules**
  (`.s-blog-entry__text--rtl`, set from `isRtlText(post.title)` exactly as the article head is):
  the fix landed on the article page alone, so the split it describes went on reproducing on every
  card of the home page — measured at 1440 on an Arabic instance, an English-titled card put its
  title at x=545 and its byline group at 849–1061, and now starts both at 545.
- **No keyboard legend on a touch device**, in the footer as well as in the app's empty state:
  `.s-blog-footer__hint` (the `Ctrl K` chip) is `display: none` under `(max-width: 700px),
  (pointer: coarse)`. Nothing is lost — the nav's search field is on screen at every width, and
  it is what the chip pointed at.
- **`bannerFallback: "generated"` produces a made thing, not a blur.** `generatedBannerCss()`
  now lays a deterministic hairline rule pattern (angle and spacing from the title hash, painted
  from `--text` at 7–9%, so it is the theme's own ink on any of the fifteen grounds) over the
  three hash-hued radial blobs. Three soft blobs alone read as an image that failed to load: a
  783×166 field with no edge anywhere in it, and index thumbnails that looked broken rather than
  abstract.
- **The generated banner is ONE SYSTEM, in the room's own palette.** Two things made it read as
  clip-art dropped into a manuscript. (1) Every hash hue now sits under a hard floor of
  `var(--accent)` (`color-mix(… var(--accent) 55%, <tinted hue>)`); `--banner-tint` alone let a
  theme opt out entirely (parchment at 0%), which is how iron-gall's gold-and-brown page carried a
  saturated green→yellow card. The hash still tells two posts apart — by where the warmth sits and
  how the field is ruled — and never by importing a colour the theme does not own. (2) `variant`
  is a SIZE, not a look: the thumb ran at 85% saturation and 2.1× strength against the hero's 62%
  and 1×, and the base layer was tinted for one and not the other, so the same post rendered as a
  saturated multi-hue diagonal on the home page and a near-flat brown wash at the top of its own
  article. One saturation, one accent floor, one base layer, one grain; the small size keeps a
  1.35× nudge because 130px of anything reads flatter than 780px of it.
- **A snippet STRIPS a tag, whole.** `stripInlineMd` removed the `#` and left the word standing,
  so a post ending "…it buys the reader a breath. #design #typography" shipped on the front page as
  "…it buys the reader a breath. design typography" — a nonsense noun phrase glued to real prose.
  DESIGN.md's hard rule is strip OR render; plain text cannot render a tag, so the whole token goes
  (the shape `isFurnitureLine` already uses). Search matching is unaffected: MiniSearch indexes the
  raw `body` and a separate `tags` field, not the stripped prose.
- **`--banner-tint` names how far the hash may pull the ACCENT, not how much accent to add
  back.** The generated banner's inner mix is
  `color-mix(in oklab, hsl(<hash hue>) var(--banner-tint, 0%), var(--accent))` — accent first,
  hue second. Written the other way round the token's floor value (0%, which parchment,
  sandstone, linen and solar all set, and which any theme that never declares it inherits by
  omission) meant the MAXIMUM foreign hue the outer floor allows — 45% — while the dark themes
  that "clamped hardest" at 45% imported the least. That inversion is why parchment, the theme
  the accent floor was written for, shipped a pink card beside a green one on a gold-and-cream
  page. Now 0% is pure accent, a theme that forgets the token is safe rather than maximally
  foreign, and every generated field on the four light themes is the room's own gold. Verified
  card-and-hero on iron-gall, parchment, cinnabar and lapis.
- **The tag-in-prose rule has a gate: `scripts/check-excerpt.mjs`**, documented in README beside
  the other gates. It writes a fixture whose body ENDS in a tag line (and whose first paragraph
  ends in two), then walks all three surfaces that share `stripInlineMd` — `/api/posts` excerpt,
  `/api/search` snippet, `/api/backlinks` context — for a de-hashed tag word, for a surviving raw
  `#tag`, AND for the sentence the tags were glued to, so a stripper cannot pass by deleting the
  paragraph. It needs no browser and deletes its fixtures however the run ends.
- **One label rule for every gesture that starts on a tree row.** `itemLabel()` (client/move.ts)
  is what the reader is shown; `MoveItem.name` stays the byte the API is called with. The drag
  ghost already used it — the Move-to picker's heading, the delete confirm's title (Sidebar and
  the palette's `delete-current` alike) and the delete toast did not, so one file wore two names
  inside two seconds: a row reading "Welcome" opening a dialog about "Welcome.md". The dialog
  BODY still prints the full path, because that sentence is about what happens on disk.
- **An empty public list says WHY it is empty, and never how much it is hiding.** With the
  languageFilter on, the blog's empty state adds one line naming the rule
  (`blogFilteredByLanguage`); `/api/me` carries `languageFilter` as a BOOLEAN policy flag and
  never a count, because a count of filtered-out notes is exactly the existence the filter exists
  to withhold. "Nothing published here yet." on an instance with twenty-one published posts is a
  true sentence about the list and a false one about the site.

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

## The site design engine (`publicLayout: "designed"`)

`settings.publicLayout` has a THIRD value. `"blog"` (the default) is the stock blog;
`"designed"` composes the visitor shell from a design document in `VELLUM_DATA/designs.json`.
Which one a session is SERVED is `servedLayout()` in `server/auth.ts`, not the setting: it
downgrades `"designed"` to `"blog"` whenever there is no renderable design, so the fallback
happens before the first byte and the browser never has to recover from a missing one.

**THE STOCK BLOG IS A PRISTINE, SEPARATE, ALWAYS-WORKING BASE, and that is checkable from the
diff.** `client/styles/blog.css` is untouched. `client/blog/*` is untouched except five lines in
`BlogShell`'s `ThemeButton`, which belong to the CUSTOM THEME feature rather than to this one
(`themeGroup`/`counterpartTheme` → `choiceGroup`/`counterpartChoice`, so the ☾/☀ button answers
for a custom theme as well as for the fifteen). The designed shell is a SECOND renderer beside
the first — `client/design/`, with its own routing, its own section components and its own
stylesheet, every class `s-dsn-*` — and the two meet at exactly one `if` in `App.tsx`. Nothing
in `client/design/` mutates, forks, subclasses, monkey-patches or re-styles a stock component;
what it DOES reuse is the product's shared, pure machinery (the reading renderer, the banner
helpers, the nav singleton, `formatDate`), because a second markdown renderer is the place an
XSS fix would fail to land.

**Switching is LOSSLESS in both directions.** The design lives in its own file and is never
consulted while `publicLayout` is anything else, so flipping to `"blog"` is a RESCUE — nothing
deleted, nothing migrated — and flipping back returns the site exactly as it was. That is what
lets the error boundary offer "back to the stock blog" as a one-click escape rather than a
decision. `scripts/shoot-design.mjs` asserts the round trip byte-for-byte.

### Why `designs.json` and not more keys in `settings.json`

Asked and answered, and the answer is not tidiness (the argument is written out at the head of
`server/designs.ts`):

1. `getSettings()` is on the hot path — `siteName()`, `siteLanguage()`, `publicLayout()` consult
   it per request through one mtime-cached parsed object. A design document is one to two orders
   of magnitude larger, and a dozen custom themes larger again.
2. `patchSettings()` rewrites the ENTIRE raw object on every save (by design — it preserves
   unknown keys). Nesting designs there means a one-character tagline edit rewrites every design,
   and one interrupted rename risks both.
3. Corruption has to be survivable INDEPENDENTLY. A corrupt `settings.json` already degrades to
   "env defaults in effect"; a corrupt design file must degrade to the stock blog — and if they
   are one file, a stray byte in a section's markdown takes the site name, the language and the
   publish configuration with it.
4. Versioning, migration and quarantine are file-level concerns `settings.json` has never needed
   and would grow only for this.
5. Export/import is a whole-file operation on a design and a nonsense one on settings.

What stays in `settings.json` is the one thing that IS a setting: `publicLayout`. WHICH design is
active lives beside the designs, so a renamed or deleted design cannot leave `settings.json`
naming something that is not there.

`designs.json` is `0600`, written write-then-rename with a per-writer tmp name, and read through
an mtime-checked cache — the three properties `settings.ts` documents next door, for the same
reasons.

### The schema, migration and quarantine

`DESIGN_SCHEMA` (`shared/design.ts`) is the version this build authors and renders, and a
document declares its own — PER DOCUMENT, not per file, because an imported design carries its
own and one stale import must not quarantine the designs beside it. There are exactly three
outcomes and never a fourth:

- equal → validated and rendered;
- older with a registered step in `MIGRATIONS` → migrated, then validated. The step that exists
  today is `0 → 1`: a document with no `schema` key at all, which is what a hand-written or
  third-party design looks like. Nothing in it can be MISunderstood — the fields we do not find,
  validation supplies — so it migrates rather than quarantining;
- anything else (older with no step, or NEWER than this build) → **QUARANTINED**: kept on disk
  byte-for-byte, never rendered, listed in the panel with the reason. A design authored by a
  newer Vellum must not be rendered "as best we can": this build would silently drop the keys it
  does not know, and a public homepage losing a section without anybody being told is precisely
  the invisible failure the whole feature is written against. `persist()` writes a quarantined
  row back exactly as it was read.

**Validation is a strict allowlist twice over**: an unknown section `kind` is a 400 naming it,
and an unknown KEY inside a section is a 400 naming it (`KIND_KEYS`). Every value is
range-checked, every string is stripped of control characters and bidi overrides
(`shared/bidi.ts` — this text renders into the public page beside note titles), an image
reference must be an `https://` URL or a safe vault image path, and a CTA link must be
site-relative or `https://` — a homepage button is not a place that accepts `javascript:`.
Prototype keys (`__proto__`, `constructor`) hit the allowlist like any other unknown key.

**A REJECTION IS A NAMED 400, AND THERE ARE TWO CLASSES THAT MAKE ONE.** `shared/design.ts` throws
`DesignError(path, …)` for the document tree; `shared/designChrome.ts` throws its OWN
`DesignError(path, code, …)` for the chrome, and `validateDesign()` calls `validateChrome()`, so
both escape from a single write. `server/designs.ts::bad()` knew only the first, so every chrome
rejection failed the `instanceof` test, was rethrown, and reached the generic handler as a **500
with no message** — one file rejecting two different ways depending on which half was malformed,
which is the opposite of what this section promises. Measured then: a bad nav `kind`, a nav nested
three deep, `{"kind":"url","target":"javascript:alert(1)"}` and `{"typography":{"baseSize":"big"}}`
all answered 500 `{"error":"Internal server error"}` while a bad section answered a correct 400
naming the path. `isRejection()` now lists every class a validator is ALLOWED to throw, by name,
in one predicate — `DesignError`, the chrome's (imported as `ChromeError`), `ThemeError`,
`QuarantineError` — and the same import fixes the quarantine reason a step below, where a
hand-written `designs.json` with a bad nav item listed as "unreadable design (…)" instead of its
own sentence. Measured after: `nav.items[0].kind must be one of: home, note, page, topic, url,
group`, `nav.items[0].target must be an http(s) or site-relative URL`, `typography.baseSize must
be a number`, each a 400.

**"Every string" MEANS BOTH VALIDATORS, and for a while it meant one.** `shared/design.ts` stripped
bidi in `text()` and `block()`; `shared/designChrome.ts::strictText` — the validator behind every
nav label, group label, footer column title, footer entry label and `footer.copyright` — stripped
only `[\u0000-\u001f\u007f]` and let `U+202A–202E` / `U+2066–2069` through, as did `cleanText`
beside it and the custom theme's `name` (whose own doc comment claimed otherwise). Measured: a
design imported with the nav label `"safe\u202Eevil"` and the copyright `"\u2066hidden\u2069 c
2026"` stored both intact, `GET /api/design/public` handed both to a cookieless visitor, and the
public header drew that menu item as `safelive`. A design document — including one imported from a
stranger's `.json`, which is the same file as a shipped preset — could put a label on the public
header whose displayed text differs from its stored text and which reorders the glyphs after it.
The codebase already knew the rule; one validator was missed. `designChrome.ts` now imports
`shared/bidi.ts` (which is purer than it is: a regexp and a replace), and so does `customTheme.ts`.

**The client validates AGAIN before it renders a byte**, with the same shared validator. A
`designs.json` edited by hand past the API is a supported way to configure this product (it is
the same escape hatch `settings.json` has), and a server one build ahead of a cached bundle is a
real state; neither may put a malformed section in front of a visitor.

### Routes

Mounted at `/api/design` from `server/api.ts`, BELOW `authGuard`, so every mutation is already
401 to a visitor and to an admin wearing the preview header. Reads add their own gate —
`assertAdminRead()` answers **401** under preview mode, which is the honest answer to "may I read
the design panel while asking to be treated as a visitor".

- `GET /api/design` — the admin overview: designs (with quarantine reasons), themes, the section
  kinds and the token table the panel builds its menus from, and `posts` — the VISITOR's feed, so
  the previews draw the site the design will actually print rather than the list this session can
  read (see "Preview content" above).
- `GET|PUT|DELETE /api/design/docs/:id`, `POST /api/design/docs`,
  `POST /api/design/docs/:id/{duplicate,reset}`, `GET /api/design/docs/:id/export`,
  `POST /api/design/docs/import`, `PUT /api/design/active`.
- `POST /api/design/themes`, `PUT|DELETE /api/design/themes/:id`.
- **`GET /api/design/public`** — visitor-safe, and the one route with a per-session shape.
- **`GET /api/design/themes.css`** — the generated custom-theme stylesheet. In `OPEN_PATHS` for
  `custom.css`'s reason: pure styling, no vault content, and the login page of a `PUBLIC=false`
  instance should be painted in the colours that instance chose. `immutable`, because its link
  carries a content signature as `?v=`.

**`/public` blanks a `note` section's PATH for a session that may not read it** rather than
dropping the section. Both halves matter: the path never travels, so a design cannot become a
"does this note exist" oracle for the publish set or the language filter; and the section still
ARRIVES, so the renderer meets something it cannot render and the boundary does what it does for
every other broken design. Dropping it instead would have shown visitors a silently shorter
homepage — the invisible state this product keeps refusing.

### THE ERROR BOUNDARY

A correctness feature, not a nicety, and it is gated: `scripts/shoot-design.mjs` breaks the site
three ways on purpose and measures what each session gets.

An invalid config, a deleted note a section points at, or a render-time throw all end in one
answer:

- **a visitor** gets `<BlogShell />` — the stock component, unmodified, no props — automatically.
  Never a blank page and never a stack trace. The gate measures rendered TEXT, not markup length,
  because "blank" and "slow" look identical otherwise.
- **the owner** (an admin previewing their own site, `store.previewVisitor`) keeps the designed
  page with the failing section replaced by a card that NAMES it, under a strip carrying
  "Back to the stock blog" — which is `PATCH /api/settings {publicLayout:"blog"}` and nothing
  else, so it is lossless.

The boundary is **per section**, not per page: a boundary that catches everything can only say
"something broke", and React only knows which child threw if the boundary is that child's own
parent. Boundaries are keyed on `design.updatedMs`, so a fixed design clears every failure card
without a reload.

**Three doors reach it, and the server closes two of them earlier.** A corrupt or quarantined
store never reaches the browser at all (`servedLayout()`), and `/api/me` carries a
`designNotice` to a REAL admin session — never to a visitor, never to an admin in preview — so
the owner is told in the app, where they actually are, rather than only on a page they are not
looking at. That notice also covers the case the server can see and the boundary cannot reach in
time: a valid design whose `note` section points at a note that has since been deleted,
unpublished or language-hidden.

### Custom themes (`custom:<slug>`)

A custom theme is **not a sixteenth block in `tokens.css`** and never becomes one. It is
`{ base, tokens }` — one of the fifteen plus a SPARSE map of overrides — applied by putting the
BASE's id on `<html data-theme>` and the theme's slug on `<html data-custom-theme>`, which
`/api/design/themes.css` keys at `:root[data-custom-theme="…"]`. That selector is (0,2,0) against
`[data-theme="…"]`'s (0,1,0), so an override wins and nothing else moves. Three consequences, and
each is why this shape beat "generate a whole theme block":

- `tokens.css` is never rewritten, never parsed, and never shipped to the server;
- a theme that overrides four tokens stays four tokens on disk, so "reset this token" is a
  DELETE rather than a re-derivation, and an upstream retune of the base reaches every custom
  theme built on it;
- a base theme removed from the product is a loud validation failure at read time, not a room
  with half its tokens missing.

`client/design/customThemes.ts::applyThemeChoice` is the ONLY writer of both attributes — the
picker's live preview, the store's `setTheme` and the builder's preview all go through it.

**The id is `custom:<slug>` everywhere a theme id is spoken**: `settings.defaultTheme`,
`DEFAULT_THEME`, `localStorage["vellum.theme"]`, the picker, the palette dot. The prefix is what
lets every existing `isTheme()` guard keep meaning exactly what it meant (a BUILT-IN theme) while
new callers ask `isThemeChoice()`. `client/themes.ts` grew `choiceGroup` / `counterpartChoice` /
`choiceBase` / `choiceLabel` for the surfaces that must cope with both; `Theme` is unchanged.
`readEnvTheme()` accepts the SHAPE at startup (it runs before `dataDir()` has a value, so
`designs.json` cannot be consulted without a cycle) and `/api/me` withholds a `defaultTheme` the
instance no longer has. `PATCH defaultTheme` checks existence, because a default theme naming a
deleted one is a public site quietly painted in the fallback.

**A stylesheet refresh needs a fresh SIGNATURE, not just a fresh registry.** The route is
`immutable`; refreshing the theme list after a save while leaving the link's `?v=` alone means
the browser answers from cache and the theme just saved renders as its bare base — measured
exactly that way (`data-custom-theme="foxfire"` on the document, `--accent` still nocturne's).
`reloadCustomThemes()` computes the signature with the SAME shared function the server uses, so
no round trip is needed to learn a string both sides can derive.

**Deleting is guarded**: a theme a design still names is a 409 naming the design — the same
in-use rule the font routes follow, because a dangling reference is a site rendered in a theme
nobody chose.

### The contrast rules are ONE implementation

`shared/contrast.ts` holds the sRGB luminance, the WCAG ratio, the CIELAB conversion, the CIE76
ΔE and every floor. `scripts/check-contrast.mjs` imports it (Node runs `.ts` directly) and so
does the theme builder, which prints the same warnings live while an author drags a colour. A
builder carrying its own copy of the formula is a builder that will one day bless a theme the
gate rejects — and that is the theme that ships.

The gate also gained a ground it never had: **`--text` and `--text-muted` are now checked against
`--bg-hover` as well**, because `--bg-hover` is a real ground (DESIGN.md paints the sidebar's tag
pills and the backlink cards on it at rest) and both tokens clear it in all fifteen themes —
worst measured 5.62:1 muted, 12.27:1 text. **`--text-faint` is deliberately held to two grounds**
(`FAINT_GROUNDS`): faint-on-hover measures 2.73–3.00:1 in twelve of the fifteen, and that is not
twelve bugs — DESIGN.md already names `--bg-hover` as the tag pill's ground and says in the same
breath that faint measures 2.7:1 there, which is exactly why the pill's COUNT is `--text-muted`.
Adding the third ground would have failed twelve shipping themes to enforce a rule the product
does not have; the rule it does have — faint never carries reading text — is already enforced on
the two grounds faint is painted on.

### The builder

`client/components/ThemeBuilder.tsx`, mounted on `<body>` like the theme picker and the toast,
opened from the picker's header ("New custom theme") and from a pencil on each custom row.

- **The preview is the app.** Edits are written to a `<style>` element under a reserved
  `__preview` id and applied to the live document — the picker's rule, for the picker's reason.
  The CSS comes from the SAME generator the server serves, so what is on screen is byte-identical
  to what will be served after Save. Closing restores the theme that was in force.
- **The base is chosen by looking at it.** Fifteen swatch cards painted from the CONSTANT
  `--swatch-<id>-*` tokens, not a `<select>` — the rule the settings panel states about native
  chrome, and the same argument the theme picker makes about naming fifteen pigment nouns with
  nothing saying what any of them looks like.
- **Unset is a real state.** Every row shows the value it INHERITS and offers a reset that
  deletes rather than re-derives. The inherited values are read off the live document through a
  probe element carrying `data-theme`, never from a table in the client: a second definition of
  fifteen themes would go stale the first time one is retuned, and the probe also picks up a
  `custom.css` that legitimately changed a base.
- **The warnings are the gate**, in words, above the controls that cause them, with a dot on any
  token group holding a failure. A rule the author cannot see is a rule they will break.
- Export writes a `vellum.theme` JSON file; import reads one into the DRAFT (never straight into
  the store), so the author sees what arrived, live, before anything is saved.

### Presets (`shared/presets.ts`, `shared/presetCatalog.ts`)

**A preset is a design document that happens to live in the repo.** Not a template language,
not a partial, not "starter options" the designer interprets — the same `sections`, the same
`chrome`, the same `article`, the same validator. A preset that renders wrong is a design that
renders wrong, debuggable with the tools that already exist, and a section kind added to
`shared/design.ts` reaches every preset without a second vocabulary to teach it.

**APPLYING A PRESET IS AN IMPORT, and there is no preset route.** `presetExport(preset, lang)`
produces exactly the `vellum.design` envelope `POST /api/design/docs/import` already takes, so
the whole apply flow is two lines in the panel:

```ts
const doc = await importDesignDoc(presetExport(preset, language));
openDraft(doc);
```

Every property the word FORK is meant to buy falls out of a route that shipped before presets
existed: a free id, fresh `createdMs`/`updatedMs`, strict validation, custom themes remapped
under fresh slugs, and nothing the instance already has overwritten. **No new server code, no
new endpoint, no server knowledge of presets at all** — that is the design, not an economy. Two
consequences worth naming: a preset file and an exported design are THE SAME FILE (a `.json` a
stranger wrote behaves identically to a shipped one, and a design an author built can be handed
back as a preset), and **the forked document remembers nothing**. There is deliberately no
`presetId` on `DesignDoc` and there must not be one: it is a `DOC_KEYS` change — a schema bump —
bought for a breadcrumb nobody can act on, and the person who adds it is the person who will then
write "reapply the preset", which is the live link the whole shape exists to refuse.

**Three rules bind every shipped preset, and `assertCatalog()` enforces the ones it can at import
time** (duplicate id, empty or un-Arabic copy, a section or nav item naming a note):

1. **A PRESET IS PURE FORM.** Every text field it could set — section headings, the hero's own
   heading and sub, a CTA's words, `footer.copyright`, nav labels, rich-text bodies — is LEFT
   EMPTY, and the renderers already know what empty means (hero → the site name and tagline,
   empty heading → no heading, empty copyright → the instance's own footer line, empty CTA label
   → the localized "Read more"). It has to be this way: `Section.heading` is a plain string with
   nowhere to put a second language, so a preset that typed "Latest writing" would ship an
   English word into an Arabic instance and a stranger's voice into everybody's. The shape is
   ours; every word on the page is the owner's. It is also why fifty-nine presets are cheap to write
   and impossible to mistranslate.
2. **A PRESET NAMES NOTHING IN THE VAULT.** No `note` section, no `note`/`page` nav item, no tag
   filter, no image path — a shipped design cannot know what is in somebody else's vault, and a
   preset that guessed would render as the owner's very first error card. It leans on the
   fallbacks that already exist: `nav.fallback: "topics"` fills the menu from the busiest
   published tags, and list/grid sections read every published post. A fresh install gets a
   furnished site.
3. **A PRESET NAMES A THEME** — one of the fifteen, because the layout was drawn against it. It
   applies on FORK, and then only to readers with no stored preference, which is `DesignedSite`'s
   existing rule.

**Names and blurbs are DATA, not dictionary keys.** `{ en, ar }` pairs travel inside the preset.
Fifty presets as dictionary rows would be a hundred entries `check-i18n` can only see as dead
keys, and adding one preset would mean editing three files. The chrome AROUND the gallery — the
eight family labels, the buttons, the empty state — goes through `t()` like everything else, from
a LITERAL `Record<PresetFamily, I18nKey>` table for `TYPE_LABEL`'s reason.

**The catalog is a dynamic `import()`** (`loadPresets()`), so fifty-nine layouts are a chunk the admin
fetches when the designer opens rather than bytes on a visitor's first paint.

**`presetCatalog.ts` is an ORDERING, not a list.** The designs live in one module per shelf —
`presetsEditorial`, `presetsMinimal`, `presetsBrutalist`, `presetsJournal`, `presetsPortfolio`,
`presetsDocs`, `presetsAcademic`, `presetsGarden`, `presetsLanding`, `presetsGallery`,
`presetsLetter` — and the
catalog spreads them in `PRESET_FAMILIES` order with the four originals leading their families.
Two families are served by more than one module and both splits are editorial: `minimal` holds
the narrow essay shelf (560–780px, quiet weights) and then the wide, heavy, uppercase half
(1040–1400px) that reads as the same argument made the opposite way, and `reference` holds
documentation, then research, then the digital garden. A module is five designs because five is
what one person can hold in mind while checking that no two of them are the same design in
different clothes — the review that actually keeps a catalog this size honest, and the reason
the file boundary is a SHELF rather than an alphabet.

`MAX_DESIGNS` still applies: applying a preset is creating a design, and the 24-design cap
answers with the sentence it already has.

### A POST SECTION HAS NO OFFSET, and that is a catalog rule (`check-presets.mjs`)

`pick()` is `filtered.slice(0, limit)` — from the top of the same feed, every time. So any two post
sections in one design OVERLAP, and the only question is whether the overlap reads as an archive or
as a stutter. The rule: **at most two post sections, and the index at least twice the feature.**

The threshold is `index ≥ 2 × feature` rather than a round number because that is the line a READER
can see — the second section has to add at least as many posts as it repeats, or it is the same run
again with a few rows on the end. Three post sections cannot satisfy it at all (the third always
repeats one of the first two) and are refused outright.

Measured against a real vault before the rule existed, and every one of these shipped:
`commissions` printed nine projects and then an "archive" of ten — one new post; `herbarium`
stacked two grids of nine and eight; `showreel` carried a lead frame, a strip AND an index, so the
newest post appeared **three times on one page** (21 headings from 13 posts). A design whose front
page prints the same essay three times is the first thing an author sees and the last thing they
forgive, and no amount of reading the JSON catches it — only rendering it against posts does.

### The catalog gate (`scripts/check-presets.mjs`, `npm run check-presets`)

`assertCatalog(PRESETS)` runs at the bottom of `presetCatalog.ts`, which means it runs when the
MODULE LOADS — and the module is a dynamic `import()` fetched the first time an admin opens the
designer. A duplicate id or an un-Arabic blurb therefore failed no build; it threw inside the
gallery's chunk, in front of the one person about to browse fifty-nine designs. A catalog is data
in the repo: no author is present when it breaks and no user can report it usefully. It needs a
gate that runs with the other gates, and this is it — no server, no browser, milliseconds.

It checks three tiers, and the middle one is the reason it exists:

1. **What `assertCatalog` already knows**, imported and never re-implemented — a second copy of a
   rule is how a gate and its product come to disagree.
2. **What only a gate can see.** Every family is served (above). Every typography number survives
   `normalizeChrome()` — the normalizer SNAPS out-of-range values instead of throwing, so
   `scale: 1.5` (the cap is 1.414) renders as a design nobody chose and nothing says a word. The
   bar is HALF A STEP, not equality: rounding onto the slider's own grid is what an author means,
   being overruled by the bounds is not. Every theme named is one of the fifteen; every width is
   inside `MIN_WIDTH…MAX_WIDTH`; and **every preset survives `validateDesign()`**, which is the
   apply flow exactly — a preset the import route would reject is a preset whose first click is an
   error toast.
3. **Rule 1, mechanically** — a preset is PURE FORM, so every copy field it could set is empty.
   This is the rule most likely to be broken by somebody being helpful.

The shape+width collisions it prints are a NOTE, never a failure: two designs may legitimately
share a skeleton and differ in palette, columns and type (`casebook`/`lyceum` do), and that is a
judgement for a person rather than a threshold.

**The collision key is what a 200px card can RESOLVE, and it used to be finer than that.** It was
`kinds.join(">") + "|" + exact px width`, so `casebook` (1160) and `vitrine` (1120) — visually the
same card — slipped through on forty pixels nobody can see, and the gate printed ONE collision
where a reader measured six. The width is bucketed into the three bands a silhouette actually has
(narrow ≤780 / mid ≤1080 / wide), a `postGrid`'s column count and its banner flag are folded in (a
2-across and a 4-across grid are two pictures; a grid with photographs and one without are two
shelves), and a hero's height with them. It now reports seven — the six a reader measured
(`quiet-page`/`measure`, `daybook`/`preprint`, `casebook`/`vitrine`, `commissions`/`lyceum`,
`compendium`/`thicket`, `overture`/`envelope`) and `billboard`/`broadside`, which the hero fold
caught and the eye had let pass. Seven twins out of fifty-nine is a better hit rate than most
shipping theme galleries, which is why it is a note.

### Thumbnails: a REAL RENDER in the grid, a CSS miniature while it arrives

The choice was between three, and only one of the losers stayed lost.

- **Shipped screenshots** are accurate and dead. Fifty PNGs at two densities is megabytes in a
  public repo that must be REGENERATED whenever a token moves, and every one is painted in
  whatever theme the machine that shot it was wearing — so a reader on `nocturne` browses fifty
  pictures of `parchment`. Still refused.
- **`DesignThumb`** (`client/components/design/DesignThumb.tsx`) draws the design as CSS: its
  header layout, density and hairline, its column width as a percentage of the canvas, its actual
  section list in its actual order, with the artwork coming from `generatedBannerCss()` — the
  function the product already uses for a banner-less post, already deterministic per seed,
  already painted out of the theme's own tokens. **Zero bytes in the repo, no fetch, ~40 nodes a
  card, and it repaints on a theme switch because it never named a colour.** Every dimension is
  in `cqw` against `container-type: inline-size`, so one coordinate system is correct at 160px and
  at 400px with no media query and no JS measure.
- **Fifty-nine live canvases** was refused as "several thousand nodes mounting while somebody
  scrolls" — and that was the wrong number to be afraid of, because a reader can only see six.

**THE PICTURE IS REAL, AND IT IS REAL AT REST.** Every card in or near the viewport draws a
`<DesignCanvas>` — the actual header, the actual sections, the operator's own posts and their own
banner PHOTOGRAPHS, at 1120px, scaled into the card, in the PRESET's own theme. The wireframe is
now the PLACEHOLDER: what a card shows before it arrives and while it is being flung past.

The old arrangement — fifty-nine wireframes in the operator's one hue, with a real render bought
only for the single card under the pointer — is what made this read as a settings form with
pictures rather than as a template gallery. The `gallery` family, five presets whose entire
premise is photographs, rendered as five identical pale rectangles on a vault holding eight real
banner images; the honest render was already written and was being refused to fifty-eight cards
out of fifty-nine. WordPress, Ghost and Squarespace all lead with a real rendering in the theme's
own colours.

**What keeps it affordable is that "visible" is a small number.** An `IntersectionObserver` with
a `400px` root margin mounts a canvas a screen BEFORE it is needed and unmounts it 600 ms after it
leaves, so the document holds the two or three screens around the reader rather than fifty-nine
trees; a card must dwell 90 ms in that band before it pays, so a fling through the catalog mounts
nothing it flies past. Measured on a ten-post vault at 1440×900: 59 cards, 14 live canvases, 10
distinct preset themes on screen at once and 19 real `/api/file` banner backgrounds — with no
pointer anywhere near the grid. A browser with no `IntersectionObserver` draws everything: a
gallery of blank cards is the one outcome worse than a slow one.

**Why the wireframe is still worth having.** A scaled screenshot of a real page at 200px is a grey
smear with an unreadable word on top, and the miniature answers the one question that size can
answer — what shape is this, how much air does it have — for the fraction of a second before the
canvas lands. It is the same argument as before, applied to the moment it is actually true of.

**The MINIATURE is painted in the ACTIVE theme; the CANVAS is painted in the PRESET's.** A
wireframe in somebody else's palette would be a colour riot with no information in it; a real
render in the operator's palette would be a lie about the design, which is the disagreement the
preview blockers were all about. Each card also names its theme in WORDS beside the swatch
(`s-dsgp-card__themename`): the dot is `aria-hidden` decoration, and a `title` is a tooltip, which
is not a label on a touch screen and not a label to a screen reader.

### `DesignCanvas` — any design, any width (`client/design/DesignCanvas.tsx`)

The component that closed the gap named in the design engine's own notes: the panel's LIVE
PREVIEW drew the chrome around a typography SPECIMEN, so every control that shapes the composed
page changed nothing on screen.

**`route: "article"` IS THE ARTICLE PAGE, NOT THE SPECIMEN** — the other half of the same gap,
and it stayed open one round longer. Drawing a bare heading ladder there left all five
`DesignArticle` switches (Banner, Date and reading time, Tags, Related posts, Back link) with no
visible effect anywhere in the product: five toggles and no preview. The route now renders
`DesignedArticle` — the renderer the live site uses — against `PreviewContent`, so the furniture
is the design's own and every switch moves something on screen. Two things differ from the live
path and both go through `usePreviewContent()`, the seam a `note` section and a `postGrid`'s
banners already use: the body is the SPECIMEN prose (assembled from the same `designSpecimen*`
keys the old block used, so a type control still shows the sizes, the measure and the rhythm and
there is not one new string to translate) instead of a fetched note, and the page does not write
`openPath` — a picture of an article is not a page anybody navigated to. The specimen survives as
the fallback for a preview with no posts at all.

```ts
<DesignCanvas
  design={DesignDoc}          // the draft, a stored design, or presetDesignDoc(preset, lang)
  content={PreviewContent}    // what the sections read instead of the live vault
  width={1120}                // px to LAY OUT at, before scaling (CANVAS_WIDTH)
  fit="scale" | "native"      // transform to the box, or let the box be the viewport
  route="home" | "article"
  clipHeight={860}            // px of laid-out height to keep, with a fade at the cut
  ownTheme                    // paint the design's theme on the canvas box
                              // (built-ins only — a custom theme is keyed at
                              //  :root; the FRAME is where one can be honoured)
  live                        // it is in a REAL viewport (the preview frame):
                              // hoverable, and sticky is honoured
  label="…"                   // it is role="img"; everything inside is aria-hidden
/>
```

Three properties, each load-bearing:

1. **It is the real renderer.** `DesignHeader`, `RenderSection`, `DesignFooter`,
   `typographyVars`, the `.s-dsn` scope, `--dsn-width`. Not one line of section markup is written
   twice — a preview assembled from a simplified copy is a preview of the copy, and every
   divergence is a bug the author finds after publishing.
2. **It lays out at a width and scales the PIXELS.** `width: <width>px` then
   `transform: scale(box / width)`, remeasured by `ResizeObserver`. A 200px card and a 900px pane
   show the SAME page at two sizes — not two responsive breakpoints, which is what a narrow box
   would show and would be a lie about what a reader sees. `fit: "native"` drops the transform and
   lets the pane's own width be the viewport; that is the designer's pane, where an author is
   reading their own type rather than judging a shape from across the room.
3. **It is inert and it cannot take the panel down.** No nav handler (the site owns the address
   bar; a preview inside the app must not), `pointer-events: none` inside, and every part wrapped
   in the same `DesignBoundary` the live site uses — a broken preset renders a caption in the
   card instead of unmounting the designer.

Two details that were bugs before they were rules:

- **The click swallow is SCOPED to the canvas.** A canvas is routinely mounted inside a button (a
  gallery card is one), so an unscoped `closest("a,button")` finds the CARD, swallows its click,
  and the preset can be hovered but never chosen. Only a link that is a DESCENDANT of the canvas
  is swallowed.
- **`.s-dsn` is the live site's SCROLLER** (`height: 100%; overflow-y: auto`). Inside a canvas it
  is a block in somebody else's layout, and inheriting those two rules clipped every design to its
  own header. `presets.css` overrides them under `.s-dsgv` only — the live shell keeps its
  scroller.
- **`sticky` is dropped inside a SCALED canvas.** `position: sticky` resolves against the nearest
  scroll container, which inside a `transform: scale()` wrapper is the transformed element itself:
  the header would pin where the reader is not looking. A preview that draws a header in the wrong
  place to honour a switch is worse than one that draws it right. `live` is the one case where the
  canvas has a scrollport of its own — the preview frame's document — and there the switch is
  previewed rather than deferred.

### Preview content — real posts first, generated artwork second

`client/design/previewContent.tsx`. Two of the real section renderers reach OUTSIDE the design
for their content: `note` fetches a note, and `postGrid` asks the store whether missing banners
should be generated. A preview must answer for both without a second copy of either component,
so the seam is **a React context, not a fork**: `usePreviewContent()` is `null` on the live site —
which is every path those files had before — and a reviewer finds every place a preview differs
from production by grepping for that one hook.

```ts
interface PreviewContent {
  posts: PostMeta[];            // the VISITOR'S feed, in its own order, padded to 8
  pages: PageMeta[];
  notes: Map<string, string>;   // note bodies supplied instead of fetched
  noteMode: "fetch" | "sample"; // designer previews the real note; the gallery never fetches
  forceGeneratedBanners: true;  // in every preview, see below
  synthetic: boolean;           // any row was invented — the gallery says so, once, quietly
}
```

Where the content comes from, and this is the half that makes a fresh install compelling:

- **The owner's own posts first — as a VISITOR will get them.** Real titles, real dates, real
  banners, real reading times, in real order. A preset previewed against six of your own essays is
  a decision you can make; the same preset against "Lorem ipsum" is a screenshot.

  **The list comes from `GET /api/design` (`overview.posts`), never from `/api/posts`,** and that
  is a correctness rule rather than a tidy-up. `/api/posts` answers for the SESSION and for the
  layout that is live: to an admin it is unscoped, and `staticPagesActive()` is false while
  `publicLayout` is still `"blog"` — which is exactly the state an operator is in while building
  their FIRST design, before they switch, and exactly what the panel's own banner says ("The
  public site is not on your design yet"). So every preview and all fifty-nine gallery cards
  opened with the author's Contact, Colophon and About PAGES as the newest articles, plus any note
  the language filter hides from every visitor. The overview's list is
  `posts(true, languageScope(c, true).lang, true)` — visitor scope, the visitor's language scope,
  and pages excluded unconditionally, because a designed site never lists a page as an article
  whatever `publicLayout` says today. Measured on a vault of 12 published notes with `layout=blog`:
  `/api/posts` 12 rows led by Colophon and About, `/api/design.posts` 10 rows led by the newest
  essay.
- **Generated artwork wherever a banner is missing**, from `generatedBannerCss()` — deterministic
  per title, painted out of the ACTIVE theme's tokens, repainting on a theme switch with nobody
  re-rendering anything. `forceGeneratedBanners` is on in every preview even when the instance
  turned generated banners OFF, because an author still has to see what a banner grid does before
  they choose one, and a fresh install would otherwise judge every image-forward preset by a
  column of empty rectangles.
- **Sample rows only to make up the numbers**, to `PREVIEW_MIN_POSTS` (8) — enough for a
  three-across grid with a river under it. Their copy is dictionary copy (`pv*`, en + ar like all
  chrome) and their paths carry `SAMPLE_PREFIX` (`__vellum-sample__/`), a path no vault surfaces.
  **The padding rule is "top up", never "replace"**: real posts keep their real order and their
  real position and samples are APPENDED. A preview that put invented rows first would show an
  author a front page whose lead story is a fiction, which is the one thing a design preview may
  not do.

### The live preview: a frame, a device and a clock

`client/design/PreviewFrame.tsx` + `client/components/design/PreviewStage.tsx`. The designer's
right-hand pane is not a canvas in a box — it is the composed site **in a nested document of its
own**, at a width the author picks, settling on the trailing edge of their edits.

**The pane is an `<iframe>`, and a div is a lie in three places.**

1. **Media queries answer the WINDOW, never the box.** `design.css` carries
   `@media (max-width: 700px)` — the rule that drops the designed grid to one column and lifts
   every target to 44px. A 390px div inside a 1440px window matches none of it, so a "phone"
   preview built from a narrow div is the DESKTOP design squeezed into a phone's width: the one
   picture of a phone guaranteed to be wrong. Measured in the frame at 390: grid
   `354px` (one column), topic chip 44px, document overflow 0.
2. **The app's cascade reaches into the pane.** In one document the visitor surface and the admin
   chrome share `:root`, the scrollbar rules and every selector anybody writes for the designer
   later. The frame inherits the app's stylesheets DELIBERATELY, by cloning them, and inherits the
   panel's accidents not at all.
3. **`position: sticky` needs a scrollport.** A scaled canvas has none it can honour, which is why
   `DesignCanvas` drops stickiness; a frame has one, so `live` canvases emit `s-dsn--sticky` /
   `s-dsg-top--sticky` and the switch that turns it on finally has a preview.

**`about:blank`, not `srcdoc` and not a route.** The shell's CSP is `frame-src 'none'` and stays
that way. That directive is checked on frame NAVIGATIONS: `srcdoc` and any URL are refused, while
a frame with no `src` is the initial `about:blank` — not a navigation, and it inherits the
parent's origin (so the portal can reach in) and the parent's policy (so nothing inside is more
privileged than the app). Verified in Chromium: the frame renders with the shipped header intact.
**And no `<base>` element**: `about:blank` inherits its creator's base URL by spec — banners
resolve to `/api/file?path=…` on the app's origin with no base present — while `base-uri 'none'`
refuses the element and logs a violation on every open.

**The stylesheets are CLONED from `document.head`**, `<link>` by href and `<style>` by text, under
a `MutationObserver`. **The sync is a keyed DIFF, not a rebuild**, and that is not an
optimisation: a cloned `<link>` applies asynchronously even from cache, so re-cloning the whole
head hands the frame a moment with the old sheet removed and the new one unapplied — a flash of
raw HTML in the middle of the panel, which is exactly what a screenshot caught the first time the
head changed with the designer open. Nodes still present are left alone (never re-appended
either — re-inserting a link re-runs its fetch); only arrivals are cloned and only departures
removed. For the same reason **the page inside starts hidden** and is revealed when the first
sheets answer, or after one second so a sheet that 404s never leaves an empty pane
(`data-vellum-ready`, asserted by the gate — invisible is worse than unstyled).
One place knows what CSS this build has and it is the head: cloning it brings
`tokens.css`, the generated custom-theme sheet, an operator's `custom.css`, uploaded `@font-face`
blocks and Vite's dev-injected styles, forever, with no manifest to keep in sync. `data-theme`,
`data-custom-theme`, `dir` and `lang` are mirrored off `<html>` by a second observer, so a theme
switch behind the panel repaints the preview (measured: `parchment` → body `rgb(242,235,218)`)
and an Arabic instance previews an RTL site.

**THE DESIGN'S OWN THEME OVERRIDES THE OPERATOR'S, over those two attributes and no others.**
`design.theme` is FORCED on every reader who has not chosen one — it is literally what a
first-time visitor sees — so a pane painted in the operator's theme is a preview of a site nobody
will be served. Measured before this: an operator on `iron-gall` applied Front Page (`linen`) and
the editor drew it DARK while the live page was light, and the gallery card that sold it was a
third colour again — a three-way disagreement inside one session, in the one pane the whole
editing session happens in. `PreviewFrame` takes `ownTheme`, `themeChoiceAttrs()` (the value form
of `applyThemeChoice`, one decision written by two callers in two documents) says which two
attributes a choice means, and the frame is the one preview surface that can honour a `custom:`
choice as well as one of the fifteen, because the generated sheet keys `:root[data-custom-theme]`
and the frame has a root. `dir` and `lang` stay the INSTANCE's — a design does not choose the
language its site is written in — and a design that names no theme mirrors the app, which is the
honest drawing of "the reader's own". A theme change is a REPAINT of two attributes, never a
document rebuild: the clones, the observers and the author's scroll position all survive it.
Measured end to end: operator `iron-gall`, design `porphyry` → frame `porphyry`, and a cookieless
visitor's `<html data-theme>` is `porphyry` with the same body ground, `rgb(27,20,26)`.

**The scroller is put back where the live site keeps it.** `app.css` clips `html`/`body`/`#root`
— the app grid owns all scrolling — and the visitor's designed page scrolls inside `.s-dsn`.
Both sheets are cloned in, so a frame that let the DOCUMENT scroll would be a frame nothing can
scroll. The reset restores `.s-dsn` as the scrollport under `.s-dsgv--live`, which makes the
frame the visitor's arrangement exactly: same scroller, same sticky, same overscroll.

**Nothing inside a preview acts, and the swallow lives in the FRAME.** React's synthetic events do
not cross a document boundary — a portal's listeners are on the root container in the outer
document, and an event inside the frame bubbles to `about:blank`'s window and stops — so
`DesignCanvas`'s own `onClickCapture` is correct and inert in there. The frame's document carries
capture-phase `click`, `auxclick`, `submit`, `dragstart` and Enter/Space handlers instead.
Sequential focus never enters (`tabindex="-1"` on the frame, `aria-hidden` on the page inside):
everything in there is a copy of a control the panel already offers.

**Three device widths, and nothing between them** — `desktop` 1280, `tablet` 834, `phone` 390 (the
width DESIGN.md measures the shell at). The frame LAYS OUT at that width and the stage scales the
pixels into the pane, so the phone stays phone-shaped in a pane twice its width; the wrapper
carries the scaled size so the centring, the scrollbars and the device shadow agree with what the
eye sees. **Never scaled up** — a phone blown up to 700px would show an author type twice the size
their reader gets. `Actual size` drops the scale to 1:1 and lets the stage scroll, because "what
shape is this page" and "can I read this type" are two questions and a designer needs both.

**The preview settles on a 120 ms trailing edge**, with one dot lit while it is behind. Under the
~150 ms an eye reads as instant, over the 16 ms a drag would blow; identity-based, because every
control writes a new document object. Measured: 24 slider keystrokes in 168 ms, 50 device switches
with the same iframe element and the same in-frame node count (211 → 211) — the frame is built
once and reconciled after that, which is also why the author's scroll position survives every
edit. A route change is a NAVIGATION and resets it.

**Gated by `scripts/check-preview.mjs`** (`npm run check-preview`, `PORT` + `VELLUM_PASSWORD`),
which drives the real panel in a real browser and measures the frame from the inside: the frame
exists at all under the shipped CSP, the sheets and the theme arrive, the phone gets the phone
rules, the pictures resolve, a chip highlights under a pointer mapped through the scale, an edit
lands, and fifty switches leave the same element with the same node count. It creates one design,
uses it and deletes it, putting the previously active one back — on failure too.

**A fresh install still gets a page worth looking at**: with zero published posts the pane draws
six sample cards with generated artwork, the topics menu filled from the sample tags, and one
quiet line saying some rows are samples (`presetSampleNote`). With real posts the pictures are the
author's own — measured resolving to `/api/file?path=Media%2Fkyoto.jpg`.

### The gallery contract (`client/components/design/PresetGallery.tsx`)

```ts
interface PresetGalleryProps {
  presets: readonly Preset[];   // from loadPresets(); the host awaits, the gallery has no spinner
  content: PreviewContent;
  onApply: (preset: Preset) => Promise<void>;   // fork + open; see the two lines above
  onBlank: () => Promise<void>;                 // createDesignDoc(name)
  busy?: boolean;
}
```

**The gallery owns filtering, hover and selection; it owns NO network and NO store writes.**
`onApply` and `onBlank` are the only two ways out, deliberately: the panel already knows how to
open a document, refresh its overview and toast a failure, and a gallery that learned any of it a
second way is a gallery that drifts. It does not know what a design store's error sentences look
like and must not learn.

- **Filtering is one implementation** — `filterPresets`/`presetMatches`/`familyCounts` in
  `shared/presets.ts`, so the count beside the search box and the grid under it cannot disagree.
  Text is applied FIRST and the family chips count the text-filtered set, so a chip reading "0"
  beside a grid full of matches is not a reachable state. Search matches id, family, tags and the
  name and blurb **in both languages**, folded (diacritics, tatweel, alef and ta-marbuta) — an
  Arabic instance still finds a preset by an English name it read about somewhere.
- **Eight families**, closed, describing the JOB and never the decoration: `editorial`,
  `minimal`, `journal`, `portfolio`, `reference`, `landing`, `gallery`, `letter`. **Every one of
  them has a module**, and that is a rule rather than a description of where the writing stopped.
  The chips are drawn from `PRESET_FAMILIES` unconditionally and count what is in the catalog, so a
  family with nothing behind it renders as a chip that is `disabled` on every instance, in every
  language, whatever anybody types in the search box — `landing` shipped exactly that, reading
  "Landing 0" beside seven live shelves. A filter that can never be switched on is not a filter; it
  is a promise of a shelf next to an empty one. The fix is a module, never a chip that learns to
  hide, because the alternative is a closed vocabulary carrying a dead word. `check-presets.mjs`
  is what keeps it true.
- **VISIBILITY, not hover, decides what is drawn for real.** The pointer no longer selects the
  one honest card: everything on screen is one (see Thumbnails above), and there is nothing left
  for a hover dwell to buy. The dwell that remains is a SCROLL dwell inside the
  `IntersectionObserver`, which no input device can starve — the old `onFocus` path armed the
  180 ms timer despite the comment above it promising keyboard readers an immediate render, and
  that disagreement is gone with the timer.
- **Selecting is a NAVIGATION, and the detail is a room with a door on it.** Opening a preset
  takes the shelf over (`.s-dsgp--detail`; the search bar, the chips and the grid go `hidden`)
  and the view opens with the three things a drilled-in screen owes its reader, in the order they
  are looked for: **back** at the inline-start as a real button with the word on it
  (`presetBack` / `presetBackToGallery`), **where** as a crumb `Presets › Kiosk` plus a position
  in the shelf being browsed (`presetPosition`, the FILTERED index — "3 of 11" inside a family,
  never "17 of 59"), and **what happens next** at the inline-end: the one accent button, with the
  state it changes from printed beside it (`presetPreviewOnly`, "Preview — not applied yet").
  Before this it was a sheet that unfolded above the grid whose only exit was a button called
  "Close" at the bottom of a column of copy, below the fold, beside the button that applies the
  preset to the site — and "Close" in a modal panel reads as "close the panel".
  - **The shelf is hidden, never unmounted**, so back is lossless: the query, the family chip and
    the cards' own DOM survive. The scrollport's offset and the card that had focus are recorded
    on the way in and restored on the way out — a keyboard reader who opened card 31 lands back
    on card 31, not on the search box. The scrollport is FOUND (nearest ancestor whose computed
    `overflow-y` scrolls), not named: it belongs to `.s-dsgr__controls`, which is another file.
  - **Esc unwinds one step.** `isPresetDetailOpen()` / `closePresetDetail()` are the same
    module-level precedence handle `SectionPicker` established and exist for the same measured
    reason: both layers listen in the capture phase, capture order is registration order, and the
    panel (mounted first) wins — so one Esc used to close the whole designer over an unsaved
    design when the reader only meant to leave a preset. The panel ASKS. Backspace also goes back
    (bubble-phase, and it stands down inside any field), and **← / → step along the shelf in the
    READING direction** — in an RTL shelf the next card is to the LEFT, and arrows that ignored
    that would walk an Arabic reader backwards through their own catalog.
  The detail also carries the real canvas at `clipHeight: 1400`, the
  blurb, the family, the theme swatch and its name, and two sentences that have
  to be said before somebody clicks — that a preset ships the shape and the words stay theirs, and
  that applying makes an editable copy the preset can never reach again. The right half also
  carries **what this page is made of** (the section manifest, glyph and name, in order) and the
  preset's **tags as FACETS**: every preset already ships a rich `tags` array ("wide", "grid",
  "uppercase", "masthead", "news", "dense", "headlines") and the only way to reach any of it was
  to guess the word into the free-text box. `presetMatches` already searches tags, so a chip is
  one `setText` away from being a filter.
- **"Start from blank" is the first tile**, always, dashed, and it is `createDesignDoc` — the
  stock defaults and nothing else.
- **THE GALLERY TAKES THE PREVIEW'S COLUMN** (`.s-dsgr__body--wide`, `tab === "presets"`). It is
  the one tab that is already a preview, and the only exception to the three-column rule below.
  Everywhere else the right-hand pane is the thing the author is looking at; on this tab it was
  drawing the DRAFT — the one document somebody comparing fifty-nine alternatives is not thinking
  about — or the words "no design yet" across 1.4fr, while the shelf it belongs to was folded into
  a 380px form column at **two cards across**. The gallery already answers everything that pane
  exists to answer, at three magnifications of its own: a miniature per card, a real
  `DesignCanvas` under the pointer after the dwell, and a full one in the detail sheet. Two columns
  here is not a smaller panel, it is the shelf at the size a shelf wants — measured five across at
  1440 and four at 1320. **`.s-dsgr__preview` is UNMOUNTED, not hidden**: it owns an iframe, a
  `MutationObserver` and a settle timer, and none of those should be running behind a surface that
  is not showing them (measured: 0 frames in the document while the gallery is open).
- **Browsing the whole catalog leaks nothing.** The live canvases are BOUNDED rather than singular
  now — the two or three screens around the reader — and every one of them is unmounted when it
  leaves that band, so scrolling to the end of the catalog and back leaves the document the size
  it started. The unmount, the 600 ms leave grace and the unmounted preview stage are what buy
  that, and a regression in any of them shows up here first.

### A SCALED PREVIEW IS ANCHORED PHYSICALLY, BECAUSE ITS ORIGIN IS PHYSICAL

`transform-origin` has no logical form. Every surface that draws a design smaller than life lays
the page out at a fixed width (`CANVAS_WIDTH` 1120, or a device width) and scales the pixels — and
the box being scaled is placed by FLOW, which IS logical. In `[dir="rtl"]` those two disagree by
exactly `layoutWidth − boxWidth`: the 1120px block aligns its RIGHT edge to the container's right
edge, so its left edge sits at negative x, and a `top left` origin scales it about a corner off
the side of the card.

That is not a cosmetic drift. Measured on an Arabic instance before the fix: every gallery card
drew its page at x −145…76 of a card at 754…975 — **entirely outside its own `overflow: hidden`,
so all fifty-nine cards were blank rectangles** — and the preset detail sheet drew a page clipped
to its right-hand third, which is the "preview shifted to the right" the owner reported. In
English the identical code is pixel-perfect, which is why this is a rule with a gate behind it
rather than a screenshot somebody remembers to take.

The rule: **in `scale` mode the page leaves flow** — `.s-dsgv--scale .s-dsgv__page { position:
absolute; top: 0; left: 0; transform-origin: top left }` in `presets.css`, with a physical `left`
so the anchor and the origin are the same corner in both directions, and **no `[dir]` rule at
all**. `DesignCanvas` writes only `width` and `transform` inline and must not write the origin
back. `native` mode keeps flow — it is not transformed and it has to scroll. `.s-dsgs__frame` (the
stage's iframe, `designer.css`) has always been arranged this way and carries the same note; it is
the pattern, not the exception.

**Gated by `scripts/check-designer-nav.mjs`** (`npm run check-designer-nav`, `PORT` +
`VELLUM_PASSWORD`; `LANGS` and `WIDTHS` override the `en,ar × 1440,1280` default). It measures the
drawn page's rect against its container's on the card and on the detail sheet, in both directions
at both widths (2px of sub-pixel slop and not one more), and drives the whole navigation model:
the crumb, the one-tab-stop rail with arrow/Home/End, the drill-in, focus landing in the room,
offset and focus restored on the way out, reading-direction arrows, and Esc unwinding one step
before it closes the panel. It finds the designer's door STRUCTURALLY (the status-bar icon
buttons, tried in turn) rather than by typing a word into the palette, because the palette
searches localised labels and would open nothing on the one instance this gate exists for. It
switches the instance language — it must, that is the point — and puts it back, on failure too.
Verified to FAIL on the pre-fix stylesheet with `dx −899` on the card and `dx −430` on the detail,
and to pass in English either way.

### Where you are, in the panel: `.s-dsgr__crumbs`

One line under the head, always: **`Design your site › <design> › <room>`**, with the middle
segment present only on the tabs that edit one document (the library tabs — Designs, Presets —
are a shelf OF designs, not a room inside one). The rail said which room and the footer said
whether anything was unsaved; nothing said which DESIGN, so a panel holding two of them looked
identical whichever was loaded and every control on every tab was editing a thing the screen never
named. The design's name is note-shaped text and is wrapped in `<bdi>` with the separators OUTSIDE
the isolate, the same rule every other note-derived chrome label follows; `›` is `Bidi_Mirrored`
and therefore gets no transform.

**The rail is a real tablist**: `aria-orientation="vertical"`, `aria-controls` the panel,
`tabIndex` roving with the selection so Tab always re-enters at the room the reader is in — eight
buttons that were each their own tab stop cost eight presses to cross a menu. Up/Down walk it,
Home/End reach its ends, and Left/Right are accepted too and follow the READING direction, because
the rail sits on the inline-start edge and a reader who just crossed between two side-by-side
columns with the horizontal arrows should not have to switch hands to walk the column they landed
in. Selection follows focus (an "automatic" tablist), which is right here because every panel is
instant and none of them loses anything on the way past.

**The panel's trail is drawn ONCE.** The preset detail names the open preset and nothing else
(`.s-dsgp-detail__crumbleaf`); it used to draw a root of its own — "Presets › Broadsheet" about
100px under the panel's "Design your site › Presets" — and two breadcrumbs on one screen saying
different things answer "where you are" twice, with the shorter one winning the eye.

### Getting into and out of the designer

The panel is a modal surface and goes through the same primitive as every other one:
**`useDialog(panelRef)`** (`client/a11y.ts`). It carried `role="dialog" aria-modal="true"` without
it, and all three halves were missing — measured at 1280×800 on an Arabic instance: focus never
entered the panel (after Enter on the status-bar glyph `activeElement` was still the glyph), ONE
Tab from the opener landed on the Settings gear BEHIND the modal (the whole app was tabbable
underneath it), and closing left the reader on `<body>`, which is precisely the "sent back to the
top of the document" failure `useDialog`'s restore half exists to prevent. Escape is NOT delegated
to the hook: the panel owns three inner layers (a `Select` popover, the section sheet, the preset
detail) and its own capture-phase listener is what knows their order — it now asks
`isConfirmOpen()` too, so an Esc meant for a question the panel just asked cannot close the panel
out from under it.

**Leaving with unsaved work asks first.** Esc, the `×` and a click on the backdrop all run the
same `requestClose()`: clean, it closes; dirty, it raises the standard confirm ("Close without
saving?" / Discard) and only closes on an explicit Discard. Esc used to discard silently — the bar
read "1 change not saved yet", one keystroke later the panel was gone and reopening it said
"Everything saved". The panel's own Esc comment argues at length against making Esc "a trapdoor …
with the design under edit still unsaved behind it" for the preset detail; this is the same
trapdoor one level further out.

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
- **…and the guarantee does not rest on an ignore rule, because an ignore rule is the vault's
  opinion.** The rule-level fix above is still wrong for one class of vault, and it was measured
  wrong: `hasRule()` reads a `.gitignore` that already carries a `.trash/` line as "already
  covered" and appends nothing, so a file reading `.trash/` then `!.trash/` un-ignores the trash —
  git's LAST matching rule wins — and `git add -A` committed `.trash/guides/…` again. The same
  hole exists for every other way an ignore decision can be overridden (`.git/info/exclude`, the
  operator's global `core.excludesFile`, a negation in a nested `.gitignore`). So staging is now
  a single function, `stageAll()` in `server/gitSync.ts`, and **nothing else in the module may run
  `git add`**: it runs `git add -A` and then `git rm -r --cached --ignore-unmatch -- .trash
  [<VELLUM_DATA rel>]`, evicting both paths from the INDEX. That command consults no ignore file
  at all, so no rule anywhere can put either path into the tree that gets committed, and the same
  call is what un-tracks a trash an older build already committed. `seedGitignore()` still appends
  `.trash/` to the vault's own file so a terminal `git status` is quiet — a courtesy, not the
  mechanism.
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

## The desktop app (`electron/`, `desktop/`, `client/desktop/`)

Vellum runs in a browser, and for a writer that is the wrong window: no
application menu, no window that stays where it was left, no system dictionary,
no file the reader can drag out, nothing over other applications, and a tab that
closes with twenty others. The desktop app is Electron — chosen over Tauri (whose
webview is whichever one the reader's OS shipped, and this product's whole
premise is one rendering of one editor) and over a PWA (which has none of the
seven capabilities listed below). It is **additive**: `git clone && npm install
&& npm start` is untouched, `npm run typecheck` still passes on a clone that has
never seen Electron, and a contributor who never opens `desktop/` never downloads
a Chromium.

### The server is SPAWNED, not imported — and that is the load-bearing decision

`electron/server.ts` runs `server/index.ts` as a **child process** of the
Electron binary in pure-Node mode (`ELECTRON_RUN_AS_NODE=1`, so a reader who has
no Node installed still has one). The obvious alternative — factor
`server/index.ts` into `createApp()` + `boot()` and call it in-process — was
considered and **refused**.

`server/index.ts` is a script, and the script is the contract: it parses argv,
seeds a fresh vault from `vault-seed/` before anything reads it, `process.exit(1)`s
on a `ConfigError` with the sentence that fixes it and no stack trace,
top-level-`await`s `initIndexer()`, and runs seven inits in an order
`migrateSettings()` silently depends on. A second caller of that sequence is a
second thing to keep true, and the web deployment — the actual product — would
be the one paying, in drift, for a boot path only the desktop exercises. The
process boundary costs two additive lines in `server/index.ts` and buys the
guarantee that both deployments boot identically.

Those two lines, and nothing else:

- `if (process.send) process.on("disconnect", () => process.exit(0))` — quitting
  the app must not leave a server holding a vault's port and watching its
  directory for a window that no longer exists.
- `process.send?.({ type: "vellum:listening", port: info.port })` in `serve()`'s
  callback — the **bound** port, not the requested one.

Both are inert without a parent: `process.send` exists only when the process was
given an `"ipc"` stdio.

### THE PORT IS PERSISTED PER VAULT. This is not an optimisation.

Every device preference in this product is `localStorage` — `vellum.theme`,
`vellum.workspace`, `vellum.tabs`, `vellum.vim`, `vellum.reading`,
`vellum.sidebarSide`, the folds, the pane sizes — and **`localStorage` is keyed
by origin**. The desktop's origin is `http://127.0.0.1:<port>`, so the port *is*
the identity of the reader's settings.

A desktop app that asks the OS for a free port each launch therefore hands the
reader a brand-new browser profile every morning: theme back to default, tabs
gone, folds gone, sidebar back on the other side — and **there is nowhere in the
product that could explain it**, because from the inside nothing went wrong. A
different origin genuinely has no settings. It is the worst bug available to this
feature, it is silent, and it is one line of convenience away at all times.

- One port per vault, in **6820–6899**. Not 6801: the reader running `npm start`
  in a terminal beside the app is the normal case, not a conflict to arbitrate.
- The first port a vault is offered is **seeded from its path** (`seedFor`, FNV-1a),
  not counted upward — so a reinstall, or the same vault on a second machine,
  lands on the same origin and keeps its stored layout even when the preferences
  file did not survive.
- The remembered port is tried first; then a linear probe from the seed, skipping
  ports other vaults own. Binding is the test — `portCandidates()` is pure and
  proved in `tests/desktop.test.ts`; `isPortFree()` actually binds, and the
  caller walks the list because the answer is racy by nature.
- **When the port has to move, the reader is told, in a dialog, in their own
  language** (`dlgPortMovedBody`). It is the one message this app owes: their
  layout for that vault has just reverted, and nothing inside the window can say
  why.
- `VELLUM_DATA` goes to `<userData>/vaults/<name>-<hash>/data`, **not** into the
  vault. `isIgnoredSegment` hides exactly three names — `.obsidian`, `.git`,
  `.trash` — and `.vellum` is not one of them, so a data directory beside the
  notes would appear in the reader's own tree and travel into their Dropbox.

### The owner never meets a login screen, and the binary is not a bypass

Two requirements that pull against each other: the person who chose the folder
and double-clicked the icon should not type a password to prove they are holding
their own computer — and the same binary must not become a way for every other
account on a shared machine to reach that vault.

**No new auth mode.** `server/auth.ts` already has the shape; the desktop uses it
as written:

- `HOST=127.0.0.1` — nothing off the machine can reach the port.
- `PUBLIC=false` — reads require a session too, so an unauthenticated local
  caller gets 401 on *everything*, not a published subset.
- `ADMIN_PASSWORD_HASH` — argon2id of **32 random bytes minted at launch**, never
  written to disk, never shown. Cheap parameters (m=8192, t=2, p=1) deliberately:
  scripts/hash-password.ts stretches a *human* password because it is short and
  guessable; there is no dictionary attack on 256 bits, and stretching it would
  cost ~1.2s of launch time to buy nothing.
- `SESSION_SECRET` — 32 fresh bytes per launch, so a cookie from a previous run
  is not a credential for this one.

The app then signs itself in through **`POST /api/login`, the same route the
browser uses**, and puts the cookie in that vault's Electron session partition.
There is no desktop special case anywhere in `server/`.

Two consequences worth stating:

- **`isProtected()` is true**, so Backup & sync works on the desktop. In open
  local mode the server correctly refuses to push a vault anywhere on the word of
  whoever connected.
- **The session lifetime is read off the wire, never copied.** `SESSION_TTL_MS`
  is private to `server/auth.ts`; the login response's `Set-Cookie` carries
  `Max-Age` written from it, so `electron/cookie.ts` parses that and
  `keepSignedIn` schedules from what the server said. The cookie's *name* is read
  the same way for the same reason: a desktop that typed `"vellum_session"` into
  its own source would work until someone renamed it and then fail by silently
  never being admin.

**A session partition per vault, and it is not fastidiousness: cookies ignore
ports.** Two vaults are two origins to `localStorage` and *one* origin to the
cookie jar — so a shared jar means opening the second vault overwrites the first
vault's session cookie with a token its server rejects, and the first window
silently stops being admin.

### `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`

Stated on every window rather than left to default, because a default is a
decision nobody wrote down and two of these have been the other way inside living
memory of the framework. A note can contain arbitrary HTML — the reading view
sanitizes it and the server sends a CSP behind that; these four are the third
wall. `npm run check-desktop` fails on any of the four written the other way.

`sandbox: true` is why `electron/preload.ts` is the one file under `electron/`
that is **compiled** (to CommonJS, into `desktop/build/preload.js`) rather than
run as TypeScript: a sandboxed preload is loaded by Chromium, not by Node — no
ESM, no type stripping, and `require` limited to `electron` itself. It is also
why the preload **inlines** its channel names instead of importing
`electron/ipc.ts`, and why the gate counts them.

**The bridge is 1:1 in both directions.** Every channel is declared once in
`electron/ipc.ts`; each `TO_MAIN` channel has exactly one `ipcMain.handle` and
exactly one `ipcRenderer.invoke`, each `TO_RENDERER` channel exactly one `.send`
and one `ipcRenderer.on`. Two callers is a finding and **zero is a finding** — a
dead channel is a hole that no longer has a reason, which is the worst kind to
leave open. Every handler resolves its caller through `instanceOf(event.sender)`
first: a renderer cannot name a vault, a path or a window, only act on the one it
is already inside.

### What the desktop does that the browser cannot

This list is the justification for the whole surface; a desktop app that only
re-hosts the web app is a bigger download of the same thing.

1. **A native application menu, translated.** Menu strings are user-visible copy
   and are in `electron/menuStrings.ts` in the shape `check-i18n` parses, with
   `check-desktop` running that gate's four parity assertions over them until the
   dictionaries merge.
2. **Real OS windows** — position and size restored per vault, validated against
   the displays that still exist (`onSomeDisplay`), because a window restored to
   an unplugged second monitor is an app that "does not start" while running
   perfectly, off the side of the desk.
3. **Native find-in-page** (`Ctrl/Cmd+Shift+F`) — the *rendered document*:
   reading view, outline, backlinks, transclusions. `Ctrl/Cmd+F` remains
   CodeMirror's find over the open note's text. Two verbs, two keys.
4. **Native spellcheck with the system dictionary**, drawn in Vellum's own
   `.s-menu`. `client/editor/bidi.ts` already stamps a `lang` on every line whose
   script disagrees with the document, and `setSpellCheckerLanguages` is a
   whitelist — so every language `shared/script.ts::spellcheckLang` can return
   (`he`, `fa`, `ar`) plus the instance language is enabled, or that per-line work
   is inert. The reader's choice is committed with
   `webContents.replaceMisspelling`, which lands as a native
   `insertReplacementText` — so CodeMirror's own DOM observer applies it, undo
   history included, and **nothing in `client/editor/` knows this feature
   exists**.
5. **OS dark mode, followed.** The web app deliberately does not read
   `prefers-color-scheme` — a self-hosted vault's theme is a decision its owner
   stored. On the desktop the machine is the reader's, and the flip moves to
   `counterpartChoice()` — the same function the ☾/☀ button uses, so a custom
   theme lands on its base's curated opposite.
6. **File associations and `vellum://` deep links.** Both are hostile input: a
   `vellum://` URL can be opened by any page in any browser with no prompt. Two
   refusals in `electron/deeplink.ts` are the whole trust model — a note
   reference must survive normalization and stay inside the vault, and **a vault
   reference is honored only if the reader has already opened that vault**.
   Without the second, `vellum://open?vault=/` is a link that makes the app index
   and serve the reader's entire disk.
7. **Drag a note out as a real `.md`**, a tray/menubar presence, and an
   **always-on-top reference window** — the source you quote from while you write
   in the window behind it, which is the one arrangement `client/workspace.ts`
   structurally cannot express.

### A menu item must not invent a keystroke

`GROUPS` in `client/components/ShortcutsHelp.tsx` is the one place a binding
exists and `npm run check-keymap` fails the build when two rows claim one chord.
A native menu is a **third** keyboard handler and the most dangerous of the
three, because an accelerator is consumed by the OS *before* the page sees the
key: an accelerator that disagrees with the ledger does not collide loudly, it
makes the ledger's binding silently stop working, on one platform, for one build.

So every accelerator in `electron/menu.ts` is a chord the ledger already claims,
and the item forwards the same verb — the menu is a **visible index of the
keymap**, not a second one. The forward calls the same store action the keyboard
calls (`client/desktop/index.ts`), which is the pattern the shortcut sheet's
`run:` handlers already use.

**One exception, and it is the interesting one.** Electron's convention for a new
window is `Cmd/Ctrl+N`, and this app has claimed `Ctrl/Cmd+N` for **New note**
since before the desktop existed. Taking it would make the desktop build the one
place the product's own documented binding does nothing — discovered by a reader
who pressed it expecting a note and got an empty window. New note keeps
`Ctrl/Cmd+N` and appears in the menu wearing it; **New window takes
`Ctrl/Cmd+Shift+N`**. Find next / Find previous carry no accelerator at all for
the same family of reason: `F3` and `Ctrl/Cmd+G` are both spoken for, and the
find bar's own `Enter` / `Shift+Enter` already answer.

### The gates

- **`npm run check-desktop`** (`scripts/check-desktop.mjs`) is **pure**: no
  Electron, no `node_modules`, no browser, no server. It runs in CI on every
  commit, next to `typecheck`, because `desktop/` is the one part of the repo
  most contributors never install and unbuilt code rots quietly. It asserts:
  the server's bare-import closure ⊆ `desktop/package.json` dependencies **at
  identical version specs**; nothing under `client/` or `server/` imports
  `electron`; every IPC channel paired 1:1 in the right direction; none of the
  four `webPreferences` written the unsafe way; and the menu dictionary's
  translation parity, including that a key shared with `client/i18n.ts` is
  byte-identical to it.
- **`electron/probe.ts`**, run under `ELECTRON_RUN_AS_NODE` at every launch,
  asks the four questions whose answers are only ever discovered as a blank
  window: is the bundled Node ≥ 24 (`server/index.ts` is run directly and
  top-level-awaits), does `node:sqlite` exist (marginalia — opt-in, so the
  failure would otherwise wait months), does the **native** `argon2` load
  (compiled against an ABI, and Electron's is not stock Node's), and does a real
  `server/*.ts` type-strip and resolve its bare import. All four fail the same
  way, so all four are asked before the window opens.

## Aliases — a note answers to more than one name

**The README recruits Obsidian vaults, and in one of those a note is linked by a name that is
not its filename.** `aliases: [ML, machine-learning]` in the frontmatter, `[[ML]]` in twenty
other notes. There was no alias table: every one of those links rendered dashed and offered to
create a DUPLICATE note — in the first hour, to exactly the reader the pitch was aimed at. The
table is `byAlias` in `server/indexer.ts`, and it is registered and torn down by `addKeys()` /
`removeKeys()` beside labels and citekeys, so it rides every path that indexes a note —
including the watcher's incremental `indexFile()`. A stale alias that resolves to a deleted note
is worse than no aliases at all, and that is why it is not its own call.

**The ladder is exact path, then real basename, then alias.** A file actually named `DL.md`
must never lose its own name to a `aliases: [DL]` some other note declares, whatever the two
paths look like. Ties INSIDE a rung — two notes claiming `AI` — break with `pickShortest()`,
the same rule duplicate basenames have always used: fewest segments, then shortest string, then
alphabetical. One rule for names, whoever wrote them down; Obsidian picks a winner here
silently and arbitrarily, which is the behaviour this replaces, not the one it copies.

**A rung the visitor filter empties falls through to the next one** rather than answering null.
The visitor's collection is a smaller vault: inside it no note is NAMED `Ghost` at all, so the
published note whose alias is `Ghost` is the honest answer. It leaks nothing either way — both
branches are computed from notes the caller may already discover — and the alias half of
resolution is filtered by `isNoteVisibleToVisitor()` exactly as the basename half is, so an
alias can never make a private note reachable.

**Every surface lands together, because a note reachable by a name in one place and invisible
by it in three others is more confusing than no aliases at all.**

- **Links.** `resolveLink()`, which is also what backlinks, the graph, `notesLinkingTo()` and
  `/api/resolve` are built from — so a link made THROUGH an alias is a backlink like any other,
  with the same context extraction, and nothing else had to learn the word.
- **The client resolver too, or the feature is a lie in the one place the author works.**
  `client/editor/links.ts` decides whether a link is drawn dashed and where a click goes. A tree
  carries filenames, so the client cannot derive an alias: `state.loadTree()` fetches
  `GET /api/aliases` beside the tree and fills `setAliasTable()`, and the two are stale and
  fresh together. Without it the server drew the backlink while the editor drew a DASHED link
  offering to create a duplicate of the note it had just resolved — the disagreement
  `tests/links.test.ts` exists to catch. The client applies the SERVER's tie rule for aliases
  (fewest segments, then shortest, then alpha), so both name the same winner. The alias half of
  that fetch fails softly: it enriches the tree, it is not a condition of it.
- **Search.** `aliases` is a minisearch field, boosted 4 — under the title (the filename is what
  the note is called), over tags. It also gets the exact-match short-circuit `byName` has, and
  needs it more: an alias is routinely a word the note's own text never contains ("ML" on a note
  that only ever writes "machine learning"), so there is no body match left to rank.
- **`[[` autocomplete.** Reads the same table (`aliasCompletions()`), so the popup opens at the
  speed it always did — no fetch on the keystroke. An alias that merely repeats a filename is
  dropped from the list: it would complete to the same link twice, and the second row would say
  something different about where it goes.
- **The reverse: a rename OFFERS to keep the old title.** The link rewrite repairs every
  `[[wikilink]]` inside this vault. It cannot repair what is outside it — a published permalink,
  a link in someone else's notes, a bookmark — or the reader's own memory of what the note was
  called. So a rename that changes the NAME (not a move, which keeps it) raises an
  `actionToast`: one button, and the old title goes into `aliases:`. This is the half Obsidian
  leaves to the author.

**Which name matched is SAID, not guessed at.** A search hit carries `SearchHit.alias` when the
title is not what matched, and the sidebar row prints "matched alias «ML»"; a completion row
says "alias of {title}". A result whose words appear nowhere in the note, or a completion for a
name the reader has never seen on a file, reads as a bug rather than as a feature working — and
when two notes claim one alias, these rows are the only place the difference is visible.

**Reading and writing go through `server/noteFrontmatter.ts`, one operation per format.**
`parseAliases()` takes ALREADY-PARSED frontmatter, so a `.tex` note's `%--- … %---%` comment
block — the one that still compiles under `pdflatex` — carries aliases through the existing
reader with no second frontmatter path. Three spellings arrive from real vaults because YAML
gives three values for what an author reads as one list: a flow list, a block list, and the
STRING `ML, machine-learning`. A scalar is split on commas; a list ITEM never is —
`aliases: ["Smith, John"]` is already one item to YAML, and splitting it too would leave no way
to spell an alias containing a comma. Obsidian's older singular `alias:` is read as well.

**`addNoteAlias()` adds an ITEM to a block list instead of flattening it.** Flattening
`aliases:\n  - ML` into one `aliases: [...]` line would leave the `- ML` lines orphaned under a
key that now holds a value: that is not a note with an odd alias list, it is a note whose YAML
no longer PARSES — and the first thing lost when frontmatter stops parsing is `publish: true`,
i.e. the note silently leaves the public site. The new item copies the indentation, and in a
`.tex` note the `%` comment prefix, of the item already there. Absent or inline, it is one
`aliases: [...]` line written through the surgical line editor, new name first. Idempotent, so
the offer can be taken twice without growing the list.

## Moving notes and folders (drag in the tree, "Move to…", undo)

A vault reorganizes itself constantly, and until this landed the only way to move anything was to
retype its whole path into Rename. Three surfaces now perform one operation — a drag in the file
tree, "Move to…" in the tree's row menu, and "Move note to…" in the command palette — and they all
run `moveTo()` in `client/move.ts`, which owns the validity rule, the conflict dialog, the tab
remap, the toast and the undo. A second implementation behind the keyboard route is exactly how
the two would drift.

**A MOVE IS NOT A RENAME WITH A DIFFERENT STRING.** `POST /api/rename` was already the note-move
endpoint and was already rewriting `[[wikilinks]]` in the notes that pointed at a renamed note.
That is the whole story for a rename in place. It is not the whole story when the FOLDER changes,
and the two things it missed were both invisible until a reader noticed a picture had gone:

- **The moved note's own relative embeds.** `![alt](Media/x.png)` and `[see](../Ideas/Note.md)`
  resolve against the note's OWN directory (`resolveRelative()` in `client/editor/embeds.ts`, and
  its server twin `parseAssets()`). Drag a note one folder up and every one of them points
  somewhere else — the admin sees broken images, and a PUBLISHED note serves 404s to visitors,
  because `allowedAttachments()` is built from the same resolution. Nothing said so.
- **Other notes' markdown links TO it.** The old rewrite knew `[[wikilinks]]` only, so
  `[see](Ideas/Note.md)` in another note dangled.

Both are `server/moveLinks.ts`, which is pure string work over one note's content (no fs, no
index): `rewriteWikilinkPaths` remaps PATH-form targets, `rewriteDestinations` re-resolves
standard-markdown destinations, `rewriteForMove` composes them. Three rules it keeps:

- **Basename-form `[[Note]]` is never touched.** It resolves by name, so a move cannot break it,
  and rewriting it turns a portable link into a brittle one. The same guard fixed a live wart in
  the rename path: for a note at the vault ROOT the path spelling IS the basename, so moving one
  root note into a folder used to rewrite every plain `[[Solo]]` in the vault into
  `[[folder/Solo]]`.
- **The written FORM survives.** Rooted (`/Media/x.png`) stays rooted, `<…>` stays `<…>`, and
  percent-encoding is restored whenever it was there or the new text needs it. Angle brackets are
  never ADDED — `parseAssets()` does not read that form, so inventing it would allowlist nothing
  and 404 the image to every visitor. **A destination the move did not touch is reprinted
  BYTE-FOR-BYTE**, not re-encoded: `encodeURIComponent` is not the inverse of `decodeURIComponent`
  (it does not produce `%2E` for `.`), so `![p](Media/pic%2Epng)` came back as
  `![p](Media/pic.png)` after a folder move — a live link, and a byte the round-trip promise says
  should survive. `printDest` keeps the author's own spelling whenever the new one names the same
  path (`sameDest`).
- **A destination that climbs out of the vault is left alone**, exactly as `parseAssets()` drops
  rather than clamps it.

### `POST /api/folder/move` (server, shipped)

Body `{ path, toPath }` — the same shape as `/api/rename`, because dragging a note and dragging a
folder are one gesture to the reader. Answers `{ ok: true, notes, rewritten }`. **Admin only** (the
standard guard 401s every non-GET, preview sessions included). Every refusal happens before a byte
moves, and each carries a stable `code`:

- `move_into_self` — a folder into its own descendant (`Ideas` → `Ideas/2026/Ideas`). Checked on
  the string, as written AND lowercased, so a case-insensitive filesystem cannot slip past. This
  is the gesture that eats a vault: `fs.rename` answers EINVAL on some platforms and builds an
  unreachable loop on others.
- `move_conflict` (409) — the destination name is taken. Never a merge, never an overwrite:
  `fs.rename` over a non-empty directory fails, but over an EMPTY one it succeeds, silently
  swallowing the folder that was there.
- `move_not_folder` — including a SYMLINKED folder, which is a link and not a tree; moving it would
  make every count and rewrite below describe files outside the vault (the rule `deleteFolder`
  already follows when it refuses to count through one).
- `move_same`, `move_missing` (404), `move_invalid` / `move_invalid_target` (an ignored tree —
  `.trash`, `.obsidian`…), `move_bad_parent`.

One `fs.rename` does the work — atomic within a filesystem. The `EXDEV` fallback (a bind-mounted
sub-tree) copies FIRST and removes the source only once the copy is whole, cleaning up a partial
copy rather than leaving a second half-folder beside the original. A failure at any point leaves
the vault exactly as it was.

**Events: exactly ONE** `{kind:"renamed", path, toPath, dir:true}`, the shape folder DELETE
established — 715 per-file events describing one gesture is not a description. The watcher's
add/unlink storm is suppressed on both sides, **including the sub-directories** (without them a
folder holding one sub-folder still leaked an `unlinkDir` + `addDir` pair), and the suppression
window scales with the subtree: chokidar re-walks the arriving tree, so a 715-note folder trickles
events in for several seconds, all of them after a fixed 1s window would have closed
(`suppress(rel, ms)`).

**The index is correct before the response returns.** The dir event drives
`reindexFolderMove(from, to)` in the indexer (`removeFolder` + a walk of the new subtree via
`listFolderFiles`, never a re-walk of all 1,388 notes), awaited through the same `settled` chain as
every other event — so the `/api/tree` + `/api/graph` refetch the client fires on the 200 is
already true. The rewrite set is sampled BEFORE the move by `notesAffectedByFolderMove(rel)`: one
pass over the index collecting notes inside the folder, notes whose wikilinks resolve into it, and
notes whose markdown embeds point at any file inside it (the case that breaks when `Media/` is
dragged). Calling `backlinks()` once per moved note instead is O(notes²) — a million link
resolutions for one drag on a real vault. Measured: 1,214 notes moved, 246 notes rewritten, ~3.1s,
and a round trip restores every link byte-for-byte.

**The SSE visitor filter fans a folder move out per note**, like a folder delete: a visitor holding
the old path of a published note would get a 404 from a link the site drew itself. Visible-both-
ends becomes a per-note `renamed`; anything hidden at its new address leaves as a `deleted`.

### Client

- **Drop targets are FOLDER rows plus the vault root.** A note is not a container, so a file row
  refuses quietly (the browser's own cursor, no colour — every file row flashing red on the way
  past its folder is noise). The valid target takes `--accent-soft` plus a full inset `--accent`
  ring; the ring is what separates it from the ACTIVE note row, which wears the same wash with a
  leading bar. A refused folder — its own descendant, or the one it is already in — takes a
  `--danger` ring and wash, because a target that merely fails to light up is indistinguishable
  from one the pointer has not reached. `preventDefault` is what ALLOWS a drop; withholding it on
  a refused target is the refusal, so an invalid drop cannot fire at all.
- **The vault root has no row of its own**, so two surfaces stand in for it: the tree's empty space
  below the last row, and the SIDEBAR HEADER — which names the vault, never scrolls away, and is
  the only one of the two a 1,375-note vault offers, since its rows fill the pane end to end. A
  sticky "vault root" row inside the tree was the other candidate and was rejected: appearing at
  dragstart it pushes every row down 26px under a pointer that has already picked something up.
- **Spring-loaded folders**: hovering a collapsed folder mid-drag opens it after 600ms (the
  Finder/Obsidian figure — long enough that passing over on the way somewhere else never opens
  one). It arms for ANY folder, including one the item cannot land in: resting on the folder you
  are dragging OUT of is exactly how you reach the sub-folder you are dragging INTO. Dropping onto
  a collapsed folder works and does not expand it — the spring is an aid, never a precondition.
- **Auto-scroll** within 56px of either edge of the tree, speed ramping with depth into the band
  (`autoScroll` in `client/move.ts`). Driven from `onDragOverCapture` on the tree, because the rows
  stop `dragover` from bubbling and auto-scroll has to run while the pointer is over rows — which
  is all of the time.
- **No React state during a drag.** The drop classes are toggled on the DOM nodes and the dragged
  item lives in a module variable: a `dropTarget` prop would bust `memo()` on all 1.4k rows every
  time the pointer moved one row, twelve times a second, to repaint one background.
- **A drag ghost naming the item** (`.s-dragghost`, parked off-screen and snapshotted at
  dragstart). The default drag image is a translucent copy of a 26px row against a 1.4k-row tree —
  invisible, and the reader loses track of what they are dragging half a screen in.
- **ONE LABEL RULE ACROSS THE GESTURE.** `MoveItem.name` is the basename on disk (what the API is
  called with); `itemLabel()` is what a reader is shown, and it is the tree's own label
  (`noteLabelOf`). The ghost read "Welcome.md" while the row it had just left read "Welcome", and
  the same disk name went on to the Move-to conflict dialog, its prefilled field and the error
  toasts. The landed-name toast follows the same rule.
- **No source file in this repo contains a literal NUL byte.** `MovePicker.tsx` carried one, as
  the sentinel React key for the vault-root row (`row.path || "\u0000root"`), written as the byte
  rather than as the escape. A file with a NUL in it is not text: git reports "Binary files
  differ" and shows no diff for it, GitHub renders nothing, and a source file nobody can review is
  a source file nobody reviews — which is how it survived. The escape is the same string at
  runtime. If a sentinel is needed, spell it.
- **Keyboard and touch get the same operation, not a lesser one.** HTML5 drag does not exist on a
  touch screen and cannot be reached from the keyboard at all, so `MovePicker.tsx` — the row menu's
  "Move to…" and the palette's "Move note to…" — is a folder picker shaped like the command palette
  (filter field, 34px rows, arrow keys, Enter, Esc, capture-phase bindings, ≥44px rows on a coarse
  pointer). It lists exactly the destinations `canDrop()` allows, so the tree's highlighting and the
  list can never disagree, and it mounts its own React root on demand rather than adding a host to
  `App.tsx`.
- **`POST /api/folder/move` refuses a path WRITTEN as absolute.** `normalizeRel` strips the leading
  slash, so `toPath:"/tmp/escaped"` answered 200 and invented a top-level `tmp/` folder inside the
  vault. Nothing escaped — but a request that reads as "put this at /tmp" and succeeds by meaning
  something else is a success nobody asked for, so it is `move_invalid_target` (and
  `move_invalid` on the source side). Two neighbours of the same call: the destination's existence
  check is `lstat`, not `access`, so a DANGLING symlink at the target name is a `move_conflict`
  rather than something `fs.rename` replaces in silence (the source side already refused symlinks
  by `lstat`); and the `mkdir -p` that precedes the rename is taken back out when the rename throws
  (`pruneEmptyParents`, stopping at the first non-empty directory and never leaving the vault),
  instead of leaving the half-built path behind as folders nobody asked for.
- **Safety.** A name collision opens the themed prompt (`promptModal`) offering another name or
  Cancel — never a silent overwrite, and Cancel means nothing at all happened; the check is
  case-INSENSITIVE, because macOS and Windows would let `Notes.md` land on `notes.md`. Every
  completed move raises `actionToast` (`client/undoToast.ts`) naming the item, the folder it left
  and the folder it reached, **with Undo** — a real `<button>`, Tab-reachable, 9s, and the undo is
  the inverse move through the same code path, confirming with a plain toast rather than offering a
  third round. Open tabs and the active note follow the file (`remapPath` BEFORE `loadTree`, so the
  note you were reading stays the note you are reading, at its new address; App.tsx's SSE handler
  does the same for every other connected client, and `remap()` already handled the folder-prefix
  case). A move waits out a pending autosave first (`whenSaved`, 2s bounded) — a 600ms-debounced
  save landing after the move would recreate the old path as a ghost. A failure toasts the
  server's CODE translated, never `err.message`.
- **Attachments are not individually draggable**: `/api/rename` and `/api/folder/move` are note and
  folder routes, so an image travels only inside a folder that moves. The row menu follows the same
  rule the Rename row already did.

### Files dragged in from the desktop

Dropping OS files onto a folder row uploads them there through the existing magic-byte-checked
`POST /api/upload`, which grew one optional multipart field, `dir`. Omitted — every pre-existing
caller: paste in the editor, the banner picker — it is the configured attachments dir, byte for
byte as before. Given, it must name an existing directory inside the vault (`safeAbs` plus an
`lstat`; `upload_bad_dir` otherwise), and the filename still goes through `sanitizeBaseName` and
the first-free-name loop. Without this branch the browser's default takes over on drop and
navigates the whole app away to the image — the reader loses their vault to a gesture the tree
invites.

Conflicts are handled the way an UPLOAD must and a MOVE must not: the server takes the first free
name (`shot.png`, `shot-2.png`…) rather than asking, because nothing is at risk of being
overwritten and the reader has not named anything yet — and the toast names what actually landed,
so the counter is visible rather than silent. There is deliberately **no undo** here: an upload only
adds a file, and taking it back would need a delete route for attachments that the API does not
have. The destructive gesture is the one that carries undo.

## Pointer → document mapping (the ONE implementation)

**`client/editor/pointer.ts` owns every question of the form "which document position is under
this point", and CodeMirror's `posAtCoords` is not that implementation.** Live preview replaces
source with rendered boxes of a different WIDTH and a different LENGTH — `$7.7\ \text{km/s}$` is
eighteen characters of markdown standing under seven glyphs of KaTeX, `[[Note|alias]]` hides
eleven characters that still occupy positions, `![dot](…)` is one offset wearing an image — and
`posAtCoords` reasons about geometry: it walks the height map to a block and binary-searches that
block's client rects. On a row carrying a replaced inline widget that search gives up and returns
**the end of the line**. Measured on the live vault's "Eppur si muove", on the wrapped row that
carries one inline formula, x = 500 / 527 / 620 / 700 / 804 all resolved to doc position **606**,
the line's end, against a truth of 552 / 556 / 570 / 581 / 598. That is the owner's report — "click
near the start of a line and the caret lands about 25 words in" — and the error IS the distance
from the click to the end of the line, which is why it scales with how much rendered math precedes
it.

- **The mapping asks the DOM, which cannot be wrong about which glyph is under a point**:
  `caretPositionFromPoint` (WebKit: `caretRangeFromPoint`) → `posAtDOM`. Inside a widget's own DOM
  that resolves to the widget's START, which is exactly what "click the rendered math to edit its
  source" means. `posAtCoords` survives only as the last resort, for points the DOM refuses to
  answer for.
- **THE FIX HAD TO REACH THE CARET, NOT ONLY THE READERS OF A POSITION.** The block-widget case of
  this bug was fixed once already — the frontmatter card, named in livePreview.ts — and the fix
  stopped at links and hover cards, because CodeMirror places the caret from its OWN mouse
  handler and nothing had told it otherwise. `pointerSelection` is that instruction: an
  `EditorView.mouseSelectionStyle` that replaces `basicMouseSelection` wholesale (Shift extends,
  Alt adds a range, double/triple click take a word / a line), resolving every position through
  this file. Four consumers, one implementation: caret placement, wikilink / footnote / url clicks
  and checkbox toggling (livePreview.ts), the hover previews (hoverPreview.ts), and the selection
  menu.
- **Assoc is decided by the click's own y.** One document position sits at the end of one visual
  row AND the start of the next; the two rows are ~30px apart, so `assocAt` compares
  `coordsAtPos(pos, 1)` and `coordsAtPos(pos, -1)` against the pointer.
- **AND THE ANSWER IS CONSTRAINED TO THE ELEMENT UNDER THE POINTER, which is a BIDI correction.**
  `caretPositionFromPoint` does not answer "which glyph is here"; it answers "which INSERTION POINT
  is nearest", and at a bidi seam those are different questions whose answers can be a hundred
  characters apart. A line whose base direction is LTR and whose body is one long Arabic run ends
  in a neutral — a full stop — and the bidi algorithm gives that neutral the PARAGRAPH's direction,
  so it is painted at the visual RIGHT edge of the last row: on top of the leading edge of that
  row's first logical Arabic glyph. Two positions, 73 characters apart, sharing one x; Chromium
  returns the later one, so clicking the first glyph of the row put the caret at the end of the
  sentence. So `posFromPoint` keeps the browser's position only when it lies inside the document
  range of the element `elementFromPoint` names, and otherwise takes the nearest boundary that
  does. A REPLACING widget's own DOM collapses to a point (`from === to`) and is left alone —
  "click the rendered math to edit its source" is a widget-start answer by design. On every
  ordinary click the position is already inside the element it was read from, so this costs one
  comparison. `check-caret` covers it: the case is the gate's own `LINK-AR` line, in the RTL half.
- **A drag leaves the content**, so `posFromPointOrNearest` falls through to
  `posAtCoords(…, false)` — the height-map estimate is the right tool once the DOM has no glyph to
  offer, and a selection that stops updating past the last line is a selection that snaps back.
- **THE GATE IS `scripts/check-caret.mjs`**, documented in README beside the other gates. It writes
  its own note — inline math, inline code, wikilinks, tags, highlights and an image, in English and
  Arabic, on lines long enough to wrap several times — parks the selection on a neutral line before
  each sample (the reveal-on-cursor rule rewrites the layout of whatever line the caret is on, so
  measuring and clicking must both happen with the target RENDERED), takes the glyph's own box from
  `coordsAtPos(pos, 1)`…`coordsAtPos(pos + 1, -1)`, clicks 35% into it, and requires the caret
  within ONE character. Zero-width positions (hidden syntax, replaced source) and positions
  straddling a soft wrap are skipped — they are not clickable glyphs. Rendered wikilinks, tag pills
  and images are skipped too: off the cursor line those are BUTTONS, and clicking one navigates
  rather than placing a caret. The matrix runs once in each shell direction. Measured against the
  unfixed build: 15 failures, worst |Δ| **82**.

## Multiple selections (client/editor/setup.ts, pointer.ts)

**Multiple selections are the default, and every formatting rule survives them.** `Ctrl/Cmd+D`
takes the next occurrence of the current word, `Ctrl/Cmd+Click` drops an extra cursor (and, on a
cursor that already exists, removes it), `Alt+drag` makes a rectangular selection, and
`Ctrl/Cmd+B` over five ranges bolds five things — writing `\textbf{…}` five times in a `.tex`
note, because the vocabulary is resolved from the NOTE and not from the keystroke (see "A FOURTH
RULE" below).

**The feature was one line, and that is the whole story of it.** `EditorState.allowMultipleSelections`
appeared nowhere in the client, so `@codemirror/state` funnelled every multi-range selection
through `asSingle()` — while the machinery to produce and honour those ranges had been written,
reviewed and shipped:

- `client/editor/pointer.ts`'s `get(event, extend, multiple)` already implemented BOTH halves of
  Mod+click — `startSel.addRange(range)` to add one, `removeRangeAround()` to take one away.
- `client/editor/livePreview.ts`'s `activeLines()` already loops `state.selection.ranges` and
  reveals the raw markdown around EVERY range, so a secondary caret was never going to land inside
  a hidden marker and type where the reader cannot see. That was the loudest risk raised against
  this change, and the code had already answered it.
- The colour commands in `commands.ts` already map over `state.selection.ranges` and carry
  `mainIndex` through the dispatch.

So the honest description is not "multi-cursor was added" but "multi-cursor was switched on". Two
of the three keys it needs were also being eaten elsewhere, which is why nobody noticed: `Mod-d`
(`selectNextOccurrence`) has been in the extension list inside `searchKeymap` since it shipped and
never once fired, because `client/App.tsx` claimed `Ctrl/Cmd+D` for the daily note in the CAPTURE
phase. The daily note now wears `Ctrl/Cmd+Alt+D`, on the same reasoning that moved the pane
toggles to Alt: the unmodified key belongs to the editor, and a once-a-day verb does not outrank a
per-minute one.

**`preventDefault` in that listener is how a binding dies silently, and it has now happened twice.**
CodeMirror's keydown pipeline begins `if (event.defaultPrevented) break`, so a capture-phase
`preventDefault` on `window` does not merely stop the browser — it stops the EDITOR. `Ctrl/Cmd+B`
learned this when it became bold; `Ctrl/Cmd+D` is the second case and takes the same shape: the
key is defaulted ONLY when the event's target is outside the editor, where it would otherwise be
Chrome's and Firefox's "bookmark this page". Inside the editor the event is left entirely alone,
which is also what lets vim keep `Ctrl-D` as its half-page scroll — the vim compartment sits ahead
of `searchKeymap`, so it wins simply by nobody taking the key first.

**`rectangularSelection()` sits ABOVE `pointerSelection` in the extension list, and the order is
the feature.** `EditorView.mouseSelectionStyle` takes the first style that answers, and
`pointerSelection` answers every primary-button press including one with Alt held; rectangular
selection's own filter is `altKey`, so putting it first means Alt-drag becomes a column selection
and every other drag still resolves its caret through pointer.ts's DOM mapping rather than
`posAtCoords`. `crosshairCursor()` is the affordance: hold Alt and the pointer says what the next
drag will do.

## Text formatting (client/editor/commands.ts)

**One implementation, three surfaces** — the keystroke, the selection menu and the floating
toolbar all call the same command; a menu that inserted its own asterisks would drift from Ctrl+B
the first time either changed, silently.

- **Bindings are Obsidian's, checked rather than guessed**: `Mod-b` bold, `Mod-i` italic,
  `Mod-Shift-x` strikethrough, `Mod-Shift-h` highlight. `Mod-u` underline is the word processor's —
  Obsidian has no underline command, because markdown has no underline — and emits `<u>`, which
  `rawHtml.ts`'s `INLINE_TAGS` already admitted and the reading view already rendered. `__text__`
  was rejected: it is a second spelling of bold. Inline code has no Obsidian default and gets none;
  it lives in the menu.
- **`Prec.high` so they beat `defaultKeymap`, but BELOW the vim compartment**, which is first in
  the extension list: vim's Ctrl+B stays page-up, exactly as the shell handler used to promise.
- **THE PANE TOGGLES MOVED, AND `preventDefault` IS WHY THEY HAD TO.** `Mod-b` was the notes
  sidebar and `Mod-Shift-b` the outline pane. Formatting wins in the editor — it is the binding
  every reader arrives with — so the pair kept its shape (one key, Shift picks the second pane) and
  took one more modifier: **`Ctrl/Cmd Alt B`** and **`Ctrl/Cmd Alt Shift B`**, resolved through
  `shortcutKey(e)` because both Alt and the LAYOUT rewrite `key`, and refused
  while `AltGraph` is down (Right-Alt reports ctrl+alt on European layouts). The status-bar
  tooltips, both palette rows and the Ctrl/Cmd+/ sheet print the new numbers, and the sheet gained
  a *Formatting* group so it can answer "what happened to Ctrl+B" in one glance.
  App.tsx's capture handler no longer `preventDefault`s `Mod-b` INSIDE the editor: CodeMirror's
  keydown pipeline opens with `if (event.defaultPrevented) break`, so a capture-phase
  `preventDefault` does not merely stop the browser, it stops the EDITOR — measured, the new
  binding was silently dead while that line stood. Outside the editor it still dies there, because
  Firefox's bookmarks sidebar (Ctrl+B) and Chrome's bookmark bar (Ctrl+Shift+B) must never open
  over the app.
- **Three rules every command obeys.** (1) *Applying twice removes* — each kind carries a regex for
  its own rendered span, and a range already inside one is unwrapped. The containment test is
  against the span's OUTER range, markers included: the narrower "inside the inner text" broke the
  second press on a multi-line selection, whose middle lines are clipped with one end inside the
  markers and the other outside, and Ctrl+B answered by bolding the bold (`****alpha line one****`).
  (2) *No selection is a real case* — markers inserted, caret parked between them, and a caret
  already inside a span of that kind removes it. (3) *A multi-line selection is applied PER LINE* —
  markdown emphasis does not cross a blank line, so one `**` at the top of three paragraphs is two
  stray asterisks and a lost paragraph break; blank lines drop out and trailing whitespace is
  excluded.
- Line-level structure (`toggleLinePrefix`) treats `#`/`##`/`###`, `- `, `1. `, `- [ ] ` and `> ` as
  ONE family: applying `## ` to a `# ` line replaces rather than stacks, and a numbered list
  numbers itself down the block instead of emitting five `1.` lines.

### A FOURTH RULE: the commands answer the note's FORMAT

A note is no longer necessarily markdown, and `**bold**` typed into a `.tex` file is not bold text
— it is two pairs of asterisks that `pdflatex` prints verbatim, that `shared/tex.ts` does not read,
and that the live preview beside the caret does not render. Measured before this landed: Ctrl+B in
a `.tex` note wrote `**Typed**`, the menu's "Heading 2" wrote `## ` (invisible to the `\section`
outline, so the note lost a heading it appeared to gain), and a colour swatch wrote a
`<span style="color:…">` into a LaTeX document. Three agents each shipped something correct and the
seam between them was the defect; this is the rule that closes it.

- **`syntaxOf(state)` is the one question**, answered from `notePathFacet`, which BOTH editors
  provide (livePreview.ts for markdown, tex/preview.ts for LaTeX). The keystroke, the selection
  menu and the floating toolbar all ask it, so none of the three can drift from another — the same
  argument that made them share `format()` in the first place.
- **The LaTeX column is exactly what the reader can read back.** `\textbf` / `\emph` /
  `\underline` / `\texttt` are four of the six `STYLE_COMMANDS` in `shared/tex.ts` (and of
  `TEXT_STYLE` in tex/preview.ts). Anything else would render as raw source in the very next paint.
- **A format with no honest spelling is ABSENT, never approximated.** There is no `\sout` without
  `ulem` and no `\hl` without `soul`, so strikethrough and highlight do not exist in a `.tex` note:
  their rows are gone from the menu, their glyphs are gone from the toolbar (a button that does
  nothing when pressed is worse than one that is not there), and their keystrokes DECLINE — return
  `false`, so the key falls through instead of being silently eaten, while `preventDefault: true`
  still keeps Ctrl/Cmd+Shift+H off the browser's history sidebar. The task list goes the same way.
  **The colour group is gone entirely** in a `.tex` note: a coloured run is HTML.
- **Structure translates rather than transferring.** A markdown heading is a PREFIX and a LaTeX one
  is a CALL, so `toggleTexSection` wraps the line instead of prefixing it — and keeps both of the
  family rules: applying `\subsection` to a `\section` line REPLACES it, and the second press takes
  it off, with **whatever trailed the heading (almost always its `\label`) carried through
  unharmed**. Lists and quotes become `itemize` / `enumerate` / `quote` environments
  (`toggleTexEnv`), whose "second press removes" test reads the lines JUST OUTSIDE the selection,
  because that is where `\begin`/`\end` ended up after the first press.
- **A wikilink becomes `\note{…}`** — Vellum's own macro, the one `vellum.sty` makes compile
  elsewhere — and a link becomes `\href{url}{…}`. **Inline math is the one row that is
  byte-identical in both languages**, which is the whole reason `$…$` was chosen for it.

## Selection menu & floating toolbar (client/components/SelectionMenu.tsx, styles/selection.css)

- **Right-click over a SELECTION** opens it; with nothing selected the browser's own menu
  (spelling, paste, the dictionary) is the better answer and taking it would be theft.
  `Shift+F10` and the Menu key open the same menu at the selection — a menu reachable only by
  right-click is a menu half the readers of this app cannot open.
- **A MENU IS NOT A PANEL.** The top level is *text style* (six rows), *colour* (ONE swatch row
  plus a "fixed ink" checkbox) and two doors — *Structure ›* and *Insert ›* — which open as PAGES
  of the same box, with a *Back* row, ← and Esc to leave. Flat, the vocabulary measured 341×884 in
  a 1440×900 viewport and 341×828 with 1,217px of scroll at 390×844: twenty-one rows, seventeen
  swatches and four lines of body copy, i.e. ~390px of scrolling INSIDE a context menu to reach
  "Remove colour". Nothing was dropped — the palette owns the same commands, and a page a reader
  opens on purpose costs no height to a reader who does not. Measured after: 273×458 at 1440×900,
  no internal scroll.
- **The colour group is one row.** The two tiers stay (see *Coloured text*) but the reader does not
  adjudicate a WCAG argument at the moment they want a word red: the row is theme-aware by default,
  a *Fixed ink* checkbox switches the same row to the literal inks, the arithmetic lives in each
  row's `title` instead of four lines of prose in the box, and **Remove colour is the ⊘ chip at the
  end of the row**, not a row of its own.
- Keyboard-complete: ↑↓ walk the flat
  row list, ←→ walk a swatch row *answering the inline direction* (the settings SegmentedControl's
  rule) and open/leave a page by the same rule, Enter runs the highlighted row, Esc leaves a page
  and then closes, handing the caret back. Hover never moves the
  keyboard highlight without the pointer actually moving — the palette's bug, which the theme
  picker also refused to reproduce.
- **ONE ROW IS LIT, AND IT IS LIT IN THE PRODUCT'S OWN LANGUAGE.** `--accent-soft` plus a gold
  leading bar — what the command palette uses. The generic `button:hover` in app.css paints
  `--bg-hover`, which was ALSO the active row's ground, so the row under the finger and the row
  Enter would run looked equally chosen and regularly were not the same row (measured at 390: Bold
  keyboard-active and Heading 1 pointer-hovered, both `rgb(41,35,26)`). `.s-selmenu__row:hover` now
  paints nothing; the pointer's only job is to move `--active`.
- **Keycaps and group titles are `--text-muted`**, not `--text-faint`: they sit on the highlighted
  row's `--bg-hover`, where faint measures 2.74–2.98:1 across the themes. `check-contrast.mjs`
  walks `--bg-hover` as a third ground now (DESIGN.md, *Contrast*). Below 700px or on a coarse
  pointer the keycaps are **not rendered at all** — a keyboard legend on a device with no keyboard
  is the taunt DESIGN.md already forbids in the empty state.
- **Clamped into the viewport and opened toward the reading direction**, measured from the rendered
  box after layout — the tree's context menu had to learn this for the same reason: in Arabic, and
  whenever a reader pins the sidebar right, the pointer is regularly at the trailing edge. Verified
  at 1440×900 and 1024×620 in Arabic: inside the viewport on both axes, document horizontal
  overflow 0.
- **Focus lands AFTER the placement**, never on mount — the shell's "focus after the reveal lands"
  rule one component down. Without it Esc goes to the page and the menu cannot be closed from the
  keyboard.
- **The floating toolbar carries six actions** — bold, italic, strikethrough, highlight, inline
  code, and the door to the full menu. Underline is deliberately absent: least used of the six
  wrapping formats in a markdown vault, and it keeps its keystroke. It is a plain DOM strip
  parented to `<body>` (it must escape the scroller's overflow) placed from the selection's own
  client rect, owned by a `ViewPlugin` so it dies with the editor, and its buttons act on
  **mousedown** — a click would already have destroyed the selection it exists to act on.
- **It centres on the SELECTION'S RECTS, not on two carets.** The union of
  `getSelection().getRangeAt(0).getClientRects()` (falling back to `coordsAtPos` when the DOM
  selection cannot answer). `coordsAtPos(from)`/`coordsAtPos(head)` describe carets: triple-click a
  line and both land at column 0, so their midpoint is the column's LEFT EDGE — measured, a strip
  at x=302.5–494 over a selection spanning 398–948, floating in the prose gutter clear of the text
  it acts on. It is then clamped to the **prose column** first and the window second; clamping to
  the window alone put it at x=4 at 768.
- **It flips when the band above is OCCUPIED, not only when it is off-screen.** `top < 8` was the
  whole test, so double-clicking a word on a paragraph's first line landed the strip on the
  preceding heading's baseline. The band is probed as a nine-point grid of `elementFromPoint`
  (the strip taken out of hit-testing for the duration) and any `.cm-line` other than the
  selection's own means "occupied" → go below, which is the reader's own paragraph and the lesser
  collision. The floor is the SCROLLER's top, not the window's: above it is the tab bar.
- **The highlight glyph is a filled swatch behind the H**, never a rule under it — a 3px gold
  underline sitting one row from a genuine *Underline* command reads as underline. Drawn as a
  `background-image`, because an absolutely positioned `::before` paints ABOVE the button's own
  text node.

## The editor's prose gutter (why it is on `.cm-scroller`)

`--prose-gutter` is `padding-inline` on **`.cm-scroller`**, and `.cm-content` is `max-width: 648px`
with zero horizontal padding (zen: 672px inside `min(64px, 8%)`). The measure is unchanged — 648px
at every width the column is at its cap, and the percentage resolves against the same box — but the
CONTENT BOX now ends where the text ends, and that is the whole point: CodeMirror's `drawSelection`
computes a multi-line selection's rects as `contentDOM.getBoundingClientRect()` ± the first
`.cm-line`'s own padding, so a padded content box painted every wrapped and continuation row ~56px
into the prose margin — a ragged gold L hanging in the gutter under the most-used gesture in the
editor, overshooting BOTH edges in Arabic. Measured after: content 399.5–1047.5, selection rects
405.5–1045.5. Padding on `.cm-line` would fix the arithmetic too and is refused: callouts and
quotes own that padding to place their own bars.
- **Its switch is a DEVICE preference** (`vellum.selToolbar`, default ON), beside `vellum.vim` and
  `vellum.theme` — it says how THIS person edits, must not travel to a co-author through the
  settings panel, and must not need a server round-trip to answer a selection. The menu's last row
  turns it off; the palette's *Floating formatting toolbar* row turns it back on, so the switch is
  never one-way.

## Coloured text (shared/textColors.ts, client/styles/textcolor.css)

**TWO TIERS, AND THE SECOND ONE EXISTS BECAUSE THE FIRST CANNOT BE A FIXED COLOUR.** A colour a
reader puts inside a note outlives the theme it was chosen under, so it has to survive fifteen
themes × two grounds. Ask for AA on all of them at once and the answer is provably empty: against
`void`'s `#050508` a colour needs relative luminance ≥ 0.186, against `solar`'s `#ffffff` it needs
≤ 0.183. There is no such colour.

- **Tier 1, the default — SEMANTIC.** The note stores `var(--vc-red)`; `client/styles/textcolor.css`
  resolves it per theme GROUP (`themeGroup()` already partitions the fifteen into eleven dark rooms
  and four light ones), so "red" is a light coral on a dark ground and a deep brick on a light one.
  Every value clears **4.75:1 against every ground in its group** — the shipped set's worst is
  5.29:1. The note carries a MEANING, not an ink, so it reads correctly in a sixteenth theme too.
- **Tier 2 — LITERAL.** Nine hexes, one value for all fifteen themes, solved against all thirty
  grounds at once and held to **3:1** — WCAG 1.4.11's non-text floor, the most a fixed ink can
  promise given the paragraph above. For when the author means THIS red: a diagram key, a quoted
  brand, a colour being discussed as itself.
- `scripts/check-contrast.mjs` asserts both floors from the same module the client imports, and
  asserts that the stylesheet's `--vc-*` values ARE the module's (they are written twice by
  necessity — CSS cannot import — and a drift would mean the gate measures one palette while the
  product paints another).
- **`textcolor.css` is linked from `client/index.html`, after `themes.css`** — not imported from the
  editor bundle. Coloured text has to resolve in the editor, the reading view AND the blog, and
  only one of those three ever loads CodeMirror.
- **The editor renders a coloured run as a MARK, not a widget** (livePreview.ts): the tags hide off
  the cursor line and the inner text takes a `style` attribute, so the letters stay real text — the
  caret walks them, search finds them, and the pointer mapping has glyphs to land on. Only the TAGS
  are claimed, so `**bold**` inside a coloured run still renders. The value goes through the same
  sanitizer the other two surfaces use; anything it rejects is left as source, which is the honest
  rendering of a declaration that will not survive being read back. Verified: editor and reading
  view paint byte-identical computed colours for the semantic, literal and bold-inside-colour cases.

### The sanitizer's `style` allowance (client/reading/rawHtml.ts)

`style` used to pass through **untouched on every element** — the attribute filter only looked at
`on*`, `srcdoc` and URL attributes. That was a hole with the colour feature and without it:
`background:url(https://…)` in a note is a beacon that fires for every reader and reports their IP
and User-Agent to whoever wrote it, and `position:fixed` over the viewport is a clickjack. Neither
needs script, so the CSP never saw them. Two rules now, because notes are not all ours:

- **On a `<span>` the attribute is REBUILT** and may carry only `color` and `background-color`,
  whose values must be a hex / `rgb()` / `hsl()` literal, a bare colour identifier, or a `var()`
  naming a token in `COLOR_TOKENS` (the eight `--vc-*` plus `--text`, `--text-muted`, `--accent`).
  A `var()` is a read of the page's own cascade, so an unbounded allowlist would let a note paint
  itself in any value the app holds — and, with `background-color` in play, read one out by
  contrast. The bare identifier is a deliberate widening of "hex/rgb/hsl only": `color:red` is what
  a hand-written note actually says (two of them in the 1,388-note fixture), an identifier has no
  grammar for a URL, and an unknown keyword is simply ignored by the browser.
- **On every other element the attribute is FILTERED, not rebuilt.** Real vaults keep layout in
  inline style — measured on the fixture, seventeen notes carry `stroke-width` on Excalidraw SVG
  paths, `width:100%` on a figure, `text-align:center` on a div — and rebuilding those to a colour
  allowlist would silently un-draw the diagrams the raw-HTML feature exists to render. What is
  dropped is what was never legitimate: any value reaching OUT of the document (`url()`,
  `image-set()`, `element()`, `expression()`, backslash escapes, `@import`), any `position` that is
  not `static`/`relative`, any `var()` naming a token outside `COLOR_TOKENS`, `color` /
  `background-color` values that fail the same colour rule the span path applies, and
  custom-property declarations (a value smuggler).
- **`position` IS AN ALLOWLIST, and so is every `var()` read.** The test was `fixed|sticky` — a
  denylist, in which `absolute` was simply not thought of. Verified live against the 1,388-note
  fixture at 1440×900, on BOTH code paths: a published note carrying
  `<div style="position:absolute;top:0;left:0;width:100vw;height:100vh;z-index:99999;…">` rendered
  a 1440×900 box at (293,0) and `document.elementFromPoint(720,450)` answered `DIV#OVERLAY`; the
  inline `<font id=INLINEOVER style="position:absolute;…">` did the same and answered for the page
  centre AND for the status bar at (700,886). It covered the reading column, the outline pane, the
  backlinks pane and the status bar and swallowed every click there for an anonymous visitor. A
  property whose whole job is to take an element out of flow cannot be filtered by listing the ways
  one has gone wrong so far. Re-verified after: computed `position` is `static` for all three
  values, `relative` survives, and `elementFromPoint` over the status bar answers
  `FOOTER.s-statusbar`. The `var()` bound closes the other half of the same hole: `COLOR_TOKENS`
  was stated as the reason a note cannot "paint itself in any value the app holds", and
  `<font style="color:var(--danger)">` sidestepped it entirely by not being a `<span>`.
- Both code paths are covered — the DOM pass (`sanitizeElement`, used by the reading view's block
  HTML and the editor's HTML-block widget) and the regex pass (`sanitizeInlineTag`, used by the
  inline renderer). **No CSP change is involved**: `style-src 'unsafe-inline'` was already required
  by React style props, KaTeX and the generated banner gradients.

## LaTeX notes — `.tex` and `.latex`

**A note is no longer necessarily markdown.** `shared/noteFormat.ts` is the single answer to both
"is this a note" (`isNotePath`) and "which language is it written in" (`noteFormat`, `isTexPath`),
and it replaces the `.endsWith(".md")` that was spelled out about forty times across the server
and the client. `NOTE_EXTENSIONS` is ordered `[".md", ".tex", ".latex"]` and **the order is
load-bearing**: `[[Fourier]]` with both `Fourier.md` and `Fourier.tex` in the vault resolves to the
markdown one, because that is what every vault written before this feature meant by the name.
`noteCandidates()` is the shared resolution order — server (`indexer.resolveLink`), client
(`editor/links.resolveLink`), the router and `blog.matchPublished` all walk it, so no two of them
can disagree about which note a link means.

### The reader: `shared/tex.ts`

Source text → a small document model. Node-free and DOM-free, because the indexer, the reading
renderer and the editor all import it. Three properties the rest of the feature leans on:

- **It never executes anything.** `\newcommand` is expanded by substitution under a hard depth
  (8) and count (4,000) budget; there is no other macro programming. Maths is never expanded here
  at all — the collected definitions are handed to KaTeX as its `macros` option, where its own
  sandboxed expander runs them.
- **It never reaches outside the vault.** `\input` and `\includegraphics` yield NAMES; resolving
  them is the caller's job, through the same resolver wikilinks use. `server/texNote.ts` folds a
  relative name against the note's own directory and **drops** anything that climbs out (it does
  not clamp), exactly as `parseAssets()` does for a markdown image destination.
- **EVERY `\includegraphics` yields its name, not only the one inside a `figure`.** The command
  sat in `SWALLOWED_COMMANDS`, so anything outside `parseFigure` — a bare `\includegraphics{…}` in
  a paragraph, or one inside `center` / `minipage` / `wrapfigure` / a table cell — was consumed
  with its argument: it rendered as NOTHING and never reached `doc.graphics`, which is what
  `allowedAttachments()` builds the publish allowlist from. Measured on the fixture with three
  identical PNGs in one published `.tex` note: `figure` → anon `GET /api/file` 200, `center` →
  404, bare → 404, while a byte-identical markdown `![p](Fig/plot.png)` allowlisted 200. The author
  saw a paper (admin gets 200); every reader saw blank space and three 404s. It is now an inline
  `{ t: "graphic", name, width }` node — the same `<img>` the float draws, with no caption and no
  number — and the name is pushed to `doc.graphics` at the point it is read. Re-verified: all three
  forms 200 for an anonymous visitor, `parseTex(...).graphics` = all three names.
- **It never produces HTML.** Every string in the model is plain text and both renderers build DOM
  with `createElement`/`textContent`, so there is no injection path through TeX. `\href` and `\url`
  reach an `href` only when the value is `http(s)`; a `javascript:` target renders as its own text.

Unparseable input is never an error: a malformed document yields whatever was readable, and every
unimplemented control sequence becomes a quiet inline marker — never raw source, never a crash.

### Numbering belongs to Vellum, not to KaTeX

KaTeX restarts its equation counter on every `renderToString` call, so a paper with four numbered
equations rendered block-by-block would print "(1)" four times and every `\eqref` would point at
the wrong one. So the counters live in `shared/tex.ts`, and the number is handed to KaTeX as an
explicit `\tag{n}`, which it places where amsmath does — per row inside `align*`/`gather*`
included. Unstarred `align`/`gather` therefore render through their **starred** form with one
injected tag per row: same layout, our numbers, and no doubled "(1) (1)". Numbering is
article-style whatever the document class; this is stated in the README rather than left to be
discovered.

### One anchor space (`shared/anchors.ts`)

A markdown heading and a LaTeX `\label` are **the same kind of thing** — a named place inside a
note — so `[[Note#anchor]]` and `\ref{Note#anchor}` are one lookup, and neither the backlinks
panel, the graph, the hover preview, the outline nor the transclusion code has to know which
format it is pointing at. `noteAnchors(path, content)` dispatches on format; `findAnchor()` matches
an id first (a `\label` value, a heading slug) and then an anchor's human TITLE, which is what
makes `\note{Notes on Diffusion\#Derivation}` and `[[Paper#eq:fourier]]` the same operation from
opposite sides. Markdown slugs are generated by the same rule `client/reading/toc.ts` uses, because
an anchor whose id disagrees with the element id the reading view assigns is an anchor that
silently misses.

Transclusion falls out of it: `![[Paper#eq:fourier]]` resolves the note, then the anchor, then
renders only the blocks that anchor OWNS (one equation/figure/table, or a section down to the next
heading at the same or a shallower level). A miss transcludes the whole note, which is what
`![[Note#missing]]` did before anchors existed.

**`renderNoteSlice()` in `client/reading/renderNote.ts` is the ONE place that decides this**, beside
`renderNoteContent()` and for the same reason. The first version of the anchor rule lived inside
the reading view's own `transclusion()` and the EDITOR's transclusion widget never learned it: the
same `![[Note#Section]]`, twelve pixels apart, pulled in one section in the reading pane and the
entire note in the live-preview card — which also dropped the anchor from the card's title, so
nothing on screen said which of the two you were looking at. Both surfaces now call
`renderNoteSlice`, the reading view's `anchorSlice` delegates to it, and both card headers print
the same `note › anchor` trail (`.s-rv-transclude__anchor` / `.cm-s-transclude__anchor`). **The
anchor is part of the editor widget's identity** (`TransclusionWidget.eq`): two embeds of one note
at different anchors are different widgets, and leaving it out lets CodeMirror reuse one for the
other.

### Local-first, everywhere, without exception

A `\ref` whose label is defined in the SAME document never looks at the vault (`server/texNote.ts`
drops it before it ever becomes an xref; `client/reading/texRender.ts` checks the local anchor
table first). `\input` resolves against the note's own folder before the vault-wide basename
fallback. This is the rule that makes dropping an existing LaTeX project into a vault safe:
importing it can only ADD edges the compiler would have followed anyway, never change what its own
cross-references mean. For the same reason, **renaming a note rewrites `\note{…}` and
`%% [[…]] %%` — Vellum's own syntax — and leaves `\input`, `\cite` and `\ref` alone**: those belong
to the document's own semantics, and silently editing them could change what `pdflatex` produces.

### What the indexer stores

`NoteRecord` gains four fields, and the branch that fills them is the ONE place in the indexer
where a note's text is interpreted; every field below it is format-blind again.

- `prose` — the reader's prose, control sequences, math markup, labels and citation keys already
  gone. NULL for markdown (which derives the same thing lazily from `body`). This one field is what
  makes a `.tex` note searchable by its WORDS instead of by `\textbf`, and it is also what the
  language detector reads — without it a LaTeX file of Arabic prose scores as English, because
  `\begin{document}` is Latin letters.
- `anchors` — the format-agnostic table above.
- `xrefs` — LaTeX's own linking vocabulary (`\cite`, and the `\ref` that found no local label),
  kept apart from `links` because it resolves against different tables (`byCitekey` / `byLabel`).
  Putting a bibliography key through basename resolution would draw a broken edge for every
  reference in a paper. Both become graph edges and backlinks when they resolve, which is what
  "an existing project lights up unmodified" MEANS.
- `excerptSource` — the abstract, or the first real paragraph, found by walking the document TREE
  (a LaTeX file has no markdown paragraph structure to scan).

`body` stays the RAW source, because backlink context and the editor both count in source LINES and
a prose string has none.

### Frontmatter

`%---` … `%---%` — **both fences are LaTeX comments**, so the block is invisible to `pdflatex`,
which is the same bargain `%% [[Note]] %%` strikes for links. Inner lines may or may not carry
their own leading `%`. `\vellum{key=value, …}` is the macro spelling and loses to the block on any
shared key. `findTexFrontmatter()` refuses a block whose lines do not look like YAML, so a
decorative `%------` rule is not mistaken for a fence (which would blank the top of the document).
`server/noteFrontmatter.ts` dispatches every publish toggle and `banner:` write, with the same
surgical single-line contract `server/publish.ts` states for markdown.

### Routes

- `GET /api/anchors?path=` → `AnchorsResponse`. Visitor-scoped exactly like `/api/note`: a
  published note's anchors are readable, nothing else is.
- `GET /api/xref?label=` | `?cite=` → `XrefResponse`. The vault-wide half of a cross-reference,
  asked only after the document's own definitions have been checked. A miss is `200` with nulls,
  like `/api/resolve` — unresolved keys are the normal state of a bibliography, not an error.
  Visitor-scoped, because an anonymous caller must not learn that a private note defines
  `sec:acquisition`.
- `GET /api/vellum.sty` → the macro package, `text/x-tex`. A constant; it carries nothing about the
  vault, and a reader who cannot download it cannot compile the paper they were just shown.

### Editor

One branch in `buildEditorState()`'s extension list. Everything around it is format-blind — the
theme, vim, the save keymap, caret handling, uploads, hover previews. **The formatting layer is the
exception, and it is not a second branch here**: the extension is the same in both notes and only
its VOCABULARY changes, one layer down, on `notePathFacet` — see "A FOURTH RULE" under *Text
formatting*. What differs in the list is the language
(`stex` via `@codemirror/legacy-modes`, a direct dependency so LaTeX highlighting is up on the
FIRST paint), the folding (environments as well as sections), the autocomplete (`\note{`, `\ref{`,
`\cite{`, `\begin{`) and what live preview MEANS. `\label` is the one command hidden outright on an
inactive line — it prints nothing in the PDF either, and left visible it set a `\label` key in
heading type beside every section title.

## Sectioning — a heading is a handle, not a line

**`client/sections.ts` is the one answer to "what does this heading own".** A markdown heading owns
itself plus everything under it until the next heading at the same or a shallower level, nested
headings included; every affordance below reads or rewrites that one span, so none of them can
disagree about where a section ends. The heading scan is `reading/toc.ts`'s `extractHeadings`,
deliberately and not a second copy of the rule — the outline panel is the surface a reader DRAGS,
so a boundary the outline cannot see would move content nobody selected. Frontmatter and fenced
code are skipped there, once, for both (`### ` inside a ``` block is code, not structure).

- **`scripts/check-sections.mjs` is the gate**, beside the other four in the README. It generates
  thousands of documents out of the shapes that break naive implementations — YAML frontmatter,
  fences whose bodies contain `### ` lines, skipped levels, empty sections, a section at EOF, CRLF,
  no trailing newline — and asserts the reorder is a PERMUTATION: it may change the order of a
  note's lines and the depth of the moved subtree's own headings, and it may add a blank line at a
  seam; it may never lose a line and never duplicate one. It also asserts a section can never be
  dropped inside itself, that a zero-distance move is a no-op, and that extraction's two halves
  cover the original exactly. This is the most destructive thing in the product not called
  "delete": it runs on a keyless gesture, one 4px slip away, while the reader is looking at forty
  outline rows rather than at the 1,200 lines being rearranged.
- **A reorder is one splice of a LINE ARRAY**, and re-levelling rewrites only the `#` prefixes of
  the moved block's own headings, by one shared delta, clamped so the shallowest never rises above
  `#` and the deepest never falls past `######`. Blank lines are only ever ADDED at the seams
  (a heading must not land welded to the paragraph above it); removing one would be an edit nobody
  asked for.

### The two bridges, and why the editor is the source of truth

Autosave is 600ms behind the keyboard and the outline stops recounting while a note is dirty, so
`getNote()` can be a version of the note one paragraph old — extracting a section from THAT
silently reverts whatever was typed in the last half second. `sectionActions.ts` therefore offers
every read and every write to the live editor first, through two synchronous CustomEvents its
extension answers (`vellum:section-read` / `vellum:section-apply`), and falls through to the API
only when no editor holds the path, which is exactly the reading-view case. **A write through the
editor is ONE transaction over the whole document**, so Ctrl+Z takes a drag back in a single press
and the existing autosave carries it to disk — the outline never writes a file itself. The toast's
Undo is the second door, for the reader whose hand is on the mouse and whose focus is in the panel.

### Section actions (`sectionMenu.ts`, `editor/sectioning.ts`, `reading/headingMenu.ts`)

One menu, three doors: the ⋯ beside a heading's fold chevron, a right-click on any heading line, a
right-click on any outline row. It reuses the tree's `.s-menu` chrome verbatim — two context menus
that look different in one app is a bug — and clamps the same way (opens toward the reading
direction, folds back at the trailing edge, 8px margin), because the pointer is regularly at the
trailing screen edge: the outline pane lives there in English and the notes sidebar in Arabic.

- **Rows a surface cannot perform are ABSENT, not disabled** — the rule the LaTeX formatting menu
  already follows. *Fold all below*, *Select section* and *Focus section* act on a CodeMirror view,
  so an outline right-click asks `openEditorSectionMenu()` first and only falls back to the
  three-row reading menu when no editor is mounted on that path.
- **The reading view's heading menu stands down for a session that cannot write**, which on a
  blog-mode instance is every visitor: `[[Note#Heading]]` is vault syntax meaning nothing outside
  the vault, "extract" is an edit, and taking a reader's own context menu away to offer two
  commands they cannot use would be theft. Same reason it declines when text is selected — copying
  the selection is what a right-click over a selection means, everywhere in this app.
- **EXTRACTION LEAVES THE HEADING BEHIND**, at its own depth, with a `[[link]]` under it. A reader
  scrolling the note has to see that a section used to be here, and the outline has to keep the
  entry: extraction is a reorganization, and one that makes a heading vanish from the table of
  contents reads as data loss. The new note carries the subtree VERBATIM — its root heading keeps
  the `##` it had — because "never rewrite what was not asked for" outranks tidiness. The new file
  is created BEFORE the source is rewritten; the reverse order can leave a note whose section was
  cut and whose replacement was never written.
- **The ⋯ IS a hover affordance, and that does not contradict the fold chevron's rule.** The
  chevron is visible at rest because folding had NO other door and the owner could not find it.
  This menu has four (heading right-click, outline right-click, Shift+F10, and the keystrokes for
  the commands it holds), so a ⋯ printed at full strength on every heading of a forty-heading note
  is noise in the one column the product exists to keep quiet. On a COARSE pointer there is no
  hover, so there it is always on at 30px — the touch shell's own exception.
- **It is absolutely positioned out of a zero-width host.** The fold chevron pulls itself into the
  prose gutter with a negative margin, a trick only ONE element on a line can play: a second one
  shifts the first, and the heading's own text goes with it.

### The outline is a tool (`reading/TocPanel.tsx`)

Dragging a row reorders that whole section inside the note. Four rules hold the gesture honest:
**click still scrolls** (the row is a `<button>` that also carries `draggable`, so HTML5 drag is
the browser's own click/drag disambiguation and nothing here guesses a threshold); **the drop is
shown before it happens, at the DEPTH it will land at** (a gold rule between two rows, indented to
that level — a reorder that also silently re-parents is every outliner's failure mode, and the
indicator is what makes the re-parenting a decision); **drag toward the reading direction to nest
deeper**, measured on the INLINE axis so hand and indent agree in Arabic; and **spring-loaded
nesting** — 600ms of dwell on a row means "into this section", the drag-over-a-folder gesture the
tree already teaches, which is what makes a deep nest reachable without pixel-hunting a 10px
indent step. The drop indicator is `position: absolute` inside the list rather than spliced between
rows: an indicator that takes up space pushes every row below it down by its own height, so the row
the reader is aiming at moves away at the moment they aim.

The panel keeps the FULL section list (furniture headings included, which the rows do not show):
a section the outline hides is still a section the note holds, and a drop point computed from the
visible rows alone would carry someone else's lines. `.tex` notes do not drag — their structure is
`\section{…}` and this model does not describe it. The active-heading highlight is untouched by all
of it.

### Comfort

- **Fold state survives a reload, per note, keyed by heading SLUG.** Line numbers are the one
  property of a fold that a keystroke three paragraphs above it changes, and a fold that silently
  walks to another section on the next reload is worse than no persistence at all. Slugs are the
  reading view's ids, generated by the rule the outline and the anchor table already share.
  `localStorage` under `vellum.folds`, LRU-capped at 80 notes, debounced 250ms (one "fold all
  below" is one gesture and a dozen effects).
- **Focus section (`Ctrl/Cmd+Alt+F`) collapses everything but the section at the caret**, ancestors
  and descendants excepted, and Esc restores the fold set EXACTLY as it was — a reader who had
  three sections folded before pressing it must not find them open afterwards. Entering toasts
  "Focused one section — Esc restores", because a mode that removes what is on screen has to say so
  and name the way back in the same breath. **The Esc binding is NOT `Prec.high`**: under vim Esc
  is sacred, so it sits below the vim compartment (Ctrl/Cmd+Alt+F is the way back out there) and
  declines — returns `false` — whenever no section is focused, so nothing else loses the key.
- **Jump to previous / next heading is `Ctrl/Cmd+Alt+↑` / `↓`**, checked against the whole map:
  Ctrl/Cmd+B, +I and +U are formatting's, Ctrl/Cmd+Arrow is move-line, Alt+Arrow is CodeMirror's
  own, Ctrl/Cmd+Shift+[ / ] fold and Ctrl/Cmd+Alt+[ / ] fold all, Ctrl/Cmd+Alt+T is templates.
  The editor answers it from its keymap; in reading mode, where there is no caret, the shell
  answers it as a SCROLL, off the same active-heading signal the outline highlights with — so the
  key, the highlight and the panel always agree about which section the reader is in.
- **Auto-numbered headings are a READING affordance and never touch the source.** Nothing is
  written into the markdown, so a note can be numbered today and plain tomorrow and reach git
  unchanged. Two switches, and the note's own one wins in BOTH directions: a device preference
  (`vellum.headingNumbers`, off by default, toggled by the outline header's `1.` — it lives over
  the list it numbers), and frontmatter `numbered: true` / `false`. **The blog reads frontmatter
  ONLY**: a visitor has no preference of ours, so a published post is numbered because its author
  said so in the file, and an admin whose device preference is on must not see a preview no visitor
  will get. Depth is relative to the shallowest heading present, a skipped level advances one
  counter rather than three, and a note whose FIRST heading is its only `#` has that h1 treated as
  the title — numbering it "1." and its real sections "1.1, 1.2" puts the table of contents one
  level deeper than the document it describes. Numerals follow `getNumerals()`, the same system
  every count in the chrome uses: an outline row printing "1.1" in a panel whose tag counts read
  "١١٤" is exactly the mismatch that rule exists to prevent.

### The divider is punctuation, and colour alone was not enough

`.s-rv-hr` was `border-top: 1px solid var(--border)` — byte-identical to the h1 rule and to the
blog byline rule, so one page carried three chrome hairlines and one CONTENT hairline at the same
weight, colour and measure. It is gold now, and **the first pass at that was still not the
distinction it looked like**: measured on iron-gall, 1px of `--accent` at 65% alpha over a
near-black ground is FAINTER than the 1px `--border` hairline 200px above it, so the hierarchy was
not merely undistinguished but inverted. It is **2px, gold at 88%, solid from 15% to 85% of the
measure and fading to nothing at both ends** — against a 1px `--border` chrome rule that is a
difference of weight AND colour AND length, three ways at once. Stated entirely in `--accent`, so
all fifteen themes follow their own gold and none needs a rule of its own; the chrome rules are
untouched, because this is about the divider earning a treatment, not about making furniture
quieter. Markdown's three spellings become two things a typesetter has always had to say: `---` /
`___` is the plain rule (a BREATH, not a border — it does not touch the measure's edges), `***`
adds the ✦ the wordmark carries. **All three surfaces draw the same divider**: `.s-rv-hr` in
reading view, `.cm-s-hr-rule` in live preview (`RuleWidget`), and `.s-blog .s-rv-hr` for the
published page — that last one stated in `reading.css` beside the others rather than in `blog.css`,
because the visitor refinements are scoped `.s-app--visitor`, a class the blog shell never sees,
and a fourth copy of these numbers is how the surfaces drifted in the first place.

## Banner resolution — one ladder, four rungs (client/banner.ts, GET /api/banner)

A `banner:` value is a reference to an image, and until now it was the ONLY reference form in
the product with its own rule. `bannerSrc()` sent anything that was not an `https://` URL
straight to `/api/file?path=<value>`, so a BARE FILENAME — the form every Obsidian user writes,
and the only one with no autocomplete behind it — 404'd unless the image happened to sit at the
vault root, while `[[wikilinks]]`, `![[embeds]]` and `![](Media/x.png)` had always found a file
by basename from anywhere. The ladder, in order:

1. an `https://` URL — used as-is. Any OTHER scheme (`http:`, `data:`, `javascript:`) resolves
   to null rather than being mangled into a vault path: a mixed-content hero is worse than no
   hero, and `normalizeRel("http://x/y.png")` produces a path that can only 404.
2. an exact vault-relative path, case-insensitively (`attachmentsByPathLower`) — a value typed
   from what a file manager showed must not be the one form that is case-SENSITIVE.
3. that path relative to the referring note's OWN folder — `cover.png` beside the note,
   `img/cover.png` under it, `../shared/cover.png` beside its parent.
4. the basename, through `resolveEmbed()` — the same case-insensitive, shortest-path-wins index
   the embed layer uses.

`server/indexer.ts resolveImageRef(value, fromDir?)` is the ONE implementation. `resolveBanner()`
(post list, blog hero, og:image, the published-attachment allowlist) is a wrapper that passes the
note's own folder; `settingsAssetPaths()` runs the logo/home-banner/favicon values through it too,
because allowlisting only the literal string is how a logo the admin can see in the settings panel
404s for every visitor. `GET /api/banner?value=&note=` serves the client, visitor-scoped to files
`/api/file` would actually hand over (allowlisted attachment or settings asset) — a miss is
`200 {path:null}`, like `/api/resolve`, because a typo'd banner is an ordinary state of a vault.
The client caches per `(value, note)` pair, misses included, and drops the cache wherever
`clearBrokenEmbeds()` runs: the same events invalidate both, the visitor-preview toggle included.

### A banner that names nothing is NEVER silent — and never loud at a visitor

`buildBannerEl()` used to attach `img.onerror → wrap.remove()`. A typo and "no banner at all"
therefore rendered identically, on the one surface whose entire job is to show you your own file:
the author writes `banner: cover.png`, nothing appears, and nothing distinguishes a broken value
from a feature that is not working. Split by AUDIENCE, exactly as the embed layer splits its
broken-embed chip from the blog's quiet missing-image card:

- **Admin** (`buildBannerEl(value, class, {admin: true})`) — the dashed `…__missing` card: the
  same dashed-danger language as `cm-s-embed-broken`, the failing value spelled out at `--text`
  (a filename is text a reader must READ, so never `--text-faint`), and a **Set banner…** button
  dispatching the same `vellum:set-banner` event the properties card's action does. The fix is one
  click from the symptom. The editor is admin-only by construction; the reading view passes
  `useStore.getState().admin`, which is already false inside visitor preview.
- **Visitor** — nothing at all. A stranger cannot act on it, and a dashed box on a published
  article is the author's mess on the reader's page. The blog's own hero/thumbnail keep falling
  through to the generated gradient.

`useBannerSrc()` (client/components/BannerImg.tsx) is the React half — the logo, the dashboard
hero, the settings image field and both banner modals read a typed value through it. Its `pending`
state is load-bearing: "we have not asked yet" must not paint as "this names nothing".

## Templates (client/templates.ts, client/templateActions.ts)

Obsidian's core Templates plugin, so a vault dragged over works UNMODIFIED: `{{date}}`,
`{{time}}`, `{{title}}`, `{{date:FORMAT}}` / `{{time:FORMAT}}` with moment-style tokens and
`[literal]` escapes. Two additions, both because this product has a calendar setting Obsidian
does not: `{{Title}}` (Title Case) and `{{hdate}}` / `{{date:hijri}}` (Umm al-Qura, through
`shared/dates.ts` — nothing here hand-rolls a lunar calendar or a month name).

**Title Case exempts the FIRST and the LAST word** from the small-word list, which is the rule
every style that has one states (Chicago, AP). Exempting only the first was a bug with teeth: a
note the reader named "From Template A" came back as "From Template a" — the trailing "A" is not
an article there, it is the name of the thing, and `{{Title}}` had quietly downcased a capital the
author typed. Interior small words still fall, which is the whole point of the list ("The Lord Of
The Rings" → "The Lord of the Rings"), and a word carrying an INNER capital is always left alone
("iOS notes" → "iOS Notes", never "Ios Notes").

**An unknown placeholder is left VERBATIM.** `{{cursor}}`, a Templater expression, a stray `{{`:
blanking a token we do not implement destroys text the author typed AND hides the fact that the
template expects something we do not do.

**Where the site's date settings apply, and where they deliberately do not.** A template's date
lands in two kinds of place that want opposite things. The NAMED formats (`{{date:long}}`,
`full`, `medium`, `short`) and `{{hdate}}` are prose: they go through `formatCalendarDate()`, the
same formatter the blog cards use, and follow `settings.dateCalendar` and the numeral policy. The
TOKEN formats stay Gregorian and Western-digit — `{{date}}` is `YYYY-MM-DD` by Obsidian's
definition, it lands in `date:` frontmatter lines and filenames, and `١٤٤٨-٠٢-١٣` there is a date
field nothing can parse and a year off by six centuries. A token format that asks for a month or
weekday NAME is prose by construction, so its digits follow the numeral policy too.

### Frontmatter hygiene — a fix, not a feature

- **Identity keys are MINTED, never copied.** `id`, `uuid`, `guid`, `permalink`, `slug`. The
  owner's own template carries `id: 1733593454224005` and every note ever created from it
  inherited that exact value — a duplicate-key bug that spreads silently and only surfaces when
  something downstream keys on it. The fresh value keeps the SHAPE of the one it replaces: a uuid
  stays a uuid, a 16-digit timestamp stays 16 digits (`mintIdentity`). The key is in the template
  because something parses it; a shape change is the same bug wearing different clothes.
- **Merge, never stack.** Inserting into a note that already has frontmatter folds the template's
  keys into the EXISTING block. A second `---` block halfway down a file is not frontmatter — it
  is a horizontal rule followed by text that looks like YAML.
- **The target wins on a shared key, and no key appears twice.** The note's `publish:`, `date:`,
  `tags:` are facts about that note; the template's are defaults. Entries are kept as RAW LINES
  and never round-tripped through a YAML serializer, so lists, nested maps, quoted strings with
  colons and block scalars all survive byte for byte.

### The folder, and what it means for the blog

`settings.templatesFolder`, vault-relative. Unset, the server auto-detects — `Templates`,
`_templates`, `قوالب`, with a leading ordering prefix stripped (`4 - Templates`, `04. Templates`;
real vaults number their top level) — and matches WHOLE, so "Templates for clients" is a folder of
notes, not of templates. Ambiguity means **null**, never a guess: a wrong guess hides real posts
from the blog and offers the wrong list of templates, which is strictly worse than asking. The
merge rule lives in `server/settings.ts templatesFolder()` and the indexer calls it lazily —
the two modules are a cycle (settings → site → indexer), so only a runtime call is safe either way.

`posts()` skips notes under it, in the ADMIN list as well as the visitor one: a template carrying
the `publish: true` it exists to hand DOWN would otherwise appear on the site as an article of
literal `{{date}}` placeholders, and the admin's post list is the one that answers "what is on my
blog". `settings.defaultTemplate` applies one template to every note created from inside Vellum;
off by default, because a product that silently writes into every new note is a product that has
to be fought. A failure there is logged and toasted and the note stays empty — creation never
depends on it.

### Keys and surfaces

`Ctrl/Cmd Alt T` inserts, `Ctrl/Cmd Alt Shift T` creates — one key, `Shift` picks the second
command, exactly the shape the pane toggles kept. **Alt is not decoration**: `Ctrl/Cmd T` is the
browser's new tab and `Ctrl/Cmd Shift T` reopens a closed one, neither is takeable, and a
keystroke that fights the browser is a keystroke that loses. Resolved through `shortcutKey(e)`
like every other binding, which is what makes it work when Alt rewrites `key` on macOS (Option+T
is "†") AND when the layout does (Arabic's T key types "ف") — and which excludes `AltGraph`
without this binding spelling the guard itself. Both commands are in the palette; "New note from template…" is
also in the tree's folder menu, where it carries a DESTINATION the other two doors do not.

The picker previews the template's body with placeholders ALREADY FILLED — what is about to land,
not what the file says: a template's name says almost nothing about what it will put in the note,
and the difference between two of them is often three lines of frontmatter. "New note from
template…" asks for the NAME first, so `{{title}}` in that preview is the real one.

## Localization: calendar, note layout, tag labels

Three display features, one section, because they answer one question — what does this instance
look like to a reader who does not read English — and because all three share the same hard
rule: **nothing here changes a byte in the vault.** No frontmatter is rewritten, no tag is
renamed, no filename moves. Every one of them is a rendering decision that a `git diff` of the
vault cannot see.

### Hijri dates (`shared/dates.ts`, `client/dates.ts`)

`settings.dateCalendar` = `"gregorian"` (default) | `"hijri"` | `"both"`. No env counterpart,
for `languageToggle`'s reason: it is a runtime editorial choice whose default is the one that
changes nothing. It rides `/api/me` to **every** session and in **both** shells (the app's own
moderation rows, sync status and settings print dates too), and only when it is not the default,
so a default instance's payload is byte-for-byte what it was.

- **`islamic-umalqura`, and the choice is documented in the module.** Intl offers four Islamic
  calendars. `islamic` is observational and drifts by a day between ICU builds; `islamic-civil`
  and `islamic-tbla` are the tabular variants, which never drift and are not what any Arabic
  reader's wall calendar says. Umm al-Qura is the only one that is both stable and
  recognisable, so it is hard-coded — a display convention, not a preference with a long tail.
- **`client/dates.ts` is THE place a date is formatted for a human**, the way `i18n.ts` is the
  place chrome copy lives and `shared/numerals.ts` is the place numerals are decided. Four
  surfaces each held their own `Intl.DateTimeFormat` call before this landed (blog meta and
  dashboard cards, marginalia, moderation, the backup badge). That was survivable with one
  calendar; with three it means a site that prints `٢ صفر` on a post and `15 Aug` in the
  moderation row beside it, and a reader is right to read one of them as a bug. The calendar is
  pushed into the module by `state.ts::loadMe`, beside `setLang`/`setNumeralLocale`, and BEFORE
  the store commit — a component re-rendering off `dateCalendar` must already see `siteDate()`
  answering in the new calendar.
- **`"both"` is ordered by the SITE LANGUAGE, and the secondary half is bidi-isolated.** Arabic
  leads with the Hijri date and parenthesises the Gregorian one; English does the reverse. The
  parentheses go INSIDE the FSI…PDI isolate, because they belong to the run they enclose — the
  same rule `tf()` applies to every interpolated value. Month names come from Intl and digits
  from `localeDigits(blogLocale)`: nothing is hand-spelled, and one line never carries two
  numbering systems.
- **RSS IS NOT A CALLER.** `/feed.xml` keeps RFC-822 Gregorian `<pubDate>`s whatever the
  instance displays. It is a wire format an aggregator parses, not a date a person reads, and a
  reader changing their site's calendar must not change what a feed consumer sees.
- **Daily notes keep ISO filenames and display the configured calendar.**
  `daily/2026-08-16.md` is still that path on disk, in every `[[2026-08-16]]` and in every sort.
  `dailyNoteLabel()` (client/daily.ts) answers **null** in gregorian mode — there the filename
  already IS the date, and re-spelling it as "16 August 2026" would change a label nobody
  complained about — and the Hijri (or dual) date otherwise, which the status-bar crumb prints.
  The date is read back at LOCAL noon, because `dailyNotePath()` built the name from local date
  parts: parsing it as UTC midnight shifts the day for half the planet, and a shifted day is a
  different MONTH NAME in Hijri, not a rounding error.
- The moderation row's "same year, so drop the year" test is Gregorian by construction, so it
  is switched off outside gregorian mode: a comment from eight months ago sits in a different
  Hijri year and would lose the one digit that says so.

### Note direction & alignment (`shared/textLayout.ts`, `client/textLayout.ts`)

`settings.textDirection` = `"auto"` (default) | `"ltr"` | `"rtl"`; `settings.textAlign` =
`"start"` (default) | `"left"` | `"right"` | `"center"` | `"justify"`. Both defaults are the
behaviour that shipped. **A note overrides either from its own frontmatter — `dir:` / `align:`
— and the note wins.**

- **ONE module resolves it and ONE module applies it.** Three surfaces have to agree byte for
  byte (the editor's prose, the reading view, the blog article), and three components each
  setting their own `dir` and `text-align` is three chances to disagree — invisible until a
  reader opens the same note in the editor and on the public site and finds two documents.
  `applyNoteLayoutTo(el, content)` is the reading view's and the blog's single call, on the
  SAME element the renderer just handed them; `client/editor/noteLayout.ts` is the editor's,
  because its prose is a live document whose frontmatter the reader is editing.
- **`dir` is an ATTRIBUTE, alignment is a DATA ATTRIBUTE, and neither is an inline style.**
  `auto` has no CSS spelling, so the direction has to be the attribute the browser's own bidi
  algorithm reads. The alignment is `data-note-align` rather than `style="text-align:…"`
  because an inline value is inherited by every code fence and table in the note with nothing
  short of `!important` able to take it back — and those are exactly what must never be centred.
- **A PINNED DIRECTION HAS TO REACH THE BLOCKS.** Every rendered note block carries `dir="auto"`
  (the rule that lets an Arabic callout sit beside an English one, each barred on its own side),
  and a block attribute OUTRANKS its container's. So a note that pinned `rtl` was pinning a
  value every paragraph then overrode: the editor obeyed it (its per-line attribute IS the block
  attribute) and the reading view did not — the same note as two documents. `pinBlocks()` pushes
  the pin down onto the blocks that carry `auto`, marks them so it can be undone, and skips the
  ones that keep their own direction.
- **WHAT NEVER TAKES A CENTRED OR JUSTIFIED MEASURE, OR A PINNED DIRECTION:** code (fenced,
  indented and inline), tables, and display maths. `const x = 1;` inside a `dir="rtl"` container
  renders as `;const x = 1` — the semicolon swept to the far end of the line, in the one place
  on screen where the position of punctuation IS the meaning — and a `|---|---|` rule stops
  lining up with its own header. In the rendered view that is `textlayout.css`
  (`unicode-bidi: plaintext`, the CSS spelling of `dir="auto"`, so an Arabic string literal
  inside a code block still sets correctly); in the EDITOR those blocks are just LINES, so
  `noteLayout.ts::sourceLines()` finds them from the syntax tree and **`bidi.ts` decorates
  them** — that file is the only writer of the per-line `dir` attribute, because two plugins
  writing one attribute is a coin toss. Callouts, quotes and lists are prose and follow the
  note. An authored column alignment (`:---:` → `.s-rv-al-c`) always wins: it is content.
- **AND THAT CARVE-OUT IS UNCONDITIONAL, NOT ONLY UNDER A PIN.** Scoping it to `[data-note-dir]`
  covered the smaller half of the problem: a note that pins nothing — nearly all of them — has no
  `dir` on its container, and a `<pre>` carries no `dir="auto"` of its own the way a paragraph
  does, so on an ARABIC INSTANCE every code block in the reading view, the blog article and the
  hover card inherited `rtl` straight from `<html>` and rendered `const x = 1;` as `;const x = 1`.
  Measured on a plain English note with no frontmatter at all, so it was never about the note: it
  was the SHELL's direction reaching content that is not prose. The rule is keyed on the
  renderer's own classes (`.s-rv-pre`, `.s-rv-mathblock`, `.s-rv-math--display`, `.katex-display`
  block; `.s-rv-code`, `.s-rv-math` inline as an isolate rather than plaintext, since a run inside
  a sentence must not become its own paragraph), which exist nowhere but inside rendered note
  content — so it reaches all three surfaces without any of them opting in, and reaches no chrome.
- **A TABLE TAKES ITS DIRECTION FROM ITS OWN CONTENT**, `dir="auto"` on the `<table>`. The cells
  already carried it and the table did not, so it inherited the shell: an English table on an
  Arabic instance came out with its COLUMNS REVERSED while each cell's text sat the right way
  round inside it. An Arabic table still reads right to left, and a pinned note still overrides
  both through `pinBlocks()`.
- **A `.tex` note takes the direction and refuses the measure.** Its source is markup end to
  end; a centred `\begin{…}` moves under the reader's caret for no gain.
- **THE DISAGREEMENT IS BROADCAST, IN TWO PLACES, IN ONE VOICE.** `layoutBadge()` returns the
  chip or null, and null is the answer whenever the note agrees with the site — a badge that is
  always lit is a badge nobody reads. The properties card carries it in its header (beside the
  tag pills, where the frontmatter is) and the status bar as a quiet `.s-statusbar__layout`
  segment. Both are LABELS, not switches: the value lives in the note's frontmatter, which is
  where it is changed, so neither takes the mode pill's lit treatment. The `text` names only
  the halves that DIFFER; the `title` names BOTH with their sources, because "why is this note
  centred" is the question the chip exists to answer and half an answer sends the reader to the
  file.
- **A settings save repaints an OPEN note.** `noteLayoutChanged` (a `StateEffect`, the
  `languageChanged` pattern one file over) is dispatched by `Editor.tsx` when the store's
  `textDirection`/`textAlign` move, and both editor plugins rebuild on it; `ReadingView` takes
  the same two values as render dependencies. Rebuilding the whole `EditorState` would answer
  too, and would spend the reader's undo history on two attributes.

### Localised tag labels (`shared/tagLabels.ts`, `server/tagLabels.ts`, `client/tagLabels.ts`)

**DISPLAY ONLY.** `#software` stays `#software` in every note, every URL, every `EXCLUDE_TAGS`
match and every search key; what changes is the WORD on a chip. Resolution order, highest first:

1. **the tag's own page** — a note at `<settings.tagsFolder>/<tag>.md` (auto-detected, then
   `tags/`; nested
   tags nest) carrying a frontmatter `labels: { ar: … }` map. First because a label written
   there travels WITH the vault: clone it, sync it, open it in Obsidian, and the naming is still
   a note. The PATH is the tag, so a page cannot disagree with its own filename. A bare
   `labels: برمجيات` is read as the Arabic label, which is what a hand-written page says.
2. **`settings.tagLabels`** — `tag → language → label`, for tags with no page. Edited in
   Settings → Language as a compact table, one row per tag and a column per language.
3. **the canonical tag**, which is what every unlabelled tag renders as and what the whole
   feature degrades to.

Merging is per LANGUAGE, not per tag: a page naming only an Arabic label must not delete the
English one a settings row gives the same tag.

- **`tagsFolder` AUTO-DETECTS, exactly as `templatesFolder` does.** It shipped with a hard `tags`
  default beside a templates field that looked for its folder, and on the vault both were measured
  against — whose folders are `4 - Templates` and `2 - Tags` — the picker found its templates and
  every Arabic tag chip silently rendered its canonical English tag. Two halves of one promise
  ("works on an imported Obsidian vault"), landed by two people, disagreeing. `detectTagsFolder()`
  is `detectTemplatesFolder()`'s rule verbatim — an ordering prefix is not part of the name, the
  rest must match WHOLE, a single match wins, several match and the single ROOT-level one wins,
  otherwise null — over `/^_?tags?$|^وسوم$|^الوسوم$/i`. It resolves in `server/settings.ts` beside
  `templatesFolder()` rather than in `server/tagLabels.ts` where it began: the two fields answer
  the same question about the same vault, and a reader comparing them should not read two files to
  learn that only one of them looks. Unlike templates it never answers null — an unlabelled chip is
  a correct chip, so the documented `tags` name is a safe floor. `effectiveSettings` carries
  `tagsFolderDetected` beside `templatesFolderDetected`, and the panel prints the found folder from
  the SAME `templatesDetectedHint` string, because a second copy of "Found automatically: {folder}"
  is a second copy to translate.

- **`/api/tag-labels` is scoped like `/api/tags`.** Open to every session (a chip's word is what
  the public site paints), but a visitor is told the labels of the tags that session can already
  enumerate. An unfiltered map would name every `EXCLUDE_TAGS` tag and every tag carried solely
  by language-filtered notes — precisely the existence those two rules withhold.
- **The labels are read off the INDEX, not off the disk.** `NoteRecord.labels` holds a cleaned
  `{ lang: label }` map for any note that carries the key, and `tagPageLabels(folder)` filters
  by path at query time. Storing it unconditionally rather than only for notes under the tags
  folder is deliberate: the folder is a runtime setting, and gating the read on it would make
  renaming `tags/` to `topics/` need a full reindex to take effect.
- **URLs keep canonical slugs, and the localised form is a REDIRECT.** `topicUrl()` is unchanged
  everywhere; `BlogTopic` resolves the segment through `canonical()` (which answers for an
  already-canonical value too, so it is one lookup and not a branch) and rewrites the address
  with `history.replaceState` — never a push, because a history entry that immediately redirects
  turns Back into a loop. A labelled chip carries the canonical tag in its `title`.
- **SEARCH MATCHES BOTH SPELLINGS, and it does so by rewriting the QUERY.** `expandTagQuery()`
  appends a tag's canonical form when the query holds one of its labels. Feeding the labels into
  minisearch's `tags` field instead would tie a display setting to the index: editing one label
  in the settings panel would leave every note's indexed tags stale until a reindex, and saving
  a tag page in Obsidian would have to re-index every note carrying the tag. The query is where
  the two vocabularies meet, it is one string long, and canonical terms already match — so the
  rewrite only ADDS.
- **`client/tagLabels.ts` is a plain module with subscribers**, like `i18n.ts` and `sync.ts`:
  every tag surface in both shells needs it, several of them are imperative DOM with no React
  context to reach into (the properties card, the blog nav's measuring pass), and the map is one
  instance-wide fact. `useTagLabels()` hands React a VERSION rather than the map, because
  `useSyncExternalStore` compares snapshots by identity and the map is replaced wholesale on
  every load. A failed load is SILENT and keeps the previous map: a chip falling back to its
  canonical tag is a correct chip.
- **ONE PILL, ONE BUILDER — and `renderInline` was the copy that did not localise.** The reading
  view builds a tag pill twice: a DOM builder (the properties card's) and an HTML-string one
  inside `renderInline`, which is what paragraphs, headings, table cells, list items, callouts and
  footnotes ALL go through. Only the first read the label, so an Arabic instance printed
  «التعمية» on its sidebar cloud, its properties cards and its blog nav while every tag in the
  PROSE — and every tag in a HOVER CARD, which renders through the same function — still read
  `#cryptography`. Both now carry the label as text, the canonical tag in `data-tag` (what the
  delegated click searches on) and in `title`, and `dir="auto"`, which is not optional: `#` is
  bidi-neutral, so a chip without it reads «التعمية#» under an RTL base direction.
- **The OUTLINE localises the tags in a heading too** (`labelTagsInText`, display only). A row
  reading "Notes on #cryptography" pointing at a heading reading «Notes on #التعمية» is the same
  disagreement the heading NUMBERS were made one computation to avoid; the row's `title` keeps the
  heading as the file spells it. It is deliberately NOT applied to `Section.text`, which is
  written into files (`[[Note#Heading]]`, the stub an extraction leaves) and into anchors.
- **The EDITOR's inline tags stay canonical.** They are a mark decoration over the source
  characters, not a widget replacing them: relabelling them would make the pill a different width
  from the text under the caret, which is precisely what `check-caret` exists to catch.
- **The blog nav measures the LABEL.** `NavTopics` lays its row out from a hidden twin; measuring
  the canonical tag while drawing the Arabic label is how the row ends up one topic too wide at
  exactly the width it was tuned for.
- **The settings editor is a TABLE, and it writes the map WHOLE.** Two scripts side by side in a
  line-oriented field reorder around their own separator, and the reader is then editing a
  string they cannot read back. The tag column is `dir="ltr"` (it is a URL segment and a search
  key); the label columns are `dir="auto"`. The PATCH replaces `tagLabels` rather than merging
  it, because the editor holds all of it on screen and a merging patch would make deleting a row
  impossible. Emptying both labels deletes the label on save — there is nothing to confirm, the
  tag itself is untouched, and what comes back is the tag's own name. `effectiveSettings` returns
  the STORED map only: prefilling the editor with a label the vault owns would copy it into
  `settings.json` the first time the panel was saved, and the page would stop being the source
  of truth for its own name.

## Fenced code is a CHARACTER and a LENGTH (shared/fences.ts)

Four separate line-walkers each carried the same four characters of regex and the same wrong
idea: `const FENCE_RE = /^\s*(```|~~~)/` driving `inFence = !inFence`. A toggle is blind to which
marker opened a block and how long its run was. CommonMark closes a fence only on a run of the
SAME character, AT LEAST AS LONG as the opener, with nothing but whitespace after it — so a
```` ```markdown ```` block whose body shows a `~~~` block "closed" on the inner marker and every
line after it was read as document structure.

- **The outline REWRITES THE FILE, which is what made this data loss and not a display bug.**
  `client/reading/toc.ts::extractHeadings` feeds `client/sections.ts`, and therefore
  `sectionsOf()`, `moveSection()`, `extractSection()` and every outline row. A `### ` living
  inside such a fence became a section the document does not have: reproduced end to end, the
  outline showed 3 rows over a 2-heading note and ONE drag of the phantom row swallowed
  `# Next section` and its body INTO the code fence, deleted the note's second section and
  dropped a paragraph out of the document. Extraction was worse — it carried the fence CLOSERS
  out into the new note and left the source with an unbalanced fence.
- **The anchor table had to agree with it.** `shared/anchors.ts` generates the ids
  `[[Note#anchor]]`, transclusion and the hover previews resolve against, and the reading view
  assigns its heading ids from `toc.ts`. Two scanners with two answers is an anchor that silently
  misses, so both now read `shared/fences.ts`. `client/editor/links.ts` (the `[[Note#` completion
  list and `findHeadingLine`) and `server/indexer.ts`'s `FenceSkipper` (excerpts, snippets,
  backlink context) read it too — a note is one document and cannot have two opinions about
  where its code is.
- **A backtick fence's info string may not contain a backtick**, which is what keeps a line of
  inline code from opening a block.
- **A line's carriage return comes off before it is matched.** `md.replace(/\r\n/g,"\n")` was not
  the same thing: a CRLF note whose final newline has been trimmed ends in a DANGLING `\r`, and
  `.` and `$` do not cross one — so that line matched neither the fence regex nor the heading
  regex and the file's last fence never closed. `sourceLines()` is the split every caller uses.
- **THE GATE WAS SOUND, ITS CORPUS WAS ONE SHAPE SHORT.** `scripts/check-sections.mjs` only ever
  emitted fences that open and close with the same marker, so a toggle passed all four thousand
  documents. `makeDoc()` now also emits a ```` ```markdown ```` block holding a `~~~` block and a
  four-backtick block holding a three-backtick one; the UNCHANGED assertions then reported 3,535
  failures out of 4,000 against the old scanner, and 0 against this one.

## Line endings are the note's, not ours (client/sections.ts, client/templates.ts)

Two of the section/template write paths silently rewrote every line ending in a file. No content
was lost either way — but this file's own rule for these writers is that blank lines are only ever
ADDED at the seams, and converting twelve hundred terminators is a far larger edit nobody asked
for. On a `gitSync` instance it lands as the whole file in the next diff.

- **`splitLines()` keeps each line's OWN terminator.** It used to return one `nl` for the whole
  document, chosen as `md.includes("\r\n") ? "\r\n" : "\n"` — which is not "the document's
  flavour", it is "any CRLF anywhere wins": a note with ONE stray CRLF had all six of its endings
  converted by a single outline drag (measured: 1 CRLF in, 6 CRLF out, 0 bare LF left; now 1 in,
  1 out). The majority ending is still computed, and is used for exactly one thing — the blank
  line the reorder may ADD at a seam, which has to end somehow.
- **`sectionOffsets()` was the same root cause with a different symptom.** It accumulated
  character offsets with that single `nl`, so on a mixed-ending note it drifted one byte per LF
  line walked past: the offsets for section B of `# A\nbody a\n\r\n# B\nbody b\n` sliced
  `B\nbody b\n` — one character into the heading. Its only consumer is `selectSection()`, so the
  blast radius was a wrong selection rather than a wrong write. Now it walks the same per-line
  terminators and slices `# B\nbody b\n`.
- **`applyTemplate()` no longer normalizes the TARGET.** It did `splitFrontmatter(targetSrc
  .replace(/\r\n/g,"\n"))` and returned that as `content`, which `templateActions.ts` writes
  straight back — so inserting a template into an ordinary Windows or git-synced note rewrote
  every ending to LF (measured: 7 CRLF in the target, 0 in the merged content; now 9 in, 11 out,
  and the two added are the template's own merged rows). The template's body and the merged
  frontmatter block are re-ended in the TARGET's majority ending on the way in.
- **The gate asserts it.** `makeDoc()` now emits mixed-ending documents (a third of the CRLF
  runs), and a reorder must never DECREASE either ending count — it may only add lines. An
  extraction may not introduce an ending the source document did not have at all.

## The section ⋯ on a coarse pointer (client/styles/preview.css)

The menu behind this button has four doors on a desktop — right-click a heading, right-click an
outline row, `Shift+F10`, and the keystrokes for the commands it holds. On a phone it has ONE, and
that one used to hang off the leading edge of the screen: `inset-inline-start: -52px` on a 30px
button hung off a zero-width host, with nothing clamping it against a `--prose-gutter` of
`min(56px, 7.37%)`. Measured on Chromium at 390: every heading's button at left=-17.3 / right=12.7,
58% off-screen; at 360, left=-19.5 / right=10.5. DESIGN.md: "Never let any panel's content overflow
the viewport horizontally."

- **The gutter cannot hold it at ANY width, so it leaves the gutter.** The fold chevron already
  owns that space (-26px, 18px wide) and the touch shell's rule is a 44px target: 44 + 18 is 62px
  of controls for 56px of gutter even on a tablet, which is why a 30px compromise shipped under a
  comment claiming 44. On a coarse pointer the ⋯ moves to the heading's INLINE END, inside the
  column, and the gutter is left to the chevron alone. Measured after: 317.3–361.3 at 390,
  289.5–333.5 at 360, `scrollWidth` still equal to the viewport, and the menu opens on tap fully
  inside the viewport (101.3–331.8 of 390).
- **The heading LINE is the containing block and reserves the room** (`position: relative` +
  `padding-inline-end: 44px`, scoped by `:has(.cm-s-sectbtn)` so it reaches heading lines only),
  which is what keeps the button off the title's letters. Everything is logical: RTL puts the ⋯
  at 28.7–72.7 and the chevron at 367.3–385.3.
- **A context menu is a touch surface too.** `.s-menu__item` takes a 44px floor on a coarse
  pointer — it is the whole door this affordance opens, and 33.6px rows were the same half-promise
  the button used to make.
- **On a FINE pointer the pair is one cluster, so it lines up.** At `bottom: -0.28em` the ⋯ centre
  sat a measured 2px under the chevron's at every heading level (the widget host does not inherit
  the heading's size, so the offset is a constant); `calc(-0.28em + 2px)` puts the delta at 0.0px
  on every heading level measured (h1, h2, h3).

## A separator that cannot be read as a digit (client/metaSep.tsx)

The blog's meta line, the article header, the app's status bar, the graph HUD and the attachment
caption all print counts side by side and marked the boundary with U+00B7. At the 12–13px those
lines are set in, in the shipped Arabic face, that glyph is INDISTINGUISHABLE FROM `٠` — and it
sits flush against a run of Eastern Arabic digits. Measured on an Arabic instance with
`dateCalendar: both`: the status bar's DOM read `٥٦ كلمة · ٣١٠ حرفًا` and PAINTED as ٣١٠٠ —
310 characters read as 3,100, on the one surface the Hijri work exists to make legible.

- **The switch is on the NUMBERING SYSTEM, not the language.** An Arabic instance configured
  `ar-EG-u-nu-latn` prints Latin digits and a tick is safe there; the default `arab` numerals are
  the case that breaks.
- **What replaces it is not another character.** A character beside digits is how this happened.
  It is the HAIRLINE the status bar already marks its own groups with — 1px `--border`, the same
  rule at the same weight — which cannot be read as anything at all. English is untouched, byte
  for byte: "95 words · 518 chars", "1 August 2026 · 86 words · 1 min read".
- **`metaSepText()` is the string form**, for the two places an element cannot go (a joined
  attachment caption, a `title` attribute). There the Arabic case takes `،`, which is the
  punctuation the language already uses for this and is not a digit in any face.

## The template picker previews BOTH halves (client/components/TemplatePicker.tsx)

The module's own header says the preview exists because "the difference between two of them is
often three lines of frontmatter" — and it previewed `splitFrontmatter(note.content).body`. Two
templates whose bodies are both `# {{title}}` and whose blocks are `publish: true / tags:
[essay, longform] / banner: …` and `publish: false / tags: [private] / dir: rtl` previewed
IDENTICALLY, as the single line `# On the Ruled Page`. Picking the wrong row silently set
`publish: true` on a note bound for a public website, and the panel had shown nothing that could
warn anyone.

- **Rows, never the raw `---` block.** `templateProperties()` (client/templates.ts) reads the
  frontmatter into key/value pairs with the values in plain reading form: an inline list loses its
  brackets, a block list reads "a, b", a quoted scalar loses its quotes. The picker is outside the
  editor, where DESIGN.md forbids showing markup to a reader.
- **`publish: true` is marked, and named.** The row takes the accent and the panel carries one
  sentence — "Publishes the note to the public site" — because that is the only property in the
  set whose consequence is a stranger reading the note. The accent, not `--danger`: publishing is
  a thing the reader may well want, it just may not be a thing they meant to pick blind.
- **The body preview resolves ONE direction for the whole block.** `dir="auto"` on a `<pre>`
  resolves per bidi PARAGRAPH, and every newline in a `pre` ends one — so an Arabic template's
  Latin line flew to the opposite edge of the mono box while its neighbours stayed put. It is
  resolved once, over the whole body (`autoDir`).
- **The selected row carries the command palette's gold bar.** DESIGN.md specifies
  `--accent-soft` PLUS a 2px accent bar on the leading edge; this list shipped the ground without
  the bar, which is two answers to "which row am I on" in one product.

## Generated banners on a theme with no hue to spend (client/banner.ts)

Four light themes ship `--banner-tint: 0%` (parchment, sandstone, linen, solar), and there `hue()`
collapses to pure `--accent` for all three blobs — verified in the browser: the two extreme hash
hues resolve to the same colour on all four, and to different ones on iron-gall's 45%. What was
left to tell two posts apart was blob POSITION (invisible under a 55% accent floor: three blobs of
one colour on one ground is one wash wherever you put them), the base gradient's angle, and a rule
angle hashed over 20–69° — ONE QUADRANT — with a CONSTANT gap and a constant blob strength. Six
consecutive parchment thumbs at their shipped 132×88 came out the same beige hatched sticker.

- **Three more levers, and not one of them is a colour**, so all three survive a zero tint: the
  rule angle takes two bands (15–75° and 105–165°, never level, never steep) so two posts can be
  hatched in MIRRORED directions; the rule SPACING is hashed; and the blobs carry a per-post
  STRENGTH and reach. Measured over six titles: shipped gave gap 7 / strength 46 / spread 58 for
  every one of them and angles 26–65 with a duplicate pair; now gaps 4–8, strengths 40–58,
  spreads 58–66 and angles 18–156, with every post differing on at least two levers.
- **Card ↔ hero unity is preserved by construction.** Angle, spread and the strength scale are
  shared between the two sizes; only the gap (in the 0.64 ratio the shipped 7:11 already held) and
  the existing `boost` differ, because 130px of anything reads flatter than 780px of it.

## Justification needs a paragraph (client/textLayout.ts, styles/textlayout.css)

Most vaults that have been through a plain-text editor are wrapped at a fill column, and every one
of those source newlines is a forced break here (the editor draws a `.cm-line`, the reading view
and the blog draw a `<br>`). A forced break ends a LINE without ending the BLOCK, so a source line
wider than the measure is broken by the browser, its first half stretched to the far margin as if
it were mid-paragraph and its remainder left beside it as a two-word stub — all the way down the
note. Soft-wrapped prose, where one source line is one paragraph, justifies beautifully.

- **The note's SOURCE decides, once, and all three surfaces read the same answer off the same
  attribute** (`data-note-hardwrap`) — which is the entire point of this module. `isHardWrapped()`
  counts prose lines that sit in a RUN of two or more, skipping frontmatter, fenced code,
  headings, lists, quotes, table rows and link definitions; four such lines and a 60% share are
  the bar, so one wrapped block inside an otherwise soft-wrapped essay does not decide.
- **It is stamped only for the alignment it changes.** A hard-wrapped note that is centred, or
  flush, is a hard-wrapped note nothing is wrong with.
- **The chip says why.** A note whose frontmatter says `align: justify` still reads "Justified" —
  that is what its frontmatter says, and the chip names the frontmatter — but the tooltip now adds
  "set flush — this note's paragraphs are wrapped by hand", because a page that does not look
  justified with nothing on screen explaining it is the invisible-state trap this bar exists to
  close.

## The missing-banner card at 390 (client/styles/app.css)

`--text` on the failing value, because "a filename is text a reader must READ", was already the
rule — but `min-width: 0` plus `overflow-wrap: anywhere` let that value take the whole shortfall of
a phone-width row, where the icon, the label and the **Set banner…** button all compete on one
flex line and the value is the only item allowed to shrink. It went to 24.6px wide and broke ONE
GLYPH PER LINE — "kyo / to- / cov / er. / png" — stretching the card from 53.8px to 129.6px. A
`min-width: 14ch` floor gives the row a reason to wrap: the button drops to the next line and the
name keeps a readable measure (measured: 121.4px and one line at 390, 180.1px at 360, card height
back to 85.2px; 768 and 1440 unchanged at 53.8px). `anywhere` stays, for the pathological
80-character filename that still has to fit somewhere.

## Small corrections that came with the above

- **The blog's sticky masthead is OPAQUE.** It was `--bg` at 86% over a 12px backdrop blur, and a
  blurred-but-legible sentence is still a sentence: at 390, where the column is narrow and there is
  always prose under a 52px bar, "something the author put there." read clean through the word
  TOPICS. Blur softens contrast; it does not stop a reader parsing letterforms. The two hairlines
  are what separate the bar from the page, as they always were.
- **Outline heading numbers print the period the toggle promises.** The button is labelled "1.",
  the module header names the three spellings "1.", "2.3", "4.1.2", and the CSS beside the rows
  talks about a column of "9." / "10." / "11." — while the rows printed a bare "1 2 3".
  `numberLabel()` adds the terminator to a top-level number only; a compound number's own dots
  already say it is one. One function, so the outline and the rendered heading cannot disagree.
- **`tagLabels` is capped at 200 ENTRIES**, the number its sibling `excludeTags` has capped its
  length at since the day it was written. Per-key (50) and per-label (60) budgets existed; the map
  size did not, and a 5,000-entry PATCH was accepted with a 200 — `settings.json` grew to 378 KB
  and `GET /api/settings` to 489 KB, a response the settings panel fetches every time it opens.
  Visitor exposure was correctly nil throughout (`/api/tag-labels` stayed at 46 bytes), which makes
  it a self-inflicted wound rather than a hole. The 400 names the other half of the feature: a tag
  with a page in the tags folder is named there instead.
- **An absolute path in a vault path key is a 400, not a rewrite.** `normalizeRel()` strips the
  leading slash before `path.isAbsolute()` could ever see one, so `{"templatesFolder":"/etc"}`
  came back 200 stored as `etc` and `{"defaultTemplate":"/etc/passwd.md"}` as `etc/passwd.md`.
  `safeAbs()` kept both inside the vault so nothing escaped — but the admin who typed an absolute
  path silently got a DIFFERENT folder from the one they named, while `..`, a dotdir and a
  note-where-a-folder-belongs all answered with a clear 400. `vaultRel()` is the one helper
  `templatesFolder`, `defaultTemplate` and `home.note` share; Windows drive letters are refused
  the same way.
- **A heading a wikilink cannot spell falls back to its SLUG.** `copySectionLink` emitted
  `[[Note#<heading text>]]` verbatim, so `## Weird ]] | [[Other#x` produced a link the parser
  stops reading at the first `]]` — not a broken link so much as a link that quietly points
  somewhere else. The display text is still what goes in (it survives an edit to the heading's
  inline markup, which is why it was chosen); a heading carrying `[`, `]`, `#` or `|` takes
  `section.slug` instead, which `shared/anchors.ts` resolves by first and which is spellable by
  construction. The extraction stub is the same problem from the other end: `suggestedName()` and
  the prompt's own `check()` now refuse those four characters in a filename, because the stub left
  behind is `[[<that name>]]`.
- **An extraction refused for a name that is already taken says so.** `createNote` 409s before a
  byte of the source note is rewritten (verified: the source is untouched), so the reader's next
  move is to type another name — which "extracting failed" does not tell them.
  `templateActions.ts` makes exactly this distinction on exactly this 409.
- **The extraction Undo's permanent delete is documented where it happens.** It is the only delete
  in the product that bypasses `.trash/`, and `client/api.ts`'s own comment on that function is
  "a note is not a cheaper thing to lose than a folder". What it erases is a note this same toast
  created seconds ago whose entire content has just been written BACK into the source note on the
  line above, so `.trash` would hold a second copy of text the vault already has, under a name the
  reader chose once and then took back. The ordering is the safety: the restore lands first.
## Site design engine — the composed pages

`settings.publicLayout` gains a third value, **`"designed"`**, beside `app` and `blog` (stock, the
default). This section covers the VISIBLE half of it: the home page a design composes, the article
page it wraps, and the composer that edits both.

> **How the engine is laid out.** The design engine was built in three parts, and they were
> reconciled into one before landing. There is exactly ONE design document
> (`shared/design.ts`, `DesignDoc`), ONE store (`server/designs.ts` →
> `VELLUM_DATA/designs.json`), ONE HTTP surface (`server/designRoutes.ts`, mounted at
> `/api/design`), ONE public renderer (`client/design/`) and ONE composer
> (`client/components/design/`). The chrome half of the document — nav, typography, header,
> footer — has its own module, `shared/designChrome.ts`, and hangs off the document as
> `DesignDoc.chrome`; it is a separate FILE, not a separate document, because two modules
> describing one file is how a store ends up with two ideas of what a design is. Stylesheets:
> `styles/design.css` (the rendered site) and `styles/designer.css` + `styles/composer.css`
> (the panel).

**THE STOCK BLOG IS A CODE PATH THIS NAMESPACE ONLY READS FROM.** `client/blog/` and
`styles/blog.css` are not mutated, forked, monkey-patched or conditionally branched — the diff is
the proof, and it is meant to be. Designed mode composes its OWN tree (`DesignedSite`,
`DesignedArticle`) out of the stock furniture it imports: `TagChips` and `PostMetaLine` from
`PostList.tsx`, `formatDate`/`NavLink`/`isRtlText` from `util.tsx`, `topicUrl` from `nav.ts`,
`Marginalia`, `renderMarkdown`, `bannerSrc`/`generatedBannerCss`, and the `.s-blog-heading`,
`.s-blog-meta`, `.s-blog-pn`, `.s-blog-share` and `.s-blog-related__*` classes by name. Reuse is
what makes a designed page and a stock page the same product; a fork is what would make them two.
Consequence, deliberately: an improvement to a stock component reaches designed mode for free, and
a designed page cannot drift from the design language without someone editing this namespace.

- **`schema.ts` is the wire contract, and `normalizeDesign(unknown)` is TOTAL.** It takes a parsed
  blob, a half-written file, `null`, `42` — and always returns a renderable `DesignConfig`. Wrong
  types are coerced or defaulted, numbers clamped, unknown section types dropped, duplicate ids
  regenerated, duplicate article parts collapsed, missing parts appended switched OFF, and a `body`
  part always present. **A corrupt design is therefore survivable exactly as a corrupt
  settings.json is**, and — the point of concentrating it here — no renderer below needs a single
  optional-chain on an option it declared. Verified: a config with `count: "many"`,
  `columns: 99`, `card: "banana"`, `enabled: "yes"`, a `"wormhole"` section, a duplicate id, a
  `null`, a bare `42` and `article: "not an array"` renders a correct page and prints no
  "undefined" anywhere.
- **The config is plain JSON with no derived state**, which is what makes flipping to stock and
  back LOSSLESS: nothing is computed at save time, so a retained design re-activates identically.
  `serializeDesign()`/`parseDesign()` are the export/import pair, and `stockDesign()` is both the
  starting design and what "reset to stock defaults" returns to — shaped as closely as sections
  allow to what the stock blog already renders, so turning the engine on is a starting point
  rather than a blank screen.
- **EVERY SECTION DEGRADES BY REMOVING ITSELF.** A section with nothing to say returns `null`, so
  a designed page can never show a heading over an empty box, a card grid with no cards, or a
  "Most discussed" rule above white space — the failure DESIGN.md forbids, on the marketing
  surface. Where a fallback beats a disappearance it is spelled out in the section's own comment
  rather than left to a `?.` in the JSX: the hero walks `note → latest → site` (an empty top of
  page reads as a broken site), and Featured falls back to the newest post. The page itself prints
  one honest `blogNothingPublished` line when the vault has nothing published — every section has
  correctly vanished by then, and a blank page is not an answer.
- **Every read goes through an endpoint the stock blog already uses, with the session's own cookie
  and `withPreview()`**: `/api/posts`, `/api/note`, `/api/graph`, `/api/comments?path=`. No section
  invents a data path, so no section can become a second, laxer door onto the vault. "Recent
  comments" is the one that had to be built rather than found — there is no site-wide visitor
  endpoint for it and there must not be one, since `/api/comments/all` is admin-only precisely
  because it enumerates — so it asks the per-note route (visitor-scoped, gated on publication) for
  the ≤8 posts `/api/posts` already said carry comments, and drops any thread that fails.
- **A note named by a design is resolved against the tree this session can see** (`resolveNotePath`
  — a title through the editor's own `resolveLink`, a path checked against `collectNotes`). Not for
  safety, which `/api/note` already provides: a section pointed at a deleted note would otherwise
  refetch it on every render and paint a red 404 in the console about a page behaving exactly as
  designed.
- **A custom markdown/HTML block goes through `renderMarkdown()`** — the reading renderer, hence
  `rawHtml.ts`'s sanitizer. `dangerouslySetInnerHTML` appears nowhere in the namespace, so a
  designed site is exactly as XSS-resistant as a published note. Guarded by `scripts/shoot-designer.mjs`,
  which feeds a block `<script>`, `<img onerror>`, `<iframe>`, `<svg onload>` and a `javascript:`
  href and asserts all five die while the prose survives.
- **Each section renders inside its own `SectionBoundary`.** A throw removes THAT section and
  reports `{ id, type, message }` upward; the page above decides what to do with it. The admin
  surfaces (`DesignedPreview`, the composer's footer) NAME the failing section and offer one-click
  revert to stock — "something went wrong" would leave the operator to find the block by switching
  sections off one at a time.
- **`store.ts` is a seam, deliberately thin.** `loadDesign()`/`saveDesign()` over a pluggable
  `DesignBackend`; the built-in one is this browser's localStorage and says so in the composer
  (`designBackendIsLocal()` → `dsnLocalOnly`). Whatever owns instance settings installs the real
  backend with `setDesignBackend()` at boot. A load that fails, is absent or is corrupt returns
  `stockDesign()` rather than throwing out of a boot path.
- **`entry.ts` is the namespace's ONLY point of contact with the app**: it mounts its own React
  root on `<body>` (the `toast.ts` / `openThemePicker()` pattern), so the whole integration is one
  `import "./designer/entry.ts"` in `App.tsx` — no store field, no prop chain, no line in App's
  render. Three admin-only doors: `openDesigner()` / `openDesignedPreview(path)` for a palette row
  or a Settings button to call, a `vellum:designer` window event, and `?designer=1` /
  `?designer=preview[&path=…]` in the URL. The panels are DYNAMIC imports — a visitor never
  downloads the composer.

**The composer.** Two tabs (home / article), a reorderable list, and a live preview of the real
components beside it.

- **Drag is not the only way to reorder.** `SectionList` rows are draggable *and* carry ↑/↓
  buttons, with Alt+↑/↓ from the focused row; the buttons are always there, not a small-screen
  fallback, because native HTML5 drag is unreachable with a keyboard and unreliable under a finger.
  A button move keeps focus ON the moved row — reordering is a repeated gesture, and a list that
  drops focus after each press turns three presses into three hunts for the button.
- **A locked row still moves.** The article `body` may be repositioned (everything above it is the
  header region, everything below the footer) but cannot be switched off or removed, and its switch
  and ✕ are ABSENT rather than disabled: an inert control is a question the reader answers twice.
- **The preview's width switcher is honest because designer.css states its breakpoints as
  CONTAINER queries** (`container-name: dsn` on `.s-dsn-home` / `.s-dsn-art`), so a 390px frame
  inside a 1440px window lays out exactly as a phone does. Media queries would have made the one
  surface that could catch a broken phone layout the surface that hides it. On the real site the
  container is the page, so the two agree. The frame is scaled with `zoom`, not a transform: a
  transform leaves the untransformed height behind and the stage scrolls a phantom.
- **Every control is one of OURS** (`components/controls/*`), for the reason the settings panel
  gives. The one addition is a `textarea` — the set had none because nothing in settings needed
  one, and a single-line input for a paragraph of prose is not a smaller version of the right
  control but the wrong one. A note is picked from a LIST of published posts, not typed as a path.
- **Reading-renderer furniture is hidden against the designed roots, not against `.s-blog`.** The
  renderer emits a frontmatter properties card and an inline banner for the app's reading view;
  the stock blog hides both with `.s-blog .s-rv-props` / `.s-rv-banner`, which is a rule about
  where the markup happens to be mounted. `designer.css` restates the same two facts (plus the
  marginalia measure, and the reading column's page padding) against `.s-dsn-home` / `.s-dsn-art`,
  so a designed page is correct wherever a shell mounts it — including a composer preview that is
  not inside `.s-blog` at all. Without it an article drew its banner twice.

**Gate:** `scripts/shoot-designer.mjs` (dev harness, needs playwright or `CHROMIUM=`). It shoots
the composer and the designed pages at 1440/768/390 in both languages across five themes, and it
asserts the behaviour that screenshots cannot: reorder + toggle + save round-trip through the
store, the starved design renders no orphan headings, the corrupt design renders at all, and the
sanitizer holds.


## The site designer — navigation, static pages, typography, header & footer

`settings.publicLayout` takes a THIRD value, `"designed"` (`app` | `blog` (stock, default) |
`designed`). What it selects is a composed site; what it must never do is disturb the one
underneath it.

- **THE STOCK BLOG IS A SEPARATE, PRISTINE, ALWAYS-WORKING BASE.** `client/blog/` and
  `styles/blog.css` are not forked, not patched and not conditionally branched: the designed
  shell (`client/design/`) composes its OWN tree — its own header, menu and footer — and mounts
  the stock article / topic / home components underneath as read-only leaves. Its stylesheet
  (`styles/design.css`) carries `.s-dsg` on EVERY rule without exception, so removing that one
  class leaves the stock rules and nothing else. A reviewer can confirm the whole guarantee by
  grepping the diff for `client/blog/`: the only edits there are none.
- **SWITCHING IS INSTANT AND LOSSLESS BOTH WAYS.** The design lives in
  `VELLUM_DATA/design.json`; the switch lives in `settings.json`. Nothing in `designStore.ts`
  reads `publicLayout`, so going back to stock is a setting change and NOTHING else — the design
  file is not touched, not cleared, not migrated — and going forward again returns it byte for
  byte. A rescue you cannot undo is not a rescue. `POST /api/design/reset` is the separate,
  deliberate act that removes the file (leaving the instance as a fresh clone is, rather than as
  a file full of explicit defaults that would shadow every future change to "stock").
- **A BROKEN DESIGN DROPS VISITORS TO STOCK, AND NAMES ITSELF TO THE ADMIN.** Three failure
  modes, one outcome: an unreadable `design.json` (`corrupt: true` on `/api/design/site`), a
  failed load, or a render-time throw caught by `DesignBoundary` — one boundary per section
  (`header`/`nav`/`page`/`footer`), because "the site is broken" and "the footer's third column
  is broken" are different facts and only the second is actionable. A visitor gets
  `<BlogShell/>` whole; the admin (a real admin session, or an admin previewing as a visitor)
  gets the designed site with the failing section held out, a notice naming it, and one click
  that PATCHes `publicLayout` back to `blog`. The boundary resets on a `resetKey` (config +
  route), never on `children` — an identity comparison there is a new element every render and
  turns one broken section into an infinite render/throw loop.
- **A CORRUPT DESIGN FILE IS SURVIVABLE EXACTLY AS A CORRUPT `settings.json` IS.** `readRaw()`
  never throws: one `console.warn`, an empty document, and `normalizeChrome()` fills the stock
  values. Unknown top-level keys are preserved verbatim on every write (the settings.ts rule) —
  the document is shared, `chrome` is one slice of it, and a client that has never heard of
  another key must not delete it.
- **TWO VALIDATORS, ONE SET OF RULES** (`shared/designChrome.ts`, pure — no fs, fetch, React or
  DOM). `normalizeChrome(raw)` is LENIENT and never throws: every READ goes through it, on both
  sides. `validateChrome(raw)` is STRICT and throws `DesignError(path, code)`: every WRITE goes
  through it. They agree on what is legal and differ only in what they do about an illegal
  value, which is the difference between "an operator typed this just now" and "this is what is
  on disk". `server/designApi.ts` maps the code onto `VaultError(400, …, code)` so the client
  translates a stable name rather than printing English prose.
- **BOUNDS ARE THE FEATURE.** `TYPO_BOUNDS` is the single table behind the designer's sliders,
  the strict validator and the lenient clamp — a control physically cannot offer a value the
  PATCH refuses. Body 15–21px, measure 58–86ch, line height 1.4–1.9, weight 400–800, scale
  1.10–1.414, rhythm 0.75–1.6. Heading SIZES are derived (`base × ratio^n`, `typographyVars()`),
  not six independent fields: six fields is six ways to put an h3 above its h2. Colours are
  never a design input — a design decides size, weight, rhythm and arrangement; the fifteen
  themes stay fifteen themes.
- **THE MEASURE IS EMITTED TWICE.** `--dsg-measure` (ch) caps the PROSE, because a character
  count is what the control means; `--dsg-measure-px` caps every wrapper around it, because a
  `ch` resolves against each element's own font-size and the page column, the article header and
  the footer grid would otherwise each land on a different width.
- **THE COMPOSED PAGE WEARS THE TYPOGRAPHY TOO.** The vars reached the article page, the reading
  renderer and the header wordmark, and stopped at the four titles the HOME page is made of — a
  hero, a section heading, a card title, a list row — which were `var(--font-serif)` at a fixed
  rem. The consequence was not subtle: a design at weight 800 in uppercase sans and one at
  weight 400 in serif drew the same front page, so nine controls and fifty-nine presets differed only
  in palette and arrangement. All four now take `--dsg-head-font/-weight/-transform/-variant/
  -tracking`, and their sizes come off the same modular scale as everything else (`--dsg-h1` for
  a hero, `--dsg-h3` for a section heading and a list row, `--dsg-h4` for a card), so no legal
  combination can invert the hierarchy. Excerpts and a hero's sub take `--dsg-body-font`. Every
  var carries its old value as the fallback, so a page rendered without them is unchanged.
- **A MASTHEAD SHARES THE PAGE'S COLUMN.** `stacked` and `stackedStart` headers are capped at
  `--dsn-width` and centred: the header block has no ground of its own, so a full-viewport one
  put the wordmark at the window edge while the sections sat in a 760px column. `inline` is
  exempt on purpose — it is a bar, it has its own row cap, and it is the one layout allowed to
  be wider than the writing.
- **NAVIGATION IS HAND-BUILT, AND VISITOR-SCOPED SERVER-SIDE.** Items are `home` / `note` /
  `page` / `topic` / `url` / `group`, ≤ 20 top level, ≤ 12 per submenu, ONE level of nesting
  (a second level is a 400, not a silent flatten). `visitorNav()` drops every hidden item, every
  item whose note is not `isNoteVisibleToVisitor()`, every topic in `excludedTags()`, and every
  group left with no children — so a menu can neither ship a dead link nor name an unpublished
  note's path to an anonymous reader. The item stays in the STORED design: unpublishing a note
  for a week must not delete the menu entry pointing at it, and the builder flags it instead.
  URL targets are `http(s)://…` or site-relative `/…` only (no `javascript:`, no `data:`, no
  protocol-relative `//host`), and note targets are re-checked with `normalizeRel` + `safeAbs`
  server-side: only the server can answer "does this path stay inside the vault".
- **STATIC PAGES ARE A FRONTMATTER FLAG, `page: true`** (`server/pages.ts` documents the choice
  against a designated folder: a page keeps its place in the vault, its wikilinks and its
  permalink, and the flag is reversible in one keystroke). A page must still be `publish: true`.
  It is read on every index (`NoteRecord.page`) and ACTED ON only when `staticPagesActive()` —
  i.e. in designed mode — which is what keeps the stock feed bit-for-bit what it was:
  `posts(visitor, excludePages)` is called with `false` everywhere the stock blog calls it. In
  designed mode the page leaves `/api/posts` and `/feed.xml` and renders through `PageView` (no
  date, no reading time, no tags, no prev/next, no related). `GET /api/design/pages` lists them,
  visitor-scoped like everything else.
- **API** (all under `/api/design`, mounted below the auth guard): `GET /site` (anyone —
  visitor-scoped chrome + pages + `corrupt`), `GET /pages` (anyone), `GET /` (admin; 404 to
  visitors like `/api/settings` — it names hidden items, unpublished notes and an absolute path),
  `PATCH /` (merge a partial chrome per SECTION — a list is replaced wholesale, since "moved to
  the top" and "deleted" are the same diff to a field-wise merge), `PUT /` (import a whole
  document, ≤ 256 KB, unknown keys kept), `POST /reset`.
- **A REFUSAL IS PRINTED, NOT REPLACED.** `client/design/api.ts` builds a `DesignApiError`
  carrying the server's exact sentence, and every catch in the panel used to throw it away for a
  static `designSaveFailed` / `designImportFailed` — so a precise 400 (`sections[0].markdown: is
  too long (20000 characters max)`) reached the author as "Could not save the design", naming
  neither the field nor the reason, and the 500-instead-of-400 defect above was invisible in
  practice for exactly that reason. `designErrorText(err, fallback)` prints a 4xx's own message
  (the server is saying something about THIS document) and falls back to the panel's sentence on a
  5xx or a dropped connection (which say only that something broke). The import file is also
  size-checked against `API_BODY_MAX` BEFORE it is read: the server 413s an 11 MB body and always
  did, but by then the admin's tab has read and `JSON.parse`d the whole thing, and a `File` knows
  its own size for free.
- **The designer** (`client/components/design/`) is a DRAFT surface: every control writes to a
  draft, the preview redraws from the draft, Save is one request. The preview renders the REAL
  components with the REAL derived tokens — a preview built from a second rendition is a preview
  of the rendition — but never routes: no nav handler, no `pushState`, clicks swallowed at the
  container, and a specimen body instead of a fetch. Its door is one palette row (the theme
  picker's precedent: what it opens is a browsing-and-building surface, so it is one row, not
  five), and it mounts a root on `<body>` like `openThemePicker()`.

## The designer is a DESIGN TOOL, not a settings form

The panel that composes a design (`client/components/design/`, `styles/designer.css` +
`styles/composer.css`) is the surface this whole feature is judged on: a home page is an ORDER
before it is anything else, and an order you cannot rearrange with your hand is a list of settings
wearing a designer's name. What follows is normative for that panel.

### THE DESIGN'S COLOUR IS CHOSEN BY LOOKING AT IT

`DesignThemeCards` (`client/components/design/DesignThemeCards.tsx`) — "Site default" plus the
fifteen plus every custom theme, as swatch cards painted from the CONSTANT `--swatch-<id>-*`
tokens through the same `[data-theme-swatch]` hook the theme picker and the builder already use.
It is the rule the ThemeBuilder states, applied to the other control that decides a palette; a
retuned theme moves here with no second table to update.

This was a `<Select>` whose options were `["", ...customThemes]` — the instance's HAND-BUILT
themes and nothing else. On a fresh instance that is exactly ONE row ("Site default"), the
control's own value rendered as the raw slug `iron-gall` with no label and no colour, and not one
of the fifteen built-in themes was reachable: after applying a preset an author could keep the
colour it shipped or destroy it, and nothing else. The field's own hint says the value is "forced
on readers who have not chosen a theme themselves", so the single control that decides what every
first-time visitor sees was inoperable — against WordPress's Customizer colour panel and
Squarespace's palette picker, disqualifying on its own.

Two details are load-bearing. **"Site default" is a real choice, not an empty row**: it carries no
swatch attribute, so its card inherits the live document's `--bg/--text/--accent` and draws the
room the app is standing in — "the reader's own", which is a decision an author makes on purpose.
And **a custom theme's card is painted from its own overrides where it has them and from its
base's swatch where it has not**, which is exactly what a sparse layer over a built-in is.

(It is also a popover that cannot be misplaced. The old `<Select>` opened UPWARD and covered the
design rows above it, including the "ACTIVE" badge on the design being edited.)

### TWO MORE DOORS, BECAUSE ONE WAS THE COMMAND PALETTE

`openDesigner()` had exactly one call site in the whole client (`CommandPalette.tsx`). The Settings
modal carried the `publicLayout: "designed"` segment with no link to the designer, and there was
no sidebar, status-bar or gear entry — so an operator who flipped the switch landed on a designed
site with no design and no signpost to the tool, and the entire feature was behind Ctrl+P and a
guess at the word. It now also opens from:

- **the status bar**, beside the gear — where an admin already goes to change what a visitor sees;
- **Settings → Publishing & comments**, in the row directly under the layout segment. The row that
  just taught somebody the word "designed" is the row that has to hand them the tool.

Both are the same `openDesigner()`; the settings door closes the settings modal first, because two
stacked dialogs is not a place. (Arabic discoverability came with it: the palette matched only the
exact label «صمّم», so the noun everybody types, «تصميم», answered "no results". It is in the row's
HINT now, which the palette already searches — "typing what you can read must never answer no
matches".)

### The three columns, and the laptop that decides them

`.s-dsgr__body` is `186px · minmax(380px, 1.05fr) · minmax(0, 1.4fr)` — rail, controls, preview —
and the panel is `min(1520px, 100%)` by `min(940px, 100vh - 32px)`. The numbers are one argument:
a form column that grows past ~460px is a form with nothing in the middle of it, so every pixel
past that belongs to the preview, which is the thing the author is actually looking at.

**1280×800 keeps all three columns.** It is the smallest screen this surface is designed for, and
a designer that hides the design at the size most people own is a designer for demos. What gives
first is the ROW, not the pane: below 1320 the section card wraps to two lines (what it is on top,
what you can do to it underneath) so a section name is never two words wide. The preview is
dropped only below 1040, where it would be a thumbnail of a thumbnail.

**The one exception is the presets tab**, which is two columns at every width (`--wide`): the
gallery IS a preview surface, so the pane beside it had nothing left to say and was spending the
larger share of the panel saying it. See the gallery contract above — that is the only tab allowed
to claim the third column, and it claims it by UNMOUNTING the stage rather than hiding it.

### The rail is grouped and drawn

Eight words in a column is a menu. The rail carries four named runs — *Your designs*, *The page*,
*The look*, *Keeping* — and every row carries the SHAPE of what it opens (`PanelGlyphs.tsx`), so
the column is scanned by picture and confirmed by word. The active row is `--accent-soft` with a
2px `--accent` bar on its LEADING edge, which is the rule every active row in this product already
follows; the bar is transparent at rest so nothing shifts when it lights. Each tab carries
`data-tab`, which is how a gate reaches one. Labels WRAP rather than ellipsing — an ellipsis in a
rail of eight rows eats the one word that distinguishes "Header & footer" from "Pages".

### The board (`SectionList.tsx`)

**THREE WAYS TO MOVE A ROW, and all three are first-class.** Drag it by the grip; press the ↑/↓
buttons; or lift it with the KEYBOARD — Space on the grip, arrows to move, Space or Esc to set it
down. The buttons are not a small-screen fallback (a control that exists only on one input device
is a control half the readers do not have) and the keyboard lift is not a consolation prize: it
moves the row the same way the drag does and says so through an `aria-live` region ("Hero is now 3
of 7"). `Alt+↑/↓` still moves the focused row from the row itself.

**POINTER EVENTS, NOT HTML5 DRAG.** `draggable` gives a browser-drawn ghost nobody can style, no
touch support worth the name, and a `dragenter` stream that fires against the row under the GHOST
rather than under the finger. One pointer path serves mouse, pen and touch, the grip is
`touch-action: none`, and the "ghost" is the row itself, lifted.

**A drag shows where it will land, and it takes both halves.** The rows the lifted card has passed
slide out of its way (160ms) so there is a real slot, and a dashed accent SOCKET the size of the
card is drawn in that slot — a caret alone lands under the card the reader is holding, and a gap
alone says "somewhere around here". The list is NOT reordered until the reader lets go:
rearranging under a pointer that has not committed is the board deciding for them. (The row that
draws the socket is the one BELOW the slot, except at the end of the list and except when that row
is the lifted one, whose pseudo-element travels with the pointer.) The scrolling column follows
the pointer at its edges, or a twenty-section design can only be reordered one screen at a time.

**Moving a row keeps focus on THAT row** — by button, by keyboard and after a drop. Reordering is
a repeated gesture, and a list that drops focus after each press turns three presses into three
hunts for the button. Reordering a keyed node blurs it, so the lift survives on a `refocus` guard
rather than on `onBlur` alone.

**A row shows what it IS**: its position, a wireframe glyph of its kind (`SectionGlyph.tsx`), its
name, its hint, then the moves, the switch and the ✕. A locked row keeps its position controls and
its switch and ✕ are ABSENT rather than disabled. One row's options are open at a time and they
open IN PLACE, under the row, over 160ms of height and opacity.

**Glyphs are `currentColor` and `aria-hidden`, always.** They inherit the row's own token
(`--text-muted` at rest, `--accent` when hovered or open), so they are correct in all fifteen
themes and on all three grounds without a rule of their own; their interior shading is opacity over
a picture, never over `--text-faint`, which is at its floor already; and no shade of one carries a
fact the words beside it do not.

### Adding a section is a picker of pictures (`SectionPicker.tsx`)

The eight kinds are eight SHAPES and their names are the least informative thing about them, so
every option is illustrated with the same wireframe language the rows and the gallery miniatures
use. The sheet opens IN FLOW under the button rather than as a popover — a popover inside a
scrolling pane is a popover that pane will clip — focus lands on the first option, and Esc closes
it and hands focus BACK to the button.

**`isSectionPickerOpen()` is why Esc works at all.** The sheet and the panel both listen for Esc in
the CAPTURE phase on `window`, capture order is registration order, and the panel is mounted first
— so one Esc closed the whole designer out from under an open picker, measured. `stopPropagation`
inside the sheet cannot fix that; it runs second. The OUTER surface asks whether an inner one owns
the key, which is exactly the precedence `isSelectOpen()` already keeps for the Select popover.

### Empty states invite

An instance with no design opens on the PRESETS tab, so that IS the first screen: fifty-nine
finished sites, two columns wide, each already drawn in its own colours against the operator's own
posts. It opened on the Designs tab before, which spent ~55% of a 1440×900 dialog on dark
emptiness with a one-line "No design yet" in the preview column — and that screen is the moment
the WordPress comparison is won or lost. The invitation is still on the Designs tab for anybody
who goes back: three section glyphs, "Nothing designed yet", the sentence that says posts fill a
design in immediately, and the two doors (*Browse the presets*, *New design*). A design with no sections says "An empty page,
waiting" and names what a page is made of. Neither reports the absence of a list, and the tab's own
instruction line is withheld while there is nothing to instruct — "drag a row, or move it with the
arrows" over a panel with no rows in it is directions to a thing that is not there.

### The save bar is a STATE

Nothing in the panel reaches the public site until Save, so the bar's whole job is to make "there
are decisions in the air" impossible to miss: clean it is a hairline and a muted line; dirty it
takes an accent rule along its top edge, a raised ground, a pulsing dot and a COUNT.

`countChanges()` counts the way an AUTHOR counts, and that is the reason it is not a leaf-wise diff
of two blobs: moving one section in a list of seven rewrites six array slots, and a bar reading "31
changes" after one drag is worse than no number. So sections are compared BY ID (one change for an
edited section, one for each added or removed), the ORDER counts once and only over the sections
both documents share (an add already counted itself; a move made in the same sitting is a second
decision and must show), and the rest of the document is compared leaf by leaf, where a leaf is one
control. The count goes through `countPhrase(n, "changes")`, so Arabic gets its real plural forms
like every other count in the product. A dirty draft with no countable change still says "Unsaved
changes" — true, and there is no honest number to print.

`Ctrl/Cmd+S` saves, and it is SWALLOWED either way: the browser's own Save dialog over a design
panel is a jump-scare, not a feature.

### A DIFFERENT SITE ARRIVES; IT DOES NOT CUT

Applying a preset or opening another design replaces the entire page in the preview pane, and a
hard cut between two complete sites reads as a glitch rather than as the choice somebody just
made. `PreviewStage` cross-fades on a change of `design.id` — 280 ms, once, and never on first
render, because a pane that animates its own arrival every time the designer opens is an animation
about nothing. An edit to the SAME document still updates in place; that is the 120 ms settle and
it must not be dressed up. The keyframe writes OPACITY ONLY: the frame carries an inline
`transform: scale(k)` the stage computed, and a keyframe that also wrote `transform` would snap
the device to the wrong size for the length of the fade.

### Motion is 150–200ms and it is a preference

Rows settle when they land (200ms), options and the picker arrive rather than appear (160–170ms),
the controls column cross-fades when the rail moves (`key={tab}`, 160ms), the add button's `+`
turns into a `×`, and the preview settles on the trailing edge of a burst of edits (`PreviewStage`).
Every one of those is 150–200ms of MEANING and none of them is the only carrier of that meaning, so
`prefers-reduced-motion: reduce` drops the animation and keeps the fact. Verified with the panel
under `reducedMotion: "reduce"`, in RTL, at 1280×800, and on light and dark themes.

## The book reader (`client/books/`, `server/books.ts`)

A `.pdf` in the vault is a **book**, and a click on one opens a reader, not a
browser tab. The tab rendered the file perfectly well; what it could not do is
remember the page, take a keystroke, or know that the vault has forty other
books in it. Scope is PDF and reading only — pdf.js is the engine, and it is
the only file format this surface knows.

### A book is its BYTES, not its path

Reading state is keyed by `sha256(size ‖ first 64 KiB ‖ last 64 KiB)` of the
file (`server/books.ts::bookKey`, format validated by
`shared/bookAnchor.ts::isBookKey`). **Never by the path.**

The vault is the one directory this application does not own. Obsidian writes
to it, Syncthing and Dropbox write to it, `git pull` writes to it, and the
owner writes to it with `mv` at two in the morning. A key that only our own
rename handler maintains goes stale the first time a book is filed by hand, and
what is lost is not a cache: it is page 612 of a book someone has been reading
since March. So the identity travels IN the file, and a book that moves, or is
renamed, or arrives from another machine under a different name, is the same
book with the same position.

The sample rather than the whole file, because a scanned atlas is 400 MB and
hashing it whole costs a full read per open and per shelf listing — at 400
books, a shelf that never paints. The header and first object at one end, the
cross-reference table and the trailer (including the `/ID` array the spec asks
writers to make unique) at the other, with the exact length between them: two
different books would need identical lengths AND identical xref tables. A file
smaller than both windows is hashed whole.

The honest cost, and it is written down rather than hidden: **re-saving a book
makes a new book.** An OCR pass, a re-compression, a bookmark added in another
program — different bytes, fresh position. That is the right trade against a
path key, which loses the position every time the file merely MOVES, and moving
is the commoner event by a wide margin.

`shared/bookAnchor.ts` also defines `book:<key>#p212` — the citable reference
form. The form a NOTE carries is the wikilink at the end of that module —
`[[Ibn Khaldun.pdf#page=212&rect=…&id=…]]`, the same idea wearing the vault's own syntax, where
the id resolves to the key and the key is the bytes; `bookRef()`/`parseBookRef()` remain the
internal spelling.

### The store is in VELLUM_DATA. The vault keeps nothing.

`VELLUM_DATA/books.json`, written with the same write-then-rename shape
`server/settings.ts::persist()` uses, mode `0600`, mtime-checked read cache.
Positions are OUR bookkeeping, not the reader's content: a sidecar
`.vellum-reading.json` beside every PDF would be litter in a folder people
sync, grep and back up. **The PDF itself is never written to** — nothing in
`server/books.ts` opens a vault file except with mode `"r"`, and
`npm run check-books` enumerates every write call in that file (the four in
`persist()` are the whole list; a fifth fails the build — and that census now covers highlights and margin notes too, which share the file and add no write of their own).

A patch is PARTIAL and is merged (`cleanBookState(patch, prev)`): the
once-a-second scroll write carries `{ page, offset }` and cannot undo a zoom the
reader set a moment earlier. `cleanBookState` is total and never throws — a
corrupt store costs positions, and losing positions must not also mean losing
the ability to open a book.

The last write of a session goes out with `navigator.sendBeacon` on `pagehide`,
which is why `/api/books/state` answers POST as well as PUT. The commonest way
a reading session ends is closing the tab, and by then a `fetch` is cancelled in
flight.

### The routes are admin-only, and they do not serve bytes

`GET /api/books` (the shelf), `GET /api/books/one?path=`, `GET|PUT|POST|DELETE
/api/books/state?key=`. Mounted under the auth guard, and both GETs say
`assertAdminRead(c)` themselves: a shelf is an enumeration of the owner's own
directory, and a visitor shown one published page must not be able to ask what
else is in there. The PDF's bytes still come from `/api/file`, publish-gated and
`Content-Security-Policy: sandbox`'d exactly as before — this surface widens
nothing.

### pdf.js: one door, one worker, and the worker is a FILE

`client/books/pdfjs.ts` is the only module that names `pdfjs-dist`, and it
reaches the library through `import()`. The engine is ~1.1 MB and the worker
another ~1.3 MB, for a surface most sessions never open;
`scripts/check-bundle.mjs` forbids `node_modules/pdfjs-dist/` and the reader's
own components in every first-paint closure, and requires
`books/BooksSurface.tsx` to remain a chunk of its own.

**The worker is imported with vite's `?url` suffix and served from our own
origin.** The recipe every pdf.js tutorial gives — fetch the worker source, wrap
it in a `Blob`, hand over the object URL — works perfectly in `npm run dev` and
is dead in production, because the vite dev server sends no CSP and this origin
sends `default-src 'self'` with no `blob:` anywhere in it. A feature that works
for its author and for nobody else is the worst failure available here, so
`SHELL_CSP` states `worker-src 'self'` out loud and `npm run check-books`
asserts all of: the `?url` import, `workerSrc` set from it, no `blob:` in the
policy, and no `createObjectURL` near the worker.

`script-src` carries `'wasm-unsafe-eval'` — the NARROW token, never full
`'unsafe-eval'`. pdf.js decodes JBIG2 and JPEG 2000 in WebAssembly, and those
two formats are every scanned book in the world; without the token a scanned
PDF renders as blank pages.

Four side-data directories (`cmaps`, `standard_fonts`, `wasm`, `iccs`) are
copied to `/pdfjs/` by the `pdfjsAssets()` plugin in `vite.config.ts`, which
also serves them from `node_modules` in dev so the two environments agree about
a URL. Without them: a Japanese book is boxes, a document that references
Helvetica without embedding it renders with the wrong metrics, and a scanned
book is blank. `dist/pdfjs/**/*.wasm` is served as `application/wasm` so
`WebAssembly.instantiateStreaming` takes the fast path instead of warning.

### Page virtualization: the window is ±2 spreads

A 900-page book gets 900 page SLOTS — cheap boxes that keep the scrollbar
honest and let the browser do layout — and at most **five spreads** hold a
canvas (`client/books/layout.ts::renderWindow`, radius 2). The number is
arithmetic, not taste: a fit-width A4 page at `devicePixelRatio` 2 rasterizes to
~2500 × 3500, which is 35 MB of canvas backing store. Five spreads is 175 MB in
single mode and 350 MB in dual; rendering all 900 is 31 GB, which is not a slow
reader but a tab the browser kills. Two spreads of lookahead is what stops a
fast `j` or a Page-Down from showing an empty box.

Page sizes are measured lazily and unmeasured pages borrow page one's shape, so
the scrollbar is approximately right from the first frame. `clampCanvasScale`
caps the device-pixel scale below the ~16-megapixel ceiling browsers put on a
`<canvas>` — over it a canvas does not throw, it silently paints **nothing**.

### The keyboard is the interface

`j`/`k` scroll, `Space`/`Shift+Space` and `Ctrl+D`/`Ctrl+U` page, `gg`/`G`,
`<n>G` go to a page, `/` searches with `n`/`N` stepping, `o` the contents, `+`/`-`
zoom, `a` fit width, `s` fit page, `d` dual page, `i` night mode, `r` rotate
(`R` back), `m<c>`/`'<c>` marks, `?` the key sheet, `l` the shelf, `q` closes,
and `:` is a command line with a name for every one of those states.

**Every character key resolves through `client/keys.ts::shortcutKey()`.** A
bare `e.key === "j"` is false on an Arabic keyboard, on a Russian one and on a
Greek one — that module exists because five of this product's seven global
shortcuts were measured dead under a non-Latin layout, and a reader whose
system keyboard is Arabic is exactly who asked for this feature.
`npm run check-books` fails the build on any `e.key === "<printable>"` under
`client/books/`. Named keys (Escape, the arrows, Page keys, Space) are compared
directly: they are layout-independent already.

Marks are named by what the reader TYPED, not by the physical key — a chapter
marked with `ب` is recalled with `ب`. Numbers in the `:` line are accepted in
Latin, Arabic-Indic and Persian digits, because an Arabic instance PRINTS
`٢١٢` in the status line and refusing it back is a small betrayal.

The reader's keys are deliberately NOT in `GROUPS`/`docs/keymap.md`: they are
live only while a book is open, and a global sheet that describes them
everywhere is a sheet that lies most of the time. `?` opens the reader's own.

### Chrome-free by default

No permanent toolbar. The title bar and the status line appear on pointer
movement or a keystroke and fade after ~2.2s (`[data-chrome="off"]`); under
`prefers-reduced-motion` the fade is a cut. Everything the pointer can reach is
reachable from the keyboard, and everything the keyboard does has a name in the
`:` line — that is what makes "no visible controls" a design rather than an
omission.

### Two directions on one screen

The CHROME mirrors with the interface language, like the rest of the app. The
PAGES mirror with the BOOK: `spreadsOf()` reverses the PAIR (not the sequence)
for a right-to-left binding, so an Arabic volume in dual-page mode shows
`[3, 2]` and the eye travels right to left across the spread. Direction is
detected once from a text sample taken from the MIDDLE of the book — front
matter is where a copyright page and a translator's note live, both in English
in books that are not — and then stored, so `:rtl`/`:ltr` outranks the guess
forever. A bilingual owner reading an English monograph in an Arabic interface
gets an Arabic panel around a left-to-right book, and that case is the reason
the two questions are answered separately.

### Night mode does not ruin the photographs

`i` cycles `off → night → flip`. `night` is not `filter: invert(1)`: an
inversion turns black type on white paper into white type on black paper
(good) and turns the plate on page 212 into a photographic negative — a face in
cyan, a night sky in white. The documents most worth reading at night are
exactly the ones a naive inversion ruins.

So the page is rendered once and composited: inverted with
`invert(1) hue-rotate(180deg)` (the second half keeps a red heading red), the
resulting black lifted to the theme's own `--bg` with a `screen` blend so a book
in `sandstone` is dark sandstone rather than a black rectangle in a warm room,
and then **every raster figure drawn back over the top, unfiltered**. The figure
rectangles come from the page's operator list before anything is rasterized
(`client/books/figures.ts`), cached per page in page space so a zoom re-multiplies
six numbers instead of re-running the pass.

`paintImageMaskXObject` is deliberately NOT exempted. A stencil mask is a 1-bit
shape painted in the current fill colour, which is how a scanned page of text
arrives; exempting it would leave a scanned book unreadable in the one mode that
exists to make it readable at night. That single line of judgement is the
difference between this working and not. `flip` is the plain negative for the
reader who actually wants one, and skips both the tint and the figure pass.

### Search folds the way an Arabic reader types

`client/books/search.ts` matches character by character through a fold and
reports offsets into the ORIGINAL string, so a hit found in extracted text can
be turned back into a DOM `Range` over the untouched text layer. Harakat, the
superscript alef, Quranic annotation marks, tatweel, combining diacritics,
zero-width joiners and soft hyphens are skipped; the alef family, the yeh
family, teh marbuta and the Persian letters fold together; one typed space
matches the line break extraction invents. `الْمُقَدِّمَة` is found by typing
`المقدمة`, which is the whole point — and "résumé" is found by typing
"resume" for free.

The k-th hit is located twice, once in the extracted page text and once in the
rendered text layer, by the SAME function on the SAME normalization. That is
the only reason the two agree. The hit is painted with the CSS Custom Highlight
API — no node is inserted into the text layer, so the positions pdf.js computed
stay exact and the text stays selectable. A browser without the API scrolls the
match into view untinted.

### The shelf paints instantly and fills in

The default state of a library card is a **typographic plate** — the title in
`--font-serif` on `--bg-raised`, which is what the spine of a book without a
jacket looks like — never a spinner and never an error. A 400-book shelf cannot
render 400 covers before it paints, and a grid of spinners tells the reader
their library is broken. **A shelf whose covers never rendered would still be a
usable shelf.** That is the bar.

Covers are page 1, rendered small, requested as cards scroll into view and
cancelled as they leave. At most **three** `getDocument` calls are in flight at
once and every `PDFDocumentProxy` is destroyed the instant its bitmap exists
(`client/books/covers.ts`): a document is not a handle, it is a worker-side heap
of decoded fonts and images, and 400 of them is how a tab reaches four
gigabytes. Title, author and page count are cached back into the book's state
by the same one-shot open, so the next visit prints them without parsing
anything. A book that will not open keeps its plate — reporting "failed" on
forty cards because a network hiccup ate forty range requests is noise about
nothing anyone can act on.

The shelf's own search folds identically to the in-book one, so an Arabic title
typed without its harakat finds the book that carries them.

### Where it is mounted, and where it is going

`/library` is the shelf and `/book/<vault path>` is one book; both are real
addresses, because a book someone is halfway through is a thing they bookmark
(the page is already remembered server-side, so the URL only names the volume).

**A book is a WORKSPACE TAB** (the owner: "prob should just treat it like a
normal tab?? so people can open the book while taking notes"). The portal era —
a React root on a body-appended element, full-screen over the app, a
`booksAreOpen()` flag the router consulted — is deleted, not kept as a second
door. `client/books/door.ts` is what remains in first-paint code: URL parsing,
the tree walk that resolves a citation, and a call into the store
(`openBook` / `openLibrary`). `Pane.tsx` mounts `BooksSurface` through
`React.lazy` when a pane's surface is `"book"` or `"library"`; the surface
still takes a route and callbacks and touches no global state, exactly the
move its portal-era header promised. Its `active` prop says whether the pane
holds the keyboard — every zathura key listens on `window`, and a `j` typed
toward the note beside the book must not turn a page. The address bar follows
the FOCUSED pane (`bookSurfaceOf` in client/router.ts): a book tab in focus
puts `/book/…` up, focusing the note beside it hands the bar back — the
computed-URL comparison in the router subscription is what lets that change
without `openPath` changing. A citation rides the open itself
(`OpenHow.book` → the pane's one-shot `bookTarget`, cleared by `onLanded`),
so a later citation into an already-open book still jumps.

### Annotating: the PDF is never written to

`h` marks the selection, `H` steps the ink, `e` writes a note in the margin,
`x` takes one back (with an Undo), `A` lists them. Every one of those has a
name in the `:` line — `:highlight`, `:ink 3`, `:note`, `:annotations` — and
`:h` still means `:help`, because the vi rule resolves the first name whose
abbreviation the typed word satisfies and a reader with `:h` in their fingers
must not have it start inking their selection.

A highlight is stored in `VELLUM_DATA/books.json` under the book's CONTENT KEY,
beside the reading position and validated by the same total, never-throwing
shape (`shared/bookAnchor.ts::cleanHighlight`). It is a page number, one
rectangle PER LINE, an ink 1–6, the passage, and a margin note. Rectangles are
FRACTIONS of the unrotated page, never pixels and never PDF points: a reader
annotates at 140% on a laptop and reopens at fit-width on a 4K display rotated
ninety degrees, and the page's own proportions are the only coordinate space
that survives all of it.

**Nothing is written into the PDF.** Not a `/Annots` entry, not a re-save, not
the mtime. The vault is the one directory this application does not own; a
reader who marks a sentence must not thereby rewrite a 400 MB scan that five
machines then have to pull down again, and a file whose bytes change is — by
this reader's own rule — a DIFFERENT BOOK with a fresh position. So the whole
census still holds: `npm run check-books` enumerates every write call in
`server/books.ts` and the four in `persist()` are the entire list, and
`tests/books.test.ts` compares the PDF's bytes and its mtime after a page has
been annotated. The honest cost is that a highlight does not travel to a
different reader of the same file. That is the right trade for a single-owner
vault and it is the same one the reading position already makes.

Annotations are a SIBLING of `books` in the store, not a field inside each
state, because a position is patched forty times an hour by a debounced scroll
and is merged partially — putting a list of passages inside the record a scroll
write merges into is how a passage someone marked gets clobbered by them
scrolling past it. For the same reason `:forget` does NOT delete them: it means
"stop resuming this book", which is a sentence about a scroll offset, and a
command that reads as tidying up must never be the command that throws work
away.

The six inks are `--book-ink-1..6`, on `:root` ONLY, outside `check-contrast`'s
`REQUIRED_TOKENS`, and `npm run check-books` fails the build if any theme
overrides one. They are PAGE inks, not chrome: they sit on a printed page
rather than on the app's ground — the attachment viewer's fixed scrim makes the
same argument pointed the other way — a highlighter is yellow in every theme
anyone has ever bought one in, and a per-theme ink would mean the same passage
is marked green on the laptop and pink on the desktop, which is not a theme but
data loss. They are exempt from the contrast gate because an ink NEVER CARRIES
TEXT: the words under it are the page's own glyphs at the page's own contrast,
the wash is `aria-hidden` and takes no pointer events, and the passages are
listed AS TEXT in the `A` panel, which is where a keyboard reader reaches them.
Alpha around 0.4 is the hinge — under it a mark is invisible on a scanned grey
page, over it the ink competes with the letters it is pointing at — and the
blend is `multiply`, because a highlighter is a translucent ink laid on paper.

### A quote is assembled by COLUMN GEOMETRY, not by stream order

This is the load-bearing paragraph of the whole stage.

**pdf.js returns text items in the order the content stream wrote them.** That
is not a defect: a PDF page has no paragraphs, no columns and no reading order
in it — only "put these glyphs at this matrix" — and a typesetter may emit them
in any order that paints the same page. TeX, on a two-column paper, commonly
INTERLEAVES the columns: line 1 left, line 1 right, line 2 left, line 2 right.

Joined in that order the quotation is alternating half-sentences. It is
grammatical. It is fluent. It is not what the book says, and nothing on screen
tells anyone: the reader selected the right passage, saw the right passage
highlighted, pressed `c`, and a sentence the author never wrote went silently
into their notes and from there into their own writing. **A wrong quotation
that looks right is the worst failure this reader can produce**, which is why
`client/books/columns.ts` is a module with its own fixture rather than three
lines inside a keystroke handler.

Nothing in it reads the order the pieces arrived in. Columns are found by
projecting every piece onto the x axis and looking for a corridor no piece
crosses — a real gutter is empty on EVERY line, whereas the space between two
words is covered by the line above it — with the corridor required to be wider
than both 3.5% of the selection and one line height. Lines are grouped on y.
The order inside a line follows the SCRIPT: an Arabic line's first word is its
rightmost, and sorting one by ascending x silently reverses every sentence in
the quote. In a right-to-left paper the right-hand column is read first.

And hyphens. A book breaks "significant" as "sig-" / "nificant", and a naive
line join gives `sig- nificant` — embarrassing every single time, in every
quote, forever. Undoing it is guarded on all four sides: a capital on the right
is a compound the author wrote (`Anglo-Saxon`), a digit is never a hyphenation
(`1990-1995`), a single letter before the break is `x-ray` rather than a word
broken after one character, and the character before the hyphen must belong to
a script that HYPHENATES — Arabic does not, so a dash at the end of an Arabic
line survives. Soft hyphens are dropped; the Persian zero-width non-joiner is
kept, because it is spelling and not noise.

`npm run check-books` asserts that the reader builds its passages through
`assembleSelection()` and that nothing under `client/books/` except
`selection.ts` reads `getSelection().toString()` — DOM order is the PDF's
stream order, and that shortcut is the one anyone would reach for.

### `c` puts it in the note beside you

`c` cites with no target dialog: the note beside you is the active tab, which
is the answer in nearly every session. `Shift+C` opens the same panel with the
note picker focused instead of the quote — one surface, two doors, nothing to
learn twice. The list is the OPEN TABS and not the whole vault: a citation goes
into something you are working on, and a list of nine hundred notes is a list
nobody reads.

**The assembled quote is shown in an EDITABLE field before one character
reaches the note**, and that is not ceremony. Assembling a passage off a page
that has no reading order in it is inference, and inference is occasionally
wrong: a running head caught in the selection, a footnote marker, a wide table
read as two columns. Every one of those produces a quotation that is fluent,
plausible and not what the book says. A quote you can see before it lands is a
quote you can fix. The field is set in `--font-serif` — the face it will be
READ in — because a quotation proofread in the UI sans and then rendered in a
book face is a quotation nobody actually proofread. The ink goes down only on
confirm: a cancelled citation leaves the page exactly as it was.

What lands is the vault's own callout syntax, which is the point — it already
renders in the live preview, in the reading view and on a published page, and
it already survives being opened in Obsidian:

```
> [!quote]
> …the passage…
>
> — [[Ihya.pdf#page=42&rect=0.118,0.313,0.742,0.081&id=k7f3q2a9|Ihya, p. 42]]
```

EVERY line of the quote is prefixed, blank lines included: a callout whose body
contains an unprefixed blank line ENDS at that line, which would put a
two-paragraph quotation's second paragraph outside the box and its attribution
somewhere else again. A selection that crosses a page break is one sentence and
is joined by the same rule that joins two lines, hyphen and all; it leaves one
highlight per PAGE, because a rectangle has to be on something.

The write goes through `client/sectionActions.ts::applyNoteContent`, which
**claims `markSelfWrite(path)` BEFORE the request** and prefers the open editor
when one holds the note — so the citation is one undoable transaction the
existing autosave carries to disk, and the SSE echo (which overtakes the
response by about two milliseconds) is not reported back to the reader as
"changed on disk". A bare `putNote` here fails `npm run check-books`. It is
APPENDED rather than inserted at a cursor, and deliberately: the reader is
full-screen over the app, so there is no caret anyone is looking at, and a
block that lands invisibly mid-note is a block they have to go and find. (The
"no caret" half of that sentence predates book tabs — a note CAN be on screen
beside the reader now — but appending is still right: the caret belongs to the
OTHER pane, and a citation that teleports it mid-note would steal the very
split the reader arranged.) The
toast carries Undo, which restores the note to exactly what it was.

### The anchor is a wikilink, not a new syntax

`[[Ihya.pdf#page=42&rect=…&id=k7f3q2a9|Ihya, p. 42]]` rides
`client/editor/links.ts::parseWikilink()` **unchanged** — target, `#anchor`,
`|alias`. That is why it was given this shape: the live preview, the reading
view, the backlink index, the hover card and the autocomplete all keep working
without being taught anything. A `book:` scheme or a `%%vellum-cite%%` fence
would have needed every one of them to learn a second language, and a note full
of a syntax only this program understands has stopped being ordinary markdown,
which is the promise the whole vault rests on.

`page=` carrying a NUMBER is the whole of what tells a citation apart from a
heading somebody wrote, and it is strict: `[[Notes#page=one]]` is a link to a
heading called "page=one" and stays one. Three things ride in the anchor and
each is load-bearing. `page` is where to open. `rect` is what to pulse — a
citation that only opened a page of nine hundred words has not answered the
click — and it is carried in the LINK and not only in the store, so a citation
into a book whose annotations were later deleted still points at the passage.
`id` is the handle the store knows, and it is what makes the link survive a
rename.

Both renderers draw it and both open it. In the reading view it is an
`.s-rv-cite` anchor carrying the note it was clicked FROM; in the editor it is
`cm-s-cite`, resolved through the reader's own PDF lookup rather than
`resolveLink` (which answers about NOTES, so a PDF would otherwise render
dashed and a click would offer to create `Ihya.pdf.md`). On a published page a
citation is not a link at all — it reads as the words the owner wrote, because
a visitor has no library to open and no business enumerating one.

Clicking it opens the reader at that page and pulses the rectangle three times
and then stops; under `prefers-reduced-motion` the ring is held still for the
same span. A ring left permanently around a sentence is a defacement of
somebody's book. `/book/<path>#page=42&rect=…&id=…` is the same address in the
URL bar, so a citation is bookmarkable.

### When the name in a citation stops being the book's name

Three months after the note was written the file is
`Sources/al-Ghazali - Ihya (ed. 1998).pdf`, because that is what people do to a
shelf and because Obsidian, Syncthing, `git pull` and `mv` all write to this
directory without telling us. Every reader that stored a PATH now has a dead
link and the passage the note was arguing from is gone.

It is not gone here. The `id` names a highlight, the highlight is filed under a
CONTENT KEY, and the key is a hash of the bytes. `GET /api/books/locate?id=`
answers where those bytes are now: the names this key has been seen under
first, newest first and two cheap reads each, and failing that a walk of the
vault's PDFs — the same pass the shelf already does. `BookState.names` is what
makes the first half possible and is maintained by `cleanBookState` from the
`path` every open already sends, capped and de-duplicated.

So the book opens anyway, on the right page, on the right sentence. **And then
it offers to repair the note**, because rescuing the reader once per click
forever leaves the link wrong in git and on the published site. The offer is a
toast with an action on it, not an automatic edit: repairing is a change to the
reader's own file and the reader decides whether their file changes. The
rewrite matches `[[<name>#` and nothing looser — a citation is the only
wikilink shape that can carry a `.pdf` target followed by a `#`, so it cannot
touch a `[[Note#Heading]]`, a differently-named book, or the words "Ihya.pdf"
in a sentence. A repair that edited one line too many would be a far worse bug
than the broken link it was fixing. It goes through the same
`applyNoteContent` door and carries its own Undo.

`path: null` is a real answer and means the bytes have left the vault. The
reader is told that rather than shown a spinner.

The recovery is DYNAMICALLY imported (`client/books/citations.ts`).
`client/books/door.ts` is first-paint code reached by a static import from the
sidebar and the router; the happy path there is a tree walk and nothing else —
no request, no await, the book opens on the same tick as the click — and only a
citation whose name has stopped resolving loads a byte of the rest.

### The shelf finds the passage, not just the book

Typing in the library's search box now searches the marked passages as well as
the titles, and shows them above the covers: someone who typed a word they
remember reading is not looking for a cover. It is the one thing a library of
PDFs can do that a folder of them cannot — find the sentence you underlined in
a book whose title you have forgotten.

`GET /api/books/highlights/all` ships the passages and the MATCHING happens in
the client, on `client/books/search.ts`'s fold — the same one `/` uses inside a
book, so `الْمُقَدِّمَة` is found by typing `المقدمة` and a margin note counts
as part of its passage, because "the thing I wrote about it" is exactly what a
person remembers. There is one implementation of that rule in this product and
shipping the passages rather than the query is what lets the shelf reuse it.
The request is made on the FIRST KEYSTROKE, never on open: a shelf that paints
instantly is a promise this surface already made, and a decade of marginalia
arriving before the first cover would break it for a search most visits never
run. The store caps what it will carry at once and says when the answer was cut
short.

### The routes

`GET|PUT|DELETE /api/books/highlights?key=` (PUT is an UPSERT by id — changing
the ink, writing a margin note and correcting a quote are the same request with
the same id, and appending would leave the old ribbon painted under the new
one), `GET /api/books/highlights/all`, `GET /api/books/locate?id=`. Same guard
and same reasoning as the rest of the chapter: the reads say
`assertAdminRead(c)` themselves and nothing here serves a vault file — the
routes trade in a content key, a page number and four numbers between 0 and 1.

---

## Lazy surfaces: ONE BOUNDARY EACH (`client/App.tsx`)

Every `React.lazy()` surface in the shell gets its **own** `<Suspense>`. This is a correctness
rule, not a taste one, and it is written down because the tidy-looking alternative is wrong in a
way nothing on screen explains.

A Suspense boundary is not a loading indicator. When anything under it suspends, React unmounts
**the whole subtree** and renders the fallback in its place. One boundary wrapped around the app
shell therefore meant that opening Settings — a modal — tore down the sidebar, the tabs, the
editor and the status bar along with it. With the chunk throttled the open note went to zero
characters while the reader watched, and CodeMirror was rebuilt from scratch when the chunk
landed. The fallback was `null`, so what the reader saw was the application vanishing.

It broke focus too, and this is the second bug rather than a symptom of a different one: the
dialogs capture `document.activeElement` on mount as the opener to restore on Escape
(`useDialog` in `client/a11y.ts`), and the element they were opened FROM had just been unmounted
by the very boundary that was loading them. So the first Escape of every session put focus on
`<body>`, and a keyboard reader was returned to the top of the document. **Fixing the boundaries
fixes the focus** — nothing that is already on screen is inside the boundary that suspends, so
the opener is still there to go back to.

The rules that follow from it:

- One `<Suspense>` per lazily-mounted surface. `Surface` in `App.tsx` is that boundary.
- Panes pass a REAL fallback shaped like the pane (`.s-sidebar`, `.s-tabs`, `.s-statusbar`,
  `.s-editor`, `.s-reading`, `.s-graph`) so the grid keeps its shape while the chunk lands.
  Modals pass none: a dialog arriving a frame late is invisible, a skeleton flashing where a
  dialog is about to be is not.
- Boundaries go INSIDE a ternary that chooses between two surfaces, never around it — a boundary
  around the editor/reading choice makes switching between them suspend the arm already mounted.
- A surface that is **always mounted** (`ConfirmHost`, `LoginModal`, `PreviewBanner`,
  `TemplatePicker`, `DesignStatus`) stays STATIC. `lazy()` defers nothing when the component
  mounts unconditionally — the import fires immediately — while costing a boundary and a round
  trip. Only a CONDITIONALLY mounted surface is worth splitting, which is why `ShortcutsHelp` is
  lazy AND gated on `shortcutsOpen`: gating is what makes its laziness real.
- A named import out of a lazy module is a STATIC import of that module, and silently undoes the
  split. `vimSubCopy` lives in `client/vimCopy.ts` and `openDesigner` in
  `client/components/design/openDesigner.ts` for exactly this reason — one reached into
  `StatusBar`, the other into `DesignerPanel`, and each dragged its whole surface back into the
  first paint. `npm run check-bundle` is what catches the next one.

- The reader is split TWICE, and the outer boundary is not `App.tsx`'s. The app
  shell holds only `client/books/door.ts` — a URL parser and a store call —
  and `Pane.tsx` reaches `BooksSurface` through `React.lazy`; the surface then splits the
  shelf from the reader, and `client/books/pdfjs.ts` splits the 1.1 MB engine
  from both. A reader who only browses their shelf never downloads the page
  renderer. `npm run check-bundle` names `pdfjs-dist` and the reader's
  components in FORBIDDEN and `books/BooksSurface.tsx` in MUST_SPLIT.

Proposed additions (I may not edit CONTRACTS.md). Suggested placement: a new
subsection beside the palette/editor-extensions entries.

## Finding: recents, ranked completion, tag completion, heading jump

- `client/recents.ts` — the FRECENCY LEDGER: which notes this browser's reader
  keeps returning to. Records every change of the store's `openPath` onto a
  note (installed by `installRecents(useStore)`, which CommandPalette.tsx calls
  at module load — state.ts keeps no dependency on the feature). One entry per
  path: `{ path, weight, at }`, where `weight` is the visit count decayed with
  a 7-day half-life (decay-then-increment on each visit, so the stored number
  IS the decayed count). Persisted in `localStorage["vellum.recents"]`, capped
  at 50 by score (not age). PATHS ONLY, PRUNED AT READ TIME: every read
  filters against the live tree, so a deleted note leaves the list when the
  tree does, and a visitor session — whose tree is the published subset —
  never surfaces a private path's title, even one an admin session left in the
  same browser. Storage is re-read on every public call because pop-out
  windows share the origin's localStorage. The pure core (recordVisit /
  rankRecents / parseRecents / decayedWeight) is proven in
  tests/recents.test.ts under bare node; the module therefore must not import
  state.ts (the store touches window/localStorage at import time) — the store
  is handed in.

- Palette on EMPTY query: recent notes first (a snapshot taken at palette
  open — the list must not reshuffle between two Ctrl+Ps in one minute, and
  opening the palette is itself a visit), minus the note currently open,
  capped at 10; then the commands; then open tabs not already named by the
  recents section (duplicate rows would make arrow-key distances drift with
  usage).

- Palette "@" prefix = HEADING JUMP within the open note: fuzzy over the
  note's ANCHOR table (shared/anchors.ts — headings and LaTeX \labels alike;
  ids are a match haystack too, since "eq:fourier" is how a \label is
  remembered). Enter dispatches the same `vellum:goto-heading` event with the
  same `{slug, line, text}` payload TocPanel's rows send, so the editor and
  the reading view each consume the half they already handle. Content comes
  from GET /api/note rather than the live buffer: the palette chunk must not
  import CodeMirror (the bufferBridge wall), and autosave keeps the server
  copy ~600ms fresh.

- Wikilink completion ("[[") is RANKED, lexicographically: match quality on
  the title/alias (exact > prefix > substring > subsequence), then frecency
  (the same ledger), then already-linked-from-the-open-note, then
  alphabetical. `filter: false` — the source hands CodeMirror a finished
  order, because CM's own scorer would re-sort by string distance. An alias
  row ranks by its NOTE's frecency/linkedness. Once a `|` is typed the popup
  closes (the author is writing display text). The alias dedupe rules
  (one row per alias, winner-first) are unchanged — tests/aliases.test.ts.

- The CREATE ROW: last row of the "[[" popup, admin only, only when nothing
  answers the typed name exactly. It creates `<open note's folder>/<typed>.md`
  (a typed name containing "/" is obeyed as a root-relative path; a typed
  note extension is kept) and SAYS SO on the row via `promptCreates` — a
  create row that scatters files silently is worse than none. Apply inserts
  the link as typed, creates the file via api.createNote + default template,
  reloads the tree so the link renders resolved, and does NOT open the new
  note: the writer is mid-sentence. (The click-a-dashed-link path still
  creates at the vault root; that asymmetry is livePreview's to close.)

- TAG completion: "#" mid-prose offers the vault's existing tags
  (GET /api/tags, cached 60s — the SSE tree reload does not reach the editor
  module, so a TTL stands in). It does NOT fire when the `#` opens the line
  (a heading being typed), when the preceding char is not in TAG_RE's opener
  class (URLs: `https://a/#frag`), inside code/links/math (syntax-tree
  check), or inside "[[" (the anchor half owns that). Rows carry the
  LOCALISED tag label (client/tagLabels.ts) as detail beside the canonical
  tag; the canonical tag is what gets inserted — chips say, files store.
  Boost is log-scaled usage count, so well-used tags surface first among
  equal matches.

## Landing on the line

**The wire.** `Backlink` grew `line` (appended, never reordered): 1-based in the note's FULL
source, frontmatter included — the coordinate the editor counts in. The indexer parses `body`
(frontmatter stripped), so every record carries `bodyStartLine` and `fileLine()` is the ONE
place body-relative indexes become file lines; `.tex` bodies are the full file (offset 0).
`SearchMatch` is the same coordinate.

**The machinery (client/landing.ts).** The line-based variant of `pendingHeading`, NOT a second
system: for a surface already on screen it dispatches the existing `vellum:goto-heading` event —
the editor's handler has read `detail.line` since the outline panel — and for a cross-note
landing it holds a one-shot pending slot and retries per frame until an editor view for the note
is attached (`bufferOf`, via DYNAMIC import so CodeMirror stays out of first paint;
check-bundle), the reading view consumes the slot (`takePendingLine`) after its own render, the
reader moves on, or ~4s pass. `detail.path` now rides on the event so a handler CAN scope a goto
to its own pane's note; the reading view does, pre-existing handlers ignore it and behave as
before. Every landing marks the landed element with `.s-landed` for 1.5s (`flashElement`) — a
translucent accent wash, no new text/background pair, fade dropped under prefers-reduced-motion.

**Reading-view precision is SECTION-level, and says so.** The reading renderer keeps no
per-block source map, so a line landing resolves to the nearest heading at-or-above the line via
the note's own anchor table (`shared/anchors.ts` — the same table `[[Note#anchor]]` resolves
against, so the two landings cannot disagree about where a section starts), walking backward
past anchors the renderer assigns no element to; with no preceding anchor it falls back to the
note TOP. The flash makes the imprecision legible. The editor lands on the exact line. Honest
fallback beats fake precision; anyone adding a source map to the renderer should delete this
paragraph's fallback, not layer on it.

**Surfaces.** A backlink card is a div now (a button may not contain buttons): the title row
lands on the first mention, each context line on its own mention — mentions are distinct by LINE
(two identical context lines are two places a click can land). A search hit grew a sibling
chevron: expanded, it lists `/api/search/matches` rows (line number + marked line through the
same snippet renderer as the hit itself); empty and failed fetches both render the quiet
"no matches" row because the whole-note click above still works. Expansions and fetched lines
are query-scoped state and a late response for an abandoned query is dropped.

**Hover previews in the admin app.** `installNotePreviews` (client/landing.ts) is the blog
shell's `installHoverCards` engine — same LRU, same card, check-hovercache still stands over the
bound — with admin wiring: `resolve` reads `data-preview-path` off backlink cards and search hit
rows, `render` is the blog card's excerpt recipe behind dynamic imports (the reading renderer
must not enter the first-paint chunk for a hover). Installed by BacklinksPanel over its panel
body and by the Sidebar over the search results region; re-installed on language change, exactly
as the blog install's contract states. Recent-notes rows: none exist in the sidebar today
(recents live in the CommandPalette, another owner) — nothing was installed there.

**Multi-pane caveat (pre-existing, now load-bearing).** `vellum:goto-heading` is a broadcast and
the EDITOR's handler ignores `detail.path`; with two editor panes on different notes a line-goto
scrolls both. The reading view scopes itself; scoping the editor's handler is Editor.tsx-owner
territory and the `path` in the detail is already there waiting for it.

Insert under "Text formatting (client/editor/commands.ts)", after the LaTeX rule.

---

## The composer commands (selection menu only — no keystrokes, by decision)

Four verbs behind the right-click menu: extract the selection into a linked
note, insert a footnote, change the selection's case, wrap it in a callout.
None of them claims a key — the selection menu is the door, Obsidian binds
none of them by default either, and the keymap ledger gains four `via` rows
and zero chords. The text arithmetic lives in `client/editor/composeText.ts`,
pure and CodeMirror-free, so `tests/composer.test.ts` drives exactly what the
commands dispatch — the same split `client/keymap.ts` makes for the gate.

- **EXTRACT SELECTION (`client/composerActions.ts`) is the selection-shaped
  sibling of `sectionActions.extractSection` and is built out of its parts** —
  the same dialog (`promptExtractPath`, one naming rule for both, hoisted into
  sectionActions.ts), the same create-the-new-note-FIRST ordering, the same
  undo-toast shape. What differs is argued: the source is rewritten through
  the LIVE VIEW as one transaction (the menu only exists over an open editor,
  and one transaction means Ctrl+Z alone takes the source side back); the stub
  is the bare `[[link]]`, not a heading plus a link, because a selection is
  prose mid-paragraph and owns no outline entry that could vanish; and the
  toast's Undo restores BOTH files — snapshot back into the source first,
  the new note deleted only after that lands — because a cross-file undo that
  restores one side is worse than no undo at all. Before the source is
  rewritten the command re-reads the selection and, if the document moved
  under the dialog (a second pane, a second window), takes the new note back
  and changes nothing: replacing text nobody selected is worse than asking
  again.
- **A FOOTNOTE'S NUMBER IS EARNED, NOT ASSUMED** (`planFootnote`). A command
  that always inserts `[^1]` is actively harmful from the second footnote on.
  n = 1 + the highest numeric id before the caret; numeric footnotes that
  first appear after the caret are renumbered upward — references and their
  definitions in the same plan — only when they must move to make room, never
  "tidied" (a note that jumps 1 → 5 keeps its 5: rewriting it is an edit
  nobody asked for). Word-labelled footnotes (`[^note]`) are prose, not
  arithmetic: never renamed, never counted. `[^…]` inside fenced blocks and
  code spans is code, not a reference. The command REFUSES cleanly — changes
  nothing — when the caret is in code or an id is defined twice (renumbering
  an ambiguous note silently picks a winner, which is corruption wearing a
  feature's name). The caret lands in the definition stub, because the next
  thing the writer types is the footnote. In a `.tex` note the same row
  writes `\footnote{…}` at the caret instead: numbering is the compiler's
  job there, which is the whole reason the macro exists.
- **CASE TRANSFORMS RUN PER RANGE** (`transformSelectionCase`) — the
  `changeByRange` shape the other commands use, so every caret of a
  multi-cursor selection transforms its own range. Wikilink TARGETS are
  case-sensitive addresses on disk (`[[iPhone|the phone]]` uppercased into
  `[[IPHONE|…]]` points at a file that does not exist), so only the alias
  half is prose; a link with no alias is all address and passes through
  whole, as do code spans, backticks included. Title Case is templates.ts's
  rule (first and last words always capitalize, interior small words fall,
  an author's inner capitals — "iOS" — stay), with the word positions
  counted ACROSS skipped spans so "the" straight after a code span is still
  an interior word. The implementation is a copy of templates.ts's private
  `titleCase`, marked for reunification — that file was another engineer's
  this round.
- **A CALLOUT WRAP SURVIVES ITS OWN BLANK LINES** (`calloutWrap`). Every
  selected line gets `> `; a blank line becomes a bare `>` — a genuinely
  blank line ENDS a blockquote, so the naive wrap breaks the callout at the
  first paragraph break and the second paragraph falls out as plain prose.
  The type picker is `calloutDefs.ts`'s `CALLOUT_TYPES`, in the same order
  the `> [!` autocomplete offers, so the two doors can never offer different
  callouts. Markdown only: a callout is Obsidian syntax and a `.tex` note has
  no honest spelling for one — absent, never approximated.
- **`client/noteName.ts` is a module of one function on purpose**:
  sectionActions.ts is first-paint code and composeText.ts is editor-chunk
  code, and importing the shared naming rule from composeText dragged the
  whole composer module into the admin first paint (measured: +3.2 kB in the
  sectionActions chunk) for four lines of regex. The seam sits where the
  chunk boundary is.

Suggested placement: a new section after "Text formatting
(client/editor/commands.ts)".

---

## Tables (client/editor/tables.ts, tableModel.ts; reading renderer's table branch)

One renderer, four surfaces. The reading view, the blog article, the editor's
transclusion widget and the editor's table widget all draw a table through
`client/reading/render.ts` (`.s-rv-tablewrap` scrolls, `.s-rv-table` carries
`dir="auto"` so column order follows the table's own text; alignment colons
map to `.s-rv-al-c` / `.s-rv-al-r`; `\|` escapes survive; colors are tokens
check-contrast already holds). The editor never grows a second table renderer.

**Live preview follows the reveal-on-caret rule.** Caret outside a top-level
`Table` node → the block is one `Decoration.replace` block widget
(`.cm-s-table`, a StateField — block decorations cannot come from a
ViewPlugin), and clicking a rendered cell puts the caret at that cell's
source content (each cell carries `data-pos`, mapped from the same parse the
renderer saw). Caret inside → the pipe source, its lines marked
`.cm-s-table-srcline` and set in `--font-mono`, because the padded pipes
format-on-exit writes only align in a monospace face. Tables nested in
blockquotes/callouts or lists stay source in the editor (they still render in
the reading view and blog): replacing a range that includes `> ` markers
would fight the callout field for the same lines.

**The table keymap is scoped, never global.** A `Prec.high` keymap whose
every command resolves the syntax tree first and returns false unless the
caret is a single selection inside a top-level table — outside a table Tab
still indents, Enter still breaks the line, Alt+arrows still move lines, and
an open autocomplete tooltip keeps Tab/Enter (completionStatus is checked
before the table answers). Inside one:

- **Tab / Shift+Tab** walk cells, selecting the cell's trimmed content;
  Tab in the last cell appends an empty row. **Enter** moves down a row,
  same column, caret at the content's end (walking must not arm an
  overwrite); from the last row it leaves the table downward instead of
  splitting a row.
- **Alt+↑/↓** swap body rows. The header and delimiter never move — at them
  the keystroke is consumed as a no-op, because falling through to
  moveLineUp/Down would drag the header line out of the block.
- **Alt+←/→** move a column: header, delimiter and every body row in the
  same transaction — a column move that skips the delimiter walks each
  column's alignment into its neighbour's. Arrows are VISUAL: in an RTL
  table the header's own direction flips them, same as the rendered
  `dir="auto"` does. Edges consume the key; nothing wraps, nothing shears.
- **Format on exit.** When the caret leaves a table block (and only then —
  not on undo/redo, not while any selection range still touches the block),
  the block is prettified off the update cycle: every cell padded to its
  column's display width (grapheme-clustered via Intl.Segmenter; CJK and
  emoji count two columns, Arabic one), the delimiter stretched with its
  colons kept where the author put them, leading/trailing pipes normalized,
  short rows squared off. Cell CONTENT is copied verbatim — splitting on
  unescaped pipes (`\|` holds, `\\|` splits: parity, not presence) is the
  only operation that ever looks inside a cell, which is what keeps escapes
  and code-span pipes uncorrupted. A block that stopped parsing as a table
  mid-edit round-trips untouched.

**The model is pure and tested.** All string/offset logic lives in
`tableModel.ts` with zero imports — split from tables.ts for the reason
calloutDefs.ts is split from callouts.ts: tables.ts's import chain carries
.css and CodeMirror, and `node --test` (tests/tables.test.ts) must load the
logic without them.

**Creation.** The slash menu's Table entry inserts a 2×2 skeleton with
exactly one snippet field selecting the first header cell; from there every
Tab is the table's (three fields would feed Tab to the snippet walker
instead of the cell walker).

## Tests (`npm test`) — the release gate

`node --test` over `tests/*.test.ts`. No new dependencies, no test framework, no fixtures on disk
beyond the temp vaults the tests build themselves. The whole suite runs in well under a second, so
there is no reason to skip it.

**Nothing ships until all of these are green:**

```
npm run typecheck
npm run check-i18n
npm test
node scripts/check-contrast.mjs
npm run check-bundle
npm run check-keymap
npm run check-books
```

(plus whatever visual gates the repo carries at the time — `check-caret`, `check-sections`,
`check-excerpt`, `shoot-hover` — which cover what a screenshot has to prove and the tests cannot.)

What the suite covers, and why each file exists:

- `tests/frontmatter.test.ts` — the byte-level contract of `setFrontmatterLine()`. Mostly a
  property test: for generated notes (CRLF/LF, quoted values, malformed YAML, bodies containing
  their own `---` rules and `publish:` lines) the edit changes ONE line and every other byte
  survives, the edit is idempotent, and removing the key restores the rest. Also pins server/client
  agreement on what "published" means.
- `tests/links.test.ts` — wikilink parsing plus resolution on BOTH sides (`server/indexer.ts` and
  `client/editor/links.ts`), including duplicate basenames, folder-named files, path-form targets,
  Arabic and punctuated titles, and visitor scoping. The parity block is the point: the editor and
  the graph must land on the same note.
- `tests/aliases.test.ts` — every surface of `aliases:` from one vault (resolution, search,
  `/api/aliases`, backlinks) plus the write half over strings alone. Pins the three YAML
  spellings, alias-vs-filename precedence, the `pickShortest()` tie, a `.tex` note's aliases,
  visitor scoping in both directions, and that a deleted note's aliases leave the table — the
  incremental-upkeep case, which is the one a future refactor will break. It carries a parity
  block of its own, for the same reason `links.test.ts` does: the client resolver must name the
  note the server names, or an alias is a dashed link over a note that is right there.
- `tests/books.test.ts` — the reader's testable half: that a book's key follows
  its BYTES across a rename and differs between books, that the store merges a
  partial patch and never lands in the vault, the search fold (harakat, the
  alef family, tatweel, a line break inside a phrase, offsets into the original
  string), the `:` grammar including its abbreviations and Eastern Arabic
  digits, the page window's bound and the right-to-left spread order, and the
  operator-list geometry that keeps night mode off the photographs. The
  rendering half needs a browser and is not faked: a test asserting pdf.js was
  called proves nothing about whether a page appeared.
- `tests/keymap.test.ts` — the keyboard ledger: `GROUPS` parses, every row has an answer (a key or
  the surface that carries it), every `keys` array spells a chord the one canonical way, no two rows
  resolve to the same chord in an overlapping scope, every declared overlap in `RESOLVED` still
  happens and still says why, and `docs/keymap.md` claims exactly the chords `GROUPS` binds. It runs
  the same code `npm run check-keymap` does (`client/keymap.ts`), from the other door, so a green
  gate and a green suite can never disagree. Its companion is `tests/shortcuts.test.ts`: this file
  asks whether a binding is UNIQUE, that one asks whether a keyboard typing no Latin letters can
  reach it. A new binding needs both.
- `tests/anchors.test.ts` — `[[Note#Anchor]]` against both anchor resolvers (editor by heading
  TEXT, reading view by SLUG), plus `Slugger` collisions and unicode.
- `tests/sections.test.ts` — the partition invariant: cutting a note at its heading line numbers
  and concatenating the pieces returns the original bytes. Property-tested. Fences full of `###`,
  frontmatter, nesting and CRLF included. Any section extract/move/fold feature must keep this.
- `tests/excerpt.test.ts` — excerpts and search snippets through `posts()`/`search()`: no raw
  markdown, no de-hashed tag words in the prose, no template furniture as an opening paragraph,
  word-boundary truncation, HTML escaped before `<mark>`.
- `tests/paths.test.ts` — traversal, dotfiles/`.trash`/`.obsidian`, encoded separators, NUL bytes,
  unicode normalisation and symlinks.
- `tests/settings.test.ts` — the PATCH allowlist as a security boundary: unknown keys, prototype
  keys, per-key validators, the enum keys, and "a patch that fails anywhere lands nothing". It also
  cross-checks that `server/settings.ts` THEMES still equals `client/state.ts` THEMES — the drift
  that makes the admin panel offer a theme the API answers 400 for.
- `tests/numerals.test.ts` — one numeral system per instance, checked on a DATE and a COUNT
  together (the `٩ يناير ٢٠٢٦ · 3 دقائق قراءة` regression), the separator/digit confusion rule, the
  calendar tripwire, and tag-label encoding/isolation/direction.

**Tests named `KNOWN BUG:` assert current, wrong-ish behavior on purpose** — they are the written
record of a defect nobody has decided to fix yet, and they keep the suite honest instead of green
by omission. Fixing the bug means rewriting that test, which is the intended workflow.
