// THE ONE PLACE A DATE IS FORMATTED for a human on this client.
//
// Four surfaces printed dates before this module existed — blog post meta and
// dashboard cards (blog/util.tsx), marginalia timestamps, moderation rows and
// the backup badge — and each held its own `Intl.DateTimeFormat` call. That
// was survivable while there was one calendar. It is not survivable with
// three: a site set to Hijri that prints "١٤٤٨ صفر ٢" on a post and
// "15 Aug" in the moderation row beside it has told the reader that one of
// the two is a bug, and they would be right.
//
// So every caller goes through `siteDate()`. The CALENDAR comes from settings
// (state.ts pushes it in, exactly as it pushes the language into i18n.ts), the
// numerals come from `shared/numerals.ts` via the locale, the month names come
// from Intl, and the ORDER of the two halves in "both" mode comes from the
// chrome language. Nothing here hand-rolls a month name in either calendar.
//
// RSS is deliberately NOT a caller: `/feed.xml` is a wire format and its
// <pubDate> stays RFC-822 Gregorian whatever this instance displays. A reader
// changing their site's calendar must not change what an aggregator parses.

import {
  DEFAULT_DATE_CALENDAR,
  formatCalendarDate,
  isDateCalendar,
  type DateCalendar,
} from "../shared/dates.ts";
import { getLang } from "./i18n.ts";

let calendar: DateCalendar = DEFAULT_DATE_CALENDAR;

/** state.ts owns this call, from loadMe(), beside setLang/setNumeralLocale. */
export function setDateCalendar(value: unknown): void {
  calendar = isDateCalendar(value) ? value : DEFAULT_DATE_CALENDAR;
}

/** The calendar in force — the settings panel's live preview reads it. */
export function getDateCalendar(): DateCalendar {
  return calendar;
}

/** Format a Date (or an ISO string, or epoch ms) under the instance's
 *  calendar. An unparseable value comes back as the empty string rather than
 *  as "Invalid Date" — a blank meta line is a smaller lie than a broken one. */
export function siteDate(
  value: Date | string | number,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return formatCalendarDate(date, locale, calendar, getLang(), options);
}

/** Same, but forced to one calendar — the settings panel's specimen, which has
 *  to show what each of the three choices would produce. */
export function siteDateIn(
  value: Date | string | number,
  locale: string,
  which: DateCalendar,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return formatCalendarDate(date, locale, which, getLang(), options);
}
