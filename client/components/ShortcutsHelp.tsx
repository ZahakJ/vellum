// Ctrl/Cmd+/ — every binding the shell has, grouped and searchable.
// A keystroke nobody can enumerate is a keystroke nobody uses: zen, the fold
// chevrons and the panel toggles were all keyboard-only secrets before this
// list existed. Rows that have no keystroke still appear, naming the surface
// that carries them (the palette, the status bar, a click) — the question the
// reader is asking is "how do I do X", not "which key does X".
//
// Esc closes. Opened from the status-bar ?, the palette, or Ctrl/Cmd+/ (in
// the blog shell, Ctrl/Cmd+/ is the only door — there is no status bar and no
// palette there).
//
// THREE filters, and they are the same rule three times. `admin` drops the
// rows a read-only session cannot act on; `shell` drops the rows the mounted
// shell does not have; `desktop` drops the rows only the desktop app can be
// given, and is a no-op in every browser — including this one, until that app
// exists. A blog visitor was being served the APP's sheet: Command
// palette, Graph view, Zen mode, Browse themes "via Status bar", and both
// pane toggles — six rows naming controls that are not on the page, three of
// them lit as buttons that ran commands into a shell holding no such state.
// CONTRACTS.md: rows that light up must DO something.

import { useEffect, useMemo, useRef, useState } from "react";
import { openDailyNote } from "../daily.ts";
import { insertTemplateCommand, newNoteFromTemplateCommand } from "../templateActions.ts";
import { t, type I18nKey } from "../i18n.ts";
import { layoutHints, loadLayoutHints } from "../layoutMap.ts";
import { useStore } from "../state.ts";
import { openThemePicker } from "./ThemePicker.tsx";

/** Which shell is mounted around the sheet. */
export type Shell = "app" | "blog";

