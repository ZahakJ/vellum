# Round B/C spec — Obsidian vault compatibility, view/admin modes, scale

Target vault reality: real Obsidian vaults with thousands of notes and heavy media —
nested folders, attachments (png/jpg/svg/pdf/…) alongside the markdown, and a `.obsidian/`
config dir (must be ignored everywhere: tree, index, graph, watcher).

## B1. Attachments (server)

- `GET /api/file?path=` serves any non-md vault file (png/jpg/jpeg/gif/webp/svg/pdf/mp4/mp3…)
  with correct Content-Type, ETag from mtime+size, and the same path-safety as notes. 404 others.
- Tree/index still list only .md, but `resolveEmbed(name)` resolves attachment basenames
  (case-insensitive, shortest-path) like wikilinks — expose `GET /api/resolve?name=` returning
  `{ path } | 404` for both notes and attachments.

## B2. Editor rendering (client, live preview widgets)

- `![[image.png]]` and `![[image.png|300]]` → inline <img> widget (max-width 100%, optional px
  width from alias), loaded from /api/file; broken → dashed placeholder with filename.
- Standard `![alt](relative or URL)` images likewise (vault-relative resolved against note dir).
- `![[Note]]` note embed → rendered transclusion card: note title header + rendered content
  (read-only, depth 1, cycle-safe), gold left border.
- `![[file.pdf]]` → card link that opens /api/file in new tab.
- Callouts: `> [!note] Title` (+ tip/info/warning/danger/quote/example, case-insensitive, foldable
  with `-`) → styled callout block in live preview: tinted bg, icon, bold title; body renders as
  usual. Colors per type from tokens (add --callout-* tokens).
- `==highlight==` → gold-soft background mark. `%%comment%%` → hidden in preview, faint when
  cursor inside. Footnotes `[^1]` → superscript link.
- Math: `$inline$` and `$$block$$` via KaTeX (add dependency; render in widget when cursor
  outside). Code fences: CM6 syntax highlighting for common langs (@codemirror/language-data).
- Frontmatter: when cursor outside the `---` block, collapse it to a neat properties card
  (key: value chips; tags clickable).
- All of this in live preview; a separate READING VIEW (Ctrl/Cmd+E toggles editor⇄reading) renders
  the full note to HTML (same features, plus TOC in the right panel above backlinks) — implement
  as a client-side renderer sharing the resolve logic. Reading view is the default for
  non-admin visitors (see C1).

## B3. Obsidian niceties

- Daily note command (palette + Ctrl/Cmd+D): opens/creates `daily/YYYY-MM-DD.md`.
- `[[Note#Heading]]` navigates to the heading; heading autocomplete after `#` inside `[[ ]]`.
- Unresolved wikilinks styled dashed; clicking one creates the note (admin only).
- Outline/TOC panel section (right panel): headings of open note, click scrolls.

## C1. Auth: public view / admin edit

- `.env`: `ADMIN_PASSWORD_HASH` (argon2id — add `argon2` dep), `SESSION_SECRET`, optional
  `PUBLIC=false` to require login even for viewing. No hash set → open admin (local mode) with a
  startup warning.
- `POST /api/login {password}` → argon2 verify → httpOnly signed session cookie (HMAC of
  SESSION_SECRET, 30d); `POST /api/logout`; `GET /api/me` → `{ admin: boolean, public: boolean }`.
- When a hash IS set: all mutating endpoints (PUT/POST/DELETE note/folder/rename) require admin
  session → 401 otherwise. GET endpoints stay public unless `PUBLIC=false`.
- Client: on boot fetch /api/me. Non-admin → reading view only, no editor, no create/rename/delete
  UI (hide, don't just disable), status bar shows a quiet "sign in" link → minimal login modal.
  Admin → full editor. Login state changes rerender without reload. Rate-limit login (in-memory,
  10/min/IP).

## C2. Scale (1.4k notes, 738MB)

- Indexer: build once at boot (stream files, skip >2MB md), incremental on watch events; boot
  under 3s on the real vault. Watcher: ignore `.obsidian`, `.git`, `.trash`, dotfiles.
- Tree: render collapsed at depth>1 by default for huge vaults; folder toggle stays O(subtree).
- Graph: cap physics with Barnes-Hut or spatial grid; 1.4k nodes at interactive fps; labels only
  when zoomed/hovered; initial layout seeded deterministically (hash of path) so it's stable.
- Search debounce + cancel stale; snippet generation lazy.
- `/api/file` streams (no full-buffer reads) for large media.

## Config file

- Support `.env` (loaded via `node --env-file=.env` in npm scripts, document in README) with:
  `PORT`, `VELLUM_VAULT`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `PUBLIC`, `HOME_NOTE`
  (note opened for visitors on first load — the vault's homepage).
- `npm run hash-password` script → prompts, prints argon2 hash (scripts/hash-password.ts).

## Non-negotiables

- Never write outside the vault; never serve dotfiles; `.obsidian` untouched.
- Real-vault smoke: boot against a READ-ONLY COPY of a real Obsidian vault (copy a subset ~200
  notes + their images to a scratch dir for tests; never point tests at a live vault).
- Keep DESIGN.md aesthetics for every new surface (callouts, login modal, reading view, TOC).
