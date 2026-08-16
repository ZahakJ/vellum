// Ctrl/Cmd+/ — every binding the shell has, grouped and searchable.
// A keystroke nobody can enumerate is a keystroke nobody uses: zen, the fold
// chevrons and the panel toggles were all keyboard-only secrets before this
// list existed. Rows that have no keystroke still appear, naming the surface
// that carries them (the palette, the status bar, a click) — the question the
// reader is asking is "how do I do X", not "which key does X".
//
// Esc closes. Opened from the status-bar ?, the palette, or Ctrl/Cmd+/.

import { useEffect, useMemo, useRef, useState } from "react";
import { openDailyNote } from "../daily.ts";
import { t, type I18nKey } from "../i18n.ts";
import { useStore } from "../state.ts";
import { openThemePicker } from "./ThemePicker.tsx";

/** One row: a label, and either a key sequence or the surface that carries it. */
interface Binding {
  label: I18nKey;
  /** Key tokens, rendered as <kbd> chips ("Ctrl/Cmd", "Shift", "E"). */
  keys?: string[];
  /** No keystroke — the surface it lives on ("Command palette", "Click"). */
  via?: I18nKey;
  /** Only meaningful for a session that may write to the vault. */
  admin?: boolean;
  /** What the row DOES, when the shell can do it from here. Rows carried a
   *  hover highlight while being plain divs — an affordance lie: the pointer
   *  lit a row that answered to nothing, and a screenshot of the sheet showed
   *  "Graph view" apparently selected purely because the cursor was resting
   *  on it. Now the ones that can run, run (and the sheet closes first, so the
   *  command lands on the app rather than behind a modal); the ones that
   *  cannot — editor keystrokes, Esc, a click on a link — are inert rows with
   *  no highlight at all. */
  run?: () => void;
}

interface Group {
  title: I18nKey;
  items: Binding[];
}

/** True when `word` starts a WORD in `hay` — `\b` is ASCII-only in JS, and
 *  this sheet is searched in Arabic too. */
function startsWord(hay: string, word: string): boolean {
  let i = hay.indexOf(word);
  while (i !== -1) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1])) return true;
    i = hay.indexOf(word, i + 1);
  }
  return false;
}

/** How well a row answers `words`: -1 when any word matches nothing (the row
 *  is filtered out), otherwise higher is a better answer. The weights say
 *  what the reader means: a word that OPENS the row's own label is what they
 *  typed; a word buried inside another word in a neighbouring group is not. */
function score(item: Binding, group: Group, words: string[]): number {
  if (words.length === 0) return 0;
  const label = t(item.label).toLowerCase();
  const via = item.via ? t(item.via).toLowerCase() : "";
  const keys = (item.keys ?? []).join(" ").toLowerCase();
  const title = t(group.title).toLowerCase();
  let total = 0;
  for (const word of words) {
    let best = -1;
    if (label.startsWith(word)) best = 8;
    else if (startsWord(label, word)) best = 6;
    else if (keys.includes(word)) best = 4;
    else if (label.includes(word)) best = 3;
    else if (startsWord(via, word)) best = 2;
    else if (via.includes(word) || title.includes(word)) best = 1;
    if (best < 0) return -1;
    total += best;
  }
  return total;
}

const GROUPS: Group[] = [
  {
    title: "scGroupNav",
    items: [
      { label: "scPalette", keys: ["Ctrl/Cmd", "P"], run: () => useStore.getState().setPaletteOpen(true) },
      {
        label: "scSearch",
        keys: ["Ctrl/Cmd", "K"],
        run: () => window.dispatchEvent(new CustomEvent("vellum:quicksearch")),
      },
      { label: "scGraph", keys: ["Ctrl/Cmd", "G"], run: () => useStore.getState().setView("graph") },
      { label: "cmdDailyNote", keys: ["Ctrl/Cmd", "D"], admin: true, run: () => void openDailyNote() },
      { label: "newNote", keys: ["Ctrl/Cmd", "N"], admin: true },
      { label: "scFollowLink", via: "scFollowLinkKey" },
      // The tree carries images and PDFs now, and nothing else on screen says
      // that a click on one opens a viewer or that the arrows walk the folder.
      { label: "scOpenFile", via: "scFollowLinkKey", admin: true },
      { label: "scWalkFiles", keys: ["← / →"], admin: true },
      { label: "scEscape", keys: ["Esc"] },
    ],
  },
  {
    title: "scGroupEditing",
    items: [
      { label: "scSave", keys: ["Ctrl/Cmd", "S"], admin: true },
      { label: "scUndo", keys: ["Ctrl/Cmd", "Z"], admin: true },
      { label: "scRedo", keys: ["Ctrl/Cmd", "Shift", "Z"], admin: true },
      { label: "scFind", keys: ["Ctrl/Cmd", "F"], admin: true },
      { label: "scMoveLine", keys: ["Ctrl/Cmd", "↑ / ↓"], admin: true },
      { label: "scSlash", via: "scSlashKey", admin: true },
      // The chevron is visible chrome again (preview.css), so this row can name
      // the KEYSTROKE as well as the control — a help sheet that documents an
      // invisible affordance is not an answer to "I could not find it".
      { label: "scFold", keys: ["Ctrl/Cmd", "Shift", "[ / ]"], via: "scFoldKey", admin: true },
      { label: "scFoldAll", keys: ["Ctrl/Cmd", "Alt", "[ / ]"], admin: true },
    ],
  },
  {
    title: "scGroupModes",
    items: [
      {
        label: "cmdToggleReading",
        keys: ["Ctrl/Cmd", "E"],
        admin: true,
        run: () => useStore.getState().toggleReading(),
      },
      { label: "cmdZen", keys: ["Ctrl/Cmd", "Shift", "Z"], run: () => useStore.getState().setZen(true) },
      { label: "cmdToggleVim", via: "scViaStatusBar", admin: true, run: () => useStore.getState().toggleVim() },
      {
        label: "previewAsVisitor",
        via: "scViaStatusBar",
        admin: true,
        run: () => void useStore.getState().setPreviewVisitor(true),
      },
      { label: "browseThemes", via: "scViaStatusBar", run: () => openThemePicker() },
    ],
  },
  {
    title: "scGroupPublishing",
    items: [
      { label: "cmdPublishNote", keys: ["Ctrl/Cmd", "Shift", "P"], admin: true },
      { label: "cmdSetBanner", via: "scViaPalette", admin: true },
      { label: "cmdModerateComments", via: "scViaPalette", admin: true },
      { label: "siteSettings", via: "scViaStatusBar", admin: true, run: () => useStore.getState().setSettingsOpen(true) },
    ],
  },
  {
    title: "scGroupPanels",
    items: [
      {
        label: "cmdToggleSidebar",
        keys: ["Ctrl/Cmd", "B"],
        run: () => {
          const s = useStore.getState();
          s.setSidebarCollapsed(!s.sidebarCollapsed);
        },
      },
      {
        label: "cmdTogglePanel",
        keys: ["Ctrl/Cmd", "Shift", "B"],
        run: () => {
          const s = useStore.getState();
          s.setPanelCollapsed(!s.panelCollapsed);
        },
      },
      { label: "scHelp", keys: ["Ctrl/Cmd", "/"] },
    ],
  },
];

