// The two per-browser chrome-language preferences, and the one rule that
// decides which of them a session is actually reading in.
//
// TWO PREFERENCES, BECAUSE THEY ANSWER TWO DIFFERENT QUESTIONS. The site
// language (settings.language / SITE_LANG) is an editorial decision about
// what this instance PUBLISHES in. It used to double as the language its
// owner EDITS in, and the visitor switch was applied over the top of it for
// every session — so one tap on the public site's ع rewrote the owner's
// editor, sidebar and command palette too, and on an instance whose
// publicLayout is "app" (no blog shell, therefore no EN/ع control rendered
// anywhere) there was no way back short of clearing localStorage by hand.
// That is the bug these two keys exist to end:
//
//   vellum.editorLang  an ADMIN's own chrome, this browser. Never leaves it,
//                      never reaches a visitor, never changes what is
//                      published. Null means "follow the site language".
//   vellum.lang        a VISITOR's own chrome, this browser. Honoured only
//                      while the instance offers the switch
//                      (settings.languageToggle), so turning the setting off
//                      restores the site language for everyone regardless of
//                      what their browser remembers.
//
// Scope, deliberately narrow, and the same for both: chrome STRINGS and
// DIRECTION only. Note content is never re-directed (it renders per block
// with dir="auto", as authored), and dates/numerals stay on the instance's
// blogLocale — CONTRACTS pins one numbering system per instance, chosen by
// the date locale, and a per-person override of that would put two numeral
// systems on one line again.

import type { Lang } from "./i18n.ts";

const LANG_KEY = "vellum.lang";
const EDITOR_LANG_KEY = "vellum.editorLang";

function read(key: string): Lang | null {
  try {
    const value = localStorage.getItem(key);
    return value === "en" || value === "ar" ? value : null;
  } catch {
    return null;
  }
}

function write(key: string, lang: Lang | null): void {
  try {
    if (lang === null) localStorage.removeItem(key);
    else localStorage.setItem(key, lang);
  } catch {
    // storage full/unavailable — the choice just won't survive a reload
  }
}

/** The visitor's stored choice, or null when they never made one (or storage
 *  is unavailable — a private-mode browser simply gets the site default). */
export function readVisitorLang(): Lang | null {
  return read(LANG_KEY);
}

/** Remember (or, with null, forget) the visitor's choice. */
export function writeVisitorLang(lang: Lang | null): void {
  write(LANG_KEY, lang);
}

/** The admin's own editor chrome, or null for "follow the site language" —
 *  which is both the default and the way back, exactly as `sidebarSidePref`
 *  keeps "auto" reachable rather than letting the first pick be permanent. */
export function readEditorLang(): Lang | null {
  return read(EDITOR_LANG_KEY);
}

/** Remember (or, with null, follow the site again) the admin's editor
 *  language. A device preference, like the theme: it is never sent to the
 *  server and never appears in a Save diff. */
export function writeEditorLang(lang: Lang | null): void {
  write(EDITOR_LANG_KEY, lang);
}

/** Which language THIS session's chrome renders in.
 *
 *  The split is on `admin`, and the server is the one who says so — it
 *  reports `admin: false` for an admin who is previewing as a visitor, which
 *  is precisely right: a preview that kept showing the owner's editor
 *  language would be previewing the wrong site. (Theme mirroring reads the
 *  same flag for the same reason; see state.ts::mirrorTheme.)
 *
 *  Neither preference can reach the other's session, so an Arabic site can be
 *  run from an English editor, and an English site from an Arabic one,
 *  without either choice touching a single published byte. */
export function chromeLang(session: {
  /** A real admin session (false while previewing as a visitor). */
  admin: boolean;
  /** settings.languageToggle — the instance offers the public EN/ع switch. */
  languageToggle: boolean;
  /** settings.language / SITE_LANG, as /api/me reported it. */
  siteLang: Lang;
  /** readEditorLang() */
  editor: Lang | null;
  /** readVisitorLang() */
  visitor: Lang | null;
}): Lang {
  if (session.admin) return session.editor ?? session.siteLang;
  return (session.languageToggle ? session.visitor : null) ?? session.siteLang;
}

export function otherLang(lang: Lang): Lang {
  return lang === "ar" ? "en" : "ar";
}
