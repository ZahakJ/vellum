// NATIVE SPELLCHECK, DRAWN IN VELLUM'S OWN MENU.
//
// The browser already spellchecks the editor, because `client/editor/bidi.ts`
// puts a `lang` on every line whose script disagrees with the document — so an
// Arabic paragraph inside an English note is checked against an Arabic
// dictionary instead of arriving as one unbroken red underline (CONTRACTS.md,
// "Spellcheck answers the LINE, not the note"). What the browser CANNOT do is
// give you the system dictionary: a web page gets whatever Chromium ships, it
// cannot learn a word, and the reader's own dictionary — the one holding their
// colleagues' names and their field's vocabulary — is unreachable.
//
// Electron can, and this file is the two halves of doing it well:
//
//   1. THE LANGUAGES. `setSpellCheckerLanguages` is a whitelist, and a `lang`
//      attribute naming a language that is not on it is simply ignored — so
//      bidi.ts's per-line work is inert unless every language it can emit is
//      enabled here. `shared/script.ts::spellcheckLang` returns exactly four
//      answers (he, fa, ar, or null → inherit the instance's own), so those
//      four plus the instance language are what gets enabled. Enabling a
//      language Chromium has no dictionary for throws, so each is tried
//      against the platform's own list first.
//
//   2. THE MENU. Electron's tutorial answer is a native `Menu` popup, and it
//      is the wrong one HERE. This product has one context menu — `.s-menu`,
//      shared verbatim by the tree, the heading menu and the tab strip, in the
//      instance's own theme, mirrored in Arabic, with the same focus ring and
//      the same Esc — and a grey OS popup landing in the middle of it is two
//      context menus in one app, which CONTRACTS.md calls a bug rather than a
//      feature. So main does not draw anything: it forwards the misspelling,
//      the system's suggestions and the pointer position to the renderer, and
//      `client/desktop/spellMenu.ts` draws `.s-menu`. The reader's choice comes
//      back and is committed with `webContents.replaceMisspelling`, which
//      Chromium delivers as a native `insertReplacementText` — so CodeMirror's
//      own DOM observer applies it, undo history included, and this feature
//      needs no hook into `client/editor/` at all.
//
// macOS is the exception the code has to know about: there the OS owns
// spellchecking, `setSpellCheckerLanguages` is unavailable (it throws), and the
// dictionaries follow the system's own language list. So the languages half is
// skipped there and the menu half is identical.

import type { Session, WebContents } from "electron";

/** Everything `client/editor/bidi.ts` can stamp on a line, via
 *  `shared/script.ts::spellcheckLang`. Kept in this order deliberately:
 *  Chromium checks against the first enabled language that has a dictionary,
 *  and the instance's own language is unshifted onto the front by
 *  `enableSpellcheck` below. */
export const LINE_LANGUAGES = ["he", "fa", "ar"] as const;

/** BCP-47 tags for the instance language. Chromium's list is region-tagged
 *  ("en-US", not "en"), so a bare "en" would be silently dropped — the failure
 *  mode this whole function exists to avoid. Matching is by PREFIX against
 *  whatever the platform actually offers. */
export function resolveLanguages(available: readonly string[], wanted: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of wanted) {
    const exact = available.find((a) => a.toLowerCase() === tag.toLowerCase());
    if (exact) {
      if (!out.includes(exact)) out.push(exact);
      continue;
    }
    const prefixed = available.find((a) => a.toLowerCase().startsWith(`${tag.toLowerCase()}-`));
    if (prefixed && !out.includes(prefixed)) out.push(prefixed);
  }
  return out;
}

/** Turn the spellchecker on for a vault's session, in the languages this vault
 *  can actually contain. Returns the tags that took effect — empty on macOS
 *  (the OS decides) and empty when the build has no dictionaries, which is what
 *  the renderer needs in order not to offer a spelling menu that can never say
 *  anything. */
export function enableSpellcheck(ses: Session, instanceLang: string, enabled: boolean): string[] {
  ses.setSpellCheckerEnabled(enabled);
  if (!enabled) return [];
  // macOS: `setSpellCheckerLanguages` is not implemented and throws. The OS
  // spellchecker is already reading the `lang` attribute, so there is nothing
  // to configure and nothing to report.
  if (process.platform === "darwin") return [];
  try {
    const available = ses.availableSpellCheckerLanguages;
    const tags = resolveLanguages(available, [instanceLang, ...LINE_LANGUAGES]);
    if (tags.length > 0) ses.setSpellCheckerLanguages(tags);
    return tags;
  } catch (err) {
    console.warn("vellum: could not configure the spellchecker:", err);
    return [];
  }
}

export interface SpellMenuPayload {
  word: string;
  suggestions: string[];
  /** Where the pointer was, in CSS pixels within the window — the renderer
   *  places `.s-menu` there with the same clamp the tree's menu uses. */
  x: number;
  y: number;
}

/** Turn a `context-menu` event into the payload the renderer draws, or null
 *  when the right-click was not on a misspelling and Vellum has nothing to add
 *  to whatever menu the page itself opens. */
export function spellMenuFor(params: Electron.ContextMenuParams): SpellMenuPayload | null {
  if (!params.misspelledWord) return null;
  return {
    word: params.misspelledWord,
    // Chromium offers at most three; the renderer draws what it is given
    // rather than padding the list to a fixed height.
    suggestions: params.dictionarySuggestions ?? [],
    x: params.x,
    y: params.y,
  };
}

/** Commit a suggestion. Goes through `replaceMisspelling` — the same call the
 *  native menu would have made — rather than through anything that knows what
 *  a CodeMirror document is. */
export function replaceMisspelling(wc: WebContents, text: string): void {
  wc.replaceMisspelling(text);
}
