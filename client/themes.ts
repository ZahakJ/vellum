// The theme library, client side: the ids come from shared/themes.ts (the
// server validates against the same list), and this module adds what only the
// chrome needs — the picker's grouping and the ☾/☀ counterpart map.
//
// It is deliberately not part of state.ts: fifteen themes are a catalog, and
// three surfaces outside the store read it (the theme picker, the palette's
// per-theme commands, the settings panel's default-theme row). state.ts
// re-exports THEMES/Theme so the store's contract in CONTRACTS.md still reads
// as it did.

import { DARK_THEMES, LIGHT_THEMES, THEMES, type Theme, type ThemeGroup } from "../shared/themes.ts";
import type { I18nKey } from "./i18n.ts";

export { DARK_THEMES, LIGHT_THEMES, THEMES, isTheme, themeGroup } from "../shared/themes.ts";
export type { Theme, ThemeGroup } from "../shared/themes.ts";

/** The other side of the day for a theme: the light room that matches a dark
 *  one, and back again. A ☾/☀ button (the public blog's) means "the same site,
 *  lit differently" — with fifteen themes, walking the whole list from one is
 *  not that, so the pairs are named rather than derived. */
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
  parchment: "iron-gall",
  sandstone: "cinnabar",
  solar: "tallow",
  linen: "void",
};

export function counterpartTheme(theme: Theme): Theme {
  return COUNTERPART[theme] ?? THEMES[0];
}

/** Human label + one-line room description per theme id. The IDS are the
 *  contract (shared/themes.ts, `DEFAULT_THEME`, the palette, settings) and do
 *  not move; this is only what a reader is shown. Fifteen raw Latin pigment
 *  nouns identified fifteen rooms in BOTH languages before this — obscure in
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
  parchment: { name: "thParchment", desc: "thParchmentDesc" },
  sandstone: { name: "thSandstone", desc: "thSandstoneDesc" },
  linen: { name: "thLinen", desc: "thLinenDesc" },
  solar: { name: "thSolar", desc: "thSolarDesc" },
};

/** The picker's two groups, in list order. */
export const THEME_GROUPS: { group: ThemeGroup; themes: readonly Theme[] }[] = [
  { group: "dark", themes: DARK_THEMES },
  { group: "light", themes: LIGHT_THEMES },
];
