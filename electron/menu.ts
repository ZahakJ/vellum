// THE NATIVE APPLICATION MENU — and the one rule that decides every line of it.
//
// ── A MENU ITEM MUST NOT INVENT A KEYSTROKE ────────────────────────────────
//
// `client/components/ShortcutsHelp.tsx`'s `GROUPS` is the single place a
// binding exists in this product; `docs/keymap.md` is a rendering of it, and
// `npm run check-keymap` fails the build when two rows claim one chord. A
// native menu is a THIRD keyboard handler — the check-keymap header says so
// out loud — and it is the most dangerous of the three, because a menu
// accelerator is consumed by the OS BEFORE the page sees the key. An
// accelerator that disagrees with the ledger does not collide loudly; it makes
// the ledger's binding silently stop working, on one platform, for one build.
//
// So: every accelerator here is a chord the ledger already claims, spelled the
// way the ledger spells it, and the item forwards the same verb the key
// forwards. The menu is a VISIBLE INDEX of the keymap, not a second one.
//
// The single exception is New window, and it is the interesting one. Electron's
// convention for a new window is Cmd/Ctrl+N — and this app has claimed
// Ctrl/Cmd+N for **New note** since before the desktop existed. Taking it would
// mean the desktop build is the one place where the product's own documented
// binding does nothing, discovered by a reader who pressed it expecting a note
// and got an empty window. So New note keeps Ctrl/Cmd+N (and appears in the
// menu wearing it, which is what a menu is for) and New window takes
// Ctrl/Cmd+Shift+N. Find next / Find previous carry NO accelerator for the same
// family of reason: F3 and Ctrl/Cmd+G are both spoken for, and the find bar's
// own Enter / Shift+Enter already answer.
//
// Everything user-visible here comes from electron/menuStrings.ts — see the
// header there for why the strings are not yet in client/i18n.ts and what the
// merge looks like.

import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { m } from "./menuStrings.ts";
import type { Command } from "./ipc.ts";

export interface RecentEntry {
  path: string;
  name: string;
}

export interface MenuHandlers {
  /** Forward a verb to the focused window's renderer. */
  send: (command: Command) => void;
  openVault: () => void;
  openRecent: (vault: string) => void;
  clearRecent: () => void;
  newWindow: () => void;
  revealVault: () => void;
  about: () => void;
  recents: RecentEntry[];
  spellcheckEnabled: boolean;
  setSpellcheck: (on: boolean) => void;
  /** Null when the focused window is not one Vellum owns. */
  focused: BrowserWindow | null;
}

const isMac = process.platform === "darwin";

function recentsSubmenu(h: MenuHandlers): MenuItemConstructorOptions[] {
  if (h.recents.length === 0) {
    return [{ label: m("menuNoRecent"), enabled: false }];
  }
  return [
    ...h.recents.map((entry) => ({
      // The vault's own name, in the vault's own script — never the absolute
      // path, which on a real machine is forty characters of home directory
      // before the one word that distinguishes it. The full path is the
      // tooltip, where a reader who has two vaults called "notes" can find it.
      label: entry.name,
      toolTip: entry.path,
      click: () => h.openRecent(entry.path),
    })),
    { type: "separator" as const },
    { label: m("menuClearRecent"), click: () => h.clearRecent() },
  ];
}

