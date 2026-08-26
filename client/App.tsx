// App shell: layout grid (sidebar | main | backlinks, status bar below),
// global keyboard shortcuts, and the single SSE subscription that keeps the
// tree, backlinks, and externally-changed open notes fresh.

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { lazySurface } from "./lazySurface.tsx";
import type { PropertyValue, VaultEvent } from "../shared/types.ts";
import { subscribeEvents } from "./api.ts";
import { coalesce } from "./coalesce.ts";
import { clearBrokenEmbeds } from "./editor/embeds.ts";
import { collectNotes } from "./editor/links.ts";
import { invalidateVaultGraph } from "./graphCache.ts";
import ConfirmHost from "./components/Confirm.tsx";
import LoginModal from "./components/LoginModal.tsx";
import PreviewBanner from "./components/PreviewBanner.tsx";
// The vim sub-mode copy table lives in its own module rather than in
// StatusBar, which is now lazy: a named import from a lazy component's file is
// a STATIC import of that file, and StatusBar reaches the designer, the theme
// picker and the sync badge. One named import would have dragged all of it
// back into the first paint and quietly undone the split below.
import { vimSubCopy } from "./vimCopy.ts";
// Always-mounted hosts stay STATIC. All four render (or stand ready to
// render) on every path through this component, so lazy() would buy no
// deferral — the import fires the moment they mount — while costing each of
// them a boundary and a round trip. Only a surface that is CONDITIONALLY
// mounted is worth splitting.
import DesignStatus from "./design/DesignStatus.tsx";
import TemplatePicker from "./components/TemplatePicker.tsx";
import { openDailyNote } from "./daily.ts";
import { t, tf } from "./i18n.ts";
import { isKey, shortcutKey } from "./keys.ts";
import { promptNewNote } from "./prompts.ts";
import { insertTemplateCommand, newNoteFromTemplateCommand } from "./templateActions.ts";
import { applyUrl, installRouter, syncUrl } from "./router.ts";
import { recentSelfWrite, sidebarIsDrawer, useStore } from "./state.ts";
import {
  adoptExternalChange,
  flushAllBuffers,
  revalidateBuffers,
  unsavedPaths,
} from "./editor/bufferBridge.ts";
import { dismissToasts, toast } from "./toast.ts";

/** Writes made by our own autosave echo back through the watcher; ignore
 *  "changed" events arriving within this window of a local save. */
const SELF_SAVE_WINDOW_MS = 1500;
/** The floor between two wake-up revalidations. An alt-tab raises `focus` and
 *  `visibilitychange` within a frame of each other, and a reader flicking
 *  between two windows raises them again a second later; the probe is cheap
 *  but it is not free, and nothing about a vault changes twice in two seconds
 *  that the SSE stream is not already carrying. */
const WAKE_THROTTLE_MS = 2000;

/** How long zen's ✕ lingers before fading out (any mouse move brings it back). */
const ZEN_HINT_MS = 2000;

/** Trailing window for whole-vault refreshes driven by the SSE stream. Above
 *  the watcher's own 100ms debounce, so a burst arrives as one wave, and far
 *  below the threshold at which a tree feels stale. */
const SSE_COALESCE_MS = 250;

// macOS binds Ctrl+B to emacs-style "char left" inside CodeMirror, and this
// file used to carry an IS_MAC test so the editor could keep it. The test is
// gone with the shortcut: Ctrl/Cmd+B is now the EDITOR's (bold), so the
// question "may the editor have this key" no longer has a platform answer —
// CodeMirror's own precedence decides, and plain Ctrl+B on macOS still reaches
// the emacs binding underneath `formatKeymap`'s Mod-b.

// Everything below this line is a SURFACE, not a shell: exactly one of the
// two shells is ever mounted, and most of the app shell's modals never open
// at all. Reaching them through lazy() is what gives rollup a boundary to
// split on — build/chunks.ts then regroups them so each surface arrives as
// one request rather than a waterfall of per-component chunks.
//
// ConfirmHost, LoginModal and PreviewBanner deliberately stay static above:
// all three render in the BLOG branch as well, so making them lazy would
// drag the app-shell chunk back into an anonymous reader's first paint —
// the exact cost this split exists to remove.
//
// The CodeMirror editor keeps its own chunk (its dependencies dwarf every
// other surface). That boundary is ASSERTED, not assumed:
// `node scripts/check-bundle.mjs` fails the build if CodeMirror, the vim
// keymap, KaTeX or the graph engine ever reappear in what a first paint
// downloads.
//
// EVERY ONE OF THESE GETS ITS OWN <Suspense>, and that is a correctness rule,
// not a taste one. A boundary is not a loading indicator: React unmounts the
// WHOLE subtree under the boundary that suspends and replaces it with the
// fallback. One boundary around the shell therefore meant that opening
// Settings — a modal — tore down the sidebar, the tabs, the editor and the
// status bar with it; on a throttled connection the open note went to zero
// characters while the reader watched, and CodeMirror was remounted from
// scratch when the chunk landed. It also broke focus: the dialogs capture
// `document.activeElement` as the opener to restore on Escape, and the
// element they were opened FROM had just been unmounted, so the first Escape
// of every session dropped focus to <body>. Per-surface boundaries fix both,
// because nothing that is already on screen is inside the boundary that
// suspends.
const Workspace = lazySurface(() => import("./components/Workspace.tsx"));
const BlogShell = lazySurface(() => import("./blog/BlogShell.tsx"));
const DesignedSite = lazySurface(() => import("./design/DesignedSite.tsx"));
const GraphView = lazySurface(() => import("./components/GraphView.tsx"));
const Sidebar = lazySurface(() => import("./components/Sidebar.tsx"));
const Tabs = lazySurface(() => import("./components/Tabs.tsx"));
const StatusBar = lazySurface(() => import("./components/StatusBar.tsx"));
const BacklinksPanel = lazySurface(() => import("./components/BacklinksPanel.tsx"));
const CommandPalette = lazySurface(() => import("./components/CommandPalette.tsx"));
const BannerModal = lazySurface(() => import("./components/BannerModal.tsx"));
const ModerationPanel = lazySurface(() => import("./components/ModerationPanel.tsx"));
const TrashModal = lazySurface(() => import("./components/TrashModal.tsx"));
const SettingsModal = lazySurface(() => import("./components/SettingsModal.tsx"));
// The keyboard-shortcut sheet is lazy AND mount-gated on `shortcutsOpen` —
// which is why it is worth splitting when the other always-mounted hosts are
// not. It renders in the BLOG branch too, so a static copy put its 389 lines,
// and the theme picker it reaches, into an anonymous article reader's first
// request in order to describe keys that reader has not pressed. The store
// already holds the open flag, so the mount can simply wait for it.
const ShortcutsHelp = lazySurface(() => import("./components/ShortcutsHelp.tsx"));

