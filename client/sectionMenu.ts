// The heading menu — one box, opened from three surfaces.
//
// Every heading in Vellum answers a right-click, and in the editor it also
// carries a ⋯ affordance beside its fold chevron. Both open THIS menu, and so
// does a right-click on an outline row, because an outline row IS a heading
// and a reader who has just dragged one has their pointer on it already.
//
// Built imperatively on `<body>` rather than as a React component for the same
// reason `toast.ts` and the theme picker are: it is opened from CodeMirror
// widget DOM, from a React panel and from the reading view's imperative
// renderer, and a portal that three component trees can reach is a portal that
// belongs to none of them. It reuses the tree's `.s-menu` chrome verbatim —
// two context menus that look different in one app are a bug, not a feature.
//
// The clamp is the tree's rule too (CONTRACTS, "the tree's context menu"): the
// pointer is regularly at the TRAILING screen edge — the outline pane lives
// there in English and the notes sidebar in Arabic — so the box opens toward
// the reading direction, folds back when that edge has no room, and clamps
// both axes to an 8px margin. Measured after mount, because its height depends
// on how many rows the calling surface offers.

import { t } from "./i18n.ts";
import {
  copySectionLink,
  copySectionMarkdown,
  extractSection,
  noteContent,
} from "./sectionActions.ts";
import { sectionAtHeading, sectionsOf, type Section } from "./sections.ts";
import type { I18nKey } from "./i18n.ts";
import "./styles/sections.css";

/** Margin the menu keeps from every viewport edge (the tree's number). */
const EDGE = 8;

export interface SectionMenuOptions {
  path: string;
  /** The note as the calling surface sees it — the editor's live buffer when
   *  one is open, so a menu opened 200ms after a keystroke acts on what is on
   *  screen rather than on the last autosave. */
  content: string;
  /** 0-based line of the heading the menu belongs to. */
  headingLine: number;
  x: number;
  y: number;
  /** Rows only the editor can offer. Absent = the row is not drawn, because a
   *  menu row that does nothing when pressed is worse than one that is not
   *  there (the rule the LaTeX formatting menu already follows). */
  onFoldBelow?: (section: Section) => void;
  onUnfoldBelow?: (section: Section) => void;
  onSelect?: (section: Section) => void;
  onFocus?: (section: Section) => void;
  /** Called after any row that rewrote the note, so a panel can recount. */
  onDone?: () => void;
}

let openMenu: HTMLElement | null = null;

/** Close whatever heading menu is up (also called on Esc and outside clicks). */
export function closeSectionMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

function row(
  menu: HTMLElement,
  key: I18nKey,
  run: () => void,
  cls = "s-menu__item",
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  btn.textContent = t(key);
  btn.addEventListener("click", () => {
    closeSectionMenu();
    run();
  });
  menu.appendChild(btn);
  return btn;
}

export function openSectionMenu(opts: SectionMenuOptions): void {
  closeSectionMenu();
  const section = sectionAtHeading(sectionsOf(opts.content), opts.headingLine);
  if (!section) return;

  const menu = document.createElement("div");
  menu.className = "s-menu s-menu--section";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", t("sectionActions"));

  // The heading's own text, as the menu's title: three of these rows say
  // "section" without naming one, and the reader may have right-clicked a row
  // in a 40-entry outline. `dir="auto"` — it is note content, not chrome.
  const head = document.createElement("div");
  head.className = "s-menu__title";
  head.setAttribute("dir", "auto");
  head.textContent = section.text;
  menu.appendChild(head);

  row(menu, "copySectionLink", () => copySectionLink(opts.path, section));
  row(menu, "copySectionMd", () => copySectionMarkdown(opts.content, section));
  if (opts.onSelect) row(menu, "selectSection", () => opts.onSelect?.(section));
  if (opts.onFocus) row(menu, "focusSection", () => opts.onFocus?.(section));
  if (opts.onFoldBelow) row(menu, "foldBelow", () => opts.onFoldBelow?.(section));
  if (opts.onUnfoldBelow) row(menu, "unfoldBelow", () => opts.onUnfoldBelow?.(section));
  row(
    menu,
    "extractSection",
    () => {
      void (async () => {
        // Re-read: the dialog is modal and the editor kept running behind the
        // ⋯ that opened this menu, so the buffer may have moved on.
        const fresh = await noteContent(opts.path);
        const now = sectionAtHeading(sectionsOf(fresh), opts.headingLine);
        await extractSection(opts.path, fresh, now ?? section);
        opts.onDone?.();
      })();
    },
    "s-menu__item s-menu__item--extract",
  );

  menu.style.left = `${opts.x}px`;
  menu.style.top = `${opts.y}px`;
  document.body.appendChild(menu);
  openMenu = menu;

  // Clamp after mount — the height depends on how many rows this surface gave.
  const rect = menu.getBoundingClientRect();
  const rtl = getComputedStyle(document.documentElement).direction === "rtl";
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let left = rtl ? opts.x - rect.width : opts.x;
  if (left + rect.width > vw - EDGE) left = opts.x - rect.width;
  if (left < EDGE) left = opts.x;
  let top = opts.y;
  if (top + rect.height > vh - EDGE) top = opts.y - rect.height;
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
    closeSectionMenu();
  };
  window.addEventListener("mousedown", onAway, true);
  window.addEventListener("contextmenu", onAway, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", dismiss);
}
