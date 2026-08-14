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
}

let config: SiteConfig = {
  siteName: "Vellum",
  defaultTheme: null,
  dataDir: path.resolve("data"),
  excludeTags: new Set(),
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

/** Absolute path of VELLUM_DATA/custom.css when it exists right now, else
 *  null — checked per call so the file can appear, change, or disappear
 *  without a server restart. */
export function customCssPath(): string | null {
  const p = path.join(config.dataDir, "custom.css");
  return existsSync(p) ? p : null;
}
