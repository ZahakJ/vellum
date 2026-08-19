// FINDING A PHRASE IN A PAGE OF A PDF.
//
// `/` in the reader runs this over the text pdf.js extracts from each page,
// and then runs it AGAIN over the DOM of the rendered text layer to turn the
// hit into a Range it can highlight. Both passes call the same function on the
// same normalization, which is the only reason the second pass finds the same
// k-th match as the first.
//
// Plain `indexOf` on a lowercased haystack answers this badly, and it answers
// it worst in the language this product is translated into:
//
//   · PDF text carries diacritics. "الْمُقَدِّمَة" and "المقدمة" are the same
//     word — the first is the same book with its harakat printed — and a
//     reader who types the second and is told "no matches" concludes the
//     search is broken, which it is. Latin has the same problem in a smaller
//     coat: "résumé" typed as "resume".
//   · Arabic orthography varies where it does not matter: أ إ آ ا are one
//     letter for search purposes, as are ى/ي and ة/ه.
//   · Tatweel (ـــ) is a typographic stretch, not a letter.
//   · Extraction inserts line breaks where the PAGE broke a line, not where
//     the sentence did, so one space in the query must match a newline.
//
// So matching is done character by character through a fold, with the crucial
// property that MATCHES ARE REPORTED IN ORIGINAL-STRING OFFSETS: the fold is
// consulted, never materialized, so a hit can be turned back into a DOM Range
// over the untouched text. A "normalize then indexOf" approach cannot do that
// — the offsets no longer point at anything real — and that is the whole
// reason this is thirty lines of scanning rather than one line of indexOf.
//
// Pure logic, no DOM: tests/books.test.ts drives exactly this code.

export interface Match {
  /** Offsets into the ORIGINAL haystack — usable to build a Range. */
  start: number;
  end: number;
}

/** Characters skipped entirely when they appear in the haystack: they carry no
 *  identity a reader searches by. Arabic harakat and the superscript alef,
 *  tatweel, the combining-diacritic block Latin uses, the zero-width joiners
 *  Persian and Indic scripts sprinkle through text, and the soft hyphen a
 *  typesetter leaves at a line break. */
const IGNORABLE = new RegExp(
  "[" +
    "\u0300-\u036f" + // combining diacritical marks (Latin, Greek, Cyrillic)
    "\u064b-\u0655" + // Arabic harakat, shadda, sukun, maddah, hamza above/below
    "\u0670" + //        superscript alef
    "\u06d6-\u06ed" + // Quranic annotation and pause marks
    "\u0640" + //        tatweel — a typographic stretch, not a letter
    "\u200b-\u200f" + // zero-width space/joiners and the bidi marks
    "\u00ad" + //        soft hyphen, left behind by a line break
    "\ufeff" + //        zero-width no-break space
    "]",
);

/** Letters that are the same letter for the purpose of finding a word. The
 *  Arabic set is the one every Arabic search box in the world folds; a reader
 *  types أ or ا interchangeably and means the same thing. */
const FOLD: Record<string, string> = {
  "\u0623": "\u0627", // alef with hamza above  -> alef
  "\u0625": "\u0627", // alef with hamza below  -> alef
  "\u0622": "\u0627", // alef with madda        -> alef
  "\u0671": "\u0627", // alef wasla             -> alef
  "\u0649": "\u064a", // alef maksura           -> yeh
  "\u06cc": "\u064a", // Persian yeh            -> yeh
  "\u0629": "\u0647", // teh marbuta            -> heh
  "\u06a9": "\u0643", // Persian keheh          -> kaf
};

/** One character folded to what it counts as. Whitespace of every kind — the
 *  line breaks extraction invents included — collapses to a single space. */
function fold(ch: string): string {
  if (/\s/.test(ch)) return " ";
  const mapped = FOLD[ch];
  if (mapped !== undefined) return mapped;
  const lower = ch.toLowerCase();
  // Some lowercase mappings are longer than their input (İ → i + U+0307).
  // Length must be preserved or offsets stop meaning anything, so those keep
  // their original form — they are vanishingly rare in a book and a wrong
  // offset is not.
  return lower.length === 1 ? lower : ch;
}

export function isIgnorableChar(ch: string): boolean {
  return IGNORABLE.test(ch);
}

/** The query, folded and with its whitespace collapsed. Empty when the query
 *  is nothing but ignorable characters — which `findMatches` treats as "no
 *  query" rather than as "matches everywhere". */
export function foldQuery(query: string): string {
  let out = "";
  for (const ch of query) {
    if (isIgnorableChar(ch)) continue;
    const f = fold(ch);
    if (f === " " && out.endsWith(" ")) continue;
    out += f;
  }
  return out.trim();
}

/**
 * Every occurrence of `query` in `haystack`, as offsets into `haystack`.
 *
 * Matches never overlap: the scan resumes after the end of the previous hit,
 * so searching "aa" in "aaaa" finds two, which is what `n` stepping through
 * hits has to mean.
 */
export function findMatches(haystack: string, query: string, limit = 5000): Match[] {
  // Code points, not UTF-16 units: a needle carrying an astral character
  // (a book title in Old Turkic, an emoji in a footnote) must compare one
  // character at a time or the halves of a surrogate pair meet letters.
  const needle = [...foldQuery(query)];
  if (needle.length === 0) return [];
  const chars = [...haystack];
  // Code-point index → offset in the original string. Built once: an Arabic
  // book is full of characters outside the BMP's single-unit range, and a
  // Range built from a code-point count lands in the wrong place.
  const offsets: number[] = [];
  let at = 0;
  for (const ch of chars) {
    offsets.push(at);
    at += ch.length;
  }
  offsets.push(at);

  const out: Match[] = [];
  let i = 0;
  while (i < chars.length && out.length < limit) {
    const end = matchAt(chars, i, needle);
    if (end === -1) {
      i += 1;
      continue;
    }
    out.push({ start: offsets[i], end: offsets[end] });
    // A match of nothing cannot happen (the needle is non-empty after folding)
    // but a match that consumed only ignorables could loop, so always advance.
    i = Math.max(end, i + 1);
  }
  return out;
}

/** Does `needle` (already folded) start at code-point index `from`? Returns
 *  the code-point index just past the match, or -1. */
function matchAt(chars: string[], from: number, needle: string[]): number {
  let i = from;
  let n = 0;
  // A match may not BEGIN on an ignorable character: "المقدمة" must be found
  // at the alef, not at the fatha in front of it, or the highlight starts one
  // invisible character early and a screen reader announces the wrong word.
  if (i < chars.length && isIgnorableChar(chars[i])) return -1;
  while (n < needle.length) {
    if (i >= chars.length) return -1;
    const ch = chars[i];
    if (isIgnorableChar(ch)) {
      i += 1;
      continue;
    }
    const f = fold(ch);
    if (f === " " && needle[n] === " ") {
      // One space in the query eats a whole run of whitespace in the page.
      i += 1;
      while (i < chars.length && (fold(chars[i]) === " " || isIgnorableChar(chars[i]))) i += 1;
      n += 1;
      continue;
    }
    if (f !== needle[n]) return -1;
    i += 1;
    n += 1;
  }
  return i;
}
