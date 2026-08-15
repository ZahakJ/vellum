// The visitor's own chrome language, when the instance offers the switch
// (settings.languageToggle). It lives in THIS browser's localStorage and
// nowhere else: the site keeps its configured language for everyone who never
// touches the switch, and a reader who prefers the other one keeps it across
// visits without an account.
//
// Scope, deliberately narrow: chrome STRINGS and DIRECTION only. Note content
// is never re-directed (it renders per block with dir="auto", as authored),
// and dates/numerals stay on the instance's blogLocale — CONTRACTS pins one
// numbering system per instance, chosen by the date locale, and a per-visitor
// override of that would put two numeral systems on one line again.

import type { Lang } from "./i18n.ts";

const LANG_KEY = "vellum.lang";

/** The visitor's stored choice, or null when they never made one (or storage
 *  is unavailable — a private-mode browser simply gets the site default). */
export function readVisitorLang(): Lang | null {
  try {
    const value = localStorage.getItem(LANG_KEY);
    return value === "en" || value === "ar" ? value : null;
  } catch {
    return null;
  }
}

/** Remember (or, with null, forget) the visitor's choice. */
export function writeVisitorLang(lang: Lang | null): void {
  try {
    if (lang === null) localStorage.removeItem(LANG_KEY);
    else localStorage.setItem(LANG_KEY, lang);
  } catch {
    // storage full/unavailable — the choice just won't survive a reload
  }
}

export function otherLang(lang: Lang): Lang {
  return lang === "ar" ? "en" : "ar";
}
