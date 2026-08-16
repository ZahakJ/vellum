# Development

*Running Vellum from source, the gate scripts, the screenshot harnesses, and how to contribute a change.*

← [Back to the README](../README.md) · [All docs](README.md)

---

## Dev mode

```sh
npm run dev
```

Runs the API server and Vite with hot reload side by side.

| Port | What | When |
| ---- | ---- | ---- |
| 6801 | Hono server (API + built client) | `npm start` / always |
| 5801 | Vite dev server (proxies `/api` → 6801) | `npm run dev` only |

`PORT` overrides the server port.

## The scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API server (Node's own `--watch`) and Vite side by side |
| `npm run build` | Build the client into `dist/`. The server needs no build — Node runs the TypeScript directly |
| `npm start` | Build, then serve |
| `npm run serve` | Serve without rebuilding |
| `npm run hash-password` | Prompt (no echo, or piped stdin) and print an argon2id hash for `ADMIN_PASSWORD_HASH` |
| `npm run typecheck` | `tsc --noEmit` — the strict TypeScript gate |

## The gates

Each one exits non-zero on failure. The pure-logic gates need nothing; the browser gates need a
running instance plus `npm i -D playwright` and either `npx playwright install chromium` or a
system browser via `CHROMIUM=/usr/bin/chromium`. Those that sign in take `VELLUM_PASSWORD`
(open local mode needs no password).

### `npm run check-i18n` — the dictionary

Fails if any `t()` key is missing, untranslated, dead, or if the English and Arabic sides of an
entry disagree about their `{placeholders}` — and it also fails on hardcoded English copy in JSX
*and* in imperative DOM builders. "Dead" is counted from the call sites only: the dictionary file
is excluded from the usage scan, because a key whose English value happens to be its own name
(`read: { en: "read" }`) otherwise matches inside its own definition and reports itself used.

### `npm run check-contrast` — the accessibility gate

Holds every one of the fifteen themes in `client/styles/tokens.css` to WCAG on the four text
tokens: body text and secondary text against all three grounds (`--bg`, the raised surfaces and
the hover ground the tag pills sit on), the accent against the page, and `--text-faint` at the 3:1
non-text bar on the two grounds it is licensed to paint on. The accent pair is read as text twice
over (wikilinks and tag pills in the prose, and the lit mode pill, which is the same two colors
swapped). Run it after touching theme tokens.

