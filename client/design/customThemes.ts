// Custom themes, client side: the registry, the stylesheet link, and the one
// function that puts a theme choice on the document.
//
// Two attributes, not one. `<html data-theme>` always names a BUILT-IN block —
// the custom theme's base — so every token the author did not touch comes from
// tokens.css unchanged, including the ones that block defines and this feature
// has no opinion about. `<html data-custom-theme>` names the override layer,
// which /api/design/themes.css keys at `:root[data-custom-theme="…"]` and
// therefore wins on specificity. Nothing in tokens.css is read, rewritten or
// duplicated, and a theme retune upstream reaches every custom theme built on
// it for free.
//
// Everything here is deliberately synchronous once the registry is warm: the
// theme has to be on the document before first paint of anything, and an
// `await` between "which theme" and "apply it" is a flash of the wrong room.

import {
  baseThemeOf,
  customThemesSignature,
  findCustomTheme,
  isCustomThemeId,
  type CustomTheme,
} from "../../shared/customTheme.ts";
import { isTheme, type Theme } from "../../shared/themes.ts";
import { getPublicDesign } from "./api.ts";

/** The instance's custom themes. Empty until /api/me says there are any and
 *  the first fetch lands — which is exactly the state a fresh install and
 *  every instance that never made one stay in forever, at the cost of nothing. */
let registry: CustomTheme[] = [];

/** Subscribers that must re-render when the registry changes (the picker, the
 *  builder, the status-bar glyph). A set of thunks rather than a store slice:
 *  this list changes a handful of times in a session and nothing about it
 *  belongs in the shell's state contract. */
const listeners = new Set<() => void>();

export function getCustomThemes(): CustomTheme[] {
  return registry;
}

export function subscribeCustomThemes(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setCustomThemes(themes: CustomTheme[]): void {
  registry = themes;
  for (const fn of listeners) fn();
}

/** The BUILT-IN a choice paints with. */
export function resolveBaseTheme(choice: string): Theme {
  return baseThemeOf(choice, registry);
}

/** The custom theme behind a choice, or null for the built-ins. */
export function lookupCustomTheme(choice: string): CustomTheme | null {
  return findCustomTheme(choice, registry);
}

/** A choice this browser can actually paint: a built-in, or a custom theme
 *  the registry knows. Anything else (a theme deleted on another device, a
 *  hand-edited localStorage value) is refused so the caller falls back. */
export function isKnownThemeChoice(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (isTheme(value)) return true;
  return isCustomThemeId(value) && findCustomTheme(value, registry) !== null;
}

/**
 * Put a theme choice on the document. This is the ONLY writer of both
 * attributes — the theme picker's live preview, the store's setTheme, and the
 * builder's preview all come through here, so there is one place where "what
 * is on screen" is decided.
 *
 * A custom choice the registry has not got (yet, or ever) paints its BASE if
 * the id says one, and otherwise the product default. Painting nothing was the
 * alternative and it is worse: an unknown `data-theme` matches no block, so
 * the page would render in :root's iron-gall while claiming to be something
 * else, which is the same invisible state the theme picker exists to remove.
 */
export function applyThemeChoice(choice: string): void {
  const root = document.documentElement;
  const custom = findCustomTheme(choice, registry);
  if (custom) {
    root.setAttribute("data-theme", custom.base);
    root.setAttribute("data-custom-theme", custom.id);
    return;
  }
  root.setAttribute("data-theme", isTheme(choice) ? choice : baseThemeOf(choice, registry));
  root.removeAttribute("data-custom-theme");
}

/**
 * The same decision as `applyThemeChoice`, as a VALUE rather than as a write.
 *
 * The designer's preview frame is a second document, and a theme has to reach
 * it as a pair of attributes on ITS root — a custom theme is keyed at `:root`
 * and can be painted nowhere else, which is why a nested `<div data-theme>`
 * (what a scaled canvas can do) is only ever right for the built-ins. One
 * function decides "which attributes does this choice mean"; two callers write
 * them in two documents.
 */
export function themeChoiceAttrs(choice: string): { theme: Theme; custom: string | null } {
  const custom = findCustomTheme(choice, registry);
  if (custom) return { theme: custom.base, custom: custom.id };
  return { theme: isTheme(choice) ? choice : baseThemeOf(choice, registry), custom: null };
}

// ── The stylesheet ──────────────────────────────────────────────────────────

/** Add, refresh or drop the generated custom-theme stylesheet.
 *
 *  Inserted BEFORE any custom.css link, for the reason `ensureSiteFonts`
 *  documents: the hand-written escape hatch outranks anything this product
 *  generates, never the other way round. The `?v=` is the content signature
 *  from /api/me, so a changed theme is a changed URL rather than a cached
 *  sheet painting yesterday's accent. */
export function ensureCustomThemeCss(sig: string | null): void {
  const existing = document.head.querySelector<HTMLLinkElement>("link[data-vellum-themes]");
  if (sig === null || sig === "") {
    existing?.remove();
    return;
  }
  const href = `/api/design/themes.css?v=${encodeURIComponent(sig)}`;
  if (existing) {
    if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-vellum-themes", "");
  const custom = document.head.querySelector("link[data-vellum-custom]");
  if (custom) document.head.insertBefore(link, custom);
  else document.head.appendChild(link);
}

/** What `sig` the document is currently linking, so a caller can tell whether
 *  a refetch is needed. */
let loadedSig: string | null = null;

/**
 * React to /api/me's `customThemes` signature: link (or drop) the stylesheet,
 * and refresh the registry when it changed.
 *
 * The list itself rides /api/design/public rather than /api/me because it is
 * a payload, not a fact: an instance with no custom themes never fetches it,
 * and an instance with a dozen fetches it once per signature instead of on
 * every /api/me. Failures are SILENT and non-fatal — a custom theme that
 * could not be fetched leaves the site painted in its base, which is a real
 * theme, and a toast about a stylesheet is not something a visitor can act on.
 */
export async function syncCustomThemes(sig: string | null): Promise<boolean> {
  ensureCustomThemeCss(sig);
  if (sig === null || sig === "") {
    loadedSig = null;
    if (registry.length > 0) setCustomThemes([]);
    return false;
  }
  if (sig === loadedSig) return false;
  try {
    const payload = await getPublicDesign();
    loadedSig = sig;
    setCustomThemes(payload.themes);
    return true;
  } catch (err) {
    console.warn("vellum: could not load custom themes", err);
    return false;
  }
}

/** Force the next syncCustomThemes to refetch. */
export function invalidateCustomThemes(): void {
  loadedSig = null;
}

/**
 * Refetch the themes AND re-point the stylesheet at them — what the builder
 * calls after a save.
 *
 * Refreshing only the registry is not enough, and the way it fails is silent:
 * the stylesheet link still carries the OLD `?v=`, the route serves it
 * `immutable`, so the browser answers from cache and the theme the author just
 * saved renders as its base with none of its overrides. Measured exactly that
 * way — `data-custom-theme="foxfire"` on the document and `--accent` still
 * nocturne's. The signature is computed with the SAME shared function the
 * server uses (`customThemesSignature`), so the URL this produces is
 * byte-identical to the one the next /api/me would have named — no round trip
 * to learn a string both sides can derive.
 */
export async function reloadCustomThemes(): Promise<void> {
  const payload = await getPublicDesign();
  const sig = customThemesSignature(payload.themes);
  loadedSig = sig === "" ? null : sig;
  ensureCustomThemeCss(sig);
  setCustomThemes(payload.themes);
}
