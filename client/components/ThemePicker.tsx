// The theme picker — fifteen looks, browsed instead of cycled.
//
// Four themes could hang off one status-bar button that stepped to the next
// one; fifteen cannot. Blind cycling is exactly the "invisible state" this
// round is about: a control whose only feedback is that everything changed,
// with no way to see what is available or to get back to what you had.
//
// So: a grouped list (dark rooms, then lit ones), every row wearing its own
// three-dot swatch — ground, type, accent — drawn from the CONSTANT
// --swatch-<id>-* tokens in tokens.css, so every preview is painted in its own
// theme rather than in the one currently on screen.
//
// The interaction is the point:
//   ↑↓←→  move the highlight, and the highlight APPLIES the theme live to the
//         whole app behind the panel — the only honest preview of a theme is
//         the theme.
//   Enter / click  keep it (persists through the store, like any other pick).
//   Esc / backdrop  put back the theme that was in force when the panel opened.
// The mouse never moves the keyboard highlight (hover only lights the row it
// is over). That is deliberate: the command palette's Enter-follows-the-mouse
// behaviour is the bug this product was told about, and a picker that commits
// a theme because the pointer happened to rest somewhere would be the same
// bug wearing a different hat.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { THEME_GROUPS, THEME_LABELS, type Theme } from "../themes.ts";

/** Two columns; the arrow keys move by 1 across and by COLS down. */
const COLS = 2;

/** Apply a theme to the document WITHOUT persisting it — the preview channel.
 *  (state.ts's setTheme is the committing one; it writes localStorage.) */
function previewTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

