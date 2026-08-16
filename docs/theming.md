# Theming

*The fifteen built-in themes, the custom-theme builder, the CSS token API, and `custom.css`.*

← [Back to the README](../README.md) · [All docs](README.md)

---

If Vellum is replacing a blog, you probably want it to stop saying "Vellum" and start looking
like *your* site. Three env-driven hooks cover that, no fork required.

## Name it

`SITE_NAME=Night Garden` rebrands every visible surface — the `✦` wordmark in the
sidebar, the browser tab titles (`Note · Night Garden`), and the sign-in modal.

## Pick the default look

Vellum ships **fifteen** themes — eleven dark rooms and four lit ones. Every one of them defines
the whole palette for itself (ground, type, accent, selection, focus ring, graph, all thirteen
callout hues, all eight syntax colors), so none of them is another theme wearing a different
background.

![The fifteen themes](screenshots/themes.png)

| Dark | | Light | |
| --- | --- | --- | --- |
| `iron-gall` | warm near-black, gold leaf — **the default** | `parchment` | warm paper, gold leaf |
| `cinnabar` | neutral graphite, vermilion type | `sandstone` | dry desert paper, burnt orange |
| `sumi` | ink-stick grey, aizome indigo | `solar` | brightest white paper, burnt gold |
| `void` | true black, cold signal cyan | `linen` | cool daylight, ink blue |
| `basalt` | cool blue-grey stone, pale sky | | |
| `nocturne` | blue-black night, periwinkle | | |
| `lapis` | deep lapis blue-black, brightened gold | | |
| `verdigris` | green-black, oxidized copper | | |
| `moss` | olive-black forest floor, lichen | | |
| `porphyry` | purple-black stone, dusty rose | | |
| `tallow` | warm brown paper, candle-flame amber | | |

Every reader picks their own from the **theme picker** — the theme control in the status bar
opens it, and so does *Themes* in Settings → Appearance & language. Each row is a
miniature of the room — its ground carrying a heading rule, a line of type and an accent chip —
next to a human name and a one-line description, both localized; the raw id (what `DEFAULT_THEME`
and the palette take) is in the row's tooltip. It is a grouped, keyboard-driven
list: `↑↓←→` moves the highlight and applies that theme live to the whole app behind the panel,
`Enter` keeps it, `Esc` puts back the theme you started with. (The mouse never moves the keyboard
highlight — only a click picks.) The palette carries ONE route to all fifteen: *Themes*
opens the same panel, with a dot showing the theme you are in. (It used to carry sixteen —
that row plus a `Theme: <id>` command per theme, 15 of 41 entries spent on one preference,
every one of them a blind jump into a room you had not seen. A parameter with fifteen values
belongs behind the surface that shows the values.) A
reader's choice sticks in their own browser; `DEFAULT_THEME=cinnabar` — or Settings → Appearance & language
→ *Default theme* — sets what first-time visitors see before they choose. An unknown
`DEFAULT_THEME` is ignored with a line on stderr at startup rather than silently.

## Make your own

The fifteen are a starting point, not a ceiling. **Themes → New custom theme** opens a builder:
pick one of the fifteen as a base, then override any token you like — grounds, text, accent,
borders, the thirteen callout hues, the eight syntax colors, the graph — and watch the whole app
change behind the panel while you do it, because the only honest preview of a theme is the theme.
Tokens you do not touch keep coming from the base, so a later retune of that base reaches your
theme for free, and every row's *reset* deletes the override rather than freezing today's value
into it.

The builder runs **the project's own contrast gate live**: the same code
`scripts/check-contrast.mjs` runs — body text ≥ 4.5:1 and secondary ≥ 3:1 against all three
grounds, the accent ≥ 4.5:1 on its own ground, and the accent at least 18 ΔE from your body text
(not a contrast ratio: a theme whose accent is a shade of its own type has no accent channel at
all). Warnings appear in words, above the control that caused them, with a mark on any group that
holds one.

Save it under a name and it is selectable **everywhere a built-in theme is**: the picker (its own
"Your themes" group), the ☾/☀ button, Settings → *Default theme*, and `DEFAULT_THEME=custom:<name>`
in your `.env`. Export it as JSON, mail it, import it on another instance.

## Restyle it

