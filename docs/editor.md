# The editor & reading view

*What the live-preview editor does, what markdown Vellum renders, and how you get around the vault.*

← [Back to the README](../README.md) · [All docs](README.md)

---

![The live-preview editor](screenshots/hero-editor.png)

## Writing

- **Live-preview editor** (CodeMirror 6) — markdown syntax hides itself except on the line you're
  editing; headings set in serif, clickable checkboxes, gold `[[wikilinks]]`, tag pills
- **Wikilinks with autocomplete** — type `[[` and pick any note; `[[Name|alias]]` and
  `[[Name#heading]]` supported (type `#` inside the brackets to complete headings); heading links
  render as `Note › Heading` and jump straight to the heading; renames rewrite every link that
  pointed at the old name
- **Click to follow, click to create** — plain click follows a rendered link; clicking an
  unresolved (dashed) link creates the note, Obsidian-style
- **Selection that knows what it is looking at** — double-click takes the word under the pointer
  (by grapheme cluster, so Arabic harakat and Persian ZWNJ stay inside the word), or the whole
  rendered object when you double-click one: a wikilink, a `#tag`, an inline `$math$` span, a code
  chip; inside a fence it takes the identifier, `$jquery` and `snake_case_name` included.
  Triple-click takes the paragraph, drag extends by character, shift-click extends from where you
  were. Gated in both language shells by `npm run check-caret`
- **Frontmatter properties card** — YAML frontmatter collapses to a neat key/value card with
  clickable tag pills while your cursor is outside it