function ThemePicker({ onClose }: { onClose: () => void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  useStore((s) => s.language);

  /** The theme in force when the panel opened — what Esc restores. */
  const openedWith = useRef<Theme>(theme);
  const flat = useMemo(() => THEME_GROUPS.flatMap((g) => g.themes), []);
  const [cursor, setCursor] = useState(() => Math.max(0, flat.indexOf(theme)));
  const listRef = useRef<HTMLDivElement>(null);
  /** Committed themes must not be un-previewed by the unmount cleanup. */
  const committed = useRef(false);

  const commit = useCallback(
    (pick: Theme) => {
      committed.current = true;
      setTheme(pick);
      onClose();
    },
    [onClose, setTheme],
  );

  const cancel = useCallback(() => {
    previewTheme(openedWith.current);
    onClose();
  }, [onClose]);

  // Highlight → live preview. Runs on every cursor move, including the first
  // render (harmless: the cursor starts on the current theme).
  useEffect(() => {
    const next = flat[cursor];
    if (next) previewTheme(next);
  }, [cursor, flat]);

  // If the panel dies without committing (React unmount from anywhere), the
  // preview must not survive it.
  useEffect(
    () => () => {
      if (!committed.current) previewTheme(openedWith.current);
    },
    [],
  );

  // Capture phase, and every handled key stops there: the editor, the palette
  // and the settings panel all listen on window too.
  useEffect(() => {
    const rtl = document.documentElement.getAttribute("dir") === "rtl";
    const onKey = (e: KeyboardEvent): void => {
      const step = (delta: number): void => {
        e.preventDefault();
        e.stopPropagation();
        setCursor((c) => Math.max(0, Math.min(flat.length - 1, c + delta)));
      };
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          cancel();
          return;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          commit(flat[cursor]);
          return;
        case "ArrowDown":
          return step(COLS);
        case "ArrowUp":
          return step(-COLS);
        case "ArrowRight":
          return step(rtl ? -1 : 1);
        case "ArrowLeft":
          return step(rtl ? 1 : -1);
        case "Home":
          return step(-flat.length);
        case "End":
          return step(flat.length);
        default:
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancel, commit, cursor, flat]);

  // Focus the list so the panel owns the keyboard even when it was opened by
  // a click, and keep the highlighted row in view.
  useEffect(() => listRef.current?.focus(), []);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  let index = -1;
  return (
    <div className="s-palette-overlay s-tpick-overlay" onMouseDown={cancel}>
      <div
        className="s-tpick"
        role="dialog"
        aria-label={t("themePicker")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-tpick__head">
          <span className="s-tpick__title">{t("themePicker")}</span>
          <span className="s-tpick__hint">{t("themePickerHint")}</span>
          <button type="button" className="s-bmodal__close" onClick={cancel} aria-label={t("close")}>
            ×
          </button>
        </div>

        <div
          className="s-tpick__list"
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label={t("themePicker")}
          aria-activedescendant={`s-tpick-opt-${flat[cursor]}`}
        >
          {THEME_GROUPS.map((group) => (
            <div key={group.group} className="s-tpick__group">
              <div className="s-tpick__grouphead">
                {t(group.group === "dark" ? "themeGroupDark" : "themeGroupLight")}
              </div>
              <div className="s-tpick__grid">
                {group.themes.map((id) => {
                  index += 1;
                  const at = index;
                  const on = at === cursor;
                  return (
                    <button
                      key={id}
                      id={`s-tpick-opt-${id}`}
                      type="button"
                      role="option"
                      aria-selected={on}
                      data-index={at}
                      className={`s-tpick__item${on ? " s-tpick__item--on" : ""}${
                        id === theme ? " s-tpick__item--current" : ""
                      }`}
                      // Hover does NOT move the highlight (see the header
                      // note); only a real click picks a theme.
                      onClick={() => commit(id)}
                      // The id is still the value DEFAULT_THEME and the
                      // palette take, so it stays reachable from the row.
                      title={tf("themeIdTitle", { name: t(THEME_LABELS[id].name), id })}
                    >
                      {/* A miniature of the ROOM, not of the tokens. Three
                          10px dots could not tell sumi from void from basalt
                          (dark dot, white dot, pale dot, three times over);
                          a ground carrying a heading rule, two lines of type
                          and an accent chip shows what the theme does with
                          them. Still painted from the CONSTANT --swatch-*
                          tokens, so it is never the theme on screen. */}
                      <span className="s-tpick__card" data-theme-swatch={id} aria-hidden="true">
                        <span className="s-tpick__card-rule" />
                        <span className="s-tpick__card-line" />
                        <span className="s-tpick__card-foot">
                          <span className="s-tpick__card-chip" />
                          <span className="s-tpick__card-line s-tpick__card-line--short" />
                        </span>
                      </span>
                      <span className="s-tpick__meta">
                        <span className="s-tpick__nameline">
                          {/* The label is chrome copy now; the note-derived
                              direction rule does not apply, but a <bdi> keeps
                              a Latin name from dragging an Arabic row. */}
                          <bdi className="s-tpick__name">{t(THEME_LABELS[id].name)}</bdi>
                          {id === theme && (
                            <span className="s-tpick__current">{t("themeCurrent")}</span>
                          )}
                        </span>
                        <span className="s-tpick__desc">{t(THEME_LABELS[id].desc)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Imperative mount. The picker is opened from the status bar, the settings
// panel and (eventually) the palette — three places in two component trees —
// so it mounts its own root on <body> rather than living inside one of them.
// Same shape as client/toast.ts, for the same reason.
// ---------------------------------------------------------------------------

let host: HTMLDivElement | null = null;
let root: Root | null = null;

/** Is the picker on screen? Other Esc handlers (the settings panel's) ask,
 *  because a capture-phase listener registered EARLIER runs first and would
 *  otherwise close the panel underneath the picker. */
export function isThemePickerOpen(): boolean {
  return host !== null;
}

export function closeThemePicker(): void {
  if (!root || !host) return;
  const [r, h] = [root, host];
  root = null;
  host = null;
  // Unmount on a later tick: React refuses to unmount a root while it is
  // rendering, and this is called from inside the picker's own handlers.
  setTimeout(() => {
    r.unmount();
    h.remove();
  }, 0);
}

export function openThemePicker(): void {
  if (host) return;
  host = document.createElement("div");
  host.className = "s-tpick-host";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<ThemePicker onClose={closeThemePicker} />);
}

export default ThemePicker;
