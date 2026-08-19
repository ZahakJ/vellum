// The desktop app.
//
// One process supervising N vaults; one vault is one server child, one Electron
// session partition, one persisted port and one or more windows. Everything
// interesting about the arrangement is argued for in the file that owns it:
//
//   electron/server.ts       why the server is SPAWNED, not imported
//   electron/prefs.ts        why the port is persisted per vault
//   electron/auth.ts         why the owner never meets a login screen, and why
//                            that is not a way to bypass auth on a shared box
//   electron/spellcheck.ts   why the system dictionary lands in `.s-menu`
//   electron/menu.ts         why New window is not Cmd/Ctrl+N
//   electron/probe.ts        the four ways a packaged build dies at boot
//
// This file is the wiring, and it holds the two things that have nowhere else
// to live: the registry of open vaults, and the single place every `ipcMain`
// handler is registered (so the bridge can be read top to bottom in one sitting
// and counted by `npm run check-desktop`).

import {
  BrowserWindow,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
} from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { TO_MAIN, TO_RENDERER, type Command, type Hello } from "./ipc.ts";
import { keepSignedIn, mintCredential, signIn, type Credential } from "./auth.ts";
import { PROTOCOL, knownVault, parseDeepLink, relativeNote, routeForNote, vaultForFile } from "./deeplink.ts";
import { applyMenu, trayMenu, type RecentEntry } from "./menu.ts";
import { m, menuLang, mf, setMenuLang } from "./menuStrings.ts";
import {
  forgetVault,
  recentVaults,
  rememberBounds,
  rememberVault,
  rememberedPort,
  type Bounds,
} from "./prefs.ts";
import { APP_ROOT, startVaultServer, type VaultServer } from "./server.ts";
import { enableSpellcheck, replaceMisspelling, spellMenuFor } from "./spellcheck.ts";
import { dataDirFor, flushPrefs, loadPrefs, partitionFor, savePrefs } from "./store.ts";
import { createReferenceWindow, createVaultWindow, focusedFirst, tell } from "./windows.ts";

const ICON = path.join(APP_ROOT, "desktop", "icons", "icon.png");

interface Instance {
  vault: string;
  vaultName: string;
  server: VaultServer;
  session: Electron.Session;
  credential: Credential;
  stopKeepAlive: () => void;
  windows: Set<BrowserWindow>;
  /** A route that arrived before a window was ready to receive it. */
  pendingRoute: string | null;
  spellcheck: boolean;
}

/** Vault path → instance. The registry, and the reason "one window per vault"
 *  is cheap: the second request for a vault finds this and focuses. */
const instances = new Map<string, Instance>();
let tray: Tray | null = null;
let credential: Credential | null = null;
let quitting = false;

// ──────────────────────────────────────────────────────────────── boot order

// The protocol has to be claimed BEFORE the ready event on Windows and Linux,
// where it writes a registry key / a .desktop entry naming this executable. In
// dev the executable is `electron`, so the argv it must be re-launched with is
// spelled out — otherwise the OS registers "electron" itself as the handler for
// every vellum:// link on the machine.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// SECOND LAUNCH IS NOT A SECOND APP. Double-clicking a `.md`, following a
// `vellum://` link, or launching the app again while it is running all arrive
// as a second process; without the lock each of them would start its own server
// on its own port, and the reader would have two windows on one vault with two
// origins and therefore two sets of remembered tabs.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    void handleArgv(argv);
  });
  void start();
}

async function start(): Promise<void> {
  await app.whenReady();
  await runProbe();
  credential = await mintCredential();
  nativeTheme.on("updated", () => {
    for (const win of BrowserWindow.getAllWindows()) {
      tell(win, TO_RENDERER.osTheme, nativeTheme.shouldUseDarkColors);
    }
  });
  registerBridge();
  installTray();
  refreshMenu();
  await handleArgv(process.argv);
  // Nothing to open: ask. A vault picker on first launch is the app's first
  // sentence, so it is a real dialog with a real question, not an "Open…".
  if (instances.size === 0) await openVaultDialog();
  if (instances.size === 0 && process.platform !== "darwin") app.quit();
}

