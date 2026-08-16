# Vellum design spec — the bar is "people ditch Obsidian for this"

Reference quality: Obsidian's default theme + Linear's polish. Identity: illuminated manuscript —
iron-gall dark default, parchment light, gold-leaf accent. Everything below is normative.

## Layout (CSS grid, full viewport, no page scroll)

```
┌──────────┬─────────────────────────────┬───────────┐
│ sidebar  │ tab bar                     │ backlinks │
│ ≤292px   ├─────────────────────────────┤ 300px     │
│          │ center content (editor OR   │ (collaps- │
│          │ graph), own scroll          │  ible)    │
├──────────┴─────────────────────────────┴───────────┤
│ status bar 28px                                    │
└────────────────────────────────────────────────────┘
```

- Sidebar and backlinks panel have `--bg-raised`; center is `--bg`; 1px `--border` separators.
- Backlinks collapse: chevron button in the panel header; collapsed = 0 width. Animate width
  180ms ease. The sidebar collapses the same way (`Ctrl/Cmd Alt B`; the panel is
  `Ctrl/Cmd Alt Shift B` — the pair moved one modifier out when `Ctrl/Cmd B` became **bold**).
- A collapsed pane leaves a **reopen handle**: a 14px full-height strip on that pane's own edge,
  `--bg-raised` with the shared 1px border and a `--text-muted` chevron pointing into the
  content; hover fills `--bg-hover` and turns the chevron gold. Always visible while collapsed —
  a pane with no visible way back is a lost pane — and never a hover-reveal.
- Which edge the sidebar sits on is a preference (palette: "Move sidebar to the right/left"),
  defaulting to the reading direction's leading edge. All four dir × side combinations must look
  deliberate: separators, indent, active-row bars and every chevron follow.
- **Zen** (`Ctrl/Cmd Shift Z`): sidebar, panel, tab bar and status bar animate to zero — never
  `display: none`, so entering and leaving is one movement — and the prose column centers at
  800px with 96px of air above it. The only chrome left is a hairline ✕ in the top inline-end
  corner at 50% opacity, which fades out after ~2s and returns on mouse movement (and is
  `pointer-events: none` while faded — no invisible hit targets). `Esc` also leaves.
- Never let any panel's content overflow the viewport horizontally.
- **The reading column is monotone in viewport width.** A pane may take grid space only at
  widths where the prose already has its full 760px box, so no reader is ever better off in a
  narrower window: the outline pane auto-collapses to its door below 1360, the sidebar takes
  `clamp(224px, 100vw - 776px, 292px)` and becomes an overlay drawer (☰) at ≤999, and the prose
  gutter is `min(56px, 7.37%)` — the shipped 56px wherever the measure is full, proportional
  below it, never stepped. Measured `.cm-line`, en and ar: 648 at every width from 768 up, then
  597 / 546 / 409 / 333 at 700 / 640 / 480 / 390.
- **Below 700px, or on ANY coarse pointer, every target in the shell is ≥44px** — tree rows, tag
  pills, icon buttons, status-bar buttons (and the bar itself), the drawer toggle and the tab bar
  it sits in. The empty state's tap targets were only ever half of that promise.
- **A closed drawer is `visibility: hidden`**, like every other collapsed pane: off-screen is not
  the same as out of the tab order, and a phone reader must not swipe the whole vault before
  reaching the page.

## Sidebar

- Header: wordmark `✦ Vellum` — serif (--font-serif), small-caps feel, gold accent star, 15px,
  letter-spacing 0.08em; right side: "new note" (+) and "new folder" icon buttons (inline SVG,
  16px, --text-muted, hover --accent).
- Search input: subtle raised field, 13px, rounded --radius, focus ring in --accent-soft; search
  hits list replaces the tree while active: each hit = title line (serif, 14px) + snippet line
  (12px --text-muted, `<mark>` = gold text, no bg block).
