// The built-in theme ids — the one list both sides agree on.
//
// It lives in shared/ because two validators consume it: the client (the theme
// picker, the palette's per-theme commands, the stored "vellum.theme" guard)
// and the server (`defaultTheme` in settings.json, DEFAULT_THEME in the
// environment). They used to be two hand-kept copies of four strings, which
// was survivable at four and is not at fifteen: a theme missing from the
// server's copy is a 400 on a value the client offers in a dropdown.
//
// The COLORS are in client/styles/tokens.css — one [data-theme="…"] block per
// id below, plus the constant --swatch-<id>-* identity trio. Adding a theme:
// a row here, a block there, a swatch rule in client/styles/themes.css.

/** Dark themes, in the order the picker lists them. `iron-gall` is first
 *  overall because THEMES[0] is the product default. */
export const DARK_THEMES = [
  "iron-gall",
  "cinnabar",
  "sumi",
  "void",
  "basalt",
  "nocturne",
  "lapis",
  "verdigris",
  "moss",
  "porphyry",
  "tallow",
] as const;

/** Light themes, same order rule. */
export const LIGHT_THEMES = ["parchment", "sandstone", "solar", "linen"] as const;

export const THEMES = [...DARK_THEMES, ...LIGHT_THEMES] as const;

export type Theme = (typeof THEMES)[number];
export type ThemeGroup = "dark" | "light";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function themeGroup(theme: Theme): ThemeGroup {
  return (LIGHT_THEMES as readonly string[]).includes(theme) ? "light" : "dark";
}
