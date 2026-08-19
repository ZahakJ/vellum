// Searching the settings panel — the part with no JSX in it.
//
// Split from `SettingsSearch.tsx` for a plain reason: Node strips types from a
// `.ts` file and refuses a `.tsx`, so logic that sits beside a component cannot
// be unit-tested at all. The matching rule here is the whole feature — what
// counts as a hit, and what order the hits come back in — and it is exactly the
// part worth pinning.

import { t } from "../../i18n.ts";
import { SETTINGS_INDEX, type SettingEntry } from "./settingsIndex.ts";

/** Casefold, strip Arabic diacritics and tatweel, and unify the letters Arabic
 *  spells more than one way. The same fold the book reader's search uses, for
 *  the same reason: a reader types what they hear. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ْـٰ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[̀-ͯ]/g, "");
}

export interface SettingHit {
  entry: SettingEntry;
  label: string;
}

export function searchSettings(query: string): SettingHit[] {
  const q = fold(query.trim());
  if (q === "") return [];
  const hits: { hit: SettingHit; rank: number }[] = [];
  for (const entry of SETTINGS_INDEX) {
    const label = t(entry.label);
    const hint = entry.hint === undefined ? "" : t(entry.hint);
    const env = entry.env ?? "";
    const inLabel = fold(label).includes(q);
    const inEnv = fold(env).includes(q);
    const inHint = fold(hint).includes(q);
    if (!inLabel && !inEnv && !inHint) continue;
    // A label match is what the reader meant; a help match is a hint that they
    // are close. Ranking rather than filtering, because the help sentence is
    // often where the WORD they are searching for actually lives.
    hits.push({ hit: { entry, label }, rank: inLabel ? 0 : inEnv ? 1 : 2 });
  }
  return hits.sort((a, b) => a.rank - b.rank).map((h) => h.hit);
}
