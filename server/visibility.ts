// What the visitor-facing settings are costing this site, in notes.
//
// Four settings on this instance can shrink the public site, and until now
// every one of them was a control with a name and no stated consequence:
//
//   • languageFilter — turned on, it took a real site from 20 published posts
//     to 2. Nothing said so, anywhere, ever.
//   • excludeTags    — removes topic pills, and with them whole topic pages.
//   • home.mode / home.note — a front door pointed at a note the filter hides
//     renders a blank homepage.
//   • PUBLIC=false   — the whole site is behind a login. Env-only, so the
//     panel cannot change it, but it can and must SAY it.
//
// This module answers, from this vault, with today's numbers: "if you save
// this, N of your M published notes stop being discoverable." It answers for
// hypothetical settings as well as current ones, which is what lets the
// settings panel print the consequence BEFORE the save rather than leaving the
// operator to discover it from their analytics a month later.
//
// Every count here describes DISCOVERY, matching what the filter actually
// does: a permalink to any published note keeps working under every setting.

import type { LanguageFilterMode, VisibilityImpact } from "../shared/types.ts";
import { envHomeNote, publicReads } from "./auth.ts";
import {
  isNoteVisibleToVisitor,
  publishedCensus,
  publishedTopics,
  resolveLink,
  visibleUnder,
  type FilterLang,
} from "./indexer.ts";
import { getSettings } from "./settings.ts";
import { excludedTags, languageFilterMode, publicLayout, siteLanguage } from "./site.ts";
import { normalizeRel } from "./vault.ts";

/** A hypothetical configuration to measure. Every field is optional: an absent
 *  one means "whatever is in force right now", so `visibilityFor({})` is the
 *  current state and `visibilityFor({ languageFilter: "ar" })` is the answer to
 *  "what happens if I click this". */
export interface VisibilityQuery {
  languageFilter?: LanguageFilterMode;
  excludeTags?: string[];
  publicLayout?: "app" | "blog" | "designed";
  homeMode?: "note" | "dashboard";
  homeNote?: string | null;
}

/** The language a mode filters at when nobody in particular is reading.
 *
 *  "follow" resolves to the SITE language here, and the number that comes back
 *  is therefore only half the story — which is why the panel renders "follow"
 *  from `census` (one row per reader population) rather than from `visible`.
 *  A single count cannot describe a setting whose answer differs per reader,
 *  and pretending otherwise would be the same class of lie the boolean told. */
function pinnedLang(mode: LanguageFilterMode): "ar" | "en" | null {
  if (mode === "off") return null;
  return mode === "follow" ? siteLanguage() : mode;
}

/** Measure a configuration — the one in force, or one being considered. */
export function visibilityFor(query: VisibilityQuery = {}): VisibilityImpact {
  const stored = getSettings();
  const mode = query.languageFilter ?? languageFilterMode();
  const census = publishedCensus();
  const published = census.arabic + census.latin + census.neutral;

  const want = pinnedLang(mode);
  // The same empty-set stand-down the live request path applies
  // (language.ts::resolve) — the preview must predict what the site will
  // ACTUALLY do, including its refusal to serve nothing.
  const wouldBeVisible = visibleUnder(census, want);
  const fallback = want !== null && published > 0 && wouldBeVisible === 0;
  const lang: FilterLang = fallback ? null : want;
  const visible = fallback ? published : wouldBeVisible;

  const hiddenTags = new Set(
    (query.excludeTags ?? [...excludedTags()]).map((t) => t.trim().replace(/^#/, "").toLowerCase()),
  );

  const layout = query.publicLayout ?? publicLayout();
  const homeMode = query.homeMode ?? stored.home?.mode ?? "note";
  const homeNote =
    query.homeNote !== undefined ? query.homeNote : (stored.home?.note ?? envHomeNote());

  return {
    published,
    visible,
    hiddenByLanguage: published - visible,
    languageFilter: mode,
    filterLang: lang,
    fallback,
    census,
    topics: publishedTopics(lang, hiddenTags),
    publicReads: publicReads(),
    publicLayout: layout,
    home: {
      mode: homeMode,
      note: homeNote ?? null,
      noteVisible: homeNote ? homeNoteReachable(homeNote, lang) : false,
    },
  };
}

/** Would a visitor's homepage actually render this note? Same two-clause rule
 *  /api/me's home-note gate uses (name resolution, then exact path), because a
 *  preview that disagreed with the live gate would be worse than no preview. */
function homeNoteReachable(ref: string, lang: FilterLang): boolean {
  if (resolveLink(ref, true, lang) !== null) return true;
  try {
    const asPath = /\.md$/i.test(ref) ? ref : `${ref}.md`;
    return isNoteVisibleToVisitor(normalizeRel(asPath), lang);
  } catch {
    return false;
  }
}

/** The site as it stands. */
export function currentVisibility(): VisibilityImpact {
  return visibilityFor();
}

/** Is something MATERIALLY reducing what visitors see — i.e. worth putting a
 *  standing indicator in the admin's chrome for?
 *
 *  Deliberately not "is anything at all hidden": an indicator that is always
 *  lit is an indicator nobody reads, and the failure being guarded against is
 *  a site that shrank without anyone noticing. So it lights for the states
 *  where the answer is genuinely surprising — reads closed entirely, the
 *  language filter standing down because it matched nothing, a blog front door
 *  pointing at a note visitors cannot see, or any note at all hidden by
 *  language. That last one has no threshold on purpose: "1 of 20 hidden" is
 *  still a post the owner published and nobody can find. */
export function isReducingReach(impact: VisibilityImpact): boolean {
  if (!impact.publicReads) return true;
  if (impact.fallback) return true;
  if (impact.hiddenByLanguage > 0) return true;
  // NOT topics.suppressed: EXCLUDE_TAGS is deliberate, well-understood
  // curation, its consequence is now printed under its own control, and any
  // site that uses it at all would light this pill forever — which is how an
  // indicator becomes furniture nobody reads. This one stays for notes going
  // missing.
  if (impact.publicLayout === "blog" && impact.home.mode === "note" && impact.home.note && !impact.home.noteVisible) {
    return true;
  }
  return impact.published > 0 && impact.visible === 0;
}