/** One row: a label, and either a key sequence or the surface that carries it. */
interface Binding {
  label: I18nKey;
  /** Key tokens, rendered as <kbd> chips ("Ctrl/Cmd", "Shift", "E"). */
  keys?: string[];
  /** No keystroke — the surface it lives on ("Command palette", "Click"). */
  via?: I18nKey;
  /** Only meaningful for a session that may write to the vault. */
  admin?: boolean;
  /** Only meaningful in ONE shell. Unmarked rows work in both (Ctrl/Cmd+K is
   *  answered by the sidebar's search box in the app and by the blog's own
   *  overlay; Esc, a click on a link and this sheet exist everywhere). */
  shell?: Shell;
  /** Only meaningful in the DESKTOP runtime — a native menu accelerator or a
   *  global hotkey no browser tab can be given. Unmarked rows work in both,
   *  which is the `shell` rule one line up wearing a different noun, and the
   *  filter below is the same shape for the same reason.
   *
   *  It exists before the desktop build does, on purpose. `GROUPS` is the one
   *  place a binding exists — `npm run check-keymap` reads this table and
   *  fails the build when two rows claim one keystroke — and a ledger that
   *  cannot spell "desktop only" cannot be asked whether the desktop's keys
   *  collide with the browser's. That answer has to exist before the keys do;
   *  after they ship it is a bug report. */
  desktop?: boolean;
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
      {
        label: "scPalette",
        keys: ["Ctrl/Cmd", "P"],
        shell: "app",
        run: () => useStore.getState().setPaletteOpen(true),
      },
      {
        label: "scSearch",
        keys: ["Ctrl/Cmd", "K"],
        run: () => window.dispatchEvent(new CustomEvent("vellum:quicksearch")),
      },
      {
        label: "scGraph",
        keys: ["Ctrl/Cmd", "G"],
        shell: "app",
        run: () => useStore.getState().setView("graph"),
      },
      // Alt, because the plain key is the editor's "select next occurrence" —
      // which had been dead since it shipped, swallowed here in the capture
      // phase. A once-a-day verb does not outrank a per-minute one.
      { label: "cmdDailyNote", keys: ["Ctrl/Cmd", "Alt", "D"], admin: true, run: () => void openDailyNote() },
      { label: "newNote", keys: ["Ctrl/Cmd", "N"], admin: true },
      // Templates wear Alt because Ctrl/Cmd+T and +Shift+T belong to the
      // browser (new tab / reopen closed tab) — the sheet has to be able to
      // answer "what is the template key" in one glance, including WHY it is
      // not the obvious one. Both rows run from here, in the app shell.
      {
        label: "cmdInsertTemplate",
        keys: ["Ctrl/Cmd", "Alt", "T"],
        admin: true,
        shell: "app",
        run: () => void insertTemplateCommand(),
      },
      {
        label: "cmdNewFromTemplate",
        keys: ["Ctrl/Cmd", "Alt", "Shift", "T"],
        admin: true,
        shell: "app",
        run: () => void newNoteFromTemplateCommand(),
      },
      { label: "scFollowLink", via: "scFollowLinkKey" },
      // The tree carries images and PDFs now, and nothing else on screen says
      // that a click on one opens a viewer or that the arrows walk the folder.
      { label: "scOpenFile", via: "scFollowLinkKey", admin: true },
      { label: "scWalkFiles", keys: ["← / →"], admin: true },
      // Two labels, one key: the app's Esc leaves zen, and zen is not a thing
      // the blog shell has. The blog row still names preview, which is true
      // for the admin looking through it — the only other reader of this sheet.
      { label: "scEscape", keys: ["Esc"], shell: "app" },
      { label: "scEscapeBlog", keys: ["Esc"], shell: "blog" },
      // Ctrl/Cmd+/ documents itself, and it is the ONE binding both shells
      // carry with no surface of its own — so it closes the group every
      // reader can see rather than hiding under "Panels", which the blog
      // shell does not have.
      { label: "scHelp", keys: ["Ctrl/Cmd", "/"] },
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
    // SECTIONS ARE THEIR OWN GROUP for the reason Formatting is: a heading is
    // a handle on a whole subtree, and the five things a reader can do to that
    // subtree are not five more rows of "editing". Two of them have no
    // keystroke at all — the outline drag is the flagship gesture of the
    // panel, and a gesture nobody can enumerate is a gesture nobody finds.
    title: "scGroupSections",
    items: [
      { label: "scReorderSection", via: "scViaOutlineDrag", admin: true, shell: "app" },
      { label: "scSectionMenu", via: "scSectionMenuKey", admin: true },
      { label: "scPrevHeading", keys: ["Ctrl/Cmd", "Alt", "↑"], admin: true },
      { label: "scNextHeading", keys: ["Ctrl/Cmd", "Alt", "↓"], admin: true },
      { label: "scFocusSection", keys: ["Ctrl/Cmd", "Alt", "F"], admin: true },
    ],
  },
  {
    // Formatting is its own group, not three more rows under Editing: these
    // are the keys a reader tries FIRST, before they have read anything, and
    // one of them (Ctrl/Cmd+B) used to fold a pane instead — so the sheet has
    // to be able to answer "what happened to Ctrl+B" in one glance. Every
    // binding here is Obsidian's except underline, which Obsidian has no
    // command for at all (see client/editor/commands.ts).
    title: "scGroupFormatting",
    items: [
      { label: "scBold", keys: ["Ctrl/Cmd", "B"], admin: true },
      { label: "scItalic", keys: ["Ctrl/Cmd", "I"], admin: true },
      { label: "scUnderline", keys: ["Ctrl/Cmd", "U"], admin: true },
      { label: "scStrikethrough", keys: ["Ctrl/Cmd", "Shift", "X"], admin: true },
      { label: "scHighlight", keys: ["Ctrl/Cmd", "Shift", "H"], admin: true },
      { label: "scComment", keys: ["Ctrl/Cmd", "Alt", "/"], admin: true },
      { label: "scSplitPane", keys: ["Ctrl/Cmd", "\\"], admin: true },
      { label: "scSplitPaneDown", keys: ["Ctrl/Cmd", "Shift", "\\"], admin: true },
      { label: "scClosePane", keys: ["Ctrl/Cmd", "Alt", "\\"], admin: true },
      { label: "scFocusPane", keys: ["Ctrl/Cmd", "Alt", "Shift", "↑ / ↓"], admin: true },
      { label: "scFocusPaneSide", keys: ["Ctrl/Cmd", "Alt", "Shift", "← / →"], admin: true },
      { label: "scSelectNext", keys: ["Ctrl/Cmd", "D"], admin: true },
      { label: "scAddCursor", via: "scAddCursorHow", admin: true },
      { label: "scColumnSelect", via: "scColumnSelectHow", admin: true },
      { label: "scSelectionMenu", via: "scSelectionMenuKey", admin: true },
      { label: "scTextColor", via: "scViaSelectionMenu", admin: true },
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
      {
        label: "cmdZen",
        keys: ["Ctrl/Cmd", "Shift", "Z"],
        shell: "app",
        run: () => useStore.getState().setZen(true),
      },
      { label: "cmdToggleVim", via: "scViaStatusBar", admin: true, run: () => useStore.getState().toggleVim() },
      {
        label: "previewAsVisitor",
        via: "scViaStatusBar",
        admin: true,
        run: () => void useStore.getState().setPreviewVisitor(true),
      },
      { label: "browseThemes", via: "scViaStatusBar", shell: "app", run: () => openThemePicker() },
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
        label: "cmdTogglePaneNotes",
        keys: ["Ctrl/Cmd", "Alt", "B"],
        shell: "app",
        run: () => {
          const s = useStore.getState();
          s.setSidebarCollapsed(!s.sidebarCollapsed);
        },
      },
      {
        label: "cmdTogglePaneOutline",
        keys: ["Ctrl/Cmd", "Alt", "Shift", "B"],
        shell: "app",
        run: () => {
          const s = useStore.getState();
          s.setPanelCollapsed(!s.panelCollapsed);
        },
      },
    ],
  },
];