app.on("window-all-closed", () => {
  // macOS keeps the app alive with no windows — that is the platform's model
  // and the tray is right there. Everywhere else, no windows means done.
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  const first = instances.values().next().value;
  if (first) restoreWindow(first);
  else void openVaultDialog();
});

app.on("before-quit", () => {
  quitting = true;
  for (const instance of instances.values()) {
    instance.stopKeepAlive();
    instance.server.stop();
  }
  flushPrefs();
});

// macOS delivers both of these as events rather than as argv.
app.on("open-url", (event, url) => {
  event.preventDefault();
  void openDeepLink(url);
});
app.on("open-file", (event, file) => {
  event.preventDefault();
  void openFile(file);
});

/** The four boot preconditions, asked of the runtime that will actually run
 *  the server. A packaged app that fails one of these opens a window onto
 *  nothing; this turns that into a sentence. */
async function runProbe(): Promise<void> {
  const output = await new Promise<{ code: number | null; text: string }>((resolve) => {
    const child = spawn(process.execPath, [path.join(APP_ROOT, "electron", "probe.ts")], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      cwd: APP_ROOT,
    });
    let text = "";
    child.stdout?.on("data", (chunk: Buffer) => (text += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (text += chunk.toString()));
    child.on("error", (err) => resolve({ code: 1, text: String(err) }));
    child.on("exit", (code) => resolve({ code, text }));
  });
  if (output.code === 0) return;
  dialog.showErrorBox(m("dlgProbeFailedTitle"), output.text.trim());
  app.exit(1);
}

// ───────────────────────────────────────────────────────────── opening vaults

async function openVaultDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: m("dlgChooseVault"),
    buttonLabel: m("dlgChooseVaultButton"),
    properties: ["openDirectory", "createDirectory"],
  });
  const chosen = result.filePaths[0];
  if (!result.canceled && chosen) await openVault(chosen);
}

/**
 * Open a vault: start its server, sign the app in, and put a window on it.
 * Idempotent — asking for a vault that is already open focuses the window it
 * already has, which is what makes "one window per vault" true across deep
 * links, file associations and second launches alike.
 */
/** Opens IN FLIGHT, keyed like `instances`. The instance registry only gains
 *  its row once the server has booted and the window exists, which is seconds
 *  — and a second ask inside that window (a double-clicked dock icon, a deep
 *  link landing during first launch, two files opened together) found no row,
 *  and started a SECOND server and a second window on the same vault, the two
 *  then fighting over one registry key. Idempotent has to mean "from the first
 *  moment of the first ask", not "once the slow part is done". */
const opening = new Map<string, Promise<void>>();

async function openVault(vaultPath: string, route = "/"): Promise<void> {
  const vault = path.resolve(vaultPath);
  const existing = instances.get(vault);
  if (existing) {
    if (route !== "/") deliver(existing, route);
    restoreWindow(existing);
    return;
  }
  const inFlight = opening.get(vault);
  if (inFlight !== undefined) {
    // Join the open already underway; deliver the route once it lands.
    await inFlight;
    const opened = instances.get(vault);
    if (opened) {
      if (route !== "/") deliver(opened, route);
      restoreWindow(opened);
    }
    return;
  }
  const work = openVaultUnguarded(vault, route);
  opening.set(vault, work.finally(() => opening.delete(vault)));
  return opening.get(vault);
}

