// ONE numeral policy for the whole instance — client and server share this
// module so a page can never print two numbering systems on one line.
//
// The rule: the instance's DATE locale decides. An Arabic locale that names no
// numbering system of its own means Eastern Arabic numerals ("١٥ أغسطس"), and
// then every number the chrome renders beside a date — counts, word totals,
// reading minutes, the footer year — uses the same digits. An admin who spells
// a system out (`ar-EG-u-nu-latn`) keeps exactly what they asked for, and
// again every number follows: one system, everywhere.
//
// Previously localeDigits() pinned dates to "arab" while countPhrase() kept
// counts Western, so a single Arabic blog card read "٩ يناير ٢٠٢٦ · 3 دقائق
// قراءة" — two numeral systems inside one line.

export type NumeralSystem = "latn" | "arab";

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

/** True when `locale` is Arabic and names no numbering system of its own. */
export function arabicDefaultDigits(locale: string): boolean {
  return /^ar\b/i.test(locale) && !/-u-.*\bnu-/i.test(locale);
}

/** The numbering system every number on the site is rendered in. */
export function numeralSystem(locale: string): NumeralSystem {
  return arabicDefaultDigits(locale) ? "arab" : "latn";
}

/** Intl options that pin the numerals for `locale` (empty when it decides). */
export function localeDigits(locale: string): { numberingSystem?: string } {
  return arabicDefaultDigits(locale) ? { numberingSystem: "arab" } : {};
}

/** Re-render the ASCII digits in `text` in `system` (identity for "latn").
 *  Applied to already-formatted strings — a count, a year — so grouping and
 *  surrounding copy are untouched. */
export function toNumerals(text: string, system: NumeralSystem): string {
  if (system !== "arab") return text;
  return text.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}
