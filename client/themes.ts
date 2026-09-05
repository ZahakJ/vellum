// The theme library, client side: the ids come from shared/themes.ts (the
// server validates against the same list), and this module adds what only the
// chrome needs — the picker's grouping and the ☾/☀ counterpart map.
//
// It is deliberately not part of state.ts: twenty-one themes are a catalog, and
// three surfaces outside the store read it (the theme picker, the palette's
// per-theme commands, the settings panel's default-theme row). state.ts
// re-exports THEMES/Theme so the store's contract in CONTRACTS.md still reads
// as it did.

import {
  DARK_THEMES,
  LIGHT_THEMES,
  THEMES,
  isTheme,
  themeGroup,
  type Theme,
  type ThemeGroup,
} from "../shared/themes.ts";
import { lookupCustomTheme, resolveBaseTheme } from "./design/customThemes.ts";
import { t, type I18nKey } from "./i18n.ts";

export { DARK_THEMES, LIGHT_THEMES, THEMES, isTheme, themeGroup } from "../shared/themes.ts";
export type { Theme, ThemeGroup } from "../shared/themes.ts";
export type { ThemeChoice } from "../shared/customTheme.ts";

/** The other side of the day for a theme: the light room that matches a dark
 *  one, and back again. A ☾/☀ button (the public blog's) means "the same site,
 *  lit differently" — with twenty-one themes, walking the whole list from one
 *  is not that, so the pairs are named rather than derived. The map is not
 *  required to be involutive and never was: several dark rooms share one lit
 *  counterpart, because the light set is the smaller half. */
const COUNTERPART: Record<Theme, Theme> = {
  "iron-gall": "parchment",
  cinnabar: "sandstone",
  sumi: "linen",
  void: "linen",
  basalt: "linen",
  nocturne: "linen",
  lapis: "parchment",
  verdigris: "linen",
  moss: "sandstone",
  porphyry: "linen",
  tallow: "solar",
  phosphor: "porcelain",
  sidereal: "mauveine",
  murex: "mauveine",
  parchment: "iron-gall",
  sandstone: "cinnabar",
  solar: "tallow",
  linen: "void",
  palimpsest: "tallow",
  porcelain: "verdigris",
  mauveine: "sidereal",
};

export function counterpartTheme(theme: Theme): Theme {
  return COUNTERPART[theme] ?? THEMES[0];
}

// ── Custom themes ───────────────────────────────────────────────────────────
// A custom theme is a base + overrides (shared/customTheme.ts). Everything the
// chrome asks about a theme — which half of the picker, which glyph the ☾/☀
// button draws, which room it flips to — has an answer for one, and it is
// always derived from the base. These three wrappers are what the surfaces
// call instead of the built-in-only functions above, so nothing that already
// imports `themeGroup`/`counterpartTheme` changes meaning.

/** Which half of the day a choice belongs to. */
export function choiceGroup(choice: string): ThemeGroup {
  const custom = lookupCustomTheme(choice);
  if (custom) return custom.group;
  return isTheme(choice) ? themeGroup(choice) : "dark";
}

/** The other side of the day. A custom DARK room flips to its base's light
 *  counterpart rather than to another custom one: the ☾/☀ button promises
 *  "the same site, lit differently", and only the built-in pairs are curated
 *  to keep that promise. */
export function counterpartChoice(choice: string): string {
  const custom = lookupCustomTheme(choice);
  if (custom) return counterpartTheme(custom.base);
  return isTheme(choice) ? counterpartTheme(choice) : THEMES[0];
}