The formulas and floors live in `shared/contrast.ts`, which the
[custom theme builder](theming.md#make-your-own) imports as well — one implementation, or a
builder would eventually bless a theme the gate rejects.

It also holds the **text-colour palettes** (`shared/textColors.ts`,
`client/styles/textcolor.css`), which exist in two tiers for an arithmetic reason: against
`void`'s `#050508` a colour needs relative luminance ≥ 0.186 and against `solar`'s `#ffffff` it
needs ≤ 0.183, so **no single colour clears AA on all fifteen themes**. The theme-aware tier
(`var(--vc-*)`, the default) therefore carries one value per theme *group* and is held to 4.5:1
against every ground in its group; the fixed-ink tier carries one hex for all fifteen and is held
to 3:1, WCAG 1.4.11's non-text floor, which is the most a fixed colour can promise. The gate
prints both, and checks the stylesheet's values against the module's.

### `npm run check-sections` — the section-surgery gate

No browser, no server. Dragging a heading in the outline rewrites the note — a block of lines
leaves one place and arrives in another, with the moved subtree re-levelled — which is the most
destructive operation in the product that is not called "delete": it runs on a keyless gesture, it
is one 4px slip away by accident, and the reader is looking at a forty-row outline rather than at
the 1,200 lines it is rearranging, so a single dropped paragraph would be invisible until the day
it was needed.

The gate generates thousands of documents out of the shapes that break naive implementations —
YAML frontmatter, code fences whose bodies contain `### ` lines, headings that skip levels, empty
sections, a section at end of file, CRLF, no trailing newline — and asserts the reorder is a
**permutation**: it may change the order of a note's lines and the depth of the moved subtree's
own headings, and it may add a blank line at a seam; it may never lose a line and never duplicate
one. It also asserts that a section cannot be dropped inside itself, that a zero-distance move is
a no-op, and that extraction's two halves cover the original exactly. `SEED=…` replays a failure,
`ROUNDS=…` sets the sample size.

### `npm run check-caret` — the click-to-caret gate

Live preview replaces markdown source with rendered boxes of a different width *and* a different
length — eighteen characters of `$7.7\ \text{km/s}$` standing under seven glyphs of KaTeX — so any
pointer→document mapping that reasons about geometry instead of about the DOM drifts by exactly
that difference.

It writes its own note (inline math, inline code, wikilinks, tags, highlights and an image, in
English and Arabic, on lines long enough to wrap several times), drives a real mouse over it —
single, double and triple click, drag, shift-click, select-all — runs the whole matrix once in each
shell direction, and reads back what the reader would actually copy (`window.getSelection()`),
requiring every clicked glyph to take the caret **within one character**. Before the fix it
reported misses up to **82 characters**; after it, zero.

It exists because that one question has broken four separate ways here (click position, hover
previews, mod-click navigation, text selection) and the common cause is always a pixel the
editor's height map cannot see: **nothing inside `.cm-content` may carry a vertical CSS margin.**
CodeMirror measures every line and block widget by its border box, so padding and borders are
counted and margins are not — put the air on a wrapper's padding, or in a transparent border with
`background-clip: padding-box`, never in a margin. It restores the instance language and deletes
its fixture however the run ends.

### `npm run check-excerpt` — the tag-in-prose gate

`DESIGN.md`'s hard rule is that a snippet outside the editor either STRIPS markdown or RENDERS it;
removing a `#` and leaving the word standing in the sentence is neither, and it shipped — a post
ending "…it buys the reader a breath. #design #typography" printed on the front page as "…it buys
the reader a breath. design typography". The three surfaces that flow through one stripper
(`stripInlineMd`) are all walked from one fixture whose body **ends** in a tag line: the post
excerpt (`/api/posts` — blog cards, RSS, `og:description`), the search snippet (`/api/search`), and
the backlink context line (`/api/backlinks`). It also checks the other direction — that the
stripped sentence survives and that the tags still appear where tags belong (`post.tags`, and the
search index still matches them) — so a stripper that passes by deleting everything fails too. No
browser needed; it deletes its fixtures however the run ends.

### `npm run check-design` — the error boundary

The gate for the [design engine](designer.md)'s one promise that cannot be reviewed by reading it.
It breaks a designed site three ways on purpose (a corrupt `designs.json`, a section pointing at a
note that is not there, and a section renderer patched to throw and rebuilt) and, for each,
measures what a VISITOR gets (the built-in blog, a page with real text on it, nothing escaping the
boundary) against what the OWNER gets (the designed page, the failing section named, the revert
control present). It also round-trips stock ⇄ designed and asserts the design comes back
byte-identical. Everything it touched is restored on the way out, including on failure:
`PORT=6801 VELLUM_PASSWORD=… npm run check-design`.

### `npm run check-board` — the designer's section board

Three ways to move a row (the ↑/↓ buttons, a pointer drag, and a `Space`/arrows/`Space` keyboard
lift), the drop preview before commit, `Esc` belonging to the innermost layer, the save-bar count,
and a `Ctrl/Cmd S` round trip through the store.

### `npm run check-preview` — the designer's live preview

That it is a real iframe under `frame-src 'none'`, that styles and theme reach it (including a
live theme switch), and that it lays out at 390 / tablet / 1440 device widths.

### `npm run check-presets` — the preset catalog

Unique slug ids, a bilingual name and blurb with real Arabic, a known family, at least one preset
per family, and no preset naming a note in somebody's vault. It runs the shared `assertCatalog`
rather than reimplementing it.

## Screenshot harnesses

Not wired into `package.json` — run by hand, for visual review. All take `CHROMIUM`, and most take
`THEME=parchment` and `LANGSET=ar` to check a theme or the right-to-left mirror.

| Harness | Captures |
| --- | --- |
| `node scripts/shoot.mjs <url> <outdir>` | The editor, graph and palette in both themes |
| `node scripts/shoot-settings.mjs <url> <password> <outdir>` | Every settings section through the rail, printing the panel's scroll geometry and the specimen font sizes |
| `node scripts/shoot-sync.mjs <url> <password> <outdir>` | The Backup & sync section plus the status badge's detail panel |
| `node scripts/shoot-themes.mjs` | Every theme (`ONLY=` narrows it) |
| `node scripts/shoot-rtl.mjs` | The Arabic mirror — and asserts glyph order in tag chips |
| `node scripts/shoot-tex.mjs` | `.tex` notes, with six assertions |
| `node scripts/shoot-templates.mjs` | The template picker, with assertions |
| `node scripts/shoot-hover.mjs` | Hover previews, with assertions |
| `node scripts/shoot-controls.mjs` | The hand-drawn control set (`W`/`H` set the viewport) |
| `node scripts/shoot-fontupload.mjs` | The font uploader |

## Contributing a change

1. **Read `DESIGN.md` and `CONTRACTS.md` first.** `DESIGN.md` carries the rules a change is judged
   against; `CONTRACTS.md` carries the invariants the code has already committed to. Most review
   comments here are one of those two documents quoted back.
2. **Run `npm run typecheck`.** The build is strict and the server has no compile step to catch
   things later.
3. **Run the gates your change touches** — theme tokens mean `check-contrast`, any user-visible
   string means `check-i18n`, the outline or note-rewriting code means `check-sections`, the editor
   means `check-caret`, the designer means `check-board` / `check-preview` / `check-design`.
4. **Both languages, both directions.** Every string comes from `client/i18n.ts`, and every layout
   is built on CSS logical properties. A change that only reads correctly left-to-right is not
   finished — `LANGSET=ar` on any shoot harness is the cheapest way to see it.
5. **Say why in the code.** This codebase's comments explain the decision, not the mechanism. A
   patch that changes a rule should move the paragraph that stated it.