async function openVaultUnguarded(vault: string, route: string): Promise<void> {
  const prefs = loadPrefs();
  // Read BEFORE the open is recorded: `rememberVault` below overwrites this
  // vault's row with the port it actually got, and the dialog at the end of
  // this function has to name the one it LOST.
  const wantedPort = rememberedPort(vault, prefs);
  if (!credential) throw new Error("vellum: no credential minted");
  let server: VaultServer;
  try {
    server = await startVaultServer({
      vault,
      dataDir: dataDirFor(vault),
      prefs,
      credential,
      onLog: (line) => process.stdout.write(line),
      onExit: (code, signal) => onServerExit(vault, code, signal),
    });
  } catch (err) {
    await failedToOpen(err);
    return;
  }

  const ses = session.fromPartition(partitionFor(vault));
  let lifetime: number;
  try {
    lifetime = await signIn(ses, server.origin, credential);
  } catch (err) {
    // The app could not sign in to its own server. Left unhandled this is the
    // worst-shaped failure available here: the child keeps running, holding the
    // vault's port and watching its directory, while the window that appears
    // shows a login modal for a password no human has ever seen. So the server
    // goes with it and the reader gets a sentence.
    server.stop();
    await failedToOpen(err);
    return;
  }
  const instance: Instance = {
    vault,
    vaultName: path.basename(vault),
    server,
    session: ses,
    credential,
    stopKeepAlive: keepSignedIn(ses, server.origin, credential, lifetime, (err) =>
      console.error("vellum: could not refresh the desktop session:", err),
    ),
    windows: new Set(),
    pendingRoute: null,
    spellcheck: prefs.spellcheck,
  };
  instances.set(vault, instance);

  // The chrome's language is the INSTANCE's, not the OS's: a vault configured
  // in Arabic gets an Arabic menu bar, because the window under it is already
  // mirrored and translated. Asked once, over the session that just signed in.
  await adoptLanguage(instance);
  enableSpellcheck(ses, menuLang(), instance.spellcheck);

  savePrefs(rememberVault(loadPrefs(), vault, server.port, Date.now()));
  newWindowFor(instance, route);
  refreshMenu();

  // THE ONE THING THE READER HAS TO BE TOLD. Their theme, tabs, folds and pane
  // sizes for this vault are `localStorage`, `localStorage` is keyed by origin,
  // and the origin is the port — so a vault that could not have its port is a
  // vault whose layout has just silently reverted to defaults. Nothing inside
  // the app can explain that, because from the inside nothing went wrong.
  if (server.moved) {
    void dialog.showMessageBox({
      type: "info",
      title: m("dlgPortMovedTitle"),
      message: m("dlgPortMovedTitle"),
      detail: mf("dlgPortMovedBody", { old: wantedPort, port: server.port }),
    });
  }
}

/** A vault that would not open, said out loud, with a way forward.
 *
 *  `server/index.ts` prints the sentence that fixes a bad configuration and
 *  exits 1 — carrying its stderr into this box is what puts that sentence in
 *  front of the reader instead of "something went wrong". The two buttons are
 *  the only two things a reader can actually do from here. */
async function failedToOpen(err: unknown): Promise<void> {
  const choice = await dialog.showMessageBox({
    type: "error",
    title: m("dlgServerFailedTitle"),
    message: m("dlgServerFailedTitle"),
    detail: String(err instanceof Error ? err.message : err),
    buttons: [m("dlgChooseAnother"), m("dlgQuit")],
    defaultId: 0,
  });
  if (choice.response === 0) await openVaultDialog();
  else app.quit();
}

/** Ask the instance what language its chrome speaks, and dress the native menu
 *  to match. `/api/me` is the same call the shell makes; the session cookie is
 *  already in this vault's jar, so it answers as the admin. */
async function adoptLanguage(instance: Instance): Promise<void> {
  try {
    const res = await instance.session.fetch(`${instance.server.origin}/api/me`);
    const me = (await res.json()) as { language?: string };
    setMenuLang(me.language === "ar" ? "ar" : "en");
  } catch {
    // A menu in English is a bad day; a launch that fails because a menu could
    // not be translated is a worse one.
  }
}

