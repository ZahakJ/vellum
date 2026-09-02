// ONE calendar policy for the whole instance — client and server share this
// module the way `shared/numerals.ts` is shared, and for the same reason: a
// site that prints a Hijri date on its blog card and a Gregorian one in its
// moderation row has two calendars, not one.
//
// WHY `islamic-umalqura` AND NOT `islamic`.
// Intl offers four Islamic calendars. `islamic` is the *observational* civil
// calendar and its answer drifts by a day between ICU versions and platforms;
// `islamic-civil` and `islamic-tbla` are the two tabular (arithmetic)
// variants, which never drift but are not what any Arabic reader's phone,
// newspaper or bank statement says. `islamic-umalqura` is the Umm al-Qura
// calendar of Saudi Arabia — the one printed on the calendars people actually
// own, pre-computed in ICU from the official tables rather than recomputed
// from a lunar model, so two machines agree. It is the only choice that is
// both stable and recognisable, so it is the one hard-coded here: this is a
// display convention, not a preference with a long tail.
//
// The numerals still come from `shared/numerals.ts` and the month NAMES still
// come from Intl. Nothing here hand-rolls a month table: "رمضان" spelled by
// hand is a spelling this codebase would then own forever, in every locale.

import { localeDigits } from "./numerals.ts";

/** Which calendar human-facing dates are rendered in.
 *  - `gregorian` (default) — unchanged behaviour.
 *  - `hijri` — Umm al-Qura only.
 *  - `both` — one calendar with the other parenthesised beside it, ordered by
 *    the SITE LANGUAGE (Arabic leads with the Hijri date, English with the
 *    Gregorian one). */
export type DateCalendar = "gregorian" | "hijri" | "both";

export const DEFAULT_DATE_CALENDAR: DateCalendar = "gregorian";

/** The Intl calendar id every Hijri date in this product is formatted with. */
export const HIJRI_CALENDAR = "islamic-umalqura";

export function isDateCalendar(value: unknown): value is DateCalendar {
  return value === "gregorian" || value === "hijri" || value === "both";
}

// The secondary half of a "both" rendering is a foreign run inside a sentence
// whose direction it does not share — a Latin "(14 August 2026)" spliced into
// an Arabic line reorders its own parentheses against the base direction. FSI…
// PDI is the same isolate `tf()` applies to every interpolated value; the
// parentheses go INSIDE it so they belong to the run they enclose.
const FSI = "⁨";
const PDI = "⁩";

/** Format `date` in one calendar. Falls back to the plain Gregorian rendering
 *  (and then to `en`) rather than throwing at render time — a bad BCP47 tag or
 *  an ICU build with no Umm al-Qura data must not blank a blog card. */
function formatOne(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  hijri: boolean,
): string {
  const opts: Intl.DateTimeFormatOptions = {
    ...options,
    ...localeDigits(locale),
    ...(hijri ? { calendar: HIJRI_CALENDAR } : {}),
  };
  try {
    return new Intl.DateTimeFormat(locale, opts).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, ...localeDigits(locale) }).format(date);
    } catch {
      return new Intl.DateTimeFormat("en", options).format(date);
    }
  }
}

/** Intl locale that supplies month names (and relative-time words).
 *
 *  Chrome language wins: an English visitor on an Arabic instance must read
 *  "14 August 2026", not "14 أغسطس 2026". Digits still come from
 *  `localeDigits()` so the instance numeral policy is unchanged.
 *  A regional tag is kept only when it already matches the chrome language
 *  (`en-GB` stays `en-GB` for English; `ar-EG` stays for Arabic). */
export function dateNamesLocale(blogLocale: string, lang: "en" | "ar"): string {
  const tag = blogLocale.trim() || lang;
  if (lang === "en") return /^en\b/i.test(tag) ? tag : "en";
  return /^ar\b/i.test(tag) ? tag : "ar";
}

/** Render `date` under the instance's calendar setting.
 *
 *  `lang` is the chrome language: it orders the two halves in `"both"` mode
 *  AND (via `dateNamesLocale`) picks the month names. Digits still follow
 *  `localeDigits` on that tag. */
export function formatCalendarDate(
  date: Date,
  locale: string,
  calendar: DateCalendar,
  lang: "en" | "ar",
  options: Intl.DateTimeFormatOptions,
): string {
  if (Number.isNaN(date.getTime())) return "";
  if (calendar === "gregorian") return formatOne(date, locale, options, false);
  if (calendar === "hijri") return formatOne(date, locale, options, true);
  const hijriFirst = lang === "ar";
  const primary = formatOne(date, locale, options, hijriFirst);
  const secondary = formatOne(date, locale, options, !hijriFirst);
  if (secondary === "" || secondary === primary) return primary;
  return `${primary} ${FSI}(${secondary})${PDI}`;
}
