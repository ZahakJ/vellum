// Real OS windows, with the two things a browser tab cannot have: a position
// that survives quitting, and a lifetime that belongs to one vault.
//
// ── ONE WINDOW PER VAULT, AND WHY IT IS NOT ONE WINDOW PER NOTE ─────────────
// Vellum already has a window model — `client/workspace.ts` — with panes, tab
// groups and splits, and it is the model the reader learns. A desktop app that
// opened a new OS window per note would be a second, competing arrangement of
// the same idea, and the reader would have to keep both in their head. So the
// main window is the vault, the workspace inside it is the workspace, and the
// only OS window that is NOT a vault is the reference window below — which
// exists precisely because it is the one arrangement the in-app model cannot
// express: a note that stays visible over other applications.

import { BrowserWindow, screen, shell } from "electron";
import path from "node:path";
import { APP_ROOT } from "./server.ts";
import { onSomeDisplay, type Bounds } from "./prefs.ts";

/** The compiled preload. It is compiled — not run as TypeScript like the rest
 *  of `electron/` — because `sandbox: true` is not negotiable and a sandboxed
 *  preload is loaded by Chromium rather than by Node: no ESM, no type
 *  stripping, and `require` limited to `electron` itself. That constraint is
 *  the reason preload.ts inlines its channel names instead of importing
 *  ipc.ts, and the reason `check-desktop` counts them by string. */
const PRELOAD = path.join(APP_ROOT, "desktop", "build", "preload.js");

const DEFAULT_BOUNDS = { width: 1280, height: 860 };
/** Vellum's own ground colour (`--bg` on the default theme), so the window is
 *  the app's colour for the ~200ms before the first paint rather than white —
 *  which on a dark theme is a flash straight into the reader's eyes. */
const IRON_GALL = "#16130e";

export interface WindowContext {
  vault: string;
  vaultName: string;
  origin: string;
  partition: string;
  /** Called whenever this window's geometry settles, so the vault's bounds
   *  are what the reader last left, not what they first got. */
  onBounds: (bounds: Bounds) => void;
}