- Tree: 13px UI font, 26px row height (44px on a coarse pointer), rows full-width hover --bg-hover rounded 4px, 8px left pad
  per depth. Folders: chevron (▸ rotates 90° when open, 150ms) + name; files: no icon clutter —
  just the name minus `.md`; active note row: --accent-soft bg + --accent 2px left bar. Smooth.
- Attachments (non-`.md` files) sit under a folder's notes with a 14px type glyph in the
  chevron's slot and their extension kept in the label; notes keep the no-icon rule above. The
  row reads at --text-muted like a note row (--text on hover): a FILENAME is text, and the
  quiet is carried by the glyph, the extension badge and the position under the notes — not by
  painting the name at 3.3:1. Only the glyph is --text-faint, at full opacity. The footer counts them beside the notes and carries
  the paperclip that hides them — and a folder the filter empties says "N files hidden" rather
  than opening onto nothing.
- Tags section pinned under tree: header "Tags" 11px uppercase --text-faint letterspaced; pills:
  12px, 3px 8px, --bg-hover bg, rounded-full, `#` in --accent, count in --text-muted (the pill's
  ground is --bg-hover, where --text-faint measures 2.7:1); hover fills --accent-soft.
- Sidebar footer: "N notes" 11px --text-muted, with the attachment count + paperclip toggle at
  the inline end (admin, when the vault has any).
- Attachment viewer: full-viewport scrim rgba(0,0,0,.72) + 4px blur (the ‹ › handles are painted
  for that scrim — accent-tinted ground, lit rim, --text glyph — not for the page behind them), the file at natural size
  capped to `calc(100vh - 120px)` (never upscaled), a pill caption bar under it (name serif,
  then `PNG · 1,045 × 657 · 92 KB`, then position, then open-in-tab / download / close), and
  round ‹ › handles on the logical edges. Esc, click-out, ← / → with wrapping.

## Tab bar

- 36px tall, tabs are 13px, max-width 180px ellipsis, padding 0 12px, separated by 1px border;
  active tab: --bg (merges into content), inactive: --bg-raised + --text-muted; dirty dot: 6px
  gold circle replacing the × until hover; × appears on hover, 14px hit area.

## Editor column

- Content max-width 760px, centered, padding `48px var(--prose-gutter) 120px` (the gutter is
  56px at every width where the column is at its cap). Line-height 1.7, editor font 16px
  --font-serif for prose. THE TEXT IS SERIF — this is the manuscript feel. Code/inline-code in
  --font-mono 85%.
- Headings (live preview rendered): h1 1.9em serif + hairline bottom border --border padding 0.2em;
  h2 1.5em; h3 1.25em; all --text with h1 slightly gold-tinted (color-mix 15% accent). The `#`
  marks when cursor is on the line render --text-faint.
- Heading fold chevron: in the left padding of every heading line, VISIBLE at rest (--text-faint
  at full strength), --text-muted on line hover, --accent on itself. Never a hover-reveal — same
  rule as the reopen handle, and there is no hover on a phone.
- Blockquote: 3px gold left bar + --text-muted italic. Lists: gold `•`. Checkboxes: 15px rounded
  square, gold fill + white ✓ when checked, text of done items --text-faint strikethrough.
- Wikilinks: --accent, no underline, hover underline; broken links (unresolvable): dashed
  underline --danger tint. Tags in text: same pill style as sidebar, smaller.
- Empty state (no note open): centered, the ✦ glyph large in --text-faint (the token is the
  whole budget — no opacity over it), "The vault is open." serif 18px, then keymap hints in a
  neat 2-col grid of kbd chips, dropping to one column once the centre column is too narrow for
  two (≤1100px viewport). The chips never wrap and the pane keeps a 24px gutter: a centered
  child wider than its box overflows at both ends in silence. **Below 700px and on any coarse
  pointer the keymap is replaced, not shrunk** — a keyboard legend on a device with no keyboard
  is a taunt. The same pane then offers the reader's recent notes and New note / Search notes /
  Graph view as ≥44px tap targets. Both halves are in the DOM; CSS picks.

## Backlinks panel

