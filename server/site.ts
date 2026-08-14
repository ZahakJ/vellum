// Instance customization, all env-driven: SITE_NAME (branding), DEFAULT_THEME
// (theme for visitors with no stored choice), VELLUM_DATA (directory holding
// instance files such as custom.css). Kept apart from auth so site identity
// and security config don't tangle. All values reach the client via /api/me.

import { existsSync } from "node:fs";
import path from "node:path";

interface SiteConfig {
  siteName: string;
  defaultTheme: string | null;
  dataDir: string;
  excludeTags: Set<string>;
  publicLayout: "app" | "blog";
  tagline: string | null;
  footer: string | null; // raw SITE_FOOTER (may contain {year}/{siteName}); null → default
  blogLocale: string;
  siteUrl: string | null; // canonical origin for absolute links (RSS, canonical); null → derive from request
}

let config: SiteConfig = {
  siteName: "Vellum",
  defaultTheme: null,
  dataDir: path.resolve("data"),
  excludeTags: new Set(),
  publicLayout: "app",
  tagline: null,
  footer: null,
  blogLocale: "en",
  siteUrl: null,
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
    blogLocale: env.BLOG_LOCALE?.trim() || "en",
    siteUrl: env.SITE_URL?.trim().replace(/\/+$/, "") || null,
  };
}

export function siteName(): string {
  return config.siteName;
}

export function defaultTheme(): string | null {
  return config.defaultTheme;
}

/** Lower-cased tags hidden from visitor-facing tag/topic surfaces (EXCLUDE_TAGS). */
export function excludedTags(): Set<string> {
  return config.excludeTags;
}

/** "blog" → visitors see the classic blog shell (PUBLIC_LAYOUT); admin
 *  sessions always keep the full app regardless. */
export function publicLayout(): "app" | "blog" {
  return config.publicLayout;
}

/** Masthead subtitle (SITE_TAGLINE), or null when unset. */
export function tagline(): string | null {
  return config.tagline;
}

/** Footer line, resolved: SITE_FOOTER with {year}/{siteName} placeholders
 *  substituted, defaulting to "© <year> <SITE_NAME>". */
export function footerLine(): string {
  const year = String(new Date().getFullYear());
  if (config.footer) {
    return config.footer.replaceAll("{year}", year).replaceAll("{siteName}", config.siteName);
  }
  return `© ${year} ${config.siteName}`;
}

/** BCP47 locale the client uses to format post dates (BLOG_LOCALE, default "en"). */
export function blogLocale(): string {
  return config.blogLocale;
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

/** VELLUM_DATA/fonts — the directory GET /api/fonts/:file serves from. */
export function fontsDir(): string {
  return path.join(config.dataDir, "fonts");
}
