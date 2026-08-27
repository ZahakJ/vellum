// The project's own contrast rules, in ONE place.
//
// `scripts/check-contrast.mjs` used to carry the whole of this — sRGB
// luminance, the WCAG ratio, the CIELAB conversion and the CIE76 delta — and
// that was fine while the only consumer was a gate reading tokens.css at build
// time. The custom theme builder makes a second consumer: it has to tell the
// author, WHILE THEY DRAG A COLOR, that the accent they just chose is 3.9:1 on
// their own ground, or that it sits 11 ΔE from their body text and therefore
// is not an accent at all. Those two answers must be the same answer. A
// builder carrying its own copy of the formula is a builder that will one day
// pass a theme the gate fails, and the theme it passed is the one that ships.
//
// So the numbers and the rules live here, the gate imports them (Node runs .ts
// directly — CONTRACTS, "Node >= 24"), and the browser imports them too. The
// FLOORS are the normative part and their justification is in
// scripts/check-contrast.mjs's header and DESIGN.md's "Contrast" section; this
// module only makes them executable from both sides.

/** The grounds a theme is measured against. `--bg-hover` joins the two the
 *  gate used to walk because it is a real ground and not a hover artefact:
 *  DESIGN.md paints the sidebar's tag pills and the backlink cards ON it, at
 *  rest, and a row under the pointer is exactly when a reader is reading it.
 *
 *  `--text-faint` is deliberately NOT held to it — see FAINT_GROUNDS. */
export const GROUNDS = ["--bg", "--bg-raised", "--bg-hover"] as const;
export type Ground = (typeof GROUNDS)[number];

/** Where `--text-faint` is measured, and it is two grounds rather than three
 *  ON PURPOSE — this is a statement about the token's REMIT, which is the
 *  whole basis of its 3:1 floor.
 *
 *  Measured across the built-ins, faint-on-hover lands at 2.7–3.0:1 in most
 *  rooms. That is not a list of bugs: DESIGN.md already names
 *  `--bg-hover` as the tag pill's ground and says in the same breath that
 *  `--text-faint` measures 2.7:1 there — which is why the pill's count is
 *  `--text-muted` and only the pill's `#` (an accent glyph) and the section
 *  heading above it are faint. A token whose entire licence is "UI glyphs and
 *  de-emphasized machine bookkeeping, never a name or a count" is not put on
 *  the ground that carries names and counts. Adding the third ground here
 *  would have failed most of the shipping themes to enforce a rule the product does
 *  not have; the rule it DOES have — faint never carries reading text — is the
 *  one already enforced on the two grounds faint is actually painted on. */
export const FAINT_GROUNDS = ["--bg", "--bg-raised"] as const;

/** ΔE (CIE76) floor between `--accent` and `--text`. Not a contrast ratio and
 *  cannot be one: two colors of equal luminance and opposite hue pass every
 *  ratio ever written while being perfectly distinguishable, and a theme whose
 *  accent is a shade of its own body text has no accent channel at all. 18 is
 *  where it sits because the next-closest built-in theme measures 23.9. */
export const ACCENT_TEXT_MIN_DE = 18;

/** sRGB relative luminance (WCAG 2.x). */
export function luminance(hex: string): number {
  const [r, g, b] = rgbChannels(hex).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colors, 1…21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB hex → CIELAB (D65). */
export function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgbChannels(hex).map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (v: number): number => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  [x, z] = [f(x), f(z)];
  const fy = f(y);
  return [116 * fy - 16, 500 * (x - fy), 200 * (fy - z)];
}

/** CIE76 colour difference — perceptual distance, not a contrast ratio. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** `#rgb` / `#rrggbb` / `#rrggbbaa` → three 0…1 channels. An alpha byte is
 *  READ AND DROPPED rather than refused: the three translucent tokens
 *  (--accent-soft, --selection-bg, --graph-vignette) are washes over a ground
 *  and are not held to a text floor, so the only thing asking this function
 *  for their value is a preview swatch. Anything unparseable answers black,
 *  which fails loudly against a dark ground instead of throwing mid-drag. */
function rgbChannels(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3 || raw.length === 4
      ? raw
          .slice(0, 3)
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** One assertion the gate makes about one theme. */
export interface ContrastCheck {
  /** Machine id, so a UI can key a translated sentence off it rather than
   *  printing this module's English. `accent-text` is the ΔE one. */
  id: string;
  /** The token being measured, and what it is measured against (absent on the
   *  ΔE check, whose "ground" is another foreground). */
  token: string;
  against: string;
  /** The measured value: a ratio for everything except `accent-text`. */
  value: number;
  /** The floor it must clear. */
  min: number;
  kind: "ratio" | "deltaE";
  pass: boolean;
}

/** The tokens a theme MUST define for the gate to have anything to say. */
export const REQUIRED_TOKENS = [
  "--bg",
  "--bg-raised",
  "--bg-hover",
  "--text",
  "--text-muted",
  "--text-faint",
  "--accent",
] as const;

/**
 * Run the whole gate over one resolved token set.
 *
 * The rules, and why each floor is the number it is, are argued at length in
 * scripts/check-contrast.mjs and DESIGN.md — in one sentence each:
 *   --text        4.5:1  body text (WCAG 1.4.3)
 *   --text-muted  3:1    secondary text
 *   --accent      4.5:1  on --bg it IS text (wikilinks, tag pills) and it is
 *                        also the lit mode pill's fill under --bg letters
 *   --text-faint  3:1    UI glyphs and machine bookkeeping (WCAG 1.4.11) —
 *                        never a name, a count or a label
 *   accent/text   18 ΔE  the theme has an accent CHANNEL at all
 *
 * `tokens` may be sparse; a check whose operands are not both present is
 * omitted rather than failed, so a half-authored theme reports on what it has.
 */
export function checkTheme(tokens: Record<string, string | undefined>): ContrastCheck[] {
  const out: ContrastCheck[] = [];
  const ratioCheck = (id: string, token: string, against: string, min: number): void => {
    const fg = tokens[token];
    const bg = tokens[against];
    if (!fg || !bg) return;
    const value = contrastRatio(fg, bg);
    out.push({ id, token, against, value, min, kind: "ratio", pass: value >= min });
  };

  const accent = tokens["--accent"];
  const text = tokens["--text"];
  if (accent && text) {
    const value = deltaE(accent, text);
    out.push({
      id: "accent-text",
      token: "--accent",
      against: "--text",
      value,
      min: ACCENT_TEXT_MIN_DE,
      kind: "deltaE",
      pass: value >= ACCENT_TEXT_MIN_DE,
    });
  }

  // Body and secondary text are read on all three grounds; faint on the two
  // it is licensed to paint on (see FAINT_GROUNDS); the accent's own 4.5:1 is
  // stated against --bg, the prose ground, exactly as the gate has always
  // done — that pair is read as type twice over (wikilinks and tag pills are
  // --accent on --bg; the lit mode pill is the same two colors swapped).
  for (const ground of GROUNDS) {
    ratioCheck(`text-${ground}`, "--text", ground, 4.5);
    ratioCheck(`muted-${ground}`, "--text-muted", ground, 3);
  }
  for (const ground of FAINT_GROUNDS) {
    ratioCheck(`faint-${ground}`, "--text-faint", ground, 3);
  }
  ratioCheck("accent---bg", "--accent", "--bg", 4.5);
  return out;
}

/** The failures only — what a builder shows as warnings, and what a gate
 *  counts. */
export function failedChecks(tokens: Record<string, string | undefined>): ContrastCheck[] {
  return checkTheme(tokens).filter((c) => !c.pass);
}