- Header: "Backlinks" 11px uppercase --text-faint + count badge pill; collapse chevron right.
- Each backlink: card (--bg-hover, rounded --radius, 10px padding, 8px gap): note title serif 13px
  --text, then context line 12px --text-muted with the matching `[[link]]` rendered as a gold span
  (never raw brackets). Hover: border --accent-soft. Click opens note.
- Empty: "No backlinks yet — link to this note with [[...]]" 12px --text-faint.

## Status bar

- 28px, --bg-raised, top border, 12px --text-muted. Left: breadcrumb path of open note
  (folder › note), which keeps a min-width floor down to 900px AND a max-width ceiling — identity
  outranks a character count at every width, and a trail with no ceiling is the one item flexbox
  can take every shortfall out of. When it must give, the FOLDERS give: the ancestors are one
  ellipsizing run and the note's own name is the last thing standing. Right segments in GROUPS, each marked once by a hairline (never dots
  between some neighbours and not others): BOTH counts together (words · chars and N published),
  the publish toggle, the backup badge, the mode pills, admin tools (gear · eye),
  the pane toggles, the view controls (☾/☀ · graph), the session control. All hover --text.
  No `·` anywhere in the cluster, and no hairline on the segment that OPENS it — a separator
  with nothing on its far side is a stray tick. Below 640px every hairline drops (the groups
  are neighbours by then) and the bar scrolls rather than clipping.

## Command palette

- Backdrop: rgba(0,0,0,.4) + slight blur. Panel: 560px, top 18vh centered, --bg-raised, 1px
  --border, radius 10px, shadow 0 24px 64px rgba(0,0,0,.5). Input 15px serif, borderless, 14px
  padding, bottom border. Rows 34px: icon (inline SVG 14px: file/command glyphs), name, right-side
  kbd hint or folder path --text-faint; selected row --accent-soft with gold left bar. Section
  labels ("Commands", "Notes") 10px uppercase --text-faint.

## Graph view

- Fills center. Canvas bg --bg with a very faint radial vignette. Edges: --border color, 1px,
  opacity .5. Nodes: gold-tinted discs (lightness varies by degree), 1px rim; label 11px --font-ui
  --text-muted under node, hidden below zoom 0.7 except hovered/neighbors. Hover: node + neighbors
  full opacity + labels, rest dimmed to .15. Active-note node: ring in --accent. Bottom-left HUD:
  "N notes · M links" 11px faint; bottom-right: zoom +/− and ⌖ reset buttons (icon buttons, raised).

## Motion & finish

- All interactive elements: 150ms ease transitions on color/bg/transform. `:focus-visible`: 2px
  --accent ring, radius-matched. Custom scrollbars: 8px, thumb --border hover --text-faint,
  transparent track. ::selection --accent-soft. No layout shift on hover anywhere.
- **All fifteen** themes must pass: contrast ≥ 4.5:1 body text, ≥ 3:1 muted, accent ≥ 4.5:1 on its
  own ground, ≥ 3:1 faint on **both** grounds **and ≥ 18 ΔE from its own body text** (`check-contrast.mjs` walks every block in
  tokens.css). That last one is not a contrast ratio and cannot be: a theme whose accent is a
  shade of its own type — sumi shipped one — has no accent channel at all, and every argument for
  the lit mode pill collapses with it. "No two themes share a hex" is likewise satisfiable and
  meaningless; the test is whether two swatches are separable at a glance. The accent is per theme, and only iron-gall/lapis/parchment
  are gold — a theme is a room, not a tint: it defines its own ground, type, accent, selection,
  focus ring, graph colors, thirteen callout hues and eight syntax colors, solved against its own
  `--bg`. Readers browse them in the theme picker (grouped dark/light, arrow keys preview live,
  Enter keeps, Esc restores); nothing in the product cycles blindly through fifteen looks, and
  nothing LISTS them either — the palette carries one *Themes* row (with a dot showing the theme
  in force) and not fifteen jumps into rooms the reader has not seen.
