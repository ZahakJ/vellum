// Which language a run of text should be SPELLCHECKED in.
//
// The browser chooses its dictionary from the nearest `lang` attribute, so a
// note set as one language is checked as one language — and in a vault where an
// Arabic paragraph sits inside an English note, that means one of the two
// arrives as an unbroken red underline. Obsidian has exactly this failure; it
// is the case this product exists to get right, and the editor already does the
// hard half, because `client/editor/bidi.ts` decides each line's direction from
// its own content. The same scan can answer both questions.
//
// Deliberately NOT a language detector. It reads SCRIPT, which is a property of
// the codepoints and is cheap and total; guessing between French and Spanish
// from Latin letters is a different problem with a much worse failure mode, and
// the answer there — inherit the instance's own language — is already correct
// for the overwhelming majority of lines.

const HEBREW_RE = /[\u0590-\u05ff\ufb1d-\ufb4f]/;
const ARABIC_RE = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
/** The four letters Arabic does not have (پ چ ژ گ) and the two it spells
 *  differently (ک ی, against Arabic's ك ي). Imperfect by nature — a Persian
 *  sentence built only from shared letters reads as Arabic — and still the
 *  difference between the right dictionary and a wall of red. */
const PERSIAN_RE = /[\u067e\u0686\u0698\u06af\u06a9\u06cc]/;

/** A BCP-47 language tag for `text`, or null when the script does not narrow it
 *  and the surrounding document's own language should stand.
 *
 *  Hebrew is tested first because its block does not overlap Arabic's, and
 *  Persian before Arabic because Persian is written in the Arabic script — the
 *  test is for the letters that are Persian's and not Arabic's, so the order is
 *  "narrower first", not "commoner first". */
export function spellcheckLang(text: string): string | null {
  if (HEBREW_RE.test(text)) return "he";
  if (ARABIC_RE.test(text)) return PERSIAN_RE.test(text) ? "fa" : "ar";
  return null;
}
