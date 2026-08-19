// One context menu, for every surface that has one.
//
// The tree grew a menu first (Sidebar.tsx), then the outline grew a second one
// (sectionMenu.ts) that re-derived the same placement by hand — and the two
// already disagree: only one of them restores focus, and only one of them
// dismisses on `contextmenu` elsewhere. Two menus that look alike and behave
// differently in one app is a bug, not a duplication, because the reader
// learns one and is then wrong about the other. This is the implementation
// they should both end up on; the tab bar is its first caller.
//
// What it owns, and each of these is a thing the existing menus got wrong at
// least once:
//
//   PLACEMENT. The menu opens at the pointer and the pointer can be anywhere.
//   With the sidebar on the trailing edge (RTL by default, or a reader who
//   moved it) a menu growing toward that edge runs straight off the screen and
//   takes its last row with it. So it opens toward the READING direction,
//   folds back when that edge has no room, folds back again if the fold
//   overflows, and is clamped into the viewport on both axes. Measured after
//   mount, because a menu's size is its content's. Lifted from Sidebar.tsx,
//   whose version is the one that was argued out.
//
//   FOCUS. A menu opened from the keyboard puts focus INSIDE itself and hands
//   it back on every close path — including the one nobody remembers, which is
//   activating a row. Sidebar.tsx has nine handlers that call setMenu(null)
//   directly and drop a keyboard reader on <body>; that is what `onClose`
//   being the only exit is for here.
//
//   DISMISSAL. Escape (capture, so it never reaches a dialog behind), an
//   outside mousedown, a `contextmenu` somewhere else — a right-click while a
//   menu is open means "menu there, not here" — and a resize, which invalidates
//   the geometry the placement just measured.

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** Margin the menu keeps from every viewport edge. */
const MENU_EDGE = 8;

export interface MenuRow {
  /** A `null` label is a separator; it carries no other field. */
  label: string | null;
  onSelect?(): void;
  /** Destructive — takes the danger colour and the rule above it. */
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuAnchor {
  x: number;
  y: number;
  /** Opened from the keyboard (Shift+F10 / the Menu key), so focus has to go
   *  INTO the menu and come back when it closes. A pointer-opened menu leaves
   *  focus where the reader put it. */
  fromKeyboard?: boolean;
}

export function ContextMenu(props: {
  at: MenuAnchor;
  rows: MenuRow[];
  label: string;
  onClose(): void;
}) {
  const { at, rows, label, onClose } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  /** Where focus was when the menu opened. Captured on mount rather than read
   *  at close time — by then it is the menu itself. */
  const opener = useRef<Element | null>(null);

  const close = useCallback(() => {
    if (at.fromKeyboard && opener.current instanceof HTMLElement) opener.current.focus();
    onClose();
  }, [at.fromKeyboard, onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    opener.current = document.activeElement;
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    const { width, height } = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = rtl ? at.x - width : at.x;
    if (left + width > vw - MENU_EDGE) left = at.x - width; // fold back
    if (left < MENU_EDGE) left = at.x; // …and back again if that overflows
    left = Math.max(MENU_EDGE, Math.min(left, vw - width - MENU_EDGE));
    let top = at.y;
    if (top + height > vh - MENU_EDGE) top = at.y - height;
    top = Math.max(MENU_EDGE, Math.min(top, vh - height - MENU_EDGE));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    if (at.fromKeyboard) el.querySelector<HTMLButtonElement>(".s-menu__item")?.focus();
  }, [at.x, at.y, at.fromKeyboard]);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // CAPTURE, and it stops here: a menu open over a dialog must eat the
      // Escape that would otherwise close the dialog underneath it.
      e.stopPropagation();
      e.preventDefault();
      close();
    };
    window.addEventListener("mousedown", onDown);
    // A right-click elsewhere means "a menu THERE" — the old one goes first.
    window.addEventListener("contextmenu", onDown);
    window.addEventListener("keydown", onKey, true);
    // The geometry above was measured against a viewport that no longer exists.
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("contextmenu", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
    };
  }, [close]);

  // Portalled onto <body>: every opener so far is inside a pane that animates
  // its own width and clips its overflow, and a menu must not be trapped in one.
  return createPortal(
    <div
      ref={ref}
      className="s-menu"
      role="menu"
      aria-label={label}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Arrows walk the rows; Tab LEAVES, because a menu is not a tab ring.
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Tab") return;
        if (e.key === "Tab") {
          close();
          return;
        }
        e.preventDefault();
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".s-menu__item")];
        const at2 = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === "ArrowDown" ? 1 : -1;
        items[(Math.max(0, at2) + step + items.length) % items.length]?.focus();
      }}
    >
      {rows.map((row, i) =>
        row.label === null ? (
          <div key={`sep${i}`} className="s-menu__sep" role="separator" />
        ) : (
          <button
            key={row.label}
            type="button"
            role="menuitem"
            className={`s-menu__item${row.danger ? " s-menu__item--danger" : ""}`}
            disabled={row.disabled}
            onClick={() => {
              // Close FIRST, so focus is restored before the action runs and
              // whatever the action focuses wins. The other order is how a
              // menu hands focus back to a tab it has just closed.
              close();
              row.onSelect?.();
            }}
          >
            {row.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