export default function ShortcutsHelp() {
  const open = useStore((s) => s.shortcutsOpen);
  const setOpen = useStore((s) => s.setShortcutsOpen);
  const admin = useStore((s) => s.admin);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const words = q ? q.split(/\s+/) : [];
    const scored = GROUPS.map((group) => {
      const items = group.items
        .filter((item) => !item.admin || admin)
        .map((item) => ({ item, score: score(item, group, words) }))
        .filter((row) => row.score >= 0)
        // Stable within a score: the authored order is a curriculum.
        .sort((a, b) => b.score - a.score);
      return {
        title: group.title,
        items,
        best: items.reduce((m, r) => Math.max(m, r.score), 0),
      };
    }).filter((group) => group.items.length > 0);
    // Plain substring matching put "Next / previous file in the folder" above
    // "Fold a section" for the query "fold", under a NAVIGATION heading — the
    // reader's own word matched a word ENDING in it, three rows from where
    // they were looking. Ranking sorts the groups too, or the winning row is
    // still under whichever heading the authored order happens to put first.
    return q ? [...scored].sort((a, b) => b.best - a.best) : scored;
  }, [query, admin]);

  if (!open) return null;

  return (
    <div className="s-palette-overlay" onMouseDown={() => setOpen(false)}>
      <div
        className="s-palette s-shortcuts"
        role="dialog"
        aria-label={t("shortcutsTitle")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-shortcuts__head">
          <h2 className="s-shortcuts__title">{t("shortcutsTitle")}</h2>
          <kbd className="s-kbd">Esc</kbd>
        </div>
        <input
          ref={inputRef}
          className="s-palette-input"
          type="text"
          value={query}
          placeholder={t("shortcutsPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="s-shortcuts__list">
          {groups.map((group) => (
            <section className="s-shortcuts__group" key={group.title}>
              <h3 className="s-palette-section">{t(group.title)}</h3>
              {group.items.map(({ item }) => {
                const body = (
                  <>
                    <span className="s-shortcuts__label">{t(item.label)}</span>
                    <span className="s-shortcuts__keys">
                      {item.via && !item.keys && (
                        <span className="s-shortcuts__via">{t(item.via)}</span>
                      )}
                      {item.keys?.map((key, i) => (
                        <span className="s-shortcuts__key" key={key}>
                          {i > 0 && (
                            <span className="s-shortcuts__plus" aria-hidden="true">
                              +
                            </span>
                          )}
                          <kbd className="s-kbd">{key}</kbd>
                        </span>
                      ))}
                      {item.via && item.keys && (
                        <span className="s-shortcuts__via">{t(item.via)}</span>
                      )}
                    </span>
                  </>
                );
                const key = `${group.title}:${item.label}`;
                // Close FIRST: every one of these commands acts on the app,
                // and running one behind an open modal is a change the reader
                // cannot see.
                return item.run ? (
                  <button
                    type="button"
                    className="s-shortcuts__row s-shortcuts__row--action"
                    key={key}
                    onClick={() => {
                      setOpen(false);
                      item.run?.();
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="s-shortcuts__row" key={key}>
                    {body}
                  </div>
                );
              })}
            </section>
          ))}
          {groups.length === 0 && (
            <div className="s-palette-empty">{t("paletteNoMatches")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
