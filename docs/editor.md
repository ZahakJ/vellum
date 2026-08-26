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
- **Frontmatter properties card, editable in place** — YAML frontmatter collapses to a neat
  key/value card with clickable tag pills while your cursor is outside it, and you edit it there:
  click a value to type over it, tick a checkbox for `true`/`false`, pick a date from a calendar,
  add and remove list values as chips, add a property, remove one with the × at the end of its row.
  Every one of those writes is **byte-surgical** — your quote style, your comments, your key order
  and every line you did not touch survive exactly as they were, and deleting the last property
  takes the `---` fences with it instead of leaving a stray rule behind. Machine keys (`id`,
  `uuid`, `dg-*`) stay read-only, and `publish:` keeps its own switch in the status bar. It works
  the same on a `.tex` note, whose properties live in a `%---` comment block
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
  as well as canonical ones, and it **folds diacritics and letter shapes**, so «المقدمة» finds a
  note that spells it «الْمُقَدِّمَة» and `resume` finds *résumé* — see
  [Searching in Arabic](arabic-and-rtl.md#searching-in-arabic)
- **Search operators** — the `?` under the search box opens the card that lists them; they narrow
  together, and any one of them can be negated with a leading `-`:

  | Type | Finds |
  | --- | --- |
  | `tag:recipes` | the topic and everything nested under it |
  | `path:Journal` | notes whose path holds the text |
  | `is:published`, `is:page` | the frontmatter flags |
  | `after:2024`, `before:2024-06-15` | by the note's own date (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`, UTC; `after:` is inclusive from the start of the named period and `before:` is exclusive of it, so `after:2024 before:2025` is exactly 2024) |
  | `linkto:Ledger` | notes that link **to** that note |
  | `linkfrom:Ledger` | notes that note links **to** |
  | `-tag:draft` | everything but |
  | `path:"Reading notes"` | a value with a space in it |

  A query made only of operators is a real query: `tag:recipes` on its own lists every recipe,
  newest first. Anything that does not parse — `before:soon`, a bare `tag:` — stays an ordinary
  word rather than silently matching nothing.
- **Search & replace across the vault** — the ⇄ button under the search box (admins only). The
  search box sets the **scope**: whatever operators are in it decide which notes are considered,
  so `tag:recipes` replaces in the recipes and nowhere else. You get a **dry run first, always** —
  every file it would touch, every line, the replacement beside the original, and a checkbox on
  each — then one button, and a toast with **Undo**. Where the vault is a git repository the panel
  offers to take a **snapshot** first, ticked by default: the in-memory undo expires and the commit
  does not, so a replace you regret tomorrow is still in
  [Backup & sync](backup-and-sync.md). Two rules worth knowing before you type:

  - **Matching is exact.** Case and diacritics count, and it is a literal string unless you tick
    *Regular expression* (then it is a JavaScript pattern, `$1` capture references and all, applied
    one line at a time — so `^` and `$` mean the ends of a line). The search box above folds and
    shrugs at case because finding is a question; replacing is a write, and a replace that stripped
    the harakat off a word you never typed would be destroying text you never saw.
  - **Frontmatter is never touched.** Properties have their own byte-surgical editor; a blind
    regex over YAML is how other tools eat your quote styles.

  A file that changed on disk between the preview and the press is **skipped and named**, never
  overwritten.
- **Tags** — `#inline` and frontmatter `tags:`, counted and clickable in the sidebar. Right-click
  a pill to **rename** the tag across the whole vault — inline `#tags` and frontmatter `tags:`
  alike, with everything nested under it coming along (`#zettel` → `#slip` takes `#zettel/seed`
  with it). Renaming onto a tag that already exists **merges** the two, and the dialog says so
  before you press anything. You are shown how many notes will change before it runs, and the
  toast that follows carries one **Undo**. The rewrite never enters a code fence or an inline
  code span, so a `#define` in a shell block is left exactly where it is; your quote styles,
  comments and every other frontmatter key survive byte for byte. The tag's own page under the
  tags folder comes along, and its [localised label](arabic-and-rtl.md#localised-tag-labels)
  moves with it
- **Rename a heading and the links follow** — `[[Note#Heading]]` links break silently when the
  heading is renamed: the link still opens the note and quietly lands at the top. When a save
  renames a heading other notes point into, Vellum says so — *"3 links point at “Introduction”.
  Update them to “Preface”?"* — and one button repairs them all. It is always an offer, never
  automatic, and it too carries an Undo
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
- **Your editor's language is yours** — three more states in the same two places: *Editor
  language: follow the site* (the default), *English* or *العربية*. It is a per-browser choice
  that changes nothing about what your site publishes, so an Arabic site can be run from an
  English editor. Each palette row names its language in that language's own script, which is
  the point: it stays findable when the interface is one you cannot read. See
  [Arabic & RTL](arabic-and-rtl.md#your-editors-language-is-yours)
- **Command palette** — fuzzy over notes and commands alike, and every command row has to earn
  its place: a query only surfaces commands it genuinely matches, at most five of them, and they
  sit above or below your notes according to which matched better. Typing `sort` used to put
  *Design your site* over the whole vault. Start the query with `@` or `#` to jump to a heading
  (or a LaTeX `\label`) inside the note you are reading instead.
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