function onServerExit(vault: string, code: number | null, signal: NodeJS.Signals | null): void {
  if (quitting) return;
  const instance = instances.get(vault);
  if (!instance) return;
  instances.delete(vault);
  instance.stopKeepAlive();
  for (const win of instance.windows) if (!win.isDestroyed()) win.close();
  refreshMenu();
  dialog.showErrorBox(
    m("dlgServerFailedTitle"),
    `${instance.vault}\n\n${code === null ? String(signal) : `exit ${code}`}`,
  );
}

// ────────────────────────────────────────────────────────────────── windows

function windowContext(instance: Instance): Parameters<typeof createVaultWindow>[0] {
  return {
    vault: instance.vault,
    vaultName: instance.vaultName,
    origin: instance.server.origin,
    partition: partitionFor(instance.vault),
    onBounds: (bounds: Bounds) => savePrefs(rememberBounds(loadPrefs(), instance.vault, bounds)),
  };
}

function newWindowFor(instance: Instance, route = "/"): BrowserWindow {
  const bounds = loadPrefs().vaults.find((v) => v.path === instance.vault)?.bounds ?? null;
  const win = createVaultWindow(windowContext(instance), bounds, route);
  instance.windows.add(win);
  win.on("closed", () => {
    instance.windows.delete(win);
    // The last window on a vault takes the vault's server with it. A server
    // with no window is a port held and a directory watched for nobody.
    if (instance.windows.size === 0 && !quitting) closeVault(instance);
  });
  win.on("focus", refreshMenu);
  return win;
}

function closeVault(instance: Instance): void {
  instances.delete(instance.vault);
  instance.stopKeepAlive();
  instance.server.stop();
  refreshMenu();
}

function restoreWindow(instance: Instance): void {
  const win = [...instance.windows][0];
  if (!win) {
    newWindowFor(instance);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
}

/** Which instance a webContents belongs to. The bridge answers per WINDOW, and
 *  a window belongs to exactly one vault — so every handler below resolves its
 *  caller rather than trusting anything the renderer sends about itself. */
function instanceOf(wc: Electron.WebContents): Instance | null {
  const win = BrowserWindow.fromWebContents(wc);
  if (!win) return null;
  for (const instance of instances.values()) if (instance.windows.has(win)) return instance;
  return null;
}

/** Send a route to a vault, or hold it until a window can take it. */
function deliver(instance: Instance, route: string): void {
  const win = [...instance.windows][0];
  if (!win) {
    // No window: the route IS the window's first URL, so there is nothing to
    // queue. `pendingRoute` exists for the other case — a link that arrives
    // while a window is loading, before its renderer can listen.
    newWindowFor(instance, route);
    return;
  }
  tell(win, TO_RENDERER.navigate, route);
  restoreWindow(instance);
}

// ───────────────────────────────────────────────── deep links & associations

/** Everything that can arrive on a command line: a `vellum://` URL, a note
 *  path, or nothing. Windows and Linux deliver both this way, on first launch
 *  and on `second-instance` alike. */
async function handleArgv(argv: string[]): Promise<void> {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith(`${PROTOCOL}://`)) {
      await openDeepLink(arg);
      return;
    }
  }
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("-")) continue;
    if (/\.(md|tex|latex)$/i.test(arg)) {
      await openFile(path.resolve(arg));
      return;
    }
  }
}

/**
 * A `vellum://` link. Hostile input by construction — any page in any browser
 * can navigate to one with no prompt — so the two refusals in
 * electron/deeplink.ts are the whole of the trust model:
 *
 *   · the note reference must stay inside the vault, and
 *   · the vault must be one this reader has ALREADY opened.
 *
 * The second is the one that matters. Without it, `vellum://open?vault=/` is a
 * link that makes the app index and serve the reader's entire disk.
 */
async function openDeepLink(url: string): Promise<void> {
  const link = parseDeepLink(url);
  if (!link) return;
  const route = link.note ? routeForNote(link.note) : "/";
  if (link.vault) {
    const known = knownVault(link.vault, loadPrefs().vaults.map((v) => v.path));
    if (!known) return; // a stranger does not get to choose a directory
    await openVault(known, route);
    return;
  }
  const focused = focusedInstance() ?? instances.values().next().value ?? null;
  if (focused) deliver(focused, route);
}

