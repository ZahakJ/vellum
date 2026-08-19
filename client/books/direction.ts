// WHICH WAY THE BOOK IS BOUND.
//
// A PDF does not say. There is no /Direction key, no metadata field, nothing —
// which is why almost every reader in existence gets Arabic and Hebrew books
// wrong in dual-page mode, putting page 3 to the right of page 2 in a volume
// whose spine is on the other side. The only evidence available is the text
// itself, so that is what this reads.
//
// Deliberately a SCRIPT test and not a language detector, exactly as
// shared/script.ts argues: the question "is this book bound right to left" is
// answered by the script it is set in, and the codepoints answer that cheaply
// and totally. A mixed volume — an Arabic edition with an English preface —
// is decided by the majority, which is the correct answer for a binding.
//
// And it is a GUESS, so it is only ever the initial value: the reader's `:ltr`
// or `:rtl` is stored in the book's state and outranks this forever after.

/** Arabic, Hebrew, Syriac, Thaana, N'Ko and the presentation forms. */
const RTL_RE = new RegExp(
  "[" +
    "\\u0590-\\u05ff" + // Hebrew
    "\\u0600-\\u06ff" + // Arabic
    "\\u0700-\\u074f" + // Syriac
    "\\u0780-\\u07bf" + // Thaana
    "\\u07c0-\\u07ff" + // N'Ko
    "\\u0870-\\u089f" + // Arabic Extended-B
    "\\u08a0-\\u08ff" + // Arabic Extended-A
    "\\ufb1d-\\ufb4f" + // Hebrew presentation forms
    "\\ufb50-\\ufdff" + // Arabic presentation forms A
    "\\ufe70-\\ufeff" + // Arabic presentation forms B
    "]",
  "g",
);

/** Latin, Greek and Cyrillic letters — the counter-evidence. Digits and
 *  punctuation are deliberately NOT counted: an Arabic page is full of Latin
 *  page numbers, footnote markers and DOIs, and counting those would call
 *  every Arabic book left-to-right. */
const LTR_RE = new RegExp("[A-Za-z\\u00c0-\\u024f\\u0370-\\u03ff\\u0400-\\u04ff]", "g");

/** How decisive the majority has to be. A page of Arabic prose is >90% RTL
 *  letters; an English book quoting a hadith is a few percent. Anything in
 *  between is a bilingual edition, and the tie is broken towards
 *  left-to-right — the direction that is right for more books, and the one a
 *  reader is less surprised by when they have to correct it. */
const MAJORITY = 0.4;

/**
 * Is this book bound right to left, judged from a sample of its text?
 *
 * The caller passes text from a handful of pages taken from the MIDDLE of the
 * book (see BookReader), not the first: front matter is where a translator's
 * note, a copyright page and a Library of Congress block live, and all three
 * are in English in books that are not.
 */
export function detectRtl(sample: string): boolean {
  const rtl = (sample.match(RTL_RE) ?? []).length;
  const ltr = (sample.match(LTR_RE) ?? []).length;
  const total = rtl + ltr;
  if (total < 20) return false; // a scanned book with no text layer says nothing
  return rtl / total >= MAJORITY;
}
