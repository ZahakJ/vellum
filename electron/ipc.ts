// The bridge's whole vocabulary, in one file, because `npm run check-desktop`
// counts it.
//
// A preload bridge is the only hole in `contextIsolation: true`, so its size is
// the security property — and the way a bridge stops being small is not a bad
// decision, it is entropy: someone adds a channel for a one-off, the preload
// keeps forwarding it after the caller is gone, and two releases later the
// renderer can ask the main process for things nobody remembers granting. So
// every channel is named HERE, exactly once, in the direction it travels, and
// the gate asserts the arithmetic: one `ipcMain.handle` and one
// `ipcRenderer.invoke` per TO_MAIN channel, one `.send` and one
// `ipcRenderer.on` per TO_RENDERER channel. A channel with two callers fails.
// A channel with none fails — a dead channel is a hole that no longer has a
// reason, which is the worst kind to leave open.
//
// Electron-free on purpose: `tests/desktop.test.ts` imports this file, and the
// root `npm run typecheck` follows it in from there. The desktop app's names
// are checked by the release gate every contributor already runs.

/** Renderer asks, main answers (`ipcRenderer.invoke` ⇄ `ipcMain.handle`). */
export const TO_MAIN = {
  /** First word from a mounted shell: it collects what the renderer cannot
   *  know about itself (platform, which vault this window is, whether a deep
   *  link arrived before React did) in ONE round trip. A window that has not
   *  said hello has no queued route delivered to it — see main.ts. */
  hello: "vellum:hello",
  /** Commit a spelling suggestion the reader picked out of Vellum's own menu.
   *  Main calls `webContents.replaceMisspelling`, which lands as a native
   *  `insertReplacementText` — the editor's own DOM observer handles it, so
   *  the desktop's spellchecker needs no hook into `client/editor/`. */
  spellReplace: "vellum:spell-replace",
  /** Teach the system dictionary a word ("Add to dictionary"). */
  spellAdd: "vellum:spell-add",
  /** Native find-in-page: the whole rendered document, including the reading
   *  view, the outline and the backlinks panel — which is the half `Ctrl/Cmd F`
   *  (CodeMirror's find, scoped to the open note) cannot reach. */
  findInPage: "vellum:find-in-page",
  /** Drop the find highlight and give the selection back. */
  findStop: "vellum:find-stop",
  /** Begin an OS drag whose payload is the note's real file on disk, so a note
   *  dragged to the Finder/Explorer lands as a `.md`, not as a URL. */
  dragNote: "vellum:drag-note",
  /** Open a second, always-on-top window on one note — the reference window. */
  openReference: "vellum:open-reference",
} as const;

/** Main tells, renderer listens (`webContents.send` ⇄ `ipcRenderer.on`). */
export const TO_RENDERER = {
  /** A native menu item, a tray item or an accelerator fired. The payload is a
   *  command NAME, never a keystroke: the menu and the in-app keymap must not
   *  drift into two spellings of the same verb. */
  command: "vellum:command",
  /** A misspelling was right-clicked: the word, the system dictionary's
   *  suggestions, and where the pointer was. Vellum draws the menu. */
  spellMenu: "vellum:spell-menu",
  /** Match count and active index for the find bar. */
  findResult: "vellum:find-result",
  /** Go somewhere: a `vellum://` deep link, or a file association opening a
   *  note that is already inside this window's vault. */
  navigate: "vellum:navigate",
  /** The OS switched between light and dark. */
  osTheme: "vellum:os-theme",
} as const;

export type ToMainChannel = (typeof TO_MAIN)[keyof typeof TO_MAIN];
export type ToRendererChannel = (typeof TO_RENDERER)[keyof typeof TO_RENDERER];

/** Every command name the native chrome can send. Spelled once so the menu,
 *  the tray and the renderer's dispatch table cannot disagree about a verb. */
export const COMMANDS = [
  "new-note",
  "daily-note",
  "save",
  "palette",
  "search",
  "shortcuts",
  "reading-view",
  "graph",
  "zen",
  "publish",
  "find-open",
  "reference-window",
  "sidebar",
  "panel",
] as const;

export type Command = (typeof COMMANDS)[number];

/** What a window learns the moment it mounts. */
export interface Hello {
  platform: NodeJS.Platform;
  /** Absolute vault root this window is serving — the window title and the
   *  "reveal in Finder" affordances need it, and the renderer cannot derive it
   *  from an origin that is only ever `http://127.0.0.1:<port>`. */
  vault: string;
  vaultName: string;
  /** A route that arrived before this window had a document to receive it. */
  pendingRoute: string | null;
  /** Whether the session has a spellchecker at all — false on a build with no
   *  dictionary for any enabled language, and the renderer must not draw a
   *  spelling menu that can never be populated. */
  spellcheck: boolean;
}
