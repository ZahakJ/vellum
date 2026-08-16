// Custom themes: a named override layer over one of the fifteen built-ins.
//
// A custom theme is NOT a sixteenth block in tokens.css and never becomes one.
// It is `{ base, tokens }` — a built-in theme id plus a SPARSE map of token
// overrides — and it is applied by putting the base's own id on
// `<html data-theme>` (so every token the author did not touch comes from the
// shipped block, unchanged) and the theme's id on `<html data-custom-theme>`,
// which a generated stylesheet keys the overrides off:
//
//     :root[data-custom-theme="my-room"] { --accent: #7c9; }
//
// `:root[data-custom-theme]` is (0,2,0) against `[data-theme="…"]`'s (0,1,0),
// so the override wins wherever it exists and nothing else moves. Three
// consequences worth stating, because each of them is why this shape was
// chosen over "generate a whole theme block":
//   · tokens.css is never rewritten, never parsed, and never has to be
//     shipped to the server;
//   · a theme that overrides four tokens stays four tokens on disk, so
//     "reset this token" is a delete rather than a re-derivation, and a later
//     retune of the base theme reaches every custom theme built on it;
//   · a base theme that is removed from the product is a loud, catchable
//     validation failure at read time, not a room with half its tokens
//     missing.
//
// Ids are `custom:<slug>` EVERYWHERE a theme id is spoken — `settings.
// defaultTheme`, `DEFAULT_THEME`, localStorage "vellum.theme", the picker.
// The prefix is what lets every existing `isTheme()` guard keep meaning
// exactly what it meant (a BUILT-IN theme) while the new callers ask
// `isThemeChoice()` instead.

import { checkTheme, type ContrastCheck } from "./contrast.ts";
import { isTheme, themeGroup, type Theme, type ThemeGroup } from "./themes.ts";

export const CUSTOM_THEME_PREFIX = "custom:";

/** A custom theme id as it is spoken on the wire and in localStorage. */
export type CustomThemeId = string;

/** Any theme the product can be set to: one of the fifteen, or `custom:<slug>`. */
export type ThemeChoice = Theme | CustomThemeId;

/** How many custom themes one instance may hold. Not a resource limit — the
 *  file is tiny — but a picker is a browsing surface and a hundred rooms is a
 *  directory, not a choice. */
export const MAX_CUSTOM_THEMES = 24;

export const THEME_NAME_MAX = 48;

// ── The token allowlist ─────────────────────────────────────────────────────
// STRICT: a key not in this table is a 400. The values reach a generated
// stylesheet, so "which keys" and "which value shapes" are the entire security
// story of this feature, and both are closed sets rather than filters.

/** A token's value shape. `color` is an opaque hex; `wash` also accepts an
 *  8-digit hex, because the three tokens that carry one are translucent by
 *  design (a selection over prose, an accent ground, the graph vignette).
 *  NOTHING accepts a general CSS value: no `rgba()`, no `color-mix()`, no
 *  `var()`, no `url()`. A closed grammar means the generator can concatenate
 *  without escaping and still be provably injection-free. */
export type TokenKind = "color" | "wash";

/** The groups the builder lays out, in the order it lays them out. */
export type TokenGroup = "ground" | "text" | "accent" | "line" | "callout" | "code" | "graph";

export interface TokenSpec {
  name: string;
  group: TokenGroup;
  kind: TokenKind;
}

/** Every token a custom theme may set. This is the set a `[data-theme]` block
 *  in tokens.css defines, minus `color-scheme` (which is not a color and rides
 *  on the theme's `group` instead) and minus `--banner-tint` (a percentage,
 *  not a color — the one token in a theme block that is neither). */
export const THEME_TOKENS: TokenSpec[] = [
  { name: "--bg", group: "ground", kind: "color" },
  { name: "--bg-raised", group: "ground", kind: "color" },
  { name: "--bg-hover", group: "ground", kind: "color" },

  { name: "--text", group: "text", kind: "color" },
  { name: "--text-muted", group: "text", kind: "color" },
  { name: "--text-faint", group: "text", kind: "color" },

  { name: "--accent", group: "accent", kind: "color" },
  { name: "--accent-soft", group: "accent", kind: "wash" },
  { name: "--selection-bg", group: "accent", kind: "wash" },
  { name: "--focus-ring", group: "accent", kind: "color" },

  { name: "--border", group: "line", kind: "color" },
  { name: "--danger", group: "line", kind: "color" },

  { name: "--callout-note", group: "callout", kind: "color" },
  { name: "--callout-info", group: "callout", kind: "color" },
  { name: "--callout-todo", group: "callout", kind: "color" },
  { name: "--callout-abstract", group: "callout", kind: "color" },
  { name: "--callout-tip", group: "callout", kind: "color" },
  { name: "--callout-success", group: "callout", kind: "color" },
  { name: "--callout-question", group: "callout", kind: "color" },
  { name: "--callout-warning", group: "callout", kind: "color" },
  { name: "--callout-failure", group: "callout", kind: "color" },
  { name: "--callout-danger", group: "callout", kind: "color" },
  { name: "--callout-bug", group: "callout", kind: "color" },
  { name: "--callout-example", group: "callout", kind: "color" },
  { name: "--callout-quote", group: "callout", kind: "color" },

  { name: "--syn-keyword", group: "code", kind: "color" },
  { name: "--syn-string", group: "code", kind: "color" },
  { name: "--syn-number", group: "code", kind: "color" },
  { name: "--syn-comment", group: "code", kind: "color" },
  { name: "--syn-func", group: "code", kind: "color" },
  { name: "--syn-type", group: "code", kind: "color" },
  { name: "--syn-prop", group: "code", kind: "color" },
  { name: "--syn-operator", group: "code", kind: "color" },

  { name: "--graph-node", group: "graph", kind: "color" },
  { name: "--graph-edge", group: "graph", kind: "color" },
  { name: "--graph-vignette", group: "graph", kind: "wash" },
];

