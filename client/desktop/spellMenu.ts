// THE SYSTEM DICTIONARY, IN VELLUM'S OWN MENU.
//
// Electron's documented answer to `context-menu` with a `misspelledWord` is to
// build a native `Menu` and pop it up. That is the wrong menu HERE. This
// product has exactly one context menu — `.s-menu`, shared verbatim by the
// tree, the tab strip and the heading menu (client/sectionMenu.ts), painted in
// the instance's theme, mirrored in Arabic, with the same focus ring and the
// same Esc — and CONTRACTS.md is explicit that two context menus which look
// different in one app is a bug rather than a feature. A grey OS popup landing
// inside a candlelit manuscript room is exactly that bug, and it would land on
// the surface a writer uses most.
//
// So the main process forwards the misspelling and the system's suggestions
// (electron/spellcheck.ts) and this draws them. The chrome, the clamp, the
// keyboard model and the dismissal are the heading menu's, deliberately
// copied in shape rather than shared through an export: `sectionMenu.ts` opens
// a menu ABOUT A SECTION, takes a note path and a heading line, and rewrites
// the file. This one takes a word.
//
// What comes back goes to `webContents.replaceMisspelling`, so the edit lands
// as a native `insertReplacementText` and CodeMirror's own DOM observer applies
// it — undo history included. Nothing in client/editor/ knows this file exists.

import { t } from "../i18n.ts";
import { desktop, type SpellMenuPayload } from "./bridge.ts";

/** The margin every menu in this product keeps from a viewport edge. */
const EDGE = 8;

let open: HTMLElement | null = null;

export function closeSpellMenu(): void {
  open?.remove();
  open = null;
}

function row(menu: HTMLElement, label: string, run: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "s-menu__item";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    closeSpellMenu();
    run();
  });
  menu.appendChild(btn);
  return btn;
}

export function openSpellMenu(payload: SpellMenuPayload): void {
  const bridge = desktop();
  if (!bridge) return;
  closeSpellMenu();

  const menu = document.createElement("div");
  menu.className = "s-menu s-menu--spell";
  menu.setAttribute("role", "menu");
  // The misspelled word is CONTENT, not chrome: it may be Arabic in an English
  // instance or the reverse, so it gets its own direction like every other
  // note-derived string in the product.
  menu.style.position = "fixed";

  const head = document.createElement("div");
  head.className = "s-menu__title";
  head.textContent = payload.word;
  head.dir = "auto";
  menu.appendChild(head);

  if (payload.suggestions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "s-menu__title s-menu__title--empty";
    empty.textContent = t("menuNoSuggestions");
    menu.appendChild(empty);
  }
  for (const suggestion of payload.suggestions) {
    const btn = row(menu, suggestion, () => void bridge.spellReplace(suggestion));
    btn.dir = "auto";
  }

  const sep = document.createElement("div");
  sep.className = "s-menu__sep";
  sep.setAttribute("role", "separator");
  menu.appendChild(sep);
  // The word goes into a plain file in the vault, so proper nouns and
  // transliterations travel through the same git remote as the notes that
  // needed them.
  row(menu, t("menuAddToDictionary"), () => void bridge.spellAdd(payload.word));

  menu.style.left = `${payload.x}px`;
  menu.style.top = `${payload.y}px`;
  document.body.appendChild(menu);
  open = menu;

  // Clamped after mount, because the height depends on how many suggestions
  // the system offered — which is between zero and three and not knowable
  // before. Opens toward the reading direction and folds back at the edge, the
  // rule the tree's menu set.
  const rect = menu.getBoundingClientRect();
  const rtl = getComputedStyle(document.documentElement).direction === "rtl";
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let left = rtl ? payload.x - rect.width : payload.x;
  if (left + rect.width > vw - EDGE) left = payload.x - rect.width;
  if (left < EDGE) left = payload.x;
  let top = payload.y;
  if (top + rect.height > vh - EDGE) top = payload.y - rect.height;
  menu.style.left = `${Math.max(EDGE, Math.min(left, vw - rect.width - EDGE))}px`;
  menu.style.top = `${Math.max(EDGE, Math.min(top, vh - rect.height - EDGE))}px`;

  menu.querySelector<HTMLElement>(".s-menu__item")?.focus();

  const onAway = (ev: Event): void => {
    if (ev.target instanceof Node && menu.contains(ev.target)) return;
    dismiss();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      dismiss();
      return;
    }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const items = [...menu.querySelectorAll<HTMLElement>(".s-menu__item")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    ev.preventDefault();
    const next = ev.key === "ArrowDown" ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  };
  const dismiss = (): void => {
    window.removeEventListener("mousedown", onAway, true);
    window.removeEventListener("contextmenu", onAway, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", dismiss);
    closeSpellMenu();
  };
  window.addEventListener("mousedown", onAway, true);
  window.addEventListener("contextmenu", onAway, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", dismiss);
}