/** One lazy surface, one boundary. `fallback` defaults to nothing for the
 *  modals — a dialog that arrives a frame late is invisible, whereas a
 *  SKELETON that flashes where a dialog is about to be is not. The panes pass
 *  a real placeholder so the grid keeps its shape while the chunk lands. */
function Surface({ fallback = null, children }: { fallback?: ReactNode; children: ReactNode }) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

// ── Recently opened notes ──────────────────────────────────────────────────
// The empty state on a phone cannot be a keymap, and "here are four buttons"
// is only half an answer: the thing a reader wants at the top of a session is
// the note they were in. Nothing else in the client remembers that — the
// store persists OPEN TABS, and by definition there are none when this pane
// is on screen — so App keeps a short list of its own beside them. Paths only;
// they are re-checked against the live tree before anything is drawn, so a
// deleted note, a signed-out session and an admin previewing as a visitor all
// narrow the list by themselves rather than leaking a title.
const RECENT_KEY = "vellum.recent";
const RECENT_MAX = 12;
/** How many of them the empty state offers — a list, not an index. */
const RECENT_SHOWN = 5;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string").slice(0, RECENT_MAX);
  } catch {
    return []; // private mode, quota, a hand-edited value: not worth a toast
  }
}

/** Where Ctrl/Cmd+K goes, reached by tapping instead. The sidebar owns the
 *  search box and reveals itself when it is COLLAPSED — but on a phone that
 *  pane is a fixed drawer whose visibility is `sidebarOpen`, not
 *  `sidebarCollapsed`, so a bare dispatch would focus a field parked off the
 *  screen edge and swallow every keystroke after it. Open the drawer first and
 *  dispatch on the next frame, once React has committed the class that slides
 *  it in. */
function openQuickSearch(): void {
  const store = useStore.getState();
  // Same breakpoint as the drawer's own (state.ts owns the number): the
  // sidebar stops being a grid pane at 999px, not at 700, so quick search has
  // to open the drawer at every width where the search box lives inside it.
  if (sidebarIsDrawer()) store.setSidebarOpen(true);
  requestAnimationFrame(() => window.dispatchEvent(new Event("vellum:quicksearch")));
}

function pushRecent(path: string): string[] {
  const next = [path, ...readRecent().filter((p) => p !== path)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore — the in-memory list still works for this session */
  }
  return next;
}