Drop a `custom.css` into your data directory (`VELLUM_DATA`, default `./data/`)
and Vellum serves it at `/api/custom.css` and loads it after its own stylesheets — for every
visitor and for you, in dev and prod, no rebuild, no restart. Because it loads last, your rules
win. The whole UI is driven by CSS custom properties on `:root` (and per-theme overrides via
`html[data-theme="…"]`), so most re-skins are a handful of token lines:

```css
/* data/custom.css — a green-accented reading room */
:root,
html[data-theme="lapis"] {
  --accent: #5da06b;
  --accent-soft: rgba(93, 160, 107, 0.14);
  --font-serif: "Iowan Old Style", Georgia, serif;
}
```

The token API (define them on `:root` for all themes, or under `html[data-theme="void"]` etc.
for one):

| Token | Drives |
| ----- | ------ |
| `--bg` / `--bg-raised` / `--bg-hover` | Page background / sidebar & panels / hover rows |
| `--text` / `--text-muted` / `--text-faint` | Body text / secondary text / hints & counts |
| `--accent` / `--accent-soft` | Brand color (links, wikilinks, active marks) / its translucent wash |
| `--selection-bg` / `--focus-ring` | Text-selection wash / the 2px `:focus-visible` ring |
| `--graph-node` / `--graph-edge` / `--graph-vignette` | Graph disc color / idle edge stroke / the canvas's edge wash |
| `--border` | The 1px hairlines everywhere |
| `--danger` | Destructive actions, broken-link tint |
| `--font-ui` / `--font-serif` / `--font-mono` | UI chrome / prose & headings / code |
| `--font-base` | Root type size — the entire UI is sized in `rem`, so this one token scales all chrome (default 15.5px) |
| `--font-prose` | Editor / reading prose size (default ≈18px; the blog article body sits a step above it) |
| `--radius` | Corner rounding (default 6px) |
| `--sidebar-w` | Sidebar width (default 292px) |
| `--callout-note`, `--callout-tip`, … | Per-type callout hues (see `client/styles/tokens.css`) |
| `--syn-keyword`, `--syn-string`, … | Code-highlighting palette |

## Bring your own fonts (the CSS route)

Vellum ships zero webfonts by design, but your instance doesn't have to. Drop font files into
`VELLUM_DATA/fonts/` (default `./data/fonts/`) and they are served at
`/api/fonts/<file>` — `woff2`, `woff`, `ttf`, and `otf` only, strictly by basename, with ETags
and immutable year-long cache headers. Wire them up with an `@font-face` in `custom.css`:

```css
/* data/custom.css — serve data/fonts/MyFont.woff2 as the prose face */
@font-face {
  font-family: "MyFont";
  src: url("/api/fonts/MyFont.woff2") format("woff2");
  font-display: swap;
}
:root {
  --font-serif: "MyFont", Georgia, serif;
}
```

For the no-CSS route — a curated, self-hosted catalog and an uploader, both with real Arabic —
see [Typography](typography.md).

Anything beyond tokens is fair game too — every element carries a stable `s-` prefixed class
(`.s-sidebar`, `.s-rv-p`, `.s-statusbar`, …), so `custom.css` can restyle specific components.
If you keep body text ≥ 4.5:1 contrast against `--bg`, the whole app stays readable.

## Colored text in two tiers

The default writes `var(--vc-blue)`, a *meaning* that every one of the fifteen themes resolves to
something clearing AA on its own ground, light or dark; a fixed-ink palette writes a literal hex
when you mean *that* color. Both render identically in the editor, the reading view and the blog,
and the sanitizer admits `style` on a `<span>` for `color`/`background-color` only — no `url()`,
no other properties.

The two tiers exist for an arithmetic reason: against `void`'s `#050508` a color needs relative
luminance ≥ 0.186 and against `solar`'s `#ffffff` it needs ≤ 0.183, so **no single color clears AA
on all fifteen themes**. The theme-aware tier (`var(--vc-*)`, the default) carries one value per
theme *group* and is held to 4.5:1 against every ground in its group; the fixed-ink tier carries
one hex for all fifteen and is held to 3:1, WCAG 1.4.11's non-text floor, which is the most a
fixed color can promise. `node scripts/check-contrast.mjs` gates both — see
[Development](development.md).