const TOKEN_BY_NAME = new Map(THEME_TOKENS.map((spec) => [spec.name, spec]));

/** Own-property lookup, never `TOKENS[name]` on a bare object: an allowlist
 *  read through the prototype chain answers for `constructor` and `toString`,
 *  which is the trap `patchSettings` and the font catalog both document. */
export function tokenSpec(name: string): TokenSpec | null {
  return TOKEN_BY_NAME.get(name) ?? null;
}

const HEX_OPAQUE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const HEX_ANY = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isValidTokenValue(kind: TokenKind, value: string): boolean {
  return (kind === "wash" ? HEX_ANY : HEX_OPAQUE).test(value.trim());
}

// ── The document ────────────────────────────────────────────────────────────

export interface CustomTheme {
  /** Slug, `[a-z0-9-]`, unique per instance. The full id is
   *  `custom:<id>` — see themeChoiceId(). */
  id: string;
  /** What a reader is shown. Free text (bidi controls already stripped). */
  name: string;
  /** The built-in this theme is an override layer over. */
  base: Theme;
  /** Which half of the picker it belongs in, and the `color-scheme` it
   *  declares. Defaults to the base's group; an author who turns a dark room's
   *  ground to paper says so here, and the browser's own form controls and
   *  scrollbars follow. */
  group: ThemeGroup;
  /** Sparse: only what the author actually changed. */
  tokens: Record<string, string>;
  createdMs: number;
  updatedMs: number;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function isCustomThemeId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(CUSTOM_THEME_PREFIX) &&
    SLUG_RE.test(value.slice(CUSTOM_THEME_PREFIX.length))
  );
}

/** A built-in id or a well-formed `custom:<slug>`. This is the guard every NEW
 *  caller uses; `isTheme()` keeps answering the narrower question it always
 *  answered, so nothing that already imports it changes meaning. */
export function isThemeChoice(value: unknown): value is ThemeChoice {
  return isTheme(value) || isCustomThemeId(value);
}

/** `custom:<slug>` → `<slug>`; anything else → null. */
export function customThemeSlug(choice: string): string | null {
  if (!isCustomThemeId(choice)) return null;
  return choice.slice(CUSTOM_THEME_PREFIX.length);
}

/** `<slug>` → `custom:<slug>`. */
export function customThemeChoice(slug: string): string {
  return `${CUSTOM_THEME_PREFIX}${slug}`;
}

/** A name → a slug. Falls back to a stable "theme" so a purely non-Latin name
 *  still produces a usable id; collisions are resolved by the store. */
export function slugifyThemeName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug === "" ? "theme" : slug;
}

/** The resolved group of any theme choice — built-in from the shipped table,
 *  custom from its own declaration (falling back to its base). */
export function themeChoiceGroup(
  choice: string,
  themes: readonly CustomTheme[],
): ThemeGroup {
  if (isTheme(choice)) return themeGroup(choice);
  const custom = findCustomTheme(choice, themes);
  if (!custom) return "dark";
  return custom.group;
}

/** The BUILT-IN a choice paints with: itself, or a custom theme's base. Used
 *  by everything that must hand `<html data-theme>` a real block — and by the
 *  swatch machinery, which is keyed on built-in ids. */
export function baseThemeOf(choice: string, themes: readonly CustomTheme[]): Theme {
  if (isTheme(choice)) return choice;
  return findCustomTheme(choice, themes)?.base ?? "iron-gall";
}

