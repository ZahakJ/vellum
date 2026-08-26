// The renderer's side of the desktop app: everything the native chrome asks
// the page to do, and the two things the page asks the native chrome for.
//
// ── HOW A MENU ITEM RUNS A VERB ────────────────────────────────────────────
//
// The native menu does not synthesize keystrokes and it does not reimplement
// anything: it sends a command NAME, and this file calls the same store action
// the keyboard calls. That is already the pattern in this codebase — the
// shortcut sheet's rows are `run: () => useStore.getState().toggleVim()` for
// exactly the same reason — and it is the only arrangement in which the menu
// and the keymap cannot drift into two behaviours with one label.
//
// It also means this file imports the store rather than being wired into it.
// Nothing in `client/state.ts`, `client/App.tsx` or `client/components/` knows
// the desktop exists; the desktop knows about them. That direction is the whole
// reason this stage is additive: delete `client/desktop/` and the web app is
// exactly what it was.
//
// ── AND WHY IT IS BEHIND A DYNAMIC IMPORT ──────────────────────────────────
//
// `client/main.tsx` reaches this module through `import()`, gated on the
// Electron user-agent test, so rollup gives it its own chunk and a browser
// never fetches a byte of it. `npm run check-bundle` measures the entry against
// a budget with ~8 kB of headroom; a desktop feature must not spend it.

import { openDailyNote } from "../daily.ts";
import { promptNewNote } from "../prompts.ts";
import { applyUrl } from "../router.ts";
import { useStore } from "../state.ts";
import { choiceGroup, counterpartChoice } from "../themes.ts";
import { t, tf } from "../i18n.ts";
import { toast } from "../toast.ts";
import { actionToast } from "../undoToast.ts";
import { setSpellcheckAvailable } from "../../shared/script.ts";
import { desktop, IS_DESKTOP } from "./bridge.ts";
import { closeFindBar, openFindBar, showFindResult } from "./findBar.ts";
import { openSpellMenu } from "./spellMenu.ts";

/** Save has no exported door — it lives in the editor's own keymap — so it is
 *  the one verb delivered as the keystroke it already is, aimed at whatever has
 *  focus. Everything else calls a function. */
