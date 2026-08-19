// NATIVE FIND-IN-PAGE — the other search.
//
// Ctrl/Cmd F is CodeMirror's find: the open note's TEXT, in the editor, with
// the editor's own match model. This one is Chromium's, and it searches what is
// actually on screen — the reading view, the outline, the backlinks panel, a
// transclusion, the tab strip — which is the half the editor's search
// structurally cannot reach, because none of that is in the document it holds.
// Two verbs, two keys (Ctrl/Cmd+Shift+F, from the native menu), no overlap.
//
// The bar is drawn here rather than by Electron because Electron does not draw
// one: `findInPage` returns matches and highlights them, and every app that
// uses it builds its own field. Ours is built from the app's tokens so it is
// the same room.

import { localeNum, t } from "../i18n.ts";
import { desktop, type FindResult } from "./bridge.ts";
import "./desktop.css";

let bar: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let count: HTMLElement | null = null;

function button(label: string, aria: string, cls: string, run: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `s-find__btn ${cls}`;
  btn.textContent = label;
  btn.setAttribute("aria-label", aria);
  btn.addEventListener("click", run);
  return btn;
}

/** Report what the last search found. Called from the bridge subscription. */
export function showFindResult(result: FindResult): void {
  if (!count) return;
  // Digits and a slash: no copy, and the instance's own numerals, so an Arabic
  // instance counts matches in ٣/١٧ like it counts everything else.
  count.textContent = result.matches === 0 ? "" : `${localeNum(result.active)}/${localeNum(result.matches)}`;
}

export function closeFindBar(): void {
  void desktop()?.findStop();
  bar?.remove();
  bar = null;
  input = null;
  count = null;
}

/** Open the bar (or focus and select it if it is already up — pressing the key
 *  again is "search for something else", never "close it"). */
export function openFindBar(): void {
  const bridge = desktop();
  if (!bridge) return;
  if (bar && input) {
    input.focus();
    input.select();
    return;
  }

  bar = document.createElement("div");
  bar.className = "s-find";
  bar.setAttribute("role", "search");

  input = document.createElement("input");
  input.className = "s-find__input";
  input.type = "text";
  input.placeholder = t("menuFindInPage");
  input.spellcheck = false;
  input.dir = "auto"; // a query is content, and may be in either script

  count = document.createElement("span");
  count.className = "s-find__count";
  count.setAttribute("aria-live", "polite");

  const search = (forward: boolean, again: boolean): void => {
    const query = input?.value ?? "";
    void bridge.findInPage(query, forward, again);
    if (query === "" && count) count.textContent = "";
  };

  input.addEventListener("input", () => search(true, false));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      search(!ev.shiftKey, true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeFindBar();
    }
  });

  bar.append(
    input,
    count,
    // The menu's own words rather than the find panel's: these are button
    // labels standing alone, where `cmPrevious`/`cmNext` are lower-case because
    // their other caller sets them inside a sentence.
    button("‹", t("menuFindPrevious"), "s-find__btn--prev", () => search(false, true)),
    button("›", t("menuFindNext"), "s-find__btn--next", () => search(true, true)),
    button("✕", t("close"), "s-find__btn--close", closeFindBar),
  );
  document.body.appendChild(bar);
  input.focus();
}