export function buildMenu(h: MenuHandlers): Menu {
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      // The application menu is titled by the app on macOS, whatever we put
      // here, so this one label is not translated copy — it is the bundle name.
      label: "Vellum",
      submenu: [
        { label: m("menuAbout"), click: () => h.about() },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { label: m("menuQuit"), role: "quit" },
      ],
    });
  }

  template.push({
    label: m("menuFile"),
    submenu: [
      { label: m("newNote"), accelerator: "CmdOrCtrl+N", click: () => h.send("new-note") },
      { label: m("menuNewWindow"), accelerator: "CmdOrCtrl+Shift+N", click: () => h.newWindow() },
      { type: "separator" },
      { label: m("menuOpenVault"), accelerator: "CmdOrCtrl+O", click: () => h.openVault() },
      { label: m("menuRecentVaults"), submenu: recentsSubmenu(h) },
      { type: "separator" },
      // Ctrl/Cmd+Alt+D, which is what client/App.tsx actually binds — the
      // once-a-day verb moved out to Alt when the unmodified key went back to
      // the editor. (docs/keymap.md still prints the pre-Alt spelling; the menu
      // follows the code, because the menu is what the reader will press.)
      { label: m("cmdDailyNote"), accelerator: "CmdOrCtrl+Alt+D", click: () => h.send("daily-note") },
      { label: m("save"), accelerator: "CmdOrCtrl+S", click: () => h.send("save") },
      { type: "separator" },
      { label: m("menuRevealVault"), click: () => h.revealVault() },
      { type: "separator" },
      { label: m("menuCloseWindow"), accelerator: "CmdOrCtrl+W", role: "close" },
      ...(isMac ? [] : [{ label: m("menuQuit"), role: "quit" as const }]),
    ],
  });

  template.push({
    label: m("menuEdit"),
    submenu: [
      // Roles, not forwards. On macOS an Edit menu carrying these roles is
      // what makes Cmd+C work in a web view AT ALL — without it the clipboard
      // is dead in every text field in the app. Undo and redo arrive in the
      // page as native `historyUndo`/`historyRedo` beforeinput events, which
      // CodeMirror's own history extension already answers, so the editor's
      // undo stack stays the editor's.
      { label: m("undo"), role: "undo" },
      { label: m("menuRedo"), role: "redo" },
      { type: "separator" },
      { label: m("menuCut"), role: "cut" },
      { label: m("menuCopy"), role: "copy" },
      { label: m("menuPaste"), role: "paste" },
      { label: m("menuPastePlain"), role: "pasteAndMatchStyle" },
      { label: m("menuSelectAll"), role: "selectAll" },
      { type: "separator" },
      // NATIVE find-in-page, which is a different verb from Ctrl/Cmd+F. That
      // one is CodeMirror's find, scoped to the open note's TEXT. This searches
      // the rendered document — the reading view, the outline, the backlinks
      // panel, a transclusion — which is the half the editor's search cannot
      // reach and the reason a desktop app has both.
      { label: m("menuFindInPage"), accelerator: "CmdOrCtrl+Shift+F", click: () => h.send("find-open") },
      { label: m("menuFindNext"), click: () => h.send("find-open") },
      { label: m("menuFindPrevious"), click: () => h.send("find-open") },
      { type: "separator" },
      {
        label: m("menuSpelling"),
        submenu: [
          {
            label: m("menuSpellcheckWhileTyping"),
            type: "checkbox",
            checked: h.spellcheckEnabled,
            click: (item) => h.setSpellcheck(item.checked),
          },
        ],
      },
    ],
  });

  template.push({
    label: m("menuView"),
    submenu: [
      { label: m("cmdToggleReading"), accelerator: "CmdOrCtrl+E", click: () => h.send("reading-view") },
      { label: m("cmdToggleGraph"), accelerator: "CmdOrCtrl+G", click: () => h.send("graph") },
      { label: m("cmdZen"), accelerator: "CmdOrCtrl+Shift+Z", click: () => h.send("zen") },
      { type: "separator" },
      { label: m("cmdTogglePaneNotes"), accelerator: "CmdOrCtrl+Alt+B", click: () => h.send("sidebar") },
      {
        label: m("cmdTogglePaneOutline"),
        accelerator: "CmdOrCtrl+Alt+Shift+B",
        click: () => h.send("panel"),
      },
      { type: "separator" },
      { label: m("zoomIn"), role: "zoomIn" },
      { label: m("zoomOut"), role: "zoomOut" },
      { label: m("menuActualSize"), role: "resetZoom" },
      { label: m("menuFullScreen"), role: "togglefullscreen" },
      { type: "separator" },
      { label: m("menuReload"), role: "reload" },
      { label: m("menuDevTools"), role: "toggleDevTools" },
    ],
  });

  template.push({
    label: m("menuGo"),
    submenu: [
      { label: m("menuCommandPalette"), accelerator: "CmdOrCtrl+P", click: () => h.send("palette") },
      { label: m("menuSearchNotes"), accelerator: "CmdOrCtrl+K", click: () => h.send("search") },
      { type: "separator" },
      { label: m("cmdPublishNote"), accelerator: "CmdOrCtrl+Shift+P", click: () => h.send("publish") },
    ],
  });

  template.push({
    label: m("menuWindow"),
    submenu: [
      { label: m("menuMinimize"), role: "minimize" },
      ...(isMac ? [{ label: m("menuZoomWindow"), role: "zoom" as const }] : []),
      { type: "separator" },
      {
        label: m("menuReferenceWindow"),
        accelerator: "CmdOrCtrl+Alt+R",
        click: () => h.send("reference-window"),
      },
      {
        label: m("menuAlwaysOnTop"),
        type: "checkbox",
        checked: h.focused?.isAlwaysOnTop() ?? false,
        enabled: h.focused !== null,
        click: (item) => h.focused?.setAlwaysOnTop(item.checked, "floating"),
      },
      ...(isMac ? [{ type: "separator" as const }, { label: m("menuBringAllToFront"), role: "front" as const }] : []),
    ],
  });

  template.push({
    role: "help",
    label: m("menuHelp"),
    submenu: [
      { label: m("menuShortcuts"), accelerator: "CmdOrCtrl+/", click: () => h.send("shortcuts") },
      ...(isMac ? [] : [{ type: "separator" as const }, { label: m("menuAbout"), click: () => h.about() }]),
    ],
  });

  return Menu.buildFromTemplate(template);
}

/** Install the menu. Called again whenever anything it RENDERS changes — the
 *  recent list, the spellcheck flag, the instance language, which window is
 *  focused. An Electron menu is an immutable tree; "updating" one is building
 *  it again, and pretending otherwise is how a menu ends up showing last
 *  session's vaults. */
export function applyMenu(h: MenuHandlers): void {
  Menu.setApplicationMenu(buildMenu(h));
}

/** The tray/menubar menu. Deliberately four items: a tray icon is a place to
 *  get BACK to the app, not a second copy of it. */
export function trayMenu(h: {
  show: () => void;
  newNote: () => void;
  openVault: () => void;
}): Menu {
  return Menu.buildFromTemplate([
    { label: m("menuShowVellum"), click: h.show },
    { label: m("newNote"), click: h.newNote },
    { label: m("menuOpenVault"), click: h.openVault },
    { type: "separator" },
    { label: m("menuQuit"), role: "quit" },
  ]);
}
