// The two tiers of text colour, and the arithmetic behind having two.
//
// A colour in a note has to survive TWENTY-ONE rooms — fourteen dark themes
// and seven light ones, each with a `--bg` and a `--bg-raised` — because the note
// outlives the theme it was written under. Ask for AA (4.5:1) on all of them
// at once and the answer is provably empty: against `void`'s `#050508` a text
// colour needs relative luminance ≥ 0.186, against `solar`'s `#ffffff` it
// needs ≤ 0.183. There is no such colour. That is not a tuning problem, it is
// the reason this file has two lists.
//
//   TIER 1, THE DEFAULT — SEMANTIC. The note stores `var(--vc-red)`; the
//   stylesheet resolves it per theme group (client/styles/textcolor.css), so
//   "red" is a light coral on a dark ground and a deep brick on a light one.
//   Every value clears **4.75:1 against every ground in its group** — AA for
//   body text, with margin — and the note carries a MEANING rather than an
//   ink, so the same file reads correctly in iron-gall, in parchment, and in
//   whatever theme arrives later. This is the tier the picker opens
//   on and the one the menu marks as recommended.
//
//   TIER 2 — LITERAL. Sometimes the author means THIS red, and a colour that
//   moves is the wrong answer (a diagram key, a quoted brand, a colour being
//   discussed as itself). These nine hexes are solved against every one of
//   those grounds at once and hold **3:1 everywhere** — WCAG 1.4.11's non-text
//   floor, which is the best a fixed ink can do, as the paragraph above
//   proves. `scripts/check-contrast.mjs` asserts both floors; neither list may
//   be edited without re-running it.
//
// Values are also a SECURITY surface: they end up inside a `style` attribute
// that the sanitizer lets through. Everything here is either a plain hex or a
// `var()` naming a token in `COLOR_TOKENS`, and the sanitizer accepts nothing
// else (client/reading/rawHtml.ts).

/** One swatch. `id` is the i18n key suffix and the CSS token suffix. */
export interface TextColor {
  id: string;
  /** Exactly what is written into the note's `style` attribute. */
  value: string;
  /** A ground-independent hex for drawing the swatch in the menu itself —
   *  a chip painted in `var()` would be invisible in the theme that dims it. */
  swatchDark: string;
  swatchLight: string;
}

/** Tier 1. Values resolve through client/styles/textcolor.css. */
export const SEMANTIC_COLORS: TextColor[] = [
  { id: "red", value: "var(--vc-red)", swatchDark: "#db8076", swatchLight: "#a93528" },
  { id: "orange", value: "var(--vc-orange)", swatchDark: "#d18952", swatchLight: "#8c5021" },
  { id: "amber", value: "var(--vc-amber)", swatchDark: "#b99531", swatchLight: "#745c1b" },
  { id: "green", value: "var(--vc-green)", swatchDark: "#40b12f", swatchLight: "#246b19" },
  { id: "teal", value: "var(--vc-teal)", swatchDark: "#2da999", swatchLight: "#196b60" },
  { id: "blue", value: "var(--vc-blue)", swatchDark: "#6a9dd7", swatchLight: "#265fa1" },
  { id: "violet", value: "var(--vc-violet)", swatchDark: "#b586df", swatchLight: "#8530cf" },
  { id: "magenta", value: "var(--vc-magenta)", swatchDark: "#db76b6", swatchLight: "#a9287a" },
];

/** Tier 2. One ink, every ground, 3:1 or better. */
export const LITERAL_COLORS: TextColor[] = [
  { id: "red", value: "#d1483c", swatchDark: "#d1483c", swatchLight: "#d1483c" },
  { id: "orange", value: "#b06936", swatchDark: "#b06936", swatchLight: "#b06936" },
  { id: "amber", value: "#94771e", swatchDark: "#94771e", swatchLight: "#94771e" },
  { id: "green", value: "#3f8b18", swatchDark: "#3f8b18", swatchLight: "#3f8b18" },
  { id: "teal", value: "#1e8a6f", swatchDark: "#1e8a6f", swatchLight: "#1e8a6f" },
  { id: "blue", value: "#187fc9", swatchDark: "#187fc9", swatchLight: "#187fc9" },
  { id: "violet", value: "#9c5add", swatchDark: "#9c5add", swatchLight: "#9c5add" },
  { id: "magenta", value: "#c74fa0", swatchDark: "#c74fa0", swatchLight: "#c74fa0" },
  { id: "grey", value: "#81786e", swatchDark: "#81786e", swatchLight: "#81786e" },
];

/** THE ONLY custom properties a `style` attribute may name. A `var()` is a
 *  read of the page's own cascade, so an unbounded allowlist would let a note
 *  paint itself in any value the app happens to hold — and, once
 *  `background-color` is in play, read one out by contrast. The set is the
 *  eight text-colour tokens plus the three the product already treats as ink. */
export const COLOR_TOKENS: ReadonlySet<string> = new Set([
  ...SEMANTIC_COLORS.map((c) => c.value.slice(4, -1)),
  "--text",
  "--text-muted",
  "--accent",
]);