- **Templates, Obsidian-compatible** — `{{date}}`, `{{time}}`, `{{title}}`, `{{date:FORMAT}}` (plus
  `{{hdate}}` for the Hijri date); insert one at the cursor or start a new note from one, with a
  picker that previews the filled result — see [Templates](templates-and-notes.md#templates)
- **Paste or drop attachments** — an image on your clipboard (or any accepted file dragged from a
  file manager: PDF, audio, video too) uploads and lands as `![[name.png]]` at the cursor, with an
  "Uploading…" placeholder holding the spot while it's in flight. Files can also be dropped
  straight onto the sidebar tree — onto a folder row, onto a note row, or onto the tree's own
  ground. Where they land is a [setting](configuration.md#attachments); a type the server would
  reject is refused before the upload, not after, and the toast that reports the drop carries an
  Undo
- **Slash commands** — type `/` at the start of a line for a fuzzy menu of inserts: callout, code
  fence (with language search), table skeleton, task list, math block, divider, today's date,
  daily-note link
- **Callout & fence autocomplete** — `> [!` suggests every callout type with its icon and color;
  ` ``` ` suggests languages as you type
- **Hover previews** — rest on a `[[wikilink]]` and a floating card shows the target note's
  rendered opening (`[[Note#Heading]]` previews from that heading); footnote refs preview their
  definition
- **Section surgery** — fold a heading, extract it into a new note, or drag it in the outline to
  move the whole subtree; see [Sections](templates-and-notes.md#sections-fold-extract-move)
- **Auto-numbered headings** — off by default; the outline's `1.` button turns them on for reading
  view, and `numbered: true` in a note's frontmatter numbers it for everyone, including on the
  blog. Nothing is written into your markdown
- **List/quote continuation** — `Enter` continues `-` lists, `- [ ]` tasks, numbered lists, and `>`
  quotes; `Enter` on an empty item exits. `Ctrl/Cmd ↑/↓` moves the current line. Pasting a URL over
  selected text makes a markdown link
- **Text formatting on the keys you already know** — `Ctrl/Cmd B` / `I` / `U`, plus strikethrough
  (`Ctrl/Cmd Shift X`) and highlight (`Ctrl/Cmd Shift H`) on Obsidian's own bindings. Every one
  toggles, works with no selection (markers inserted, caret between them), and applies per line
  across a multi-line selection — see [Keymap](keymap.md#why-these-keys)
- **Selection menu and floating toolbar** — right-click a selection (or `Shift F10`) for the whole
  vocabulary, grouped: text style, structure, insert, colour. It is keyboard-complete, never
  overflows the viewport, and mirrors in Arabic. A Notion-style strip with the six most-used
  actions floats over every selection unless you turn it off from the menu's last row (the palette
  turns it back on)
- **Coloured text in two tiers** — a theme-aware palette that clears AA on all fifteen themes, and
  a fixed-ink one for when you mean *that* colour; see
  [Theming](theming.md#colored-text-in-two-tiers)
- **Deletes that say what they are taking**, and a **trash browser** — see
  [Deleting](templates-and-notes.md#deleting-and-the-trash)
- **Vim mode**, autosave (600 ms debounce + `Ctrl/Cmd S`), and a keyboard-first surface

## Rendering

- **Image embeds** — `![[image.png]]`, `![[image.png|300]]`, and standard `![alt](path)` render
  inline from your vault's attachments; broken embeds get a dashed placeholder
- **Note transclusions** — `![[Note]]` renders the target note as a full-fidelity card (callouts,
  math, code highlighting included), with an "Open note" affordance when the excerpt overflows
- **PDF & attachment cards** — `![[file.pdf]]` (mp4, mp3, zip, …) becomes a card that opens the
  file in a new tab
- **Callouts** — `> [!note]`, `[!tip]`, `[!warning]`, `[!danger]` and friends, tinted and iconed,
  foldable with `-`
- **Math** — `$inline$` and `$$block$$` via KaTeX
- **Code highlighting** — fenced blocks highlight for all common languages, themed to match
- **Highlights, comments, footnotes** — `==mark==`, `%%hidden comment%%`, `[^1]` superscript refs
  that jump to their definitions
- **Reading view** — `Ctrl/Cmd E` flips the note to a fully rendered, read-only page (tables
  included), sharing the editor's resolve logic

`.tex` and `.latex` files are first-class notes with their own renderer — see
[LaTeX notes](latex.md).

## Navigating

![Graph view](screenshots/graph.png)

- **Backlinks panel** — every note shows who links to it, with the sentence that did
- **Outline (TOC) panel** — the open note's headings, tracking your scroll position; click to jump
- **Graph view** — hand-rolled canvas force simulation; drag nodes, hover to highlight neighbors,
  click to open
- **Full-text search** — prefix + fuzzy (MiniSearch), highlighted snippets with markdown syntax
  stripped, instant. It answers to [localised tag labels](arabic-and-rtl.md#localised-tag-labels)
  as well as canonical ones
- **Tags** — `#inline` and frontmatter `tags:`, counted and clickable in the sidebar
- **Attachments are in the tree**, with a lightbox, players and downloads — see
  [Attachments](templates-and-notes.md#attachments)
- **Reorganize by dragging**, with every link repaired — see
  [Reorganizing](templates-and-notes.md#reorganizing-by-dragging)
- **Daily notes** — `Ctrl/Cmd D` opens (or creates) `daily/YYYY-MM-DD.md`
- **A shell that gets out of the way** — collapse either pane (`Ctrl/Cmd Alt B`,
  `Ctrl/Cmd Alt Shift B`) down to a slim reopen handle, or go **zen** (`Ctrl/Cmd Shift Z`):
  sidebar, panel, tabs and status bar step aside and the prose centers on a wide measure. `Esc` (or
  the faint ✕) comes back. Every state is remembered across reloads — and **folding a pane never
  moves the note**: the column stays optically centred in the window whichever panes are open, with
  deliberate air beside a closed pane's reopen handle
- **Notes sidebar on either side** — three states, in the palette and in Settings → Appearance &
  language: *follow the language* (the default — left in English, right in Arabic, re-evaluated
  whenever the language changes) or pin it to the left or right screen edge for good
- **Command palette** — fuzzy over notes and commands alike
- **Live vault watching** — edit a file in any other editor and the app updates within ~100 ms
  (chokidar + SSE)

![Command palette](screenshots/palette.png)

## Modes you cannot sit in by accident

Reading, vim and visitor preview each light a pill in the status bar (accent-filled, clickable to
leave, tooltip naming the shortcut), and a mode that takes typing away also states itself *in the
workspace*: a one-line strip above the note ("Reading — this note is read-only" + an **Edit**
button) plus an accent rule down the column's leading edge.

Vim gets the same treatment one level deeper, because "vim is on" is not the trap — "the keys under
your fingers are commands right now" is: the pill carries the live sub-mode (**VIM │ NORMAL**,
**│ INSERT**, **│ VISUAL**, **│ REPLACE**), vim's own `-- INSERT --` line and `:` / `/` command line
sit at the foot of the editor, and in zen — where the whole status bar is at zero height — the strip
says it instead. [Visitor preview](publishing.md#preview-as-visitor) is a strip at the top that
pushes the page down — it never covers the layout you opened it to judge — and it never survives a
reload.