function pressSave(): void {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : window;
  const mac = navigator.platform.toLowerCase().includes("mac");
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "s",
      code: "KeyS",
      ctrlKey: !mac,
      metaKey: mac,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function runCommand(command: string): void {
  const store = useStore.getState();
  switch (command) {
    case "new-note":
      if (store.admin) void promptNewNote("");
      return;
    case "daily-note":
      if (store.admin) void openDailyNote();
      return;
    case "save":
      pressSave();
      return;
    case "palette":
      store.setPaletteOpen(true);
      return;
    case "search":
      // The same event App.tsx's Ctrl/Cmd+K raises — the sidebar's search box
      // owns the focus dance, and there is no second copy of it here.
      window.dispatchEvent(new Event("vellum:quicksearch"));
      return;
    case "shortcuts":
      store.setShortcutsOpen(true);
      return;
    case "reading-view":
      if (!store.admin) return;
      store.toggleReading();
      if (store.view === "graph") store.setView("editor");
      return;
    case "graph":
      store.setView(store.view === "graph" ? "editor" : "graph");
      return;
    case "zen":
      store.setZen(!store.zen);
      return;
    case "publish":
      if (store.admin && store.openPath) void store.togglePublish(store.openPath);
      return;
    case "sidebar":
      store.toggleSidebar();
      return;
    case "panel":
      store.setPanelCollapsed(!store.panelCollapsed);
      return;
    case "find-open":
      openFindBar();
      return;
    case "print":
      // Same door the palette row and Ctrl/Cmd+Alt+P use, and dynamic for the
      // same reason: client/print.ts carries the markdown renderer, and this
      // module is small on purpose.
      void import("../print.ts").then((mod) => mod.printNote());
      return;
    case "reference-window":
      void desktop()?.openReference(location.pathname + location.search);
      return;
  }
}

/**
 * OS DARK MODE, FOLLOWED.
 *
 * The web app has no answer to this: `prefers-color-scheme` is not wired to the
 * theme anywhere in `client/`, because a self-hosted vault's theme is a
 * decision its owner made and stored, not a property of the machine it is being
 * read on. On the DESKTOP the machine is the reader's, they set its appearance
 * on a schedule, and every other application on it obeys.
 *
 * So the flip moves to the COUNTERPART of whatever the reader currently has —
 * `counterpartChoice` is the same function the ☾/☀ button uses, so a custom
 * theme lands on its base's curated opposite rather than on a random room. A
 * theme the reader picks by hand stays picked; the next time the OS turns over,
 * it turns over with it. That is what a Mac app does, and it is the behaviour
 * that does not need explaining.
 */
function followOsTheme(dark: boolean): void {
  const store = useStore.getState();
  const want = dark ? "dark" : "light";
  if (choiceGroup(store.theme) === want) return;
  store.setTheme(counterpartChoice(store.theme));
}

/**
 * DRAG A NOTE OUT AS A REAL FILE.
 *
 * The tree already makes its rows draggable and puts the note's path on the
 * drag (`client/components/Sidebar.tsx`), which is what the in-app move uses.
 * A capture-phase listener on the document reads the same `data-tree-path` the
 * row already carries and, in the desktop only, hands the drag to the OS
 * instead: the payload becomes the FILE, so dropping it in Mail attaches it and
 * dropping it in a folder copies it.
 *
 * Delegated rather than wired into the row, deliberately — the desktop must not
 * need an edit inside a component to add a capability the component does not
 * know about. `startDrag` takes the gesture over, so the in-app drop targets
 * stop seeing it; that is the trade, and it is the right way round, because
 * moving a note between folders has a menu and a keyboard route while dragging
 * one to the Finder has neither.
 */
function installDragOut(): void {
  document.addEventListener(
    "dragstart",
    (event) => {
      const bridge = desktop();
      if (!bridge || !(event.target instanceof HTMLElement)) return;
      // Only with a modifier: a bare drag is still the tree's own move. Alt is
      // the "copy elsewhere" modifier on every platform's file manager.
      if (!event.altKey) return;
      const row = event.target.closest<HTMLElement>("[data-tree-path]");
      const rel = row?.dataset.treePath;
      if (!rel) return;
      event.preventDefault();
      void bridge.dragNote(rel);
    },
    true,
  );
}

let mounted = false;

/** Wire the renderer to the desktop. Safe to call in a browser: it returns
 *  immediately, which is what lets `client/main.tsx` keep its gate to one line
 *  and lets this module be the only thing that knows the answer. */
export async function mountDesktop(): Promise<void> {
  const bridge = desktop();
  if (!IS_DESKTOP || !bridge || mounted) return;
  mounted = true;

  bridge.onCommand(runCommand);
  bridge.onSpellMenu(openSpellMenu);
  bridge.onFindResult(showFindResult);
  bridge.onOsTheme(followOsTheme);
  // Updates, said in the app's own voice. Never a dialog: a release is good
  // news arriving at a random moment, and good news does not get to interrupt
  // a sentence. "Ready" carries the one action worth a button; the other
  // phases are one quiet line each, and the timer's "you are current" is not
  // shown at all — only the menu's explicit ask answers out loud.
  bridge.onUpdateState((payload) => {
    const state = payload as { phase?: string; version?: string };
    const version = state.version ?? "";
    switch (state.phase) {
      case "ready":
        actionToast(tf("updateReady", { version }), t("updateRestart"), () => {
          void bridge.updateApply();
        });
        break;
      case "available":
        // A build a package manager owns cannot swap itself; the button opens
        // the release page instead of pretending.
        actionToast(tf("updateAvailable", { version }), t("updateView"), () => {
          void bridge.updateApply();
        });
        break;
      case "downloading":
        toast(tf("updateDownloading", { version }));
        break;
      case "current":
        toast(t("updateCurrent"));
        break;
      case "failed":
        toast(t("updateFailed"), "error");
        break;
    }
  });
  bridge.onNavigate((route) => {
    if (!route.startsWith("/")) return;
    history.pushState(null, "", route);
    applyUrl();
  });

  installDragOut();
  window.addEventListener("beforeunload", closeFindBar);

  // The native menu follows the READER's chrome language, told once now and
  // again on every change — from a store subscription rather than the setter,
  // so a language switched from the palette, the settings panel or another
  // window's broadcast all reach the menu without knowing it exists.
  void bridge.chromeLang(useStore.getState().language);
  useStore.subscribe((s, prev) => {
    if (s.language !== prev.language) void bridge.chromeLang(s.language);
  });

  const hello = await bridge.hello();
  // Tell the editor which languages a DICTIONARY actually exists for, so the
  // per-line `lang` invites the checker only where checking can be right —
  // "*" is macOS, whose system checker reads the attribute itself.
  setSpellcheckAvailable(hello.spellLanguages ?? []);
  // A deep link or a double-clicked `.md` that arrived before this document
  // existed. The main process holds exactly one, and hands it over here rather
  // than sending it into a window that has no listener yet.
  if (hello.pendingRoute) {
    history.replaceState(null, "", hello.pendingRoute);
    applyUrl(true);
  }
}