export default function App() {
  const view = useStore((s) => s.view);
  const openPath = useStore((s) => s.openPath);
  const readingMode = useStore((s) => s.readingMode);
  const vimMode = useStore((s) => s.vimMode);
  const vimSubMode = useStore((s) => s.vimSubMode);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const loginOpen = useStore((s) => s.loginOpen);
  const bannerModalOpen = useStore((s) => s.bannerModalOpen);
  const moderationOpen = useStore((s) => s.moderationOpen);
  const trashOpen = useStore((s) => s.trashOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  // Subscribed here (not only inside the sheet) because App now decides
  // whether the sheet is MOUNTED at all — that is what keeps its chunk out of
  // the first paint on both shells.
  const shortcutsOpen = useStore((s) => s.shortcutsOpen);
  const previewVisitor = useStore((s) => s.previewVisitor);
  const reloadTick = useStore((s) => s.reloadTick);
  // Split at all? The shell's own tab bar belongs to the shell only while
  // there is one pane; past that each pane carries its own, because a tab bar
  // names what is open HERE and one strip above two panes cannot say which.
  const split = useStore(
    (s) => s.workspace.layout.columns.length > 1 || s.workspace.layout.columns[0].length > 1,
  );
  const admin = useStore((s) => s.admin);
  // Only the SSE effect below reads this, and only to reconnect the stream
  // when the reader's language changes (see the comment there).
  const language = useStore((s) => s.language);
  const authReady = useStore((s) => s.authReady);
  const publicLayout = useStore((s) => s.publicLayout);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const sidebarSide = useStore((s) => s.sidebarSide);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const panelCollapsed = useStore((s) => s.panelCollapsed);
  const zen = useStore((s) => s.zen);
  const locked = useStore((s) => !s.admin && !s.publicReads);
  const lang = useStore((s) => s.language); // re-render the chrome strings on language change
  const tree = useStore((s) => s.tree);
  /** Recently opened notes, for the phone's empty state (see readRecent). */
  const [recent, setRecent] = useState<string[]>(readRecent);
  const lastSaveRef = useRef(0);
  /** Where the caret was when Ctrl/Cmd+K threw focus into the search box —
   *  Esc puts it back there (see returnToNote in the keyboard effect). */
  const quickReturnRef = useRef<HTMLElement | null>(null);
  /** Zen's ✕ has been sitting still long enough to fade out. */
  const [zenIdle, setZenIdle] = useState(false);

  // The grid follows the inline direction, so the sidebar already sits on the
  // reading direction's leading edge (left in English, right in Arabic).
  // "Flipped" means the reader asked for the OTHER edge — the one rule that
  // has to be expressed physically, because the preference is physical.
  const flipped = (lang === "ar") === (sidebarSide === "left");

  // Public-shell modes (PUBLIC_LAYOUT=blog / designed): visitors get a public
  // shell that owns its own routes (/, /topic/…, article pages) — the app
  // router below must then stay uninstalled. Admin sessions keep the full app.
  // Both modes behave identically here on purpose: which of the two shells
  // renders is one line in the branch below, and everything else (no app
  // router, no app keybindings, the blog shortcut sheet) is the same answer.
  const blogVisitor = authReady && !admin && publicLayout !== "app";

  // Boot: /api/me, then tree + session restore / home note.
  useEffect(() => {
    void useStore.getState().bootstrap();
  }, []);

  // Several windows of one vault, behaving like one application: the theme and
  // the language follow each other, a saved note re-bases its peers' write
  // precondition, a sign-out is a barrier rather than an event, and exactly one
  // window at a time holds the pen on any given note.
  // DYNAMICALLY, because none of it is needed in the first frame. The bus, the
  // lease and the peer census answer a question — "is another window editing
  // this note" — that cannot arise until a note is open, and a static import
  // put four modules into the entry chunk that every anonymous blog reader then
  // downloaded to coordinate windows they do not have. `check-bundle` is what
  // noticed.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let dead = false;
    void import("./windows/coherence.ts").then((m) => {
      if (dead) return;
      stop = m.installWindowCoherence();
    });
    return () => {
      dead = true;
      stop?.();
    };
  }, []);

  // CLOSING THE TAB WITH UNSAVED TEXT IN IT.
  //
  // There was no `beforeunload` anywhere in the client, and `putNote` is a
  // plain fetch: closing a tab mid-sentence warned about nothing and saved
  // nothing. The loss is one sentence at a time, which is exactly why it
  // erodes trust instead of getting reported — nobody files a bug about a
  // paragraph they are not certain they wrote.
  //
  // Two halves, and the order matters. The BEACON goes first and
  // unconditionally, because it is the half that actually saves the work: a
  // `fetch` started here dies with the document, while `sendBeacon` is the one
  // transport the platform promises to deliver afterwards. Only then is the
  // browser's own "leave site?" dialog raised, and only when something was
  // still unsaved after the attempt — a confirmation prompt in front of a
  // reader whose work is already on its way is a prompt that teaches them to
  // click through prompts.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      flushAllBuffers();
      if (unsavedPaths().length === 0) return;
      e.preventDefault();
      // Every modern browser prints its own wording and ignores ours, but the
      // assignment is still what marks the event as needing the dialog.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Once the vault is in, the router takes over the address bar: a pasted
  // deep link outranks the restored session and the home note, and
  // back/forward walk visited notes. Re-installed when an admin signs in out
  // of the blog shell (blogVisitor flips false) and torn down on sign-out.
  useEffect(() => {
    if (!authReady || blogVisitor) return;
    const cleanup = installRouter();
    const hadDeepLink = location.pathname !== "/" && location.pathname !== "/graph";
    // A locked vault keeps the deep link in the address bar: it resolves
    // right after login (see installRouter's tree watcher). A bare "/"
    // keeps what bootstrap opened (home note / restored session) and
    // syncUrl() canonicalizes the address bar to it.
    if (useStore.getState().tree !== null && !applyUrl(true)) {
      // Blog-only routes (/topic/…) name nothing in the app shell — land
      // home quietly instead of complaining about a missing note.
      if (hadDeepLink && !location.pathname.startsWith("/topic/")) {
        toast(t("noteGone"));
      }
      syncUrl();
    }
    return cleanup;
  }, [authReady, blogVisitor]);

  // Track when the Editor finishes a save (dirty true -> false), so SSE
  // "changed" echoes of our own writes can be told apart from external edits.
  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        const p = state.openPath;
        if (p && prev.dirty[p] && !state.dirty[p]) lastSaveRef.current = Date.now();
      }),
    [],
  );

  // Remember which notes this reader was in. Subscribed rather than driven off
  // the `openPath` render value, so the list is written once per real change
  // (a re-render for any other reason must not reorder it).
  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        if (state.openPath && state.openPath !== prev.openPath) {
          setRecent(pushRecent(state.openPath));
        }
      }),
    [],
  );

  // …and shown only if they still exist for THIS session. The tree is already
  // scoped — a visitor's is the flat published collection, an admin in preview
  // gets the same one — so filtering through it is what keeps a remembered
  // path from naming an unpublished note to somebody who may not see it.
  const recentNotes = useMemo(() => {
    if (!tree) return [];
    const live = new Map(collectNotes(tree).map((n) => [n.path, n.title]));
    return recent
      .filter((p) => live.has(p))
      .slice(0, RECENT_SHOWN)
      .map((p) => ({ path: p, title: live.get(p)! }));
  }, [recent, tree]);

  // Navigating to another note dismisses lingering PLAIN toasts — a message
  // about the previous interaction must not overlay unrelated content. An
  // action toast is deliberately spared (client/toast.ts): deleting the open
  // note is exactly the gesture that changes `openPath`, and the Undo it
  // offers cannot dismiss itself in the same frame it appears.
  useEffect(() => {
    dismissToasts();
  }, [openPath]);

  // SSE: keep tree + backlinks fresh; reload the open note on external change.
  // Re-subscribed whenever `admin` flips: the server filters the stream by the
  // session it saw AT CONNECTION TIME, so a stream opened before login keeps
  // visitor filtering (publish toggles would arrive as bogus "deleted" events)
  // and a stream opened as admin would keep leaking unpublished paths after
  // logout. A fresh EventSource carries the current cookie.
  //
  // `language` is in the dependency list for exactly the same reason, one
  // dimension over: under `settings.languageFilter: "follow"` the stream is
  // scoped to the reader's language at connection time (EventSource cannot
  // send a header, so it went out as ?lang=), and a reader who flips the EN/ع
  // switch would otherwise keep a stream describing the collection they left —
  // announcing edits to notes their new language hides, and silent about the
  // ones it reveals. Cheap: one reconnect per deliberate language change.
  useEffect(() => {
    // Whole-vault refreshes are COALESCED; per-event bookkeeping below is not.
    // One changed file and sixty changed files leave the tree, the backlinks,
    // the tag list and the publish marks in the same place, so a burst pays
    // for one round of each instead of sixty (client/coalesce.ts spells out
    // the numbers this replaced).
    const refreshVault = coalesce(() => {
      const store = useStore.getState();
      void store.loadTree();
      void store.refreshBacklinks();
      // Keep publish marks + "N published" fresh (external edits can flip
      // frontmatter flags too).
      if (store.admin) void store.loadPublished();
    }, SSE_COALESCE_MS);

    const onEvent = (ev: VaultEvent) => {
      const store = useStore.getState();
      refreshVault();
      // TOO MUCH CHANGED TO NARRATE. The server stops sending one frame per
      // file above ~25 in 200ms (a `git pull`, a folder restore, an Obsidian
      // sync) and sends this instead; the honest answer is the one a dropped
      // stream gets — re-read everything this client is holding, since we were
      // not told which of it moved.
      if (ev.kind === "bulk") {
        invalidateVaultGraph();
        clearBrokenEmbeds();
        void revalidateBuffers();
        return;
      }
      // The link graph is the most expensive of the lot and has its own
      // debounce and its own shared cache, so it is invalidated rather than
      // refetched here.
      invalidateVaultGraph();

      // New/renamed files may satisfy embeds that 404'd earlier.
      if (ev.kind === "created" || ev.kind === "renamed") clearBrokenEmbeds();

      if (ev.kind === "renamed" && ev.toPath) {
        store.remapPath(ev.path, ev.toPath);
      } else if (ev.kind === "deleted" && store.openTabs.includes(ev.path)) {
        store.closeTab(ev.path);
      } else if (ev.kind === "changed" && ev.path === store.openPath) {
        // A publish toggle rewrites the file too; its echo is handled by
        // togglePublish's own bumpReload, not the external-change path.
        // Two ways to recognise our own write, and the FIRST is the one
        // that catches an autosave: every writer claims the path before it
        // sends the request, because the echo overtakes the response by a
        // couple of milliseconds (state.ts::markSelfWrite). The dirty→clean
        // stamp stays as the belt to that braces — it still answers for a
        // write some future path forgets to claim.
        const selfSave =
          recentSelfWrite(ev.path, SELF_SAVE_WINDOW_MS) ||
          Date.now() - lastSaveRef.current < SELF_SAVE_WINDOW_MS;
        if (!selfSave) {
          if (store.dirty[ev.path]) {
            toast(tf("changedOnDisk", { path: ev.path }));
          } else {
            // Adopt the new text INTO the open buffer rather than remounting
            // the editor. The remount used to be the whole mechanism, and with
            // the buffer registry it became the wrong one: an unmount releases
            // the buffer and a remount re-fetches it, so the note would come
            // back correct and the reader's undo history would be gone — on an
            // event they did not cause. Adoption goes through the document as
            // an ordinary transaction, so the external change is itself
            // undoable. The remount stays as the fallback for the surface that
            // has no buffer: the reading view.
            void adoptExternalChange(ev.path).then((adopted) => {
              if (!adopted) store.bumpReload();
            });
          }
        }
      }
    };
    // A STREAM THAT DROPPED AND CAME BACK IS A GAP IN WHAT WE KNOW. EventSource
    // reconnects on its own and replays nothing, so every "changed" sent while
    // it was away is gone — and the buffers here still describe files that may
    // have moved on. Re-ask, before the reader types into one of them.
    return subscribeEvents(onEvent, () => void revalidateBuffers());
  }, [admin, language]);

  // WAKING UP: the window was hidden and is visible again.
  //
  // The incident this exists for: one vault, TWO SERVERS — the desktop app's
  // child server beside a systemd instance behind the web admin. A note was
  // published from the web; the desktop app had been running for days with
  // that note's buffer loaded from before the publish. Each server's watcher
  // announces to its OWN subscribers, so the frame that would have refreshed
  // the desktop buffer went to a stream that had long since dropped. The write
  // precondition still refuses the stale save — nothing is lost — but the
  // client had no way to LEARN it was stale until it tried to write, which is
  // the worst moment to find out.
  //
  // `visibilitychange` is the event that actually fires when a laptop lid
  // opens or a backgrounded tab is picked up again; `focus` catches the case
  // where the window never went hidden and the reader simply came back to it
  // from another app. Both are throttled together — they fire in quick
  // succession on a single alt-tab, and this must not become a poll.
  useEffect(() => {
    let last = 0;
    const wake = (): void => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < WAKE_THROTTLE_MS) return;
      last = now;
      void revalidateBuffers();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);

  // Zen's only visible chrome is a faint ✕. It shows on entry (so the way out
  // is never a secret), fades after a beat, and any mouse movement brings it
  // back — the pointer is the one input that means "I am looking for a
  // control". Leaving zen resets it for the next time.
  useEffect(() => {
    if (!zen) {
      setZenIdle(false);
      return;
    }
    let timer = window.setTimeout(() => setZenIdle(true), ZEN_HINT_MS);
    const onMove = () => {
      setZenIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setZenIdle(true), ZEN_HINT_MS);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", onMove);
    };
  }, [zen]);

  // "Set banner…" requests from the editor's properties-card action.
  useEffect(() => {
    const onSetBanner = (): void => {
      const store = useStore.getState();
      if (store.admin && store.openPath) store.setBannerModalOpen(true);
    };
    window.addEventListener("vellum:set-banner", onSetBanner);
    return () => window.removeEventListener("vellum:set-banner", onSetBanner);
  }, []);

  // The properties card writes one property (v1.8, Obsidian parity #1). The
  // card is raw DOM inside a CodeMirror widget and knows nothing about the
  // store, so it asks the shell the same way the "Set banner…" button beside
  // it does — but it names its own NOTE in the event, because a split puts two
  // cards on screen and the one that was clicked is not always the focused
  // pane's. `admin` is re-checked here rather than trusted from the DOM: this
  // is the shell's gate, and the editor is only one of the things that can
  // dispatch a window event.
  useEffect(() => {
    const onProperty = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ path?: unknown; key?: unknown; value?: unknown }>).detail;
      const store = useStore.getState();
      if (!store.admin) return;
      const path = typeof detail?.path === "string" ? detail.path : store.openPath;
      const key = typeof detail?.key === "string" ? detail.key.trim() : "";
      if (path === null || key === "") return;
      void store.setProperty(path, key, (detail?.value ?? null) as PropertyValue | null);
    };
    window.addEventListener("vellum:property", onProperty);
    return () => window.removeEventListener("vellum:property", onProperty);
  }, []);

  // Global keyboard shortcuts.
  useEffect(() => {
    /** Is the caret inside the CodeMirror editor right now? */
    const inEditor = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest(".cm-editor") !== null;

    /** Something modal is on screen and owns the keyboard. The DOM half covers
     *  the layers that are not store flags — the confirm dialog, the theme
     *  picker and the attachment viewer — all of which close on Esc
     *  themselves, and none of which may have Esc taken out from under them by
     *  zen or by leaving preview. */
    const modalUp = (store: ReturnType<typeof useStore.getState>): boolean =>
      store.loginOpen ||
      store.bannerModalOpen ||
      store.moderationOpen ||
      store.trashOpen ||
      store.settingsOpen ||
      document.querySelector(".s-confirm-overlay, .s-tpick-overlay, .s-att-view") !== null;

    /** Put the caret back where the reader left it — the note they came from.
     *  Ctrl/Cmd+K throws focus into a search box on the other side of the
     *  screen; Esc has to be a way BACK, not just a way out, or the next
     *  keystroke lands in a field nobody is looking at. */
    const returnToNote = (preferred: HTMLElement | null): void => {
      if (preferred?.isConnected) {
        preferred.focus();
        return;
      }
      const editor = document.querySelector<HTMLElement>(".s-view .cm-content");
      if (editor) {
        editor.focus();
        return;
      }
      // Reading view has nothing focusable — at least take the keyboard out
      // of the search field so typing does not disappear into it.
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const store = useStore.getState();
      if (e.key === "Escape") {
        // 1. The shortcuts overlay closes first (it is the topmost layer).
        if (store.shortcutsOpen) {
          e.preventDefault();
          store.setShortcutsOpen(false);
          return;
        }
        // 2. Ctrl/Cmd+K parked the caret in the sidebar search: Esc returns it
        //    to the note. (The Sidebar's own Esc still clears the query — this
        //    runs in the capture phase and moves focus, nothing else.)
        const inSearch =
          e.target instanceof Element && e.target.closest(".s-search") !== null;
        if (inSearch) {
          const back = quickReturnRef.current;
          quickReturnRef.current = null;
          window.setTimeout(() => returnToNote(back), 0);
          return;
        }
        if (store.paletteOpen || modalUp(store)) return;
        if (e.target instanceof Element && e.target.closest("input, textarea")) return;
        // 3. Preview is a mode that took the editor away — Esc gives it back.
        if (store.previewVisitor) {
          e.preventDefault();
          void store.setPreviewVisitor(false);
          return;
        }
        // 4. Esc leaves zen — never out from under vim, where Esc is sacred.
        if (store.zen) {
          if (store.vimMode && inEditor(e.target)) return;
          e.preventDefault();
          store.setZen(false);
        }
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      // NOT `e.key.toLowerCase()`. `e.key` is what the LAYOUT produced, and on
      // the owner's Arabic keyboard the physical P key produces "ح" — so every
      // line below was false and every shortcut in this listener was dead for
      // him (and for Russian, Greek, Hebrew, Persian…). `shortcutKey` takes the
      // layout's answer when it has a Latin one and the PHYSICAL key when it
      // does not; client/keys.ts carries the whole argument, including why
      // physical must not simply win (Dvorak) and why AltGr returns null
      // (Ctrl+Alt is how half of Europe types). One consequence worth naming:
      // the two `e.altKey && e.code === "KeyB"` special cases that used to live
      // here are GONE — macOS Option+B ("∫") is not a Latin character, so it
      // falls to the physical key on the general path now, and the AltGraph
      // guards the pane toggles carried are the resolver's job for every
      // binding rather than two of them.
      const key = shortcutKey(e) ?? "";
      const bKey = key === "b";
      const tKey = key === "t";
      // Ctrl/Cmd+/ — the list of every binding, including this one. Handled
      // ahead of the modal guard so it opens (and closes) from anywhere. `?` is
      // Shift+/ on a US keyboard and the sheet answers to both; on a layout
      // that puts / elsewhere (German Shift+7, Dvorak's `[` position) the
      // layout's own "/" is what arrives, and on Arabic the physical Slash key
      // (which types "ظ") resolves to "/". `isKey` is what folds "?" into "/",
      // so this is the one binding that does not read `key` directly.
      // …but NOT Ctrl/Cmd+Alt+/, which is the editor's comment toggle. Without
      // this exclusion the sheet swallowed it in the capture phase, and a
      // capture-phase preventDefault ends CodeMirror's pipeline before its
      // first handler runs — the same way it kept Ctrl/Cmd+D and Ctrl/Cmd+B
      // dead. Alt is the escape hatch this file already uses for exactly this.
      if (isKey(e, "/") && !e.altKey) {
        e.preventDefault();
        if (!modalUp(store)) {
          store.setPaletteOpen(false);
          store.setShortcutsOpen(!store.shortcutsOpen);
        }
        return;
      }
      // Which shell this keystroke is landing in. The blog mounts no palette,
      // no graph, no panes and no zen — so every binding below except
      // Ctrl/Cmd+K (its search overlay answers that one) belongs to the
      // BROWSER there, and taking it would be theft: an anonymous reader lost
      // the print dialog and Firefox's bookmarks sidebar to two commands that
      // do not exist on the page. Same predicate as the blogVisitor render
      // branch below, read from the store because this listener never re-binds.
      const blogShell =
        store.authReady && !store.admin && store.publicLayout !== "app";
      // Ctrl/Cmd+P and +K are ALWAYS ours IN THE APP SHELL — swallowed before
      // any early return so the browser's print dialog / address-bar search
      // can never fire, modal open or not, and regardless of what CM does
      // downstream.
      //
      // +B IS THE EXCEPTION, AND preventDefault IS WHY. CodeMirror's whole
      // keydown pipeline begins `if (event.defaultPrevented) break` — so a
      // capture-phase preventDefault here does not merely stop the browser,
      // it stops the EDITOR, and Ctrl/Cmd+B is now the editor's (bold). It
      // was swallowed unconditionally while it folded a pane, and left that
      // way it made the new binding silently dead: measured, Ctrl+I bolded
      // nothing and Ctrl+B did nothing at all. So outside the editor it still
      // dies here — Firefox's bookmarks sidebar (Ctrl+B) and Chrome's bookmark
      // bar (Ctrl+Shift+B) must never open over the app — and inside it, the
      // formatting keymap's own `preventDefault: true` does the same job one
      // layer down, where it can also let vim's Ctrl+B through.
      if (key === "k" || (!blogShell && key === "p")) e.preventDefault();
      if (bKey && !blogShell && !inEditor(e.target)) e.preventDefault();
      // +D IS THE SAME EXCEPTION, FOR THE SAME REASON. Ctrl/Cmd+D is the
      // EDITOR's — `searchKeymap`'s selectNextOccurrence, and vim's half-page
      // scroll ahead of it — so it may only die out here, where it would
      // otherwise be Chrome's and Firefox's "bookmark this page". Swallowing
      // it unconditionally is precisely what kept multi-cursor dead: this
      // listener has held the key for the daily note since it shipped, and a
      // capture-phase preventDefault ends CodeMirror's pipeline before its
      // first handler runs. The daily note now wears Alt, below.
      if (key === "d" && !e.altKey && !blogShell && !inEditor(e.target)) e.preventDefault();
      // A modal dialog owns the keyboard: app-level shortcuts firing behind
      // the login/banner/moderation/confirm overlays would steal focus (e.g.
      // Ctrl+K focusing the sidebar search under the modal) or stack modals.
      if (modalUp(store) || store.shortcutsOpen) return;
      // Ctrl/Cmd+K is the blog reader's one command; the rest act on chrome
      // that is not on their page.
      if (blogShell && key !== "k") return;
      if (key === "p" && e.altKey) {
        // Ctrl/Cmd+Alt+P — print / export PDF. THE OBVIOUS CHORD WAS ALREADY
        // SPENT, twice: Ctrl/Cmd+P is the palette and Ctrl/Cmd+Shift+P
        // publishes, and neither of those is worth moving so that printing can
        // have the key browsers hand it. So printing wears Alt, like the daily
        // note and the pane toggles, and both of the alternatives are honest:
        // the palette row prints the chord, and inside the BLOG shell nothing
        // is swallowed at all — a visitor's Ctrl/Cmd+P is the browser's, and
        // reading/print.css is what makes it produce the right pages.
        //
        // Dynamic import for the reason CommandPalette gives at the same call:
        // the module carries the markdown renderer and must not be in a first
        // paint. It is already resolved whenever a document is on screen.
        e.preventDefault();
        void import("./print.ts").then((mod) => mod.printNote());
      } else if (key === "p" && e.shiftKey) {
        // Ctrl/Cmd+Shift+P: publish toggle (admin, note open) — never the palette.
        if (store.admin && store.openPath) void store.togglePublish(store.openPath);
      } else if (key === "p") {
        store.setPaletteOpen(!store.paletteOpen);
      } else if (key === "k") {
        // Ctrl/Cmd+K — search everywhere: the sidebar's search box in the
        // app shell, a centered overlay in the blog shell. Whichever shell is
        // mounted owns the event. An open palette hands over to search
        // instead of fighting it for focus.
        e.preventDefault();
        if (store.paletteOpen) store.setPaletteOpen(false);
        // Remember the note we are leaving so Esc can hand it back. A second
        // press while the search box already has focus must not overwrite it
        // with the search box itself.
        const from = document.activeElement;
        if (from instanceof HTMLElement && from.closest(".s-search") === null) {
          quickReturnRef.current = from;
        }
        window.dispatchEvent(new Event("vellum:quicksearch"));
      } else if (key === "g") {
        e.preventDefault();
        store.setView(store.view === "graph" ? "editor" : "graph");
      } else if (key === "e") {
        if (!store.admin) return; // visitors live in reading view
        e.preventDefault();
        store.toggleReading();
        if (store.view === "graph") store.setView("editor");
      } else if (bKey && e.altKey) {
        // THE PANE TOGGLES WEAR ONE MORE MODIFIER THAN THEY USED TO.
        // Ctrl/Cmd+B was the notes sidebar and Ctrl/Cmd+Shift+B the outline
        // pane; Ctrl/Cmd+B is now BOLD, because that is the binding every
        // reader arrives with and formatting wins inside the editor
        // (client/editor/commands.ts). The pair kept its shape — one key,
        // Shift picks the second pane — and moved out to Alt, so the only
        // thing to re-learn is "add Alt". The status-bar tooltips, the two
        // palette rows and the Ctrl/Cmd+/ sheet all print the new numbers.
        // AltGraph is excluded — on several European layouts Right-Alt reports
        // ctrl+alt, and a reader typing a bracket must not fold a pane — but
        // the exclusion is no longer spelled here: `shortcutKey` returns null
        // for AltGr, for THIS binding and every other one.
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) store.setPanelCollapsed(!store.panelCollapsed);
        else store.toggleSidebar();
      } else if (bKey) {
        // Plain Ctrl/Cmd+B (and +Shift+B) are swallowed above — Firefox's
        // bookmarks sidebar and Chrome's bookmark bar must never open over the
        // app — and then handed on: inside the editor CodeMirror's formatting
        // keymap answers them, and outside it nothing does. Deliberately
        // nothing: a key that folds a pane in one half of the window and bolds
        // a word in the other is a key nobody can describe.
      } else if (key === "z" && e.shiftKey) {
        // Ctrl/Cmd+Shift+Z — zen. On macOS this is ALSO CodeMirror's only
        // redo binding (redo is Mod-y elsewhere), so the editor keeps Cmd+
        // Shift+Z when the caret is in it — Ctrl+Shift+Z, the palette command
        // and the ✕ all still enter zen there. stopPropagation everywhere
        // else: CM must never redo and toggle zen off the same keystroke.
        if (e.metaKey && inEditor(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        store.setZen(!store.zen);
      } else if (key === "\\") {
        // Ctrl/Cmd+\ splits along the INLINE axis, +Shift stacks instead, and
        // +Alt closes the pane. One key, one mental model: "another one of
        // these", with Shift choosing the direction — the same shape the pane
        // toggles use. A split that would breach the cap says so by name
        // rather than appearing to do nothing, which is how a keystroke gets
        // reported as broken.
        if (!store.admin) return;
        e.preventDefault();
        if (e.altKey) {
          store.closeFocusedPane();
        } else if (!store.splitFocusedPane(e.shiftKey ? "block" : "inline")) {
          toast(t("paneCapReached"));
        }
      } else if (e.altKey && (e.key === "PageDown" || e.key === "PageUp")) {
        // THE TAB STRIP GETS A KEYBOARD (v1.8 audit, F12). Every other pane
        // operation had a chord and the tabs inside them had none, so a reader
        // with forty notes open could split, close and walk between panes
        // without a mouse and then had to reach for one to change tab.
        //
        // WHY THESE KEYS. The three chords the whole world uses for tabs —
        // Ctrl+Tab, Ctrl+PageUp/PageDown, Ctrl+W — all belong to the browser,
        // and a keystroke that fights the browser is a keystroke that loses.
        // Two of them can be worn one modifier over, which is the escape hatch
        // this file already takes for the templates and the pane toggles; the
        // third cannot, because Alt+Tab belongs to the window manager. So the
        // page keys carry the walk and W carries the close, and the muscle
        // memory transfers with one extra finger.
        //
        // NOT arrows: Ctrl+Alt+←/→ is GNOME's workspace switcher and macOS
        // Chrome's own tab switcher, and neither hands it back.
        e.preventDefault();
        store.stepTab(e.key === "PageDown" ? 1 : -1);
      } else if (key === "w" && e.altKey) {
        // Ctrl/Cmd+Alt+W — close the focused pane's active tab. The bare chord
        // closes the browser window and is not takeable anywhere.
        e.preventDefault();
        store.closeActiveTab();
      } else if (key === "d" && e.altKey) {
        // Ctrl/Cmd+Alt+D — the daily note, moved here off the plain key for
        // the same reason the pane toggles moved to Alt above: the unmodified
        // key belongs to the editor, and a once-a-day verb does not outrank a
        // per-minute one. It kept its letter, so the only thing to re-learn is
        // "add Alt". The vim guard that used to sit here is gone with the
        // collision: vim's Ctrl-D now reaches vim by simply not being taken.
        if (!store.admin) return; // daily note may create a file
        e.preventDefault();
        void openDailyNote();
      } else if (key === "n") {
        if (!store.admin) return;
        e.preventDefault();
        // Our dialog, not the OS box: prompts.ts owns the naming rule and
        // shows what the typed name becomes (see client/prompts.ts).
        void promptNewNote("");
      } else if (tKey && e.altKey) {
        // TEMPLATES WEAR ALT, and it is not a stylistic choice. Ctrl/Cmd+T is
        // the browser's new tab and Ctrl/Cmd+Shift+T reopens a closed one —
        // neither is takeable, and a keystroke that fights the browser is a
        // keystroke that loses. Alt is the same escape hatch the pane toggles
        // took when Ctrl/Cmd+B became bold, and the pair keeps that shape:
        // one key, Shift picks the second command. AltGraph is excluded for
        // the same reason it is there (European layouts report Right-Alt as
        // ctrl+alt) — `shortcutKey` does that for every binding now, so the
        // guard is not repeated here. A desktop that eats Ctrl+Alt+T at the WM
        // layer still leaves the palette and the tree's folder menu.
        if (!store.admin) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) void newNoteFromTemplateCommand();
        else if (store.openPath) void insertTemplateCommand();
      }
    };
    // Capture phase: run ahead of CodeMirror/vim handlers so a stopPropagation
    // downstream can never let Ctrl+P fall through to the browser.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Until /api/me answers, render nothing — no flash of the wrong mode.
  if (!authReady) return <div className="s-app" />;

  // Visitors of a blog-mode instance get the classic blog — no app chrome.
  // (The banner renders only during admin preview — PreviewBanner is inert
  // for real visitors.)
  if (blogVisitor) {
    return (
      <>
        {/* First in the flow: the strip pushes the whole site down rather than
            covering its masthead — preview exists to JUDGE that masthead. */}
        <PreviewBanner />
        {/* THE one line where the design engine meets the stock blog. The
            server only sends "designed" when a design is actually renderable,
            and DesignedSite falls back to this very component — unmodified,
            no props — for every failure it can see that the server cannot.

            The fallback is the empty shell, not a spinner: the blog chunk is
            one request behind the entry and a flash of chrome-then-content
            reads worse than a beat of the page background. Both arms share the
            one boundary because only one of them is ever mounted, and the
            fallback they would each want is the same page-shaped blank. */}
        <Surface fallback={<div className="s-blog" />}>
          {publicLayout === "designed" ? <DesignedSite /> : <BlogShell />}
        </Surface>
        {/* The sheet knows which shell it is in and drops the rows this one
            does not have — six of them named controls the blog never mounts. */}
        {shortcutsOpen && (
          <Surface>
            <ShortcutsHelp shell="blog" />
          </Surface>
        )}
        <ConfirmHost />
      </>
    );
  }

  // A mode that removes the ability to type has to be visible in the
  // WORKSPACE, not only in the status bar: the reader's eyes are on the note.
  const readingLocked = admin && !previewVisitor && readingMode && view === "editor" && !!openPath;

  // Zen takes the status bar (and with it the whole mode cluster) to zero
  // height, so in zen the strip is the ONLY place a mode can live. Reading
  // already survived into zen; vim did not, and ZEN + VIM was a modal editor
  // with nothing on screen saying whether the next keystroke would type or
  // delete a line. Outside zen the pill carries this, so the strip stays out
  // of the way — and the two are mutually exclusive by construction
  // (reading unmounts the editor, so there is no vim to report).
  const vimLocked =
    admin && !previewVisitor && !readingMode && vimMode && zen && view === "editor" && !!openPath;
  const vimStrip = vimLocked ? vimSubCopy(vimSubMode) : null;

  const shellClass = [
    "s-app",
    admin ? "" : "s-app--visitor",
    sidebarOpen ? "s-app--drawer" : "",
    flipped ? "s-app--flip" : "",
    sidebarCollapsed ? "s-app--nosidebar" : "",
    // The panel's own collapse lives on .s-panel--collapsed and always has —
    // but the CENTRE column has to know about it too (app.css balances its
    // gutters against what each end of the shell is actually holding), and a
    // sibling's class is not something CSS can ask about.
    panelCollapsed ? "s-app--nopanel" : "",
    zen ? "s-app--zen" : "",
    previewVisitor ? "s-app--preview" : "",
    readingLocked ? "s-app--reading" : "",
    // Zen's ✕ steps below whichever strip is up; one class covers both so the
    // offset rule does not have to enumerate the modes.
    readingLocked || vimLocked ? "s-app--modebar" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      {/* First tab stop in the document: past the sidebar tree (which can be
          a thousand rows) and straight into the note. Hidden until focused. */}
      <a className="s-skip" href="#s-main">
        {t("skipToContent")}
      </a>
      {/* Grid row above every pane (grid-area: notice) — never an overlay. */}
      <PreviewBanner />
      {/* The sidebar's own boundary. Its fallback holds the grid column open
          at the width the pane will occupy, so the shell does not reflow
          sideways when the chunk lands. */}
      <Surface fallback={<aside className="s-sidebar" aria-hidden="true" />}>
        <Sidebar />
      </Surface>
      {/* Mobile drawer chrome: backdrop dismisses; the toggle floats over the
          main column. Both are display:none above the narrow breakpoint. */}
      <div
        className="s-drawer-backdrop"
        onClick={() => useStore.getState().setSidebarOpen(false)}
        aria-hidden="true"
      />
      {/* Slim reopen handle for a collapsed sidebar — a hairline strip on the
          sidebar's own edge, so the bar always leaves a door where it stood.
          (In zen there is no door: Esc and the ✕ are the way out.) */}
      {sidebarCollapsed && !zen && (
        <button
          type="button"
          className="s-reopen s-reopen--sidebar"
          onClick={() => useStore.getState().setSidebarCollapsed(false)}
          title={t("showPaneNotes")}
          aria-label={t("showPaneNotes")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}
      {/* tabIndex -1 so the skip link can actually land focus here: an <a
          href="#…"> moves the caret to the target only if the target is
          focusable, otherwise the next Tab starts from the top again. */}
      <main className="s-main" id="s-main" tabIndex={-1} aria-label={t("mainContent")}>
        <button
          type="button"
          className="s-drawer-btn"
          aria-label={t(sidebarOpen ? "closeSidebar" : "openSidebar")}
          title={t(sidebarOpen ? "closeSidebar" : "openSidebar")}
          onClick={() => useStore.getState().setSidebarOpen(!sidebarOpen)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Surface fallback={<div className="s-tabs" aria-hidden="true" />}>
          {/* The shell's bar belongs to the shell only while there is one pane.
              Split, each pane carries its own — a tab bar names what is open
              HERE, and one strip above two panes could not say which. */}
          {!split && <Tabs />}
        </Surface>
        {/* One line, part of the layout (it pushes the note down, it does not
            float over it), saying what the mode is and how to leave it. The
            accent rule down the column's inline-start edge is its companion:
            app.css draws it from .s-app--reading. */}
        {readingLocked && (
          <div className="s-modebar" role="status">
            <span className="s-modebar__dot" aria-hidden="true" />
            <span className="s-modebar__text">{t("readingStrip")}</span>
            <button
              type="button"
              className="s-modebar__action"
              onClick={() => useStore.getState().setReadingMode(false)}
            >
              {t("readingStripAction")}
            </button>
          </div>
        )}
        {vimStrip && (
          <div className="s-modebar s-modebar--vim" role="status">
            <span className="s-modebar__dot" aria-hidden="true" />
            <span className="s-modebar__text">{t(vimStrip.strip)}</span>
            <button
              type="button"
              className="s-modebar__action"
              onClick={() => useStore.getState().toggleVim()}
            >
              {t("vimStripAction")}
            </button>
          </div>
        )}
        {/* The graph is about the WINDOW, not about a pane: it replaces the
            whole working area, exactly as it did before panes existed. */}
        {view === "graph" ? (
          <section className="s-view">
            <Surface fallback={<div className="s-graph" />}>
              <GraphView />
            </Surface>
          </section>
        ) : (
          // Every pane draws its own note. The children below are the states
          // that belong to the window rather than to a pane — a locked vault,
          // an empty one — and a pane with no tab hands them straight through.
          <Surface fallback={<div className="s-view" />}>
            <Workspace>
              {locked ? (
            <div className="s-empty">
              <div className="s-empty__glyph" aria-hidden="true">✦</div>
              <p className="s-empty__title">{t("vaultPrivate")}</p>
              <button
                type="button"
                className="s-btn s-btn--accent"
                onClick={() => useStore.getState().setLoginOpen(true)}
              >
                {t("signIn")}
              </button>
            </div>
          ) : (
            <div className="s-empty">
              <div className="s-empty__glyph" aria-hidden="true">✦</div>
              <p className="s-empty__title">{t("vaultOpen")}</p>
              {/* TWO empty states, and CSS picks. The keymap is the right
                  answer on a machine with a keyboard and is nothing but a
                  taunt without one: at 390px the first screen after signing in
                  was seven chips naming Ctrl-combinations, one of them
                  wrapping and shoving the grid a row out of true, the first
                  chip flush against x=0 because the grid was exactly as wide
                  as the viewport. Below ~700px — and on ANY coarse pointer,
                  because a tablet in landscape is 1024px wide and still has no
                  Ctrl key — the pane offers the same four destinations as
                  things to tap, with the notes this reader was last in above
                  them. app.css owns the swap; both halves are always in the
                  DOM so there is no resize listener and no first-paint flash. */}
              <div className="s-empty__keys">
                <span className="s-empty__key">
                  <kbd>Ctrl P</kbd> {t("keyPalette")}
                </span>
                <span className="s-empty__key">
                  <kbd>Ctrl G</kbd> {t("keyGraph")}
                </span>
                <span className="s-empty__key">
                  <kbd>Ctrl K</kbd> {t("keySearch")}
                </span>
                <span className="s-empty__key">
                  <kbd>Ctrl /</kbd> {t("keyShortcuts")}
                </span>
                {admin && (
                  <>
                    <span className="s-empty__key">
                      <kbd>Ctrl N</kbd> {t("keyNewNote")}
                    </span>
                    <span className="s-empty__key">
                      <kbd>Ctrl S</kbd> {t("keySave")}
                    </span>
                    <span className="s-empty__key">
                      <kbd>Ctrl E</kbd> {t("keyReading")}
                    </span>
                  </>
                )}
              </div>
              <div className="s-empty__touch">
                {recentNotes.length > 0 && (
                  <nav className="s-empty__recents" aria-label={t("emptyRecent")}>
                    <h2 className="s-empty__recentshead">{t("emptyRecent")}</h2>
                    {recentNotes.map((note) => (
                      <button
                        type="button"
                        className="s-empty__recent"
                        key={note.path}
                        onClick={() => useStore.getState().openNote(note.path)}
                      >
                        {/* A note title is user content in a chrome row: it
                            picks its own direction, like every other title in
                            the product. */}
                        <bdi>{note.title}</bdi>
                      </button>
                    ))}
                  </nav>
                )}
                <div className="s-empty__actions">
                  {admin && (
                    <button
                      type="button"
                      className="s-empty__action s-empty__action--go"
                      onClick={() => void promptNewNote("")}
                    >
                      {t("newNote")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="s-empty__action"
                    onClick={openQuickSearch}
                  >
                    {t("scSearch")}
                  </button>
                  <button
                    type="button"
                    className="s-empty__action"
                    onClick={() => useStore.getState().setView("graph")}
                  >
                    {t("scGraph")}
                  </button>
                </div>
              </div>
            </div>
              )}
            </Workspace>
          </Surface>
        )}
      </main>
      <Surface fallback={<aside className="s-panel" aria-hidden="true" />}>
        <BacklinksPanel />
      </Surface>
      <Surface fallback={<footer className="s-statusbar" aria-hidden="true" />}>
        <StatusBar />
      </Surface>
      {zen && (
        <div className={`s-zen-exit-wrap${zenIdle ? " s-zen-exit-wrap--idle" : ""}`}>
          {/* The keystroke, spelled out. Esc is the route that always works,
              and a mode with no visible chrome must say so at least once. */}
          <span className="s-zen-exit__hint" aria-hidden="true">
            {t("zenEscHint")}
          </span>
          <button
            type="button"
            className="s-zen-exit"
            onClick={() => useStore.getState().setZen(false)}
            title={t("exitZen")}
            aria-label={t("exitZen")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
      {/* Renders nothing unless /api/me told a REAL admin session that the
          designed site fell back to stock. One line, the reason, one click
          back — the app-side twin of the notice on the designed page itself. */}
      <DesignStatus />
      {shortcutsOpen && (
        <Surface>
          <ShortcutsHelp />
        </Surface>
      )}
      {/* A boundary EACH, with no fallback. These are the surfaces that proved
          the rule: they were the ones being opened when the shell vanished,
          and they are the ones whose opener has to stay mounted underneath so
          Escape has somewhere to put focus back. */}
      {paletteOpen && (
        <Surface>
          <CommandPalette />
        </Surface>
      )}
      {bannerModalOpen && admin && (
        <Surface>
          <BannerModal />
        </Surface>
      )}
      {moderationOpen && admin && (
        <Surface>
          <ModerationPanel />
        </Surface>
      )}
      {trashOpen && admin && (
        <Surface>
          <TrashModal />
        </Surface>
      )}
      {settingsOpen && admin && (
        <Surface>
          <SettingsModal />
        </Surface>
      )}
      {/* Always mounted (like ConfirmHost): the two template commands await a
          promise from it, and a host that only exists once something has
          already opened it cannot be the thing that opens. */}
      {admin && <TemplatePicker />}
      {loginOpen && <LoginModal />}
      <ConfirmHost />
    </div>
  );
}
