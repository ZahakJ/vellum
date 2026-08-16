// Instance customization: env defaults (SITE_NAME, DEFAULT_THEME, …) merged
// with the runtime-editable VELLUM_DATA/settings.json (settings.ts) — a stored
// settings value wins over its env default; absent keys fall back to env.
// Kept apart from auth so site identity and security config don't tangle.
// All merged values reach the client via /api/me.
//
// The settings.ts import is intentionally circular (settings.ts needs
// dataDir() from here): both modules only export functions and never call
// each other at module top level, so the cycle is inert.

import { existsSync } from "node:fs";
import path from "node:path";
import { resolveAttachmentDir, type AttachmentLocation } from "../shared/attachments.ts";
import type { LanguageFilterMode } from "../shared/types.ts";
import { numeralSystem, toNumerals } from "../shared/numerals.ts";
import { isTheme, THEMES as THEME_IDS } from "../shared/themes.ts";
import { isCustomThemeId } from "../shared/customTheme.ts";
import { getSettings } from "./settings.ts";

interface SiteConfig {
  siteName: string;
  defaultTheme: string | null;
  dataDir: string;
  excludeTags: Set<string>;
  publicLayout: "app" | "blog" | "designed";
  tagline: string | null;
  footer: string | null; // raw SITE_FOOTER (may contain {year}/{siteName}); null → default
  blogLocale: string | null; // BLOG_LOCALE as given; null → derive (language-aware) in the getter
  language: "en" | "ar"; // SITE_LANG — chrome language + RTL mirroring when "ar"
  languageFilter: EnvLanguageFilter; // LANGUAGE_FILTER — see readEnvLanguageFilter
  siteUrl: string | null; // canonical origin for absolute links (RSS, canonical); null → derive from request
  attachmentsDir: string; // vault-relative dir uploads land in (ATTACHMENTS_DIR)
  bannerFallback: "generated" | "none"; // BANNER_FALLBACK — hero for banner-less blog posts
}

let config: SiteConfig = {
  siteName: "Vellum",
  defaultTheme: null,
  dataDir: path.resolve("data"),
  excludeTags: new Set(),
  publicLayout: "app",
  tagline: null,
  footer: null,
  blogLocale: null,
  language: "en",
  languageFilter: "off",
  siteUrl: null,
  attachmentsDir: "attachments",
  bannerFallback: "generated",
};

/** DEFAULT_THEME, checked against the shared theme list. An unknown name is
 *  ignored (the instance keeps the built-in default) and SAID SO once, at
 *  startup — the same list backs `settings.defaultTheme`, whose PATCH answers
 *  400 rather than dropping the value quietly. */
function readEnvTheme(raw: string | undefined): string | null {
  const value = raw?.trim().toLowerCase() || null;
  // A custom theme id passes the SHAPE check here and nothing more: this runs
  // inside initSite(), before dataDir() has a value, so designs.json cannot be
  // consulted yet without a startup-order cycle. Existence is checked where it
  // is cheap and where the answer matters — /api/me only names a default theme
  // the instance actually has.
  if (value === null || isTheme(value) || isCustomThemeId(value)) return value;
  console.error(
    `vellum: DEFAULT_THEME="${value}" is not a built-in theme (or a custom:<name> one) — ignoring. ` +
      `Built-ins: ${THEME_IDS.join(", ")}`,
  );
  return null;
}

/** PUBLIC_LAYOUT, validated. An unrecognized value is the default layout and
 *  SAYS SO, for readEnvTheme's reason: a typo'd `PUBLIC_LAYOUT=deisgned` that
 *  silently serves the app shell is an operator staring at an unchanged site
 *  with nothing anywhere explaining why. */
function readEnvLayout(raw: string | undefined): "app" | "blog" | "designed" {
  const value = raw?.trim().toLowerCase() || "";
  if (value === "blog" || value === "designed" || value === "app") return value;
  if (value !== "") {
    console.error(`vellum: PUBLIC_LAYOUT="${value}" is not app, blog or designed — ignoring.`);
  }
  return "app";
}

/** Every value the shared LanguageFilterMode enum admits — the one list both
 *  the env reader and the PATCH validator check against. */
export const LANGUAGE_FILTER_MODES: readonly LanguageFilterMode[] = ["off", "follow", "ar", "en"];
const MODE_SET = new Set<string>(LANGUAGE_FILTER_MODES);

/** The env form of the filter. `"site"` is the LEGACY BOOLEAN: `true` never
 *  named a language, it meant "the site's own language, whatever that is", so
 *  it stays a sentinel resolved at read time (languageFilterMode) rather than
 *  being frozen into "ar" or "en" here. Everything else is the enum. */
type EnvLanguageFilter = LanguageFilterMode | "site";

/** LANGUAGE_FILTER, validated. The enum values win; the boolean spellings this
 *  variable used to take (`true/1/on/yes`, `false/0/no`) still work and mean
 *  what they always meant; anything else is IGNORED AND SAID SO, once, at
 *  startup — the same treatment DEFAULT_THEME gets, and for a sharper reason:
 *  a typo here silently decides how much of the site is public. */