/** Are we inside the desktop app? Electron stamps `Electron/<version>` into
 *  the user-agent and nothing else does, so no build flag and no store field
 *  is needed to answer it — which matters here, because the answer must be
 *  false in every browser without anyone having to remember to set it. Until
 *  the desktop ships this is false everywhere and the `desktop` filter below
 *  is a no-op; the rows it will hide do not exist yet. */
const DESKTOP = typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent);

export default function ShortcutsHelp({ shell = "app" }: { shell?: Shell }) {
  const open = useStore((s) => s.shortcutsOpen);
  const setOpen = useStore((s) => s.setShortcutsOpen);
  const admin = useStore((s) => s.admin);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // WHAT THE READER'S KEYBOARD ACTUALLY TYPES. Every keystroke below is
  // resolved by physical position when the layout produces no Latin letter
  // (client/keys.ts), so on an Arabic keyboard the palette really is the key
  // marked P — which types ح. Printing "P" alone is true about the keycap and
  // useless to anyone reading their own screen, so where the browser will tell
  // us (Chromium's keyboard-layout map) the sheet prints both. Read on open,
  // never at module load: it is one async call, and a sheet nobody has opened
  // has no questions to answer.
  const [hints, setHints] = useState(layoutHints);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
    let live = true;
    void loadLayoutHints().then((map) => {
      if (live) setHints(map);
    });
    return () => {
      live = false;
    };
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const words = q ? q.split(/\s+/) : [];
    const scored = GROUPS.map((group) => {
      const items = group.items
        .filter(
          (item) =>
            (!item.admin || admin) &&
            (!item.shell || item.shell === shell) &&
            (!item.desktop || DESKTOP),
        )
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
  }, [query, admin, shell]);

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
        {/* Shown ONLY when the reader's layout types none of these letters —
            i.e. exactly when the letters on this sheet need explaining. On a
            US, AZERTY or Dvorak keyboard the map is empty and so is this. */}
        {hints.size > 0 && <p className="s-shortcuts__layout">{t("scLayoutNote")}</p>}
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
                      {item.keys?.map((key, i) => {
                        // Single Latin letters are the only tokens a layout can
                        // move out from under the reader. "Ctrl/Cmd", "Shift",
                        // "Esc" and the arrow glyphs are the same key on every
                        // keyboard on earth.
                        const typed = key.length === 1 ? hints.get(key.toLowerCase()) : undefined;
                        return (
                          <span className="s-shortcuts__key" key={key}>
                            {i > 0 && (
                              <span className="s-shortcuts__plus" aria-hidden="true">
                                +
                              </span>
                            )}
                            <kbd className="s-kbd">{key}</kbd>
                            {typed && (
                              <span className="s-shortcuts__typed" lang="" dir="auto">
                                {typed}
                              </span>
                            )}
                          </span>
                        );
                      })}
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
