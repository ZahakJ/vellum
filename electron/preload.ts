// THE BRIDGE. Everything the renderer is allowed to ask the desktop for, and
// nothing else.
//
// ── WHY THE CHANNEL NAMES ARE TYPED OUT HERE INSTEAD OF IMPORTED ───────────
//
// `sandbox: true` is one of the four settings `npm run check-desktop` refuses
// to let anyone flip, and a sandboxed preload is loaded by Chromium rather than
// by Node: no ESM, no type stripping, and `require` limited to `electron` and a
// couple of polyfills. It cannot import `./ipc.ts`. It is compiled to CommonJS
// (desktop/tsconfig.preload.json) and it must be ONE self-contained file.
//
// So the names appear twice — once in electron/ipc.ts, once here — and the gate
// closes the gap the duplication opens: `check-desktop` reads the channel list
// out of ipc.ts and asserts each name appears EXACTLY ONCE in this file and
// exactly once on the main side, in the matching direction. Two callers is a
// finding; zero is a finding. A channel cannot drift, and a channel cannot be
// left behind after its caller is deleted, which is the shape a preload hole
// actually has.
//
// ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
//
// No `ipcRenderer`. No `require`. No file paths, no `fs`, no `child_process`,
// no "just run this command". The renderer is showing the reader's own notes,
// and notes contain other people's HTML: the reading view sanitizes it
// (client/reading/rawHtml.ts) and the server sends a CSP behind that, and this
// bridge is the third wall. Every method below takes plain data and returns
// plain data, and every one of them is something the main process would be
// willing to do for a stranger.

import { contextBridge, ipcRenderer } from "electron";

/** Callbacks are wrapped so the renderer never receives the IpcRendererEvent —
 *  it carries `sender`, which is a live handle to the whole IPC surface. */
function on<T>(channel: string, cb: (payload: T) => void): void {
  ipcRenderer.on(channel, (_event, payload: T) => cb(payload));
}

contextBridge.exposeInMainWorld("vellumDesktop", {
  /** One round trip on mount: platform, vault, a deep link that arrived before
   *  React did, and whether a spellchecker exists at all. */
  hello: () => ipcRenderer.invoke("vellum:hello"),

  // ── main → renderer ──────────────────────────────────────────────────────
  onCommand: (cb: (command: string) => void) => on("vellum:command", cb),
  onSpellMenu: (cb: (payload: unknown) => void) => on("vellum:spell-menu", cb),
  onFindResult: (cb: (payload: unknown) => void) => on("vellum:find-result", cb),
  onNavigate: (cb: (route: string) => void) => on("vellum:navigate", cb),
  onOsTheme: (cb: (dark: boolean) => void) => on("vellum:os-theme", cb),
  onUpdateState: (cb: (payload: unknown) => void) => on("vellum:update-state", cb),

  // ── renderer → main ──────────────────────────────────────────────────────
  /** The reader picked a spelling. */
  spellReplace: (text: string) => ipcRenderer.invoke("vellum:spell-replace", text),
  /** The reader taught the system dictionary a word. */
  spellAdd: (word: string) => ipcRenderer.invoke("vellum:spell-add", word),
  /** Native find-in-page. `forward` and `again` map onto Electron's own two
   *  flags; the renderer owns the find BAR, main owns the search. */
  findInPage: (query: string, forward: boolean, again: boolean) =>
    ipcRenderer.invoke("vellum:find-in-page", { query, forward, again }),
  findStop: () => ipcRenderer.invoke("vellum:find-stop"),
  /** Drag a note out of the window as its real file on disk. */
  dragNote: (rel: string) => ipcRenderer.invoke("vellum:drag-note", rel),
  /** Open this route in an always-on-top reference window. */
  openReference: (route: string) => ipcRenderer.invoke("vellum:open-reference", route),
  /** Apply a staged update and relaunch — or open the release page on a build
   *  that cannot swap itself in place. */
  updateApply: () => ipcRenderer.invoke("vellum:update-apply"),
});
