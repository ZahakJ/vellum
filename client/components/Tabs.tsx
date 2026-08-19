// Tabs row: one tab per open note. Click switches, middle-click or the ×
// button closes, and unsaved notes show a dirty dot.
//
// Keyboard: the bar is ONE tab stop (roving tabindex — the active tab is the
// one Tab reaches), arrows walk it, Home/End jump to the ends, and Delete
// closes the focused tab. Activation follows the arrows, the way browser tab
// bars behave: a reader arrowing along the bar is reading, not hunting.

import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { claimFocus } from "../a11y.ts";
import { countPhrase, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { ContextMenu, type MenuAnchor, type MenuRow } from "./ContextMenu.tsx";
import {
  activeTabOf,
  allPaths,
  closeAfterIn,
  closeAllPanes,
  closeOthersIn,
  paneAt,
  type Workspace,
} from "../workspace.ts";
import { stripBidiControls } from "../../shared/bidi.ts";
import { noteLabelOf } from "../../shared/noteFormat.ts";

/** Tab label: the basename, with bidi controls out. A filename carrying an
 *  RLO reorders its own label ("Bidi<U+202E>Attack Note" → "BidietoN kcattA"),
 *  and these labels travel into aria-labels and the document title. */
function titleOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return stripBidiControls(noteLabelOf(base));
}

/** The paths `next` would take away from `ws`.
 *
 *  Computed by RUNNING the reducer and diffing, never by re-deriving which
 *  tabs a pin protects. The rule lives in client/workspace.ts and this is the
 *  menu that promises to obey it, so a count that came from a second reading of
 *  the rule would eventually promise something the reducer does not do — and
 *  the whole reason these rows carry a number is that the number is true. */
function doomedBy(ws: Workspace, next: Workspace): string[] {
  const after = new Set(allPaths(next));
  return allPaths(ws).filter((p) => !after.has(p));
}

/** "(2 unsaved)", or nothing at all when a bulk close takes no unsaved work —
 *  a parenthesis that always appears stops being a warning. */
function unsavedNote(paths: string[], dirty: Record<string, boolean>): string | null {
  const n = paths.filter((p) => dirty[p] === true).length;
  return n === 0 ? null : countPhrase(n, "unsaved");
}

/** One bar per PANE. `paneId` is optional so every existing caller keeps
 *  working against the focused pane; the workspace grid passes it explicitly,
 *  which is what makes two panes two independent tab strips. */