/** A `.md` double-clicked in the file manager. If it belongs to a vault we
 *  know, open it there; otherwise ask, because "which vault is this?" is a
 *  question only the reader can answer and guessing means indexing a folder
 *  they never chose. */
async function openFile(file: string): Promise<void> {
  const known = loadPrefs().vaults.map((v) => v.path);
  const vault = vaultForFile(file, known);
  if (vault) {
    const rel = relativeNote(vault, file);
    await openVault(vault, rel ? routeForNote(rel) : "/");
    return;
  }
  await openVaultDialog();
}

function focusedInstance(): Instance | null {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  for (const instance of instances.values()) if (instance.windows.has(win)) return instance;
  return null;
}

// ──────────────────────────────────────────────────────────────── the bridge
//
// EVERY `ipcMain` handler in the app is in this function, and every one of them
// resolves its caller through `instanceOf` before it does anything. A renderer
// cannot name a vault, a path or a window: it can only act on the one it is
// already inside.

function registerBridge(): void {
  ipcMain.handle(TO_MAIN.hello, (event): Hello => {
    const instance = instanceOf(event.sender);
    const pendingRoute = instance?.pendingRoute ?? null;
    if (instance) instance.pendingRoute = null;
    return {
      platform: process.platform,
      vault: instance?.vault ?? "",
      vaultName: instance?.vaultName ?? "",
      pendingRoute,
      spellcheck: instance?.spellcheck ?? false,
    };
  });

  ipcMain.handle(TO_MAIN.spellReplace, (event, text: unknown) => {
    if (typeof text === "string") replaceMisspelling(event.sender, text);
  });

  ipcMain.handle(TO_MAIN.spellAdd, (event, word: unknown) => {
    const instance = instanceOf(event.sender);
    if (instance && typeof word === "string" && word) {
      instance.session.addWordToSpellCheckerDictionary(word);
    }
  });

  ipcMain.handle(TO_MAIN.findInPage, (event, payload: unknown) => {
    const args = payload as { query?: unknown; forward?: unknown; again?: unknown };
    if (typeof args?.query !== "string" || args.query === "") {
      event.sender.stopFindInPage("clearSelection");
      return;
    }
    event.sender.findInPage(args.query, {
      forward: args.forward !== false,
      findNext: args.again === true,
    });
  });

  ipcMain.handle(TO_MAIN.findStop, (event) => {
    event.sender.stopFindInPage("clearSelection");
  });

  // DRAG A NOTE OUT TO THE DESKTOP AS A REAL FILE.
  //
  // The browser can put text on a drag; it cannot put a FILE, because the file
  // is on the server's disk and the page only has bytes. Here the two are the
  // same machine, so the drag payload is the note itself — drop it in Mail and
  // it attaches, drop it in a folder and it copies, drop it in another editor
  // and it opens. The path is rebuilt from the vault root and the renderer's
  // relative reference, so nothing the renderer sends can name a file outside
  // the vault it is already showing.
  ipcMain.handle(TO_MAIN.dragNote, (event, rel: unknown) => {
    const instance = instanceOf(event.sender);
    if (!instance || typeof rel !== "string") return;
    const relative = safeRelative(rel);
    if (!relative) return;
    const file = path.join(instance.vault, relative);
    if (!file.startsWith(instance.vault + path.sep)) return;
    event.sender.startDrag({ file, icon: dragIcon() });
  });

  ipcMain.handle(TO_MAIN.openReference, (event, route: unknown) => {
    const instance = instanceOf(event.sender);
    if (!instance || typeof route !== "string" || !route.startsWith("/")) return;
    const win = createReferenceWindow(windowContext(instance), route);
    instance.windows.add(win);
    win.on("closed", () => instance.windows.delete(win));
  });
}

/** A vault-relative path with no escape. Same rule as deeplink.ts's `noteRef`,
 *  minus the note-extension requirement — an attachment is draggable too. */
