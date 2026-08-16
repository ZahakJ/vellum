# Vellum design spec — the bar is "people ditch Obsidian for this"

Reference quality: Obsidian's default theme + Linear's polish. Identity: illuminated manuscript —
iron-gall dark default, parchment light, gold-leaf accent. Everything below is normative.

## Layout (CSS grid, full viewport, no page scroll)

```
┌──────────┬─────────────────────────────┬───────────┐
│ sidebar  │ tab bar                     │ backlinks │
│ 280px    ├─────────────────────────────┤ 300px     │
│          │ center content (editor OR   │ (collaps- │
│          │ graph), own scroll          │  ible)    │
├──────────┴─────────────────────────────┴───────────┤
│ status bar 28px                                    │
└────────────────────────────────────────────────────┘
```

- Sidebar and backlinks panel have `--bg-raised`; center is `--bg`; 1px `--border` separators.
- Backlinks collapse: chevron button in the panel header; collapsed = 0 width. Animate width
  180ms ease. The sidebar collapses the same way (`Ctrl/Cmd B`; the panel is `Ctrl/Cmd Shift B`).
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

## Sidebar

- Header: wordmark `✦ Vellum` — serif (--font-serif), small-caps feel, gold accent star, 15px,
  letter-spacing 0.08em; right side: "new note" (+) and "new folder" icon buttons (inline SVG,
  16px, --text-muted, hover --accent).
- Search input: subtle raised field, 13px, rounded --radius, focus ring in --accent-soft; search
  hits list replaces the tree while active: each hit = title line (serif, 14px) + snippet line
  (12px --text-muted, `<mark>` = gold text, no bg block).
- Tree: 13px UI font, 26px row height, rows full-width hover --bg-hover rounded 4px, 8px left pad
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

- Content max-width 760px, centered, padding 48px 56px 120px. Line-height 1.7, editor font 16px
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
- Empty state (no note open): centered, the ✦ glyph large in --text-faint, "The vault is open."
  serif 18px, then keymap hints in a neat 2-col grid of kbd chips.

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
  between some neighbours and not others): the counts, the mode pills, admin tools (gear · eye),
  the pane toggles, the view controls (☾/☀ · graph), the session control. All hover --text.

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
  Enter keeps, Esc restores); nothing in the product cycles blindly through fifteen looks.
- **Contrast: `--text-faint` is not a text color.** Its bar is 3:1 — the NON-TEXT bar — and it is
  enforced on `--bg` and `--bg-raised` for every theme, so the token may carry UI glyphs (the
  heading fold chevron, the attachment type glyph, the OFF paperclip) and deliberately
  de-emphasized machine bookkeeping (the properties card's `dg-*`/uuid rows). Anything the
  reader has to READ — a filename, a count, a label naming a thing — is `--text-muted` (4.5:1 or
  better in all fifteen) or `--text`. The pair used to print `(info)` against a minimum of zero;
  parchment sat at 2.50:1 and text kept moving onto the one token nothing could fail. **Opacity
  is invisible to the gate**: `--text-faint` at 0.85 is 2.56:1 on iron-gall, so a fade over a
  token that is already at its floor is a way of failing the floor without failing the check.

## Hard rules

- No component may render raw markdown syntax to the user outside the editor (backlinks, search
  snippets strip/render `[[ ]]`, `#`, `**`).
- Every CONTRACTS.md class name stays; new classes stay `s-` prefixed; zero inline style colors.
- Screenshot gate: a change ships only if the 1440×900 screenshots (dark+light, editor+graph+
  palette) look like a product someone would pay for.