export default function Tabs({ paneId }: { paneId?: string } = {}) {
  const dirty = useStore((s) => s.dirty);
  const openNote = useStore((s) => s.openNote);
  const closeTab = useStore((s) => s.closeTab);
  const admin = useStore((s) => s.admin);
  const workspace = useStore((s) => s.workspace);
  const id = paneId ?? workspace.focus;
  const pane = paneAt(workspace, id);
  const openTabs = pane === null ? [] : pane.tabs.map((tb) => tb.path);
  const active = pane === null ? null : activeTabOf(pane);
  const openPath = active === null ? null : active.path;
  const closeOtherTabs = useStore((s) => s.closeOtherTabs);
  const closeTabsAfter = useStore((s) => s.closeTabsAfter);
  const closeAllTabs = useStore((s) => s.closeAllTabs);
  const setTabPinned = useStore((s) => s.setTabPinned);
  const focusPane = useStore((s) => s.focusPane);
  /** Every store action below acts on the FOCUSED pane, so acting on THIS one
   *  means focusing it first. A click on a tab already means "work here"; this
   *  makes the menu and the close button mean it too, which is what keeps a
   *  second pane's ✕ from closing a tab in the first. */
  const inPane = (fn: (path: string) => void) => (path: string): void => {
    focusPane(id);
    fn(path);
  };
  useStore((s) => s.language); // re-render the chrome strings on language change
  const barRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<(MenuAnchor & { path: string }) | null>(null);

  // Visitors get a clean publish-site chrome: no tab bar until a second
  // note is actually open.
  if (!admin && openTabs.length < 2) return null;

  if (openTabs.length === 0) return <div className="s-tabs s-tabs--empty" />;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, path: string): void => {
    const at = openTabs.indexOf(path);
    // Physical arrows, logical order: in an RTL bar the tab to the reader's
    // right is the PREVIOUS one, so the keys have to be swapped there or
    // "next" walks backwards on an Arabic instance.
    const rtl = barRef.current
      ? getComputedStyle(barRef.current).direction === "rtl"
      : false;
    let to: number | null = null;
    if (e.key === "ArrowRight") to = at + (rtl ? -1 : 1);
    else if (e.key === "ArrowLeft") to = at + (rtl ? 1 : -1);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = openTabs.length - 1;
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      closeTab(path);
      return;
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      // The keyboard's right-click, the same door the tree already has. Anchored
      // to the TAB rather than to a pointer that is not involved, and flagged
      // `fromKeyboard` so focus goes into the menu and comes back to this tab.
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      setMenu({ x: Math.round(box.left + 12), y: Math.round(box.bottom), path, fromKeyboard: true });
      return;
    } else return;
    e.preventDefault();
    const next = openTabs[(to + openTabs.length) % openTabs.length];
    if (next === undefined) return;
    // Selection follows the arrows here, which means every keystroke opens a
    // note — and a note, once loaded, focuses the editor. Claim the focus for
    // the bar first or the second arrow press lands the caret in the prose.
    claimFocus();
    openNote(next);
    // The newly active tab is the one carrying tabIndex 0 after the commit.
    requestAnimationFrame(() =>
      barRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
    );
  };

  /** The menu for one tab. Built fresh on open so the counts describe the
   *  workspace as it is now, not as it was when the bar last rendered. */
  const rowsFor = (path: string): MenuRow[] => {
    const here = pane === null ? null : pane.tabs.find((tb) => tb.path === path) ?? null;
    const pinned = here?.pinned === true;

    const label = (base: "tmCloseOthers" | "tmCloseAfter" | "tmCloseAll", next: Workspace) => {
      const doomed = doomedBy(workspace, next);
      const note = unsavedNote(doomed, dirty);
      return {
        // A row that would take nothing is DISABLED rather than absent: a menu
        // whose rows move between openings is a menu you cannot aim at.
        disabled: doomed.length === 0,
        label:
          note === null
            ? t(base)
            : tf(`${base}N` as "tmCloseOthersN" | "tmCloseAfterN" | "tmCloseAllN", { count: note }),
      };
    };

    const others = label("tmCloseOthers", closeOthersIn(workspace, id, path));
    const after = label("tmCloseAfter", closeAfterIn(workspace, id, path));
    const all = label("tmCloseAll", closeAllPanes(workspace));

    return [
      { label: t("tmClose"), onSelect: () => inPane(closeTab)(path) },
      { label: null },
      { ...others, onSelect: () => inPane(closeOtherTabs)(path) },
      { ...after, onSelect: () => inPane(closeTabsAfter)(path) },
      { ...all, onSelect: () => { focusPane(id); closeAllTabs(); } },
      { label: null },
      { label: pinned ? t("tmUnpin") : t("tmPin"), onSelect: () => { focusPane(id); setTabPinned(path, !pinned); } },
      {
        // When you need it you are looking at the NOTE, not at the tree — the
        // row walks the sidebar to the file: ancestors open, row lit, scrolled
        // into the middle of the pane.
        label: t("tmReveal"),
        onSelect: () =>
          window.dispatchEvent(new CustomEvent("vellum:tree-reveal", { detail: { path } })),
      },
      {
        label: t("tmCopyPath"),
        onSelect: () => {
          void navigator.clipboard?.writeText(path).then(() => toast(t("tmPathCopied")));
        },
      },
    ];
  };

  const openMenu = (e: ReactMouseEvent, path: string): void => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, path });
  };

  return (
    <div className="s-tabs" role="tablist" aria-label={t("openTabsAria")} ref={barRef}>
      {openTabs.map((path) => {
        const isActive = path === openPath;
        const isDirty = Boolean(dirty[path]);
        const state = pane === null ? null : pane.tabs.find((tb) => tb.path === path) ?? null;
        const pinned = state?.pinned === true;
        const ephemeral = state?.ephemeral === true;
        return (
          // The row is chrome, not a control: the tab and its close button are
          // two separate widgets, and nesting one inside the other would make
          // the × unreachable from the keyboard (a focusable thing inside a
          // role="tab" is a nested-interactive violation, and the CSS had it
          // at opacity 0 anyway).
          <div
            key={path}
            role="presentation"
            title={path}
            className={`s-tab${isActive ? " s-tab--active" : ""}${isDirty ? " s-tab--dirty" : ""}${
              pinned ? " s-tab--pinned" : ""
            }${ephemeral ? " s-tab--ephemeral" : ""}`}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                focusPane(id);
                closeTab(path);
              }
            }}
            onMouseDown={(e) => {
              // Stop middle-click autoscroll before auxclick fires.
              if (e.button === 1) e.preventDefault();
            }}
            onContextMenu={(e) => openMenu(e, path)}
          >
            <button
              type="button"
              role="tab"
              className="s-tab__main"
              aria-selected={isActive}
              // Roving tabindex: exactly one tab stop for the whole bar.
              tabIndex={isActive ? 0 : -1}
              onClick={() => {
                focusPane(id);
                openNote(path);
              }}
              onKeyDown={(e) => onKeyDown(e, path)}
            >
              {/* A pinned tab says so in the row, not only in the menu that set
                  it: the promise is "a link click will not replace this", and a
                  promise the reader cannot see is one they will not rely on. The
                  glyph is decoration; the word underneath it is what a screen
                  reader gets. */}
              {pinned && (
                <>
                  <span className="s-tab-pin" aria-hidden="true">◆</span>
                  <span className="s-sr-only">{t("tabPinned")}</span>
                </>
              )}
              {/* Note-derived text inside chrome: direction per title. */}
              <span className="s-tab-title" dir="auto">{titleOf(path)}</span>
              {ephemeral && <span className="s-sr-only">{t("tabPreview")}</span>}
              {isDirty && (
                // The dot is the only mark that says "not saved". A bare
                // aria-label on an empty <span> is not reliably exposed, so
                // the words live in real text and the dot is decoration.
                <>
                  <span className="s-tab-dirty" aria-hidden="true" />
                  <span className="s-sr-only">{t("unsaved")}</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="s-tab-close"
              aria-label={tf("closeTab", { title: titleOf(path) })}
              tabIndex={isActive ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                focusPane(id);
                closeTab(path);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      {menu && (
        <ContextMenu
          at={menu}
          rows={rowsFor(menu.path)}
          label={t("tabActions")}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
