// The reader's language, and what it means for one request.
//
// `settings.languageFilter` used to be a boolean, and turning it on cost a
// real site eighteen of its twenty published posts with nothing anywhere
// saying so. It is now an enum (shared/types.ts::LanguageFilterMode), and one
// of its values — "follow" — cannot be answered from configuration alone: it
// asks what language the PERSON READING is reading in. That question has to be
// asked and answered per request, which is what this module is.
//
// Every visitor-facing route resolves ONE `LanguageScope` at its top and hands
// `scope.lang` to the indexer. Nothing below the routes reads the mode
// globally, because a global read is exactly how a per-reader setting turns
// back into a per-site one.

import type { Context } from "hono";
import type { LanguageFilterMode } from "../shared/types.ts";
import { publishedCensus, visibleUnder, type FilterLang } from "./indexer.ts";
import { languageFilterMode, languageToggleEnabled, siteLanguage } from "./site.ts";

/** The header the client sends its ACTIVE chrome language in. Named and gated
 *  as a sibling of X-Vellum-Preview, and for the same reason: it is a claim
 *  the client makes about itself which the server may or may not honor. */
export const LANG_HEADER = "X-Vellum-Lang";

/** Surfaces that accept `?lang=` instead, because they cannot send a header:
 *  EventSource (SSE) has no header API at all, and neither a feed reader
 *  fetching /feed.xml nor a crawler fetching /sitemap.xml is our client.
 *  Exactly the shape of the `?preview=visitor` carve-out for /api/events, and
 *  equally narrow — a query param honored on every route would let any
 *  <img src> or crawler pick a scope.
 *
 *  On the two crawler paths the param is the ONLY way to ask for one side of a
 *  bilingual site, which is why the sitemap joins the feed here: they answer
 *  the same question ("what exists"), and one of them being answerable per
 *  language while the other is not would make the pair disagree. */
const QUERY_PATHS = new Set(["/api/events", "/feed.xml", "/sitemap.xml"]);

/** The reader's active language as CLAIMED by the request, or null.
 *
 *  Asking is not getting, exactly like X-Vellum-Preview:
 *   • the value must be exactly "ar" or "en" — anything else is dropped
 *     silently rather than coerced, because a mistyped scope should fall back
 *     to the site's own language, not to a guess;
 *   • the claim is honored only while `settings.languageToggle` is ON. An
 *     instance that offers readers no language switch has no reader language
 *     to speak of: its readers all read it in the site language, and letting a
 *     header say otherwise would hand any caller a second, undocumented way to
 *     re-scope the public site. */
export function readerLanguage(c: Context): "ar" | "en" | null {
  let raw = c.req.header(LANG_HEADER)?.trim().toLowerCase();
  if (raw === undefined && QUERY_PATHS.has(c.req.path)) {
    raw = c.req.query("lang")?.trim().toLowerCase();
  }
  if (raw !== "ar" && raw !== "en") return null;
  if (!languageToggleEnabled()) return null;
  return raw;
}

/** Everything one request needs to know about language curation. */
export interface LanguageScope {
  /** The configured mode (settings.languageFilter, else LANGUAGE_FILTER). */
  mode: LanguageFilterMode;
  /** The filter to APPLY — hand this to every indexer call. null = none. */
  lang: FilterLang;
  /** Set when `lang` was dropped: this language qualified no published note,
   *  so the request is being served the FULL set instead of an empty site. */
  fallbackFrom: "ar" | "en" | null;
}

/** No curation at all — what every ADMIN surface gets, unconditionally.
 *  "Admin surfaces are never filtered" (CONTRACTS.md) is a rule about the
 *  owner's own view of their own vault, and it does not bend for a mode. */
const ADMIN_SCOPE: LanguageScope = { mode: "off", lang: null, fallbackFrom: null };

/**
 * Resolve the language scope for one request.
 *
 * `limited` is `isPublishLimited(c)` — passed in rather than imported so this
 * module and auth.ts do not have to import each other. A request that is not
 * publish-limited is the admin looking at their own vault: no filter, ever.
 *
 * The empty-set fallback applies to EVERY non-"off" mode, pinned ones
 * included, and it is the point of this round. A public site that shows
 * nothing is never what an operator meant, whatever they clicked: pinning to
 * Arabic on a vault with no Arabic posts is a configuration mistake, and the
 * humane response to a configuration mistake on a live site is to keep serving
 * it while saying so loudly to the one person who can fix it (the admin, via
 * `MeData.visibility` and the settings panel), not to blank the site for
 * everyone else. `fallbackFrom` is how the response says so.
 */
export function languageScope(c: Context, limited: boolean): LanguageScope {
  return limited ? resolve(readerLanguage(c)) : ADMIN_SCOPE;
}

/** The scope a request-less caller gets: the mode resolved against the SITE
 *  language, with no reader. Used by the crawler-facing <head> injector, which
 *  speaks for the site rather than for one reader. */
export function siteScope(): LanguageScope {
  return resolve(null);
}

function resolve(reader: "ar" | "en" | null): LanguageScope {
  const mode = languageFilterMode();
  if (mode === "off") return { mode, lang: null, fallbackFrom: null };
  // "follow": the reader's own language, falling back to the site's when they
  // have not chosen one (or the instance offers no switch). "ar"/"en": pinned,
  // and the reader's preference is deliberately ignored — that is what pinning
  // means, and the settings panel says so in those words.
  const want: "ar" | "en" = mode === "follow" ? (reader ?? siteLanguage()) : mode;
  // One pass over the published set, not two: this runs on every visitor
  // request under any non-"off" mode.
  const census = publishedCensus();
  const published = census.arabic + census.latin + census.neutral;
  if (published > 0 && visibleUnder(census, want) === 0) {
    return { mode, lang: null, fallbackFrom: want };
  }
  return { mode, lang: want, fallbackFrom: null };
}
