// ONE numeral policy for the whole instance — client and server share this
// module so a page can never print two numbering systems on one line.
//
// The rule, BY OWNER DECREE (2026-08-24): Western digits everywhere — "15
// أغسطس", "1447 هـ", "3 دقائق قراءة" — including Hijri dates. Arabic locales
// default to Eastern Arabic-Indic numerals in Intl, so this module PINS latn
// rather than merely omitting a preference. An admin who spells a system out
// in the locale (`ar-u-nu-arab`) still keeps exactly what they asked for:
// the pin applies only when the locale names no system of its own.
//
// The module's original sin is worth remembering both times it was rewritten:
// localeDigits() once pinned dates to "arab" while countPhrase() kept counts
// Western, and a single Arabic blog card read "٩ يناير ٢٠٢٦ · 3 دقائق قراءة"
// — two numeral systems inside one line. Whatever the policy is, it lives
// HERE and nowhere else.

export type NumeralSystem = "latn" | "arab";

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

/** True when `locale` is Arabic and names no numbering system of its own. */
export function arabicDefaultDigits(locale: string): boolean {
  return /^ar\b/i.test(locale) && !/-u-.*\bnu-/i.test(locale);
}

/** The numbering system every number on the site is rendered in. Always
 *  "latn" unless the locale itself demands otherwise (`-u-nu-arab`). */
export function numeralSystem(locale: string): NumeralSystem {
  return /-u-.*\bnu-arab\b/i.test(locale) ? "arab" : "latn";
}

/** Intl options that pin the numerals for `locale`. Arabic locales are pinned
 *  to latn EXPLICITLY — Intl would otherwise give them arab digits — and a
 *  locale that names its own system is left alone. */
export function localeDigits(locale: string): { numberingSystem?: string } {
  return arabicDefaultDigits(locale) ? { numberingSystem: "latn" } : {};
}

/** Re-render the ASCII digits in `text` in `system` (identity for "latn").
 *  Applied to already-formatted strings — a count, a year — so grouping and
 *  surrounding copy are untouched. */
export function toNumerals(text: string, system: NumeralSystem): string {
  if (system !== "arab") return text;
  return text.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}
