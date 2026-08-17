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

/** The third state of the site's default theme: not a theme id at all, but
 *  "whatever the admin is looking at". `settings.defaultTheme` (and
 *  `DEFAULT_THEME`) take this word alongside the fifteen ids, and it is the
 *  DEFAULT when neither is set — a blog looks like its author's editor unless
 *  the author says otherwise. The theme actually served then comes from
 *  `settings.adminTheme`, mirrored from the admin's browser (which is the only
 *  place their own pick has ever lived). */
export const FOLLOW_THEME = "follow";

/** A default-theme PREFERENCE: a pinned theme id, or the follow sentinel.
 *  Never a theme by itself — resolve it through the server's visitorTheme(). */
export type ThemePref = Theme | typeof FOLLOW_THEME;

export function isThemePref(value: unknown): value is ThemePref {
  return value === FOLLOW_THEME || isTheme(value);
}

export function themeGroup(theme: Theme): ThemeGroup {
  return (LIGHT_THEMES as readonly string[]).includes(theme) ? "light" : "dark";
}
