// THE FOLDER ICON PICKER — the whole UI for feature A.
//
// WHY IT IS NOT A SETTINGS ROW. A folder's glyph is a property OF THAT
// FOLDER, and the place a reader is when they want to change it is the folder
// itself, in the tree. A settings page listing "Games → gamepad, Reading →
// book, …" would be a second, worse tree that has to be kept in step with the
// real one by hand. So it hangs off the context menu, beside Rename — the
// other verb that belongs to the folder rather than to the instance.
//
// It is anchored, not modal: the row it describes must stay visible behind it.
// Positioning, edge-folding and Escape follow the context menu's own rules
// (Sidebar.tsx:776-803) so the two feel like one surface — because they are:
// one opens the other, at the same point on the screen.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FOLDER_ICONS, type FolderIcon } from "../../shared/folderIcons.ts";
import { folderIconLabel } from "../folderIconLabels.ts";
import { t, tf } from "../i18n.ts";
import FolderGlyph from "./FolderGlyph.tsx";
// The popover's styles travel with this chunk, not with app.css — see the
// sheet's own header for why.
import "../styles/foldericons.css";

/** Margin the popover keeps from every viewport edge (the menu's number). */
const EDGE = 8;
/** Cells per row. Also the arrow keys' vertical stride — see onKeyDown. */
const COLS = 5;

export interface IconPickState {
  /** Vault-relative folder path being marked. Never "" — the vault root is
   *  not a folder anyone can put a glyph on (its key would be empty). */
  path: string;
  /** The folder's own name, for the popover's title. */
  name: string;
  /** What it wears now, or null. */
  current: FolderIcon | null;
  x: number;
  y: number;
  /** Opened from the keyboard, so focus must come back to the tree on close. */
  fromKeyboard: boolean;
}

export default function FolderIconPicker({
  state,
  onPick,
  onClose,
}: {
  state: IconPickState;
  /** null clears the folder's mark. */
  onPick(icon: FolderIcon | null): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The roving tab stop. A grid of twenty-one buttons that were each a tab
  // stop would put the whole icon set between the reader and the row below —
  // so exactly one cell is tabbable and the arrows move it (ARIA APG's
  // radiogroup pattern, which is also what this control IS: one of n).
  const [at, setAt] = useState(() => {
    const i = state.current ? FOLDER_ICONS.indexOf(state.current) : -1;
    return i >= 0 ? i : FOLDER_ICONS.length; // the "no icon" cell
  });

  // Same geometry as the context menu it replaces: open toward the reading
  // direction, fold back when that edge is full, clamp on both axes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    const { width, height } = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = rtl ? state.x - width : state.x;
    if (left + width > vw - EDGE) left = state.x - width;
    if (left < EDGE) left = state.x;
    left = Math.max(EDGE, Math.min(left, vw - width - EDGE));
    let top = state.y;
    if (top + height > vh - EDGE) top = state.y - height;
    top = Math.max(EDGE, Math.min(top, vh - height - EDGE));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // Focus lands on the CURRENT choice however the popover was opened. This
    // one is unlike the context menu, which only takes focus for a keyboard
    // reader: a grid of glyphs with no focus ring anywhere gives a keyboard
    // user nothing to press an arrow from.
    el.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
    // Deps are the ANCHOR only, deliberately: `at` changes on every arrow
    // press, and re-running this would re-measure and re-place the popover
    // under a reader mid-navigation.
  }, [state.x, state.y]);

  // Click-out and Escape, exactly as the context menu closes.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const last = FOLDER_ICONS.length; // index of the "no icon" cell
  const move = (next: number) => {
    const i = Math.max(0, Math.min(last, next));
    setAt(i);
    ref.current?.querySelectorAll<HTMLButtonElement>(".s-tree-iconpick__cell")[i]?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // The horizontal arrows are PHYSICAL keys on a logical grid: in Arabic the
    // first cell is on the right, so ArrowRight must walk backwards or the
    // reader's arrow and the reader's eye disagree.
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    switch (e.key) {
      case "ArrowRight":
        move(at + (rtl ? -1 : 1));
        break;
      case "ArrowLeft":
        move(at + (rtl ? 1 : -1));
        break;
      // Clamping (not wrapping) is what makes the wide "no icon" cell work
      // without special-casing: ArrowDown from any cell in the last row of
      // glyphs lands on it, and ArrowUp from it lands back in that row.
      case "ArrowDown":
        move(at + COLS);
        break;
      case "ArrowUp":
        move(at - COLS);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(last);
        break;
      case "Tab":
        // A popover is not a tab ring. Tab leaves and closes, like the menu.
        onClose();
        return;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className="s-tree-iconpick"
      role="dialog"
      aria-label={tf("folderIconFor", { name: state.name })}
      // Physical `left`, like the context menu one line of code away: this is
      // a viewport coordinate the effect above has already resolved for the
      // reading direction, not a box inside a flow.
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="s-tree-iconpick__title" dir="auto">
        {state.name}
      </div>
      <div
        className="s-tree-iconpick__grid"
        role="radiogroup"
        aria-label={t("folderIcon")}
        onKeyDown={onKeyDown}
      >
        {FOLDER_ICONS.map((icon, i) => {
          const on = state.current === icon;
          return (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={folderIconLabel(icon)}
              title={folderIconLabel(icon)}
              tabIndex={at === i ? 0 : -1}
              className={`s-tree-iconpick__cell${on ? " s-tree-iconpick__cell--on" : ""}`}
              onClick={() => onPick(icon)}
            >
              <FolderGlyph icon={icon} size={16} />
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={state.current === null}
          tabIndex={at === last ? 0 : -1}
          className={`s-tree-iconpick__cell s-tree-iconpick__cell--none${
            state.current === null ? " s-tree-iconpick__cell--on" : ""
          }`}
          onClick={() => onPick(null)}
        >
          {t("folderIconNone")}
        </button>
      </div>
    </div>
  );
}