export function findCustomTheme(
  choice: string,
  themes: readonly CustomTheme[],
): CustomTheme | null {
  const slug = customThemeSlug(choice);
  if (slug === null) return null;
  return themes.find((theme) => theme.id === slug) ?? null;
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Thrown by validateCustomTheme; the server turns it into a 400 with this
 *  message, the importer prints it beside the file it came from. */
export class ThemeError extends Error {}

/** Validate an untrusted custom theme (a PUT body, an imported file, a row
 *  read back off disk). Returns a NEW object holding only allowlisted keys —
 *  never the caller's object, so nothing unvalidated can ride along into the
 *  file or the generated stylesheet. */
export function validateCustomTheme(input: unknown, now = Date.now()): CustomTheme {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ThemeError("A custom theme must be a JSON object");
  }
  const raw = input as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim() : "";
  if (name === "") throw new ThemeError("Custom theme needs a name");
  if (name.length > THEME_NAME_MAX) {
    throw new ThemeError(`Custom theme name is too long (${THEME_NAME_MAX} characters max)`);
  }

  if (!isTheme(raw.base)) {
    throw new ThemeError(
      `Custom theme "${name}" names an unknown base theme: ${JSON.stringify(raw.base)}`,
    );
  }
  const base: Theme = raw.base;

  const group: ThemeGroup =
    raw.group === "dark" || raw.group === "light" ? raw.group : themeGroup(base);

  const id =
    typeof raw.id === "string" && SLUG_RE.test(raw.id) ? raw.id : slugifyThemeName(name);

  const tokens: Record<string, string> = {};
  const rawTokens = raw.tokens;
  if (rawTokens !== undefined) {
    if (typeof rawTokens !== "object" || rawTokens === null || Array.isArray(rawTokens)) {
      throw new ThemeError(`Custom theme "${name}": "tokens" must be an object`);
    }
    for (const [key, value] of Object.entries(rawTokens as Record<string, unknown>)) {
      const spec = tokenSpec(key);
      if (!spec) throw new ThemeError(`Custom theme "${name}": unknown token ${key}`);
      if (typeof value !== "string" || !isValidTokenValue(spec.kind, value)) {
        throw new ThemeError(
          `Custom theme "${name}": ${key} must be a hex color` +
            (spec.kind === "wash" ? " (#rgb, #rrggbb or #rrggbbaa)" : " (#rgb or #rrggbb)"),
        );
      }
      tokens[key] = value.trim().toLowerCase();
    }
  }

  const stamp = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

  return {
    id,
    name,
    base,
    group,
    tokens,
    createdMs: stamp(raw.createdMs, now),
    updatedMs: stamp(raw.updatedMs, now),
  };
}

// ── Generated CSS ───────────────────────────────────────────────────────────

/** One theme's override block. Every key came out of the allowlist and every
 *  value out of a hex regex, so there is no escaping to get wrong — which is
 *  the point of both being closed sets rather than filters. */
export function customThemeCss(theme: CustomTheme): string {
  const lines = [`  color-scheme: ${theme.group};`];
  for (const spec of THEME_TOKENS) {
    const value = Object.prototype.hasOwnProperty.call(theme.tokens, spec.name)
      ? theme.tokens[spec.name]
      : undefined;
    if (value) lines.push(`  ${spec.name}: ${value};`);
  }
  const selector = `:root[data-custom-theme="${theme.id}"]`;
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

/** The whole instance's custom themes as one stylesheet. */
export function customThemesCss(themes: readonly CustomTheme[]): string {
  const head =
    "/* Vellum — custom themes. Generated from VELLUM_DATA/designs.json;\n" +
    "   every declaration below came out of a closed token allowlist and a hex\n" +
    "   grammar (shared/customTheme.ts). Do not edit: it is rewritten on save. */\n";
  return head + themes.map(customThemeCss).join("\n");
}

/** A signature that changes whenever any custom theme does — the `?v=` on the
 *  stylesheet link, exactly like `fontsSignature()`. Without it a browser that
 *  has the sheet cached keeps painting yesterday's accent. */
export function customThemesSignature(themes: readonly CustomTheme[]): string {
  if (themes.length === 0) return "";
  let hash = 0x811c9dc5;
  for (const theme of themes) {
    for (const ch of `${theme.id}:${theme.base}:${theme.group}:${JSON.stringify(theme.tokens)}`) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `${themes.length}-${(hash >>> 0).toString(36)}`;
}

// ── Contrast, resolved ──────────────────────────────────────────────────────

/**
 * The gate's verdict on a custom theme — which needs the BASE's values for
 * every token the author did not override, or a theme that only touched
 * `--accent` would report nothing about the ground it has to be legible on.
 *
 * `baseTokens` is the base theme's resolved token map; the client reads it off
 * the live document (`getComputedStyle` against a probe element carrying
 * `data-theme`), which is the only source that cannot drift from tokens.css.
 */
export function checkCustomTheme(
  theme: Pick<CustomTheme, "tokens">,
  baseTokens: Record<string, string>,
): ContrastCheck[] {
  return checkTheme({ ...baseTokens, ...theme.tokens });
}