function readEnvLanguageFilter(raw: string | undefined): EnvLanguageFilter {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") return "off";
  if (MODE_SET.has(value)) return value as LanguageFilterMode;
  if (/^(true|1|on|yes)$/.test(value)) return "site"; // legacy: pin to the site language
  if (/^(false|0|no)$/.test(value)) return "off";
  console.error(
    `vellum: LANGUAGE_FILTER="${value}" is not a language-filter mode — ignoring (filter off). ` +
      `One of: ${LANGUAGE_FILTER_MODES.join(", ")}`,
  );
  return "off";
}

/** Read site settings from the environment. Call once at startup. */
export function initSite(env: NodeJS.ProcessEnv = process.env): void {
  config = {
    siteName: env.SITE_NAME?.trim() || "Vellum",
    // Validated against the shared theme list, not passed through: a typo'd
    // DEFAULT_THEME used to travel all the way to /api/me and get silently
    // dropped by the client, so the operator saw the default theme and no
    // explanation anywhere. One line on stderr at startup is the whole fix.
    defaultTheme: readEnvTheme(env.DEFAULT_THEME),
    dataDir: path.resolve(env.VELLUM_DATA?.trim() || "data"),
    // Workflow/status tags (e.g. zettel maturity markers) that shouldn't
    // surface as topic headings or tag pills on the published site. A leading
    // "#" is tolerated; matching is case-insensitive. Admin views unaffected.
    excludeTags: new Set(
      (env.EXCLUDE_TAGS ?? "")
        .split(",")
        .map((t) => t.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean),
    ),
    // Blog mode: visitors get a classic blog shell instead of the app chrome.
    // "designed" composes the visitor shell from the active design instead
    // (server/designs.ts); anything else is the default app layout.
    publicLayout: readEnvLayout(env.PUBLIC_LAYOUT),
    tagline: env.SITE_TAGLINE?.trim() || null,
    footer: env.SITE_FOOTER?.trim() || null,
    blogLocale: env.BLOG_LOCALE?.trim() || null,
    // Chrome language: "ar" localizes every chrome string and mirrors the UI
    // right-to-left. Anything but exactly "ar" (case-insensitive) is English.
    language: env.SITE_LANG?.trim().toLowerCase() === "ar" ? "ar" : "en",
    // Public-surface language filter (see indexer + LanguageFilterMode).
    languageFilter: readEnvLanguageFilter(env.LANGUAGE_FILTER),
    siteUrl: env.SITE_URL?.trim().replace(/\/+$/, "") || null,
    // Vault-relative directory uploaded images land in (created on demand).
    // Slashes trimmed; the API layer path-safety-checks the joined result.
    attachmentsDir:
      env.ATTACHMENTS_DIR?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "attachments",
    // Notes without a banner: "generated" (default) shows a deterministic
    // abstract gradient in the blog list + article hero; "none" shows nothing.
    bannerFallback:
      env.BANNER_FALLBACK?.trim().toLowerCase() === "none" ? "none" : "generated",
  };
}

// Every getter below merges live: settings.json value when set, env default
// otherwise. getSettings() is mtime-cached, so the common cost is one stat.

export function siteName(): string {
  return getSettings().siteName ?? config.siteName;
}

export function defaultTheme(): string | null {
  return getSettings().defaultTheme ?? config.defaultTheme;
}

/** Lower-cased tags hidden from visitor-facing tag/topic surfaces
 *  (settings.excludeTags, else EXCLUDE_TAGS). */
export function excludedTags(): Set<string> {
  const stored = getSettings().excludeTags;
  if (stored !== undefined) return new Set(stored.map((t) => t.toLowerCase()));
  return config.excludeTags;
}

/** "blog" → visitors see the classic blog shell; "designed" → the active
 *  design composes it (settings.publicLayout, else PUBLIC_LAYOUT). Admin
 *  sessions always keep the full app regardless.
 *
 *  This is the CONFIGURED value. What a visitor actually gets is
 *  `servedLayout()` in server/auth.ts, which downgrades "designed" to "blog"
 *  whenever there is no renderable design — the fallback happens on the
 *  server so a visitor's first byte is already the pristine base. */
export function publicLayout(): "app" | "blog" | "designed" {
  return getSettings().publicLayout ?? config.publicLayout;
}

/** Masthead subtitle (settings.tagline, else SITE_TAGLINE), or null. */
export function tagline(): string | null {
  return getSettings().tagline ?? config.tagline;
}

/** Raw footer template (may contain {year}/{siteName}), or null when neither
 *  settings.footer nor SITE_FOOTER is set — the settings panel edits this. */
export function footerTemplate(): string | null {
  return getSettings().footer ?? config.footer;
}

/** Footer line, resolved: the footer template with {year}/{siteName}
 *  placeholders substituted, defaulting to "© <year> <site name>". */
