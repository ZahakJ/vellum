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
 *  spells more than one way — a reader types what they hear.
 *
 *  CHARACTER MAP FIRST, normalize never. The first version ran `.normalize
 *  ("NFKD")` and THEN replaced the hamza-alef family — but NFKD had already
 *  decomposed those alefs into bare alef + a combining hamza (U+0654/0655),
 *  which neither the harakat class nor the Latin combining class stripped. The
 *  fold was a complete no-op: searching a bare-alef spelling found nothing a
 *  hamza-spelled label offered, which is precisely the "reader concludes the
 *  setting does not exist" failure this module exists to prevent — and the
 *  test comparing the two spellings passed vacuously, two empty lists agreeing
 *  with each other. The map below is the book reader's own (search.ts), which
 *  was right all along. */
const ARABIC_FOLD: Record<string, string> = {
  "\u0623": "\u0627", // alef with hamza above  -> alef
  "\u0625": "\u0627", // alef with hamza below  -> alef
  "\u0622": "\u0627", // alef with madda        -> alef
  "\u0671": "\u0627", // alef wasla             -> alef
  "\u0649": "\u064a", // alef maksura           -> yeh
  "\u06cc": "\u064a", // Persian yeh            -> yeh
  "\u0629": "\u0647", // teh marbuta            -> heh
  "\u06a9": "\u0643", // Persian keheh          -> kaf
};

function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    if (/[\u064b-\u0652\u0640\u0670]/.test(ch)) continue; // harakat + tatweel
    out += ARABIC_FOLD[ch] ?? ch.toLowerCase();
  }
  return out;
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