function restore(bounds: Bounds | null): Partial<Electron.BrowserWindowConstructorOptions> {
  if (!bounds) return DEFAULT_BOUNDS;
  if (!onSomeDisplay(bounds, screen.getAllDisplays())) return DEFAULT_BOUNDS;
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function webPreferences(partition: string): Electron.WebPreferences {
  return {
    preload: PRELOAD,
    partition,
    // The four that `npm run check-desktop` refuses to let anyone flip. They
    // are stated rather than left to default because a default is a decision
    // nobody wrote down: `sandbox` and `contextIsolation` have both been the
    // other way inside living memory of this framework, and a reader's vault
    // is on the other side of them.
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    // The point of the whole spellcheck arrangement: Chromium's own
    // spellchecker, reading the `lang` that client/editor/bidi.ts already puts
    // on each LINE. See electron/spellcheck.ts.
    spellcheck: true,
  };
}

/** Every window is fenced to its own vault's origin.
 *
 *  A note can contain a link to anywhere, and the reading view renders links.
 *  Without this, one click on `http://evil.example` replaces the app's window
 *  with somebody else's page — inside a window holding an authenticated
 *  session to the reader's vault. External links open in the reader's BROWSER,
 *  which is where a link to the web belongs; in-app navigation stays on the
 *  origin the app started. */
function fence(win: BrowserWindow, origin: string): void {
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${origin}/`) || url === origin) return;
    event.preventDefault();
    void openExternally(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternally(url);
    return { action: "deny" };
  });
}

/** `shell.openExternal` will hand ANY scheme to the OS, `file:` and
 *  `vellum:` included — so a note containing a crafted link would be a
 *  one-click "run this". Two schemes, and nothing else. */
async function openExternally(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
}

function watchBounds(win: BrowserWindow, onBounds: (bounds: Bounds) => void): void {
  const report = (): void => {
    // A maximized or minimized window's `getBounds()` is the maximized frame,
    // which is not what to restore to — `getNormalBounds()` is the size it
    // would return to, and the flag is remembered separately.
    if (win.isDestroyed() || win.isMinimized()) return;
    const b = win.getNormalBounds();
    onBounds({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
  };
  win.on("moved", report);
  win.on("resized", report);
  win.on("maximize", report);
  win.on("unmaximize", report);
  win.on("close", report);
}

/** The main window for a vault. */
export function createVaultWindow(ctx: WindowContext, bounds: Bounds | null, route = "/"): BrowserWindow {
  const win = new BrowserWindow({
    ...restore(bounds),
    minWidth: 480,
    minHeight: 400,
    // The title is the app's, not the document's: `client/` sets
    // `document.title` per note, and Electron would otherwise let a note name
    // overwrite the window title with no vault in it. `title` + this flag mean
    // "the vault is always in the title bar".
    title: ctx.vaultName,
    backgroundColor: IRON_GALL,
    show: false,
    autoHideMenuBar: false,
    webPreferences: webPreferences(ctx.partition),
  });
  if (bounds?.maximized) win.maximize();
  fence(win, ctx.origin);
  watchBounds(win, ctx.onBounds);
  // Painted before shown: a window that appears already holding the vault,
  // rather than a white rectangle that fills in.
  win.once("ready-to-show", () => win.show());
  reportFailures(win, ctx.origin);
  void win.loadURL(ctx.origin + route);
  return win;
}

/**
 * THE REFERENCE WINDOW — the thing this whole stage is for, in one feature.
 *
 * A second window on ONE note, always on top of every other application, with
 * the chrome out of the way. It is what you put the source in while you write
 * the essay, and it is the arrangement a browser fundamentally cannot give you:
 * a tab is always inside its window, and a window is always inside the stack.
 *
 * It is a plain window on the same origin with the same session, so it is the
 * same app — the same editor, the same theme, the same keys. Nothing about it
 * is a reduced mode.
 */
export function createReferenceWindow(ctx: WindowContext, route: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 360,
    minHeight: 300,
    title: ctx.vaultName,
    backgroundColor: IRON_GALL,
    show: false,
    alwaysOnTop: true,
    // Visible over full-screen apps too, on the platforms that distinguish —
    // otherwise "always on top" means "except when you are actually working".
    fullscreenable: false,
    webPreferences: webPreferences(ctx.partition),
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  fence(win, ctx.origin);
  win.once("ready-to-show", () => win.show());
  reportFailures(win, ctx.origin);
  void win.loadURL(ctx.origin + route);
  return win;
}

/** A window that cannot load its own origin, or whose renderer died, is the
 *  exact failure this app is most likely to have and least able to show: the
 *  window is the only place a message could go, and the window is the thing
 *  that failed. So it goes to the console the server's own output already
 *  shares, where a bug report can reach it. */
function reportFailures(win: BrowserWindow, origin: string): void {
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    // -3 is ERR_ABORTED, which every cancelled in-flight navigation reports —
    // including the ordinary one where a second load starts before the first
    // finishes. It is not a failure.
    if (code === -3) return;
    console.error(`vellum: could not load ${url || origin} — ${description} (${code})`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`vellum: the window's renderer stopped — ${details.reason}`);
  });
}

/** Send a message to one window, safely. A window can be closing while a menu
 *  click is still in flight, and `webContents.send` on a destroyed window
 *  throws — which would take the menu handler down with it. */
export function tell(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

/** Every open window across every vault, focused-first — the order the menu
 *  and the tray need when they have to pick "the current one". */
export function focusedFirst(): BrowserWindow[] {
  const all = BrowserWindow.getAllWindows();
  const focused = BrowserWindow.getFocusedWindow();
  return focused ? [focused, ...all.filter((w) => w !== focused)] : all;
}
