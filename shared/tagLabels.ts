// Localised tag labels — DISPLAY ONLY.
//
// The vault keeps its canonical tags forever: `#software` stays `#software` in
// every note, in every URL, in EXCLUDE_TAGS, in the language filter and in
// `/api/search`'s index. What this module owns is the one thing an Arabic
// front end needs and a vault must not pay for — the WORD a reader sees on a
// chip. Nothing here ever rewrites a file.
//
// Resolution order, highest first:
//   (a) the tag's own page in the tags folder, via its frontmatter
//       `labels: { ar: برمجيات }` — so the naming travels WITH the vault and
//       survives being cloned, synced or opened in Obsidian;
//   (b) `settings.tagLabels`, for tags that have no page — edited in
//       Settings → Language;
//   (c) the canonical tag itself.
//
// A label is per LANGUAGE, in both sources, because one vault serves both
// shells: the same map answers an English visitor with "Software" and an
// Arabic one with «برمجيات».

import { stripBidiControls } from "./bidi.ts";

/** canonical tag (lowercased) → language tag → label. */
export type TagLabelMap = Record<string, Record<string, string>>;

/** Longest a label may be. A chip is a chip. */
export const TAG_LABEL_MAX = 60;

/** Where a tag's own page lives by default — Obsidian's own convention, and
 *  the folder the README's worked example uses. */
export const DEFAULT_TAGS_FOLDER = "tags";

/** The canonical key a tag is stored and looked up under. Tags are already
 *  lowercased by the indexer; this is the one place that fact is spelled out
 *  so a caller holding a raw frontmatter value cannot miss it. */
export function tagKey(tag: string): string {
  return tag.trim().replace(/^#/, "").toLowerCase();
}

/** The label for `tag` in `lang`, or the canonical tag when nothing names it.
 *  An exact language match wins; `ar-EG` falls back to `ar` before giving up,
 *  because a labels map written for a language should not have to enumerate
 *  its regions. */
export function tagLabel(tag: string, lang: string, map: TagLabelMap | null): string {
  const canonical = tag.replace(/^#/, "");
  if (!map) return canonical;
  const entry = map[tagKey(canonical)];
  if (!entry) return canonical;
  const exact = entry[lang];
  if (typeof exact === "string" && exact !== "") return exact;
  const base = lang.split("-")[0];
  const wide = entry[base];
  return typeof wide === "string" && wide !== "" ? wide : canonical;
}

/** True when the tag is displayed under a name that is not its own — the test
 *  every "show the canonical value in the tooltip" surface asks. */
export function tagIsLabelled(tag: string, lang: string, map: TagLabelMap | null): boolean {
  return tagLabel(tag, lang, map) !== tag.replace(/^#/, "");
}

/** The canonical tag a localised label names, or null. URLs keep canonical
 *  slugs; this is what lets the localised spelling be ACCEPTED as a redirect
 *  rather than 404ing a link a reader copied off a chip. Case-insensitive, and
 *  it also answers for a value that is already canonical. */
export function canonicalForLabel(value: string, map: TagLabelMap | null): string | null {
  const want = value.trim().replace(/^#/, "");
  if (want === "") return null;
  const lower = want.toLowerCase();
  if (map && Object.prototype.hasOwnProperty.call(map, lower)) return lower;
  if (!map) return null;
  for (const [canonical, labels] of Object.entries(map)) {
    for (const label of Object.values(labels)) {
      if (typeof label === "string" && label.toLowerCase() === lower) return canonical;
    }
  }
  return null;
}

/** Every label any language gives `tag` — what the search index and the
 *  query rewriter match against. */
export function labelsOf(tag: string, map: TagLabelMap | null): string[] {
  const entry = map?.[tagKey(tag)];
  if (!entry) return [];
  return Object.values(entry).filter((v): v is string => typeof v === "string" && v !== "");
}

/** A language tag key a labels map may carry: `ar`, `en`, `ar-EG`. */
function isLangKey(key: string): boolean {
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(key);
}

/** Coerce an untrusted value (frontmatter, settings.json, a PATCH body) into
 *  a labels map, dropping anything malformed. Never throws: reads must not
 *  fail because one tag page has a list where a map was expected. */
export function cleanTagLabels(value: unknown): TagLabelMap {
  const out: TagLabelMap = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [rawTag, rawLabels] of Object.entries(value as Record<string, unknown>)) {
    const key = tagKey(rawTag);
    if (key === "" || key.length > TAG_LABEL_MAX) continue;
    const entry = cleanLabelEntry(rawLabels);
    if (Object.keys(entry).length > 0) out[key] = entry;
  }
  return out;
}

/** One tag's `{ lang: label }` map, cleaned. A bare string is accepted and
 *  read as the ARABIC label: `labels: برمجيات` is what a hand-written Arabic
 *  tag page says, and refusing it would be pedantry with no upside. */
export function cleanLabelEntry(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value === "string") {
    const label = cleanLabel(value);
    if (label) out.ar = label;
    return out;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [lang, label] of Object.entries(value as Record<string, unknown>)) {
    const key = lang.trim();
    if (!isLangKey(key)) continue;
    const clean = cleanLabel(label);
    if (clean) out[key.toLowerCase()] = clean;
  }
  return out;
}

/** A label value: single-line, control characters out, BIDI OVERRIDES out,
 *  capped. The overrides matter for the same reason they do on a comment
 *  author: a chip is a short run rendered inside a nav row, and an RLO inside
 *  it reorders the row around itself rather than only itself. */
export function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = stripBidiControls(value).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (clean === "" || clean.length > TAG_LABEL_MAX) return null;
  return clean;
}

/** Merge two maps, per LANGUAGE rather than per tag: a tag page that names
 *  only an Arabic label must not erase the English one a settings row gives
 *  the same tag. `high` wins wherever the two collide. */
export function mergeTagLabels(high: TagLabelMap, low: TagLabelMap): TagLabelMap {
  const out: TagLabelMap = {};
  for (const [tag, labels] of Object.entries(low)) out[tag] = { ...labels };
  for (const [tag, labels] of Object.entries(high)) out[tag] = { ...(out[tag] ?? {}), ...labels };
  return out;
}
