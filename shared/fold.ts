// WHAT COUNTS AS THE SAME LETTER — one table, every search box in the product.
//
// Obsidian's eighth most-requested feature of all time is "search should ignore
// diacritics", and it matters more here than it does there: this product is
// half Arabic, and Arabic text that has been vowelled — a Qur'anic quotation, a
// classical text, anything a careful typist pointed — is unreachable from the
// spelling every reader actually types. «الْمُقَدِّمَة» and «المقدمة» are the
// same word; a search box that answers "no matches" for the second is not
// strict, it is broken. Latin has the same problem in a smaller coat: résumé,
// naïve, café.
//
// The table was written for the PDF reader (client/books/search.ts) and lived
// there for two releases. It is here now because three unrelated matchers need
// exactly the same answer and a fold that disagrees with itself between the
// note index and the reader is worse than no fold at all:
//
//   · the vault index (minisearch `processTerm`, server/indexer.ts) — index
//     side AND query side, which is the only way "type it plain, find it
//     pointed" can hold;
//   · the line scanner under a search hit (searchMatches) and the vault-wide
//     replace built on it — both of which need OFFSETS into the untouched
//     text, which is why `findMatches` consults the fold rather than
//     materialising it;
//   · the two client-side matchers that never touch the index at all — `[[`
//     autocomplete and the command palette's note rows.
//
// THREE DOORS, DELIBERATELY. `foldTerm` is for a token being filed or looked
// up (ignorables gone, length irrelevant). `foldKeep` is for a matcher that
// reports INDICES into its input (same length in, same length out, ignorables
// left standing — a subsequence match walks past them anyway). `findMatches` is
// for a scanner that needs original-string offsets it can turn back into a
// Range or a byte edit. Picking the wrong one is how a highlight lands one
// invisible character early.

export interface Match {
  /** Offsets into the ORIGINAL haystack — usable to build a Range, or to
   *  splice bytes for a replace. */
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

/** A PRECOMPOSED letter reduced to its base — `é` → `e`, `ï` → `i`, `ñ` → `n`.
 *
 *  The IGNORABLE block above only ever saw DECOMPOSED text: `e` followed by
 *  U+0301, which is what pdf.js hands back and what this table was written for.
 *  A filename typed on a Mac, a note pasted out of a browser, almost anything
 *  that has been through NFC normalisation carries `é` as ONE code point
 *  instead, and the fold sailed straight past it — so `resume` found `Resume.md`
 *  by its title and missed the `résumé` in the sentence, which is exactly the
 *  half of the promise a reader would notice.
 *
 *  NFD, then the base, and only when the tail is all COMBINING MARKS: Hangul
 *  syllables also decompose, into jamo that are letters in their own right, and
 *  keeping `d[0]` there would fold every syllable onto its initial consonant.
 *  The base must also be the same length as the input, because two of this
 *  module's three doors report offsets or preserve length. */
function baseLetter(ch: string): string {
  const parts = [...ch.normalize("NFD")];
  if (parts.length < 2 || parts[0].length !== ch.length) return ch;
  return parts.slice(1).every((mark) => /\p{Mn}/u.test(mark)) ? parts[0] : ch;
}

/** One character folded to what it counts as. Whitespace of every kind — the
 *  line breaks extraction invents included — collapses to a single space. */
export function foldChar(ch: string): string {
  if (/\s/.test(ch)) return " ";
  const mapped = FOLD[ch];
  if (mapped !== undefined) return mapped;
  const lower = baseLetter(ch).toLowerCase();
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
    const f = foldChar(ch);
    if (f === " " && out.endsWith(" ")) continue;
    out += f;
  }
  return out.trim();
}

/** ONE TOKEN, folded for filing or for lookup — minisearch's `processTerm` on
 *  both sides of the index, and the tag/alias tables beside it.
 *
 *  Ignorables are DROPPED, which is exactly what makes the feature work: the
 *  pointed «الْمُقَدِّمَة» and the plain «المقدمة» are filed under one key, so
 *  the plain spelling finds the pointed note and the pointed spelling finds the
 *  plain one. A term that folds away to nothing (a lone shadda, a stray
 *  zero-width joiner) returns "" and the caller drops it — indexing an empty
 *  term is how a query for nothing matches everything. */
export function foldTerm(term: string): string {
  let out = "";
  for (const ch of term) {
    if (isIgnorableChar(ch)) continue;
    out += foldChar(ch);
  }
  return out;
}

/** The same fold, LENGTH PRESERVED — for a matcher that hands back indices
 *  into what it was given (the palette's highlight marks, and any tier test
 *  computed beside them).
 *
 *  Ignorables stay where they are rather than being removed, because removing
 *  one shifts every index after it and the `<mark>` lands on the wrong glyph.
 *  Nothing is lost by keeping them: the matchers that use this door are
 *  subsequence matchers, and a subsequence walks past a fatha without noticing
 *  it. What the fold buys them is the LETTER families — أ/ا, ى/ي, ة/ه — where a
 *  substring or prefix test would otherwise fail on a spelling difference the
 *  reader does not believe in. */
export function foldKeep(text: string): string {
  let out = "";
  for (const ch of text) out += isIgnorableChar(ch) ? ch : foldChar(ch);
  return out;
}

/**
 * Every occurrence of `query` in `haystack`, as offsets into `haystack`.
 *
 * Matches never overlap: the scan resumes after the end of the previous hit,
 * so searching "aa" in "aaaa" finds two, which is what `n` stepping through
 * hits has to mean.
 *
 * THE FOLD IS CONSULTED, NEVER MATERIALIZED. A "normalize then indexOf"
 * approach cannot report offsets that point at anything real — and both callers
 * need real ones: the reader turns a hit into a DOM Range over untouched text,
 * and the vault-wide replace splices bytes at exactly these positions.
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

/** Every occurrence of ANY of `needles`, merged into one sorted run of
 *  non-overlapping ranges.
 *
 *  This is what a multi-word query needs from a line: "resume café" wants both
 *  words marked, and marking them with two independent passes produces
 *  overlapping `<mark>` spans the moment one term is a prefix of another. The
 *  longest match starting at a position wins, and the scan resumes past it —
 *  the same rule `findMatches` uses within one needle, applied across them. */
export function findAnyMatches(
  haystack: string,
  needles: readonly string[],
  limit = 5000,
): Match[] {
  const all: Match[] = [];
  for (const needle of needles) all.push(...findMatches(haystack, needle, limit));
  if (all.length < 2) return all;
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Match[] = [];
  for (const m of all) {
    const last = out[out.length - 1];
    if (last !== undefined && m.start < last.end) continue;
    out.push(m);
    if (out.length >= limit) break;
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
    const f = foldChar(ch);
    if (f === " " && needle[n] === " ") {
      // One space in the query eats a whole run of whitespace in the page.
      i += 1;
      while (i < chars.length && (foldChar(chars[i]) === " " || isIgnorableChar(chars[i]))) i += 1;
      n += 1;
      continue;
    }
    if (f !== needle[n]) return -1;
    i += 1;
    n += 1;
  }
  return i;
}