/** Where a ☾/☀ press lands on a site that has a theme of its OWN — a designed
 *  site, whose document names one (`design.theme`).
 *
 *  `counterpartChoice` alone is not a round trip. The map is not involutive
 *  and never promised to be (several dark rooms share one lit counterpart), so
 *  phosphor → porcelain → verdigris: a reader who pressed the button twice on
 *  a phosphor design was on a site nobody designed. The owner met it as
 *  "switch to light then dark and the theme gets disturbed".
 *
 *  SO ON A DESIGNED SITE THE BUTTON ALWAYS LANDS IN THE DESIGN'S PAIR: from
 *  the design's theme to its counterpart, from anything lit to the design's
 *  theme, from anything dark to the counterpart. From anywhere, two presses
 *  reach the design's room exactly. The first cut kept a reader's own stored
 *  choice OUT of the pair — "never discard a room they picked" — and stranded
 *  them: the walk above had already stored `verdigris` in the owner's browser,
 *  so the button lit verdigris differently forever and phosphor was
 *  unreachable ("it's no longer green, just shows black"). A stored choice
 *  still wins on LOAD, which is the rule that matters; this button's promise
 *  on a designed site is "this site, lit differently", and it keeps it. */
export function toggleChoice(current: string, anchor: string | null): string {
  if (anchor !== null && anchor !== "") {
    return choiceGroup(current) === choiceGroup(anchor) ? counterpartChoice(anchor) : anchor;
  }
  return counterpartChoice(current);
}

/** What a reader is SHOWN for a theme choice: a custom theme's own name, or
 *  the localized label of one of the twenty-one. Every surface that names the
 *  theme in force (the settings trigger, the picker's rows, the status-bar
 *  tooltip) goes through this, so a custom theme is named rather than
 *  described as the room it was built on. */
export function choiceLabel(choice: string): string {
  const custom = lookupCustomTheme(choice);
  if (custom) return custom.name;
  return isTheme(choice) ? t(THEME_LABELS[choice].name) : t(THEME_LABELS[THEMES[0]].name);
}

/** The built-in whose swatch tokens paint a preview of this choice. The
 *  `--swatch-<id>-*` trio is keyed on built-in ids and is CONSTANT by design,
 *  so a custom theme previews as its base plus its own overrides — which is
 *  what it is. */
export function choiceBase(choice: string): Theme {
  return resolveBaseTheme(choice);
}

/** Human label + one-line room description per theme id. The IDS are the
 *  contract (shared/themes.ts, `DEFAULT_THEME`, the palette, settings) and do
 *  not move; this is only what a reader is shown. Raw Latin pigment nouns
 *  identified every room in BOTH languages before this — obscure in
 *  English and untranslated in Arabic — with nothing anywhere saying what any
 *  of them looks like. */
export const THEME_LABELS: Record<Theme, { name: I18nKey; desc: I18nKey }> = {
  "iron-gall": { name: "thIronGall", desc: "thIronGallDesc" },
  void: { name: "thVoid", desc: "thVoidDesc" },
  lapis: { name: "thLapis", desc: "thLapisDesc" },
  cinnabar: { name: "thCinnabar", desc: "thCinnabarDesc" },
  basalt: { name: "thBasalt", desc: "thBasaltDesc" },
  verdigris: { name: "thVerdigris", desc: "thVerdigrisDesc" },
  porphyry: { name: "thPorphyry", desc: "thPorphyryDesc" },
  nocturne: { name: "thNocturne", desc: "thNocturneDesc" },
  tallow: { name: "thTallow", desc: "thTallowDesc" },
  sumi: { name: "thSumi", desc: "thSumiDesc" },
  moss: { name: "thMoss", desc: "thMossDesc" },
  phosphor: { name: "thPhosphor", desc: "thPhosphorDesc" },
  sidereal: { name: "thSidereal", desc: "thSiderealDesc" },
  murex: { name: "thMurex", desc: "thMurexDesc" },
  parchment: { name: "thParchment", desc: "thParchmentDesc" },
  sandstone: { name: "thSandstone", desc: "thSandstoneDesc" },
  linen: { name: "thLinen", desc: "thLinenDesc" },
  solar: { name: "thSolar", desc: "thSolarDesc" },
  palimpsest: { name: "thPalimpsest", desc: "thPalimpsestDesc" },
  porcelain: { name: "thPorcelain", desc: "thPorcelainDesc" },
  mauveine: { name: "thMauveine", desc: "thMauveineDesc" },
};

/** The picker's two groups, in list order. */
export const THEME_GROUPS: { group: ThemeGroup; themes: readonly Theme[] }[] = [
  { group: "dark", themes: DARK_THEMES },
  { group: "light", themes: LIGHT_THEMES },
];
