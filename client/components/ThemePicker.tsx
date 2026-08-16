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
import { customThemeChoice, type CustomTheme } from "../../shared/customTheme.ts";
import { applyThemeChoice, getCustomThemes, subscribeCustomThemes } from "../design/customThemes.ts";
import { t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { choiceBase, choiceLabel, THEME_GROUPS, THEME_LABELS, type Theme } from "../themes.ts";
import { openThemeBuilder } from "./ThemeBuilder.tsx";

/** Two columns. ←/→ move by one across the whole list; ↑/↓ move by a ROW —
 *  which is not the same as moving by COLS, because each group is its own
 *  grid. The dark group holds ELEVEN themes, so its last row is half empty and
 *  the column parity flips at the group boundary: stepping by ±2 through the
 *  flat list took ArrowDown from Tallow (dark, left column) to Sandstone
 *  (light, RIGHT column) and made Parchment — the flagship light theme —
 *  unreachable by ArrowDown at all. `rowStep` walks the geometry the reader
 *  can see instead: down a row inside the group, then into the next group's
 *  first row in the SAME column, clamped to what that row actually holds. */
const COLS = 2;

/** The picker's groups, at the moment it opens: the two shipped ones, plus
 *  "Your themes" when this instance has any. Custom themes are browsed exactly
 *  where the built-ins are — the surface that shows the values — because that
 *  is what "selectable everywhere a built-in theme is" has to mean on the one
 *  surface built for looking at them. */
function pickerGroups(custom: CustomTheme[]): { group: string; themes: string[] }[] {
  const groups: { group: string; themes: string[] }[] = THEME_GROUPS.map((g) => ({
    group: g.group as string,
    themes: [...g.themes] as string[],
  }));
  if (custom.length > 0) {
    groups.push({ group: "custom", themes: custom.map((theme) => customThemeChoice(theme.id)) });
  }
  return groups;
}

/** The index one visual row up (dir -1) or down (dir +1) from `index`.
 *
 *  Sizes are passed in rather than computed once at import: with a custom
 *  group the geometry changes at runtime, and stepping by a stale row length
 *  is the exact bug this function replaced (an ODD group flips the column
 *  parity at its boundary, which made Parchment unreachable by ArrowDown). */
function rowStep(index: number, dir: 1 | -1, sizes: number[]): number {
  const starts = sizes.reduce<number[]>(
    (acc, _size, i) => [...acc, (acc[i - 1] ?? 0) + (sizes[i - 1] ?? 0)],
    [],
  );
  let g = -1;
  for (let i = 0; i < starts.length; i++) if (index >= starts[i]) g = i;
  if (g < 0) return index;
  const size = sizes[g];
  const local = index - starts[g];
  const row = Math.floor(local / COLS);
  const col = local % COLS;
  const lastRow = Math.ceil(size / COLS) - 1;
  if (dir === 1) {
    if (row < lastRow) return starts[g] + Math.min(size - 1, (row + 1) * COLS + col);
    if (g + 1 >= sizes.length) return index;
    return starts[g + 1] + Math.min(sizes[g + 1] - 1, col);
  }
  if (row > 0) return starts[g] + (row - 1) * COLS + col;
  if (g === 0) return index;
  const prevLastRow = Math.ceil(sizes[g - 1] / COLS) - 1;
  return starts[g - 1] + Math.min(sizes[g - 1] - 1, prevLastRow * COLS + col);
}

/** Apply a theme to the document WITHOUT persisting it — the preview channel.
 *  (state.ts's setTheme is the committing one; it writes localStorage.)
 *  Routed through applyThemeChoice so a CUSTOM theme previews with its
 *  overrides on, not as the base it was built from. */
function previewTheme(theme: string): void {
  applyThemeChoice(theme);
}

function ThemePicker({ onClose }: { onClose: () => void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  useStore((s) => s.language);

  /** The theme in force when the panel opened — what Esc restores. */
  const openedWith = useRef<string>(theme);
  // Re-render when a custom theme is created, edited or deleted from the
  // builder the panel opens: the row that was just saved has to be here when
  // the builder closes over it.
  const [customTick, setCustomTick] = useState(0);
  useEffect(() => subscribeCustomThemes(() => setCustomTick((n) => n + 1)), []);
  const custom = useMemo(() => getCustomThemes(), [customTick]);
  const groups = useMemo(() => pickerGroups(custom), [custom]);
  const flat = useMemo(() => groups.flatMap((g) => g.themes), [groups]);
  const sizes = useMemo(() => groups.map((g) => g.themes.length), [groups]);
  const [cursor, setCursor] = useState(() => Math.max(0, flat.indexOf(theme)));
  const listRef = useRef<HTMLDivElement>(null);
  /** Committed themes must not be un-previewed by the unmount cleanup. */
  const committed = useRef(false);

  const commit = useCallback(
    (pick: string) => {
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
      const row = (dir: 1 | -1): void => {
        e.preventDefault();
        e.stopPropagation();
        setCursor((c) => rowStep(c, dir, sizes));
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
          return row(1);
        case "ArrowUp":
          return row(-1);
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
  }, [cancel, commit, cursor, flat, sizes]);

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
          {/* THE DOOR to the builder. It lives here because this is the panel
              that already answers "what looks are there" — a sixteenth room is
              made from the fifteen, and the base picker inside the builder is
              this same list. */}
          <button
            type="button"
            className="s-tpick__new"
            onClick={() => {
              onClose();
              openThemeBuilder(null);
            }}
          >
            {t("tbNew")}
          </button>
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
          {groups.map((group) => (
            <div key={group.group} className="s-tpick__group">
              <div className="s-tpick__grouphead">
                {t(
                  group.group === "dark"
                    ? "themeGroupDark"
                    : group.group === "light"
                      ? "themeGroupLight"
                      : "themeGroupCustom",
                )}
              </div>
              <div className="s-tpick__grid">
                {group.themes.map((id) => {
                  index += 1;
                  const at = index;
                  const on = at === cursor;
                  const mine = custom.find((entry) => customThemeChoice(entry.id) === id) ?? null;
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
                      title={tf("themeIdTitle", { name: choiceLabel(id), id })}
                    >
                      {/* A miniature of the ROOM, not of the tokens. Three
                          10px dots could not tell sumi from void from basalt
                          (dark dot, white dot, pale dot, three times over);
                          a ground carrying a heading rule, two lines of type
                          and an accent chip shows what the theme does with
                          them. Still painted from the CONSTANT --swatch-*
                          tokens, so it is never the theme on screen. */}
                      {/* The swatch trio is keyed on the fifteen built-in ids
                          and is CONSTANT across themes, so a custom room shows
                          the one it was built on — under its own name. */}
                      <span
                        className="s-tpick__card"
                        data-theme-swatch={choiceBase(id)}
                        aria-hidden="true"
                      >
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
                          <bdi className="s-tpick__name">{choiceLabel(id)}</bdi>
                          {id === theme && (
                            <span className="s-tpick__current">{t("themeCurrent")}</span>
                          )}
                          {mine && (
                            // Editing is a SEPARATE target from picking: a
                            // click on the row still means "wear this", which
                            // is what every other row in the panel means.
                            <span
                              role="button"
                              tabIndex={0}
                              className="s-tpick__edit"
                              title={t("tbEdit")}
                              aria-label={t("tbEdit")}
                              onClick={(e) => {
                                e.stopPropagation();
                                onClose();
                                openThemeBuilder(mine);
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.preventDefault();
                                e.stopPropagation();
                                onClose();
                                openThemeBuilder(mine);
                              }}
                            >
                              ✎
                            </span>
                          )}
                        </span>
                        <span className="s-tpick__desc">
                          {mine
                            ? tf("tbBasedOn", { base: t(THEME_LABELS[mine.base].name) })
                            : t(THEME_LABELS[id as Theme].desc)}
                        </span>
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
