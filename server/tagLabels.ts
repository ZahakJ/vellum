// Tag display labels, server side: the two sources merged, scoped for the
// session that is asking, and the one rewrite that keeps SEARCH honest.
//
// Everything here is DISPLAY. The vault's own tags are untouched, the URLs
// keep canonical slugs, EXCLUDE_TAGS and the language filter go on matching
// canonical values, and no file is ever rewritten. `shared/tagLabels.ts` owns
// the shapes and the resolution order; this module owns where the two sources
// come from on a running instance.

import type { TagLabelMap } from "../shared/tagLabels.ts";
import {
  canonicalForLabel,
  cleanTagLabels,
  labelsOf,
  mergeTagLabels,
} from "../shared/tagLabels.ts";
import { tagPageLabels, tags, type FilterLang } from "./indexer.ts";
import { getSettings, tagsFolder } from "./settings.ts";

export { tagsFolder };

/** The merged map: a tag PAGE's own `labels:` outranks the settings map, per
 *  language — a page naming only an Arabic label must not delete the English
 *  one a settings row gives the same tag. */
export function tagLabelMap(): TagLabelMap {
  return mergeTagLabels(tagPageLabels(tagsFolder()), cleanTagLabels(getSettings().tagLabels));
}

/** The map as a given session may see it. A visitor is told the labels of the
 *  tags that session can already enumerate through `/api/tags` — no more: an
 *  unfiltered map would name every EXCLUDE_TAGS tag and every tag carried
 *  solely by language-filtered notes, which is exactly the existence those two
 *  rules exist to withhold. Admin sessions get the whole map, because admin
 *  surfaces are never filtered. */
export function visibleTagLabels(publishedOnly: boolean, lang: FilterLang): TagLabelMap {
  const map = tagLabelMap();
  if (!publishedOnly) return map;
  const out: TagLabelMap = {};
  for (const { tag } of tags(true, lang)) {
    const entry = map[tag.toLowerCase()];
    if (entry) out[tag.toLowerCase()] = entry;
  }
  return out;
}

/** The canonical tag a URL segment names, whether it arrived canonical or
 *  localised. `/topic/برمجيات` must reach the same page `/topic/software`
 *  does — a reader copies the word off the chip they can see. */
export function canonicalTag(value: string): string | null {
  return canonicalForLabel(value, tagLabelMap());
}

/** SEARCH MATCHES BOTH SPELLINGS, and it does so by rewriting the QUERY rather
 *  than by widening the index.
 *
 *  The alternative — feeding the labels into minisearch's `tags` field — ties
 *  a display setting to the index: editing one label in the settings panel
 *  would leave every note's indexed tags stale until the next reindex, and a
 *  tag page saved in Obsidian would have to re-index every note that carries
 *  the tag. The query is where the two vocabularies actually meet, it is one
 *  string long, and it costs a scan of a map with one entry per labelled tag.
 *
 *  Canonical terms already match, so this only ADDS: a query holding a label
 *  gains that label's canonical tag beside it, and the original words stay in
 *  place so a note whose PROSE contains the Arabic word still ranks. */
export function expandTagQuery(query: string): string {
  const q = query.trim();
  if (q === "") return q;
  const map = tagLabelMap();
  const lower = q.toLowerCase();
  const extra: string[] = [];
  for (const tag of Object.keys(map)) {
    if (lower.includes(tag)) continue; // the canonical term is already there
    for (const label of labelsOf(tag, map)) {
      if (lower.includes(label.toLowerCase())) {
        extra.push(tag);
        break;
      }
    }
  }
  return extra.length === 0 ? q : `${q} ${extra.join(" ")}`;
}
