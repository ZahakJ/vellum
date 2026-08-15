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
import { numeralSystem, toNumerals } from "../shared/numerals.ts";
import { getSettings } from "./settings.ts";

interface SiteConfig {
  siteName: string;
  defaultTheme: string | null;
  dataDir: string;
  excludeTags: Set<string>;
  publicLayout: "app" | "blog";
  tagline: string | null;
  footer: string | null; // raw SITE_FOOTER (may contain {year}/{siteName}); null → default
  blogLocale: string | null; // BLOG_LOCALE as given; null → derive (language-aware) in the getter
  language: "en" | "ar"; // SITE_LANG — chrome language + RTL mirroring when "ar"
  languageFilter: boolean; // LANGUAGE_FILTER — public blog lists show only site-language notes
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
  languageFilter: false,
  siteUrl: null,
  attachmentsDir: "attachments",
  bannerFallback: "generated",
};

/** Read site settings from the environment. Call once at startup. */
export function initSite(env: NodeJS.ProcessEnv = process.env): void {
  config = {
    siteName: env.SITE_NAME?.trim() || "Vellum",
    // Passed through as-is; the client validates against its theme list and
    // ignores unknown names, so the server never chases theme additions.
    defaultTheme: env.DEFAULT_THEME?.trim().toLowerCase() || null,
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
    // Anything but exactly "blog" (case-insensitive) is the default app layout.
    publicLayout: env.PUBLIC_LAYOUT?.trim().toLowerCase() === "blog" ? "blog" : "app",
    tagline: env.SITE_TAGLINE?.trim() || null,
    footer: env.SITE_FOOTER?.trim() || null,
    blogLocale: env.BLOG_LOCALE?.trim() || null,
    // Chrome language: "ar" localizes every chrome string and mirrors the UI
    // right-to-left. Anything but exactly "ar" (case-insensitive) is English.
    language: env.SITE_LANG?.trim().toLowerCase() === "ar" ? "ar" : "en",
    // Public-surface language filter (works with `language`; see indexer).
    languageFilter: /^(true|1|on|yes)$/i.test(env.LANGUAGE_FILTER?.trim() ?? ""),
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

/** "blog" → visitors see the classic blog shell (settings.publicLayout, else
 *  PUBLIC_LAYOUT); admin sessions always keep the full app regardless. */
export function publicLayout(): "app" | "blog" {
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

/** True when public blog surfaces should list only notes written
 *  predominantly in the site language's script (settings.languageFilter,
 *  else LANGUAGE_FILTER; default false). */
export function languageFilterEnabled(): boolean {
  return getSettings().languageFilter ?? config.languageFilter;
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

/** Vault-relative directory POST /api/upload writes into (ATTACHMENTS_DIR). */
export function attachmentsDir(): string {
  return config.attachmentsDir;
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
