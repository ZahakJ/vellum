// The native menu's words — and there is ONE dictionary, which is
// `client/i18n.ts`.
//
// This file used to carry its own copy of all 63, because the stage that built
// the desktop app could not edit the client's dictionary and a menu bar reading
// "File / Edit / View" over a fully mirrored Arabic window would have been the
// largest untranslated surface in the product. Two copies were kept in step by
// a gate. That was scaffolding, and its own header said so: the end state is
// these keys living in `DICT`, `check-i18n` walking `electron/` as well as
// `client/`, and this file becoming a re-export. All three have now happened.
//
// What survives here is the part that is genuinely the MENU's and not the
// dictionary's: the application menu is global OS state, so its language is
// SET rather than passed down, and it is learned from `GET /api/me` once a
// vault's server answers (see main.ts). The client's own `setLang` drives the
// renderer; this drives the menu, in the same process that draws it.
//
// `client/i18n.ts` imports cleanly under plain Node — it touches no DOM at
// module scope — which is what makes the re-export possible at all.

import { getLang, setLang, t, tf, type I18nKey } from "../client/i18n.ts";

export type MenuKey = I18nKey;

type Lang = "en" | "ar";

/** The instance language. The menu is rebuilt after it changes. */
export function setMenuLang(lang: Lang): void {
  setLang(lang);
}

export function menuLang(): Lang {
  return getLang();
}

/** True when the chrome is mirrored. The menu uses it for one thing only:
 *  ordering a submenu's separators is not direction-dependent, but the WINDOW
 *  title is ("خزانة — ڤيلوم"). */
export function menuRtl(): boolean {
  return getLang() === "ar";
}

export function m(key: MenuKey): string {
  return t(key);
}

/** `m()` with `{placeholders}` filled. */
export function mf(key: MenuKey, vars: Record<string, string | number>): string {
  return tf(key, vars);
}