- **Contrast: `--text-faint` is not a text color.** Its bar is 3:1 — the NON-TEXT bar — and it is
  enforced on `--bg` and `--bg-raised` for every theme, so the token may carry UI glyphs (the
  heading fold chevron, the attachment type glyph, the OFF paperclip) and deliberately
  de-emphasized machine bookkeeping (the properties card's `dg-*`/uuid rows). Anything the
  reader has to READ — a filename, a count, a label naming a thing — is `--text-muted` (4.5:1 or
  better in all fifteen) or `--text`. The pair used to print `(info)` against a minimum of zero;
  parchment sat at 2.50:1 and text kept moving onto the one token nothing could fail. **Opacity
  is invisible to the gate**: `--text-faint` at 0.85 is 2.56:1 on iron-gall, so a fade over a
  token that is already at its floor is a way of failing the floor without failing the check.
- **`--bg-hover` is a THIRD ground, not a shade.** Every hovered row, every highlighted menu row
  and every tag pill is painted with it, so `check-contrast.mjs` walks it too: `--text` ≥ 4.5:1
  and `--text-muted` ≥ 3:1 on all fifteen (worst measured 4.53:1). `--text-faint` is NOT checked
  there and may not be USED there — it is a two-ground token by construction, and on `--bg-hover`
  it measures 2.74:1 (iron-gall), 2.89 (sumi, tallow), 2.98 (parchment). The selection menu's
  keycaps and group titles shipped exactly that: passing on `--bg` and `--bg-raised`, failing one
  substrate over, which is the same "failing the floor without failing the check" as the opacity
  case above.

## The divider

- `---` and `___` draw the plain divider, `***` the ornamental one. Both are a gold rule that
  FADES at both ends (`color-mix(--accent 65%)`, 22%→78%) with 2.8em of air; the ornamental one
  adds the wordmark's ✦ over a gap in the middle. **The divider is content, not furniture**: it
  may never be `1px solid var(--border)`, which is the h1 rule and the blog byline rule, because
  an article that carries three chrome hairlines and one content hairline at the same weight,
  colour and measure has told the reader nothing. All three surfaces draw it identically — live
  preview draws a block widget (`cm-s-hr-rule`), reading view and the blog draw `.s-rv-hr` — and
  live preview shows the source only while the cursor is on the line, like every other element.

## The designed public site (`publicLayout: "designed"`)

A third visitor shell, composed from a design config, beside the two that exist. Normative:

- **The stock blog is the base and stays pristine.** `client/blog/*` and `client/styles/blog.css`
  are not extended, not overridden and not themed by this feature; the designed shell is a second
  renderer in `client/design/` with its own `s-dsn-*` classes and its own stylesheet, and the two
  meet at one `if`. A reviewer confirms it from the list of files a diff names.
- **The switch is lossless in both directions.** The design lives in its own file
  (`VELLUM_DATA/designs.json`) and is never read while the layout is anything else, so going back
  to stock is a rescue and going forward again restores the site exactly.
- **A broken design is a VISITOR'S non-event.** An invalid config, a section pointing at a note
  that is gone, or a section that throws → the visitor gets the stock blog, automatically, with
  no blank page and no stack trace. The OWNER gets the designed page with the failing section
  replaced by a card naming it, under a strip carrying one click back to stock. Gated by
  `scripts/shoot-design.mjs`, which breaks the site all three ways and measures both sessions.
- **One column per page.** `.s-dsn-page` sets the measure (`site.width`, 520–1400px, 24px
  gutters; 18px on a phone) and nothing inside sets a second one — the rule the stock blog had to
  learn twice.
- **Every target is ≥44px below 700px or on any coarse pointer**, and the grid drops to one
  column. Measured at 390: document horizontal overflow 0.
- **The byline follows the TITLE's script, not the chrome's** — four rules, because the answer is
  chrome direction XOR title direction and `flex-start` is the CONTAINER's start.
- **Counts go through `localeNum()`.** A topic chip's count sits beside an Arabic-Indic date on
  every card in the same column; one numbering system per instance is not negotiable for a new
  surface either.
- **The designer panel is a DESIGN TOOL.** Three columns — a grouped, drawn rail; a controls
  column that cross-fades when the rail moves; and a preview that keeps the largest share of the
  width, all three still on screen on a 1280×800 laptop. The ONE exception is the preset gallery,
  which is itself a preview surface at three magnifications and therefore takes the preview's
  column (two columns, five cards across at 1440) with the stage UNMOUNTED behind it — a pane
  drawing the draft is the wrong answer to "which of these fifty-nine". The page is a BOARD of section cards, each
  with its position, a wireframe glyph of its kind and its own controls; a card is dragged by its
  grip (pointer events, so a finger works), the rows open a real slot for it and a dashed accent
  socket is drawn in that slot, and the order only changes when the reader lets go. Every drag has
  a keyboard equal — Space lifts, arrows move, Space drops, and a live region says where the row
  landed — and the ↑/↓ buttons never go away. Adding a section is a picker of ILLUSTRATED options,
  not a menu of nouns. Empty states invite (three glyphs, a sentence, the two doors) rather than
  reporting an empty list. The save bar lights, pulses and COUNTS what is waiting, because nothing
  in the panel reaches the public site until it is pressed. Motion is 150–200ms, purposeful, and
  gone under `prefers-reduced-motion`.
- Separators between two runs of text are hairlines, never `·`, for the reason the status bar and
  the sync lines give: the Eastern Arabic zero is itself a raised dot.
- **The designer's preview is the SITE, in a viewport of its own** — the real renderers, the real
  theme, the author's own posts and their pictures, inside an `about:blank` iframe carrying the
  app's own stylesheets, at 1280 / 834 / 390. A preview in a narrow DIV answers every media query
  with the panel's width, so its "phone" is the desktop design squeezed: the one picture of a
  phone that is guaranteed wrong. It is hoverable and it scrolls (`.s-dsn` is the scrollport in
  there, as it is on the live site), it settles 120ms after the last edit with a lit dot while it
  is behind, and a vault with nothing published still draws a furnished page rather than a column
  of empty rectangles.

## Custom themes

A sixteenth room is MADE, not shipped: `{ base, tokens }` — one of the fifteen plus a sparse map
of overrides, applied as `data-theme="<base>" data-custom-theme="<slug>"` so every token the
author did not touch still comes from `tokens.css` and an upstream retune reaches them for free.

- **A custom theme is selectable everywhere a built-in is**: the picker (its own "Your themes"
  group), Settings → default theme, `DEFAULT_THEME`, the palette dot, the ☾/☀ pairing. The id is
  `custom:<slug>`, and it is refused wherever it does not exist.
- **The builder's preview is the app**, like the picker's — a theme is a room and the only
  preview of a room is the room. Closing restores what was in force.
- **The contrast warnings are the gate, live**: `shared/contrast.ts` is the single implementation
  of the ratios, the 18 ΔE accent-vs-text distance and every floor, imported by
  `scripts/check-contrast.mjs` AND by the builder. A second copy of the formula eventually
  blesses a theme the gate rejects, and that is the theme that ships.
- **Unset is a real state.** Rows show the value they inherit and reset by DELETING the override,
  never by re-deriving it.
- The gate now walks THREE grounds for `--text` and `--text-muted` (`--bg`, `--bg-raised`,
  `--bg-hover` — the tag pill's ground, painted at rest) and two for `--text-faint`, which is a
  statement about that token's remit rather than an exemption: faint measures 2.7:1 on hover in
  twelve of the fifteen, which is exactly why the pill's count is `--text-muted`.

## Hard rules

- No component may render raw markdown syntax to the user outside the editor (backlinks, search
  snippets strip/render `[[ ]]`, `#`, `**`).
- Every CONTRACTS.md class name stays; new classes stay `s-` prefixed; zero inline style colors.
- **The stock blog is never mutated, forked or monkey-patched by the design engine.** A new
  public shell is a new renderer with new classes in a new stylesheet — never a prop threaded
  through the base, because the base is what a broken design falls back to.
- Screenshot gate: a change ships only if the 1440×900 screenshots (dark+light, editor+graph+
  palette) look like a product someone would pay for.