function safeRelative(rel: string): string | null {
  if (!rel || rel.includes("\0")) return null;
  const folded = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = path.posix.normalize(folded);
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) return null;
  return normalized;
}

let cachedDragIcon: Electron.NativeImage | null = null;

/** `startDrag` requires an icon and throws on an empty one. */
function dragIcon(): Electron.NativeImage {
  if (cachedDragIcon) return cachedDragIcon;
  const image = nativeImage.createFromPath(ICON);
  cachedDragIcon = image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 64, height: 64 });
  return cachedDragIcon;
}

// ── the spelling menu, and the find bar's results ──────────────────────────
// Both are per-window subscriptions rather than bridge channels, because both
// are things the WINDOW does rather than things the renderer asks for. They are
// attached once, in `createVaultWindow`'s wake, via the app-wide event.
app.on("web-contents-created", (_event, contents) => {
  contents.on("context-menu", (_e, params) => {
    const payload = spellMenuFor(params);
    if (!payload) return;
    contents.send(TO_RENDERER.spellMenu, payload);
  });
  contents.on("found-in-page", (_e, result) => {
    contents.send(TO_RENDERER.findResult, {
      matches: result.matches,
      active: result.activeMatchOrdinal,
    });
  });
});

// ────────────────────────────────────────────────────────────── menu & tray

function refreshMenu(): void {
  const focused = BrowserWindow.getFocusedWindow();
  const instance = focusedInstance();
  const recents: RecentEntry[] = recentVaults(loadPrefs()).map((v) => ({
    path: v.path,
    name: path.basename(v.path),
  }));
  applyMenu({
    send: sendCommand,
    openVault: () => void openVaultDialog(),
    openRecent: (vault) => void openVault(vault),
    clearRecent: () => {
      let prefs = loadPrefs();
      // The OPEN vaults stay: "clear the list" is about history, and removing
      // a vault that is on screen would take its remembered port with it.
      for (const entry of prefs.vaults) {
        if (!instances.has(entry.path)) prefs = forgetVault(prefs, entry.path);
      }
      savePrefs(prefs);
      refreshMenu();
    },
    newWindow: () => {
      const current = focusedInstance();
      if (current) newWindowFor(current);
      else void openVaultDialog();
    },
    revealVault: () => {
      if (instance) void shell.openPath(instance.vault);
    },
    about: showAbout,
    recents,
    spellcheckEnabled: loadPrefs().spellcheck,
    setSpellcheck: (on) => {
      savePrefs({ ...loadPrefs(), spellcheck: on });
      for (const each of instances.values()) {
        each.spellcheck = on;
        enableSpellcheck(each.session, menuLang(), on);
      }
      refreshMenu();
    },
    focused,
  });
}

function sendCommand(command: Command): void {
  tell(focusedFirst()[0] ?? null, TO_RENDERER.command, command);
}

function showAbout(): void {
  void dialog.showMessageBox({
    type: "info",
    title: m("menuAbout"),
    message: `Vellum ${app.getVersion()}`,
    detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
  });
}

/** The tray/menubar presence. Its value is not the menu — it is that quitting
 *  the last window does not have to mean quitting the app, so the vault the
 *  reader lives in is one click away all day. */
function installTray(): void {
  const image = nativeImage.createFromPath(ICON);
  if (image.isEmpty()) return; // no icon on disk (dev, before the build) — no tray
  tray = new Tray(image.resize({ width: 22, height: 22 }));
  tray.setToolTip("Vellum");
  tray.setContextMenu(
    trayMenu({
      show: () => {
        const first = instances.values().next().value;
        if (first) restoreWindow(first);
        else void openVaultDialog();
      },
      newNote: () => sendCommand("new-note"),
      openVault: () => void openVaultDialog(),
    }),
  );
  tray.on("click", () => {
    const first = instances.values().next().value;
    if (first) restoreWindow(first);
  });
}