export function footerLine(): string {
  // The year is a number the chrome prints beside Arabic-Indic dates and
  // counts, so it obeys the same single numeral policy (shared/numerals.ts) —
  // otherwise an Arabic footer read "© 2026" under "١٥ أغسطس".
  const year = toNumerals(String(new Date().getFullYear()), numeralSystem(blogLocale()));
  const template = footerTemplate();
  const name = siteName();
  if (template) {
    return template.replaceAll("{year}", year).replaceAll("{siteName}", name);
  }
  return `© ${year} ${name}`;
}

/** BCP47 locale the client uses to format post dates
 *  (settings.blogLocale, else BLOG_LOCALE). When neither is set the site
 *  language decides: "ar" formats dates in Arabic (Eastern Arabic numerals —
 *  correct and desired), otherwise "en". */
export function blogLocale(): string {
  return getSettings().blogLocale ?? config.blogLocale ?? (siteLanguage() === "ar" ? "ar" : "en");
}

/** Chrome language (settings.language, else SITE_LANG; default "en"). */
export function siteLanguage(): "en" | "ar" {
  return getSettings().language ?? config.language;
}

/** SITE_LANG alone — the env default, with settings.json deliberately NOT
 *  consulted. It exists for exactly one caller: settings.ts, resolving what a
 *  legacy `languageFilter: true` means. That resolution happens INSIDE
 *  getSettings(), so reaching back through siteLanguage() (which calls
 *  getSettings()) was infinite recursion — the server died at boot with
 *  "Maximum call stack size exceeded" the first time it met a real pre-enum
 *  settings file. settings.ts pairs this with the raw file's own `language`
 *  key, which is the same merge siteLanguage() does, one layer down. */
export function envSiteLanguage(): "en" | "ar" {
  return config.language;
}

/** How public discovery surfaces curate by note language: settings.languageFilter
 *  when stored, else LANGUAGE_FILTER, else "off".
 *
 *  The env "site" sentinel (a legacy boolean `LANGUAGE_FILTER=true`) resolves
 *  HERE rather than at startup, because that is what it has always meant —
 *  "whichever language the site is in right now" — and resolving it in
 *  initSite() would freeze it against a `settings.language` that had not been
 *  read yet. The STORED boolean is a different case and is migrated on disk
 *  (settings.ts): a live site's behaviour must not follow its chrome language
 *  around after an upgrade. */
export function languageFilterMode(): LanguageFilterMode {
  const stored = getSettings().languageFilter;
  if (stored !== undefined) return stored;
  return config.languageFilter === "site" ? siteLanguage() : config.languageFilter;
}

/** settings.languageToggle — the public shell offers visitors an EN/ع switch.
 *  No env counterpart (a visitor-facing switch is a runtime editorial choice),
 *  and it is the GATE on the reader-language header: a site that does not
 *  offer readers a language cannot be told by one which language it is
 *  reading in. */
export function languageToggleEnabled(): boolean {
  return getSettings().languageToggle ?? false;
}

/** Configured canonical origin (SITE_URL, no trailing slash) or null —
 *  callers then derive the origin from the request. */
export function siteUrl(): string | null {
  return config.siteUrl;
}

/** Absolute path of VELLUM_DATA/custom.css when it exists right now, else
 *  null — checked per call so the file can appear, change, or disappear
 *  without a server restart. */
export function customCssPath(): string | null {
  const p = path.join(config.dataDir, "custom.css");
  return existsSync(p) ? p : null;
}

/** Vault-relative directory POST /api/upload writes into when no attachment
 *  LOCATION setting overrides it (ATTACHMENTS_DIR; default "attachments"). */
export function attachmentsDir(): string {
  return config.attachmentsDir;
}

/** Where new attachments go: settings.attachments merged over the env
 *  default. Absent settings mean the behaviour every instance had before the
 *  setting existed — one fixed folder, ATTACHMENTS_DIR — so an upgrade
 *  changes nothing until the admin says otherwise. */
export function attachmentLocation(): AttachmentLocation {
  const stored = getSettings().attachments;
  return {
    mode: stored?.mode ?? "specified",
    folder: stored?.folder ?? config.attachmentsDir,
  };
}

/** The vault-relative directory an upload lands in, given the folder it
 *  happened in (the open note's folder, or the tree folder it was dropped
 *  on). The caller's context is advisory: `safeAbs` still judges the result. */
export function uploadDirFor(contextDir: string): string {
  return resolveAttachmentDir(attachmentLocation(), contextDir);
}

/** Absolute path of the instance data directory (VELLUM_DATA, default ./data). */
export function dataDir(): string {
  return config.dataDir;
}

/** BANNER_FALLBACK: what banner-less blog posts show as their hero. */
export function bannerFallback(): "generated" | "none" {
  return config.bannerFallback;
}

/** VELLUM_DATA/fonts — the directory GET /api/fonts/:file serves from. */
export function fontsDir(): string {
  return path.join(config.dataDir, "fonts");
}
