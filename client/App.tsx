// App shell: layout grid (sidebar | main | backlinks, status bar below),
// global keyboard shortcuts, and the single SSE subscription that keeps the
// tree, backlinks, and externally-changed open notes fresh.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { VaultEvent } from "../shared/types.ts";
import { subscribeEvents } from "./api.ts";
import { clearBrokenEmbeds } from "./editor/embeds.ts";
import BlogShell from "./blog/BlogShell.tsx";
import BacklinksPanel from "./components/BacklinksPanel.tsx";
import BannerModal from "./components/BannerModal.tsx";
import CommandPalette from "./components/CommandPalette.tsx";
import ConfirmHost from "./components/Confirm.tsx";
import GraphView from "./components/GraphView.tsx";
import LoginModal from "./components/LoginModal.tsx";
import ModerationPanel from "./components/ModerationPanel.tsx";
import PreviewBanner from "./components/PreviewBanner.tsx";
import ReadingView from "./reading/ReadingView.tsx";
import SettingsModal from "./components/SettingsModal.tsx";
import Sidebar from "./components/Sidebar.tsx";
import StatusBar from "./components/StatusBar.tsx";
import Tabs from "./components/Tabs.tsx";
import { openDailyNote } from "./daily.ts";
import { t, tf } from "./i18n.ts";
import { applyUrl, installRouter, syncUrl } from "./router.ts";
import { recentPublishWrite, useStore } from "./state.ts";
import { dismissToasts, toast } from "./toast.ts";

/** Writes made by our own autosave echo back through the watcher; ignore
 *  "changed" events arriving within this window of a local save. */
const SELF_SAVE_WINDOW_MS = 1500;

/** How long zen's ✕ lingers before fading out (any mouse move brings it back). */
const ZEN_HINT_MS = 2000;

/** macOS binds Ctrl+B to emacs-style "char left" inside CodeMirror and reads
 *  Cmd as the app modifier — so plain Ctrl+B there belongs to the editor. */
const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);

// The CodeMirror editor is the heaviest part of the client and anonymous
// visitors (reading view only) never need it — load it on demand so the
// first-paint bundle stays lean.
const Editor = lazy(() => import("./components/Editor.tsx"));

export default function App() {
  const view = useStore((s) => s.view);
  const openPath = useStore((s) => s.openPath);
  const readingMode = useStore((s) => s.readingMode);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const loginOpen = useStore((s) => s.loginOpen);
  const bannerModalOpen = useStore((s) => s.bannerModalOpen);
  const moderationOpen = useStore((s) => s.moderationOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const reloadTick = useStore((s) => s.reloadTick);
  const admin = useStore((s) => s.admin);
  const authReady = useStore((s) => s.authReady);
  const publicLayout = useStore((s) => s.publicLayout);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const sidebarSide = useStore((s) => s.sidebarSide);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const zen = useStore((s) => s.zen);
  const locked = useStore((s) => !s.admin && !s.publicReads);
  const lang = useStore((s) => s.language); // re-render the chrome strings on language change
  const lastSaveRef = useRef(0);
  /** Zen's ✕ has been sitting still long enough to fade out. */
  const [zenIdle, setZenIdle] = useState(false);

  // The grid follows the inline direction, so the sidebar already sits on the
  // reading direction's leading edge (left in English, right in Arabic).
  // "Flipped" means the reader asked for the OTHER edge — the one rule that
  // has to be expressed physically, because the preference is physical.
  const flipped = (lang === "ar") === (sidebarSide === "left");

  // Blog mode (PUBLIC_LAYOUT=blog): visitors get the classic blog shell,
  // which owns its own routes (/, /topic/…, article pages) — the app router
  // below must then stay uninstalled. Admin sessions keep the full app.
  const blogVisitor = authReady && !admin && publicLayout === "blog";

  // Boot: /api/me, then tree + session restore / home note.
  useEffect(() => {
    void useStore.getState().bootstrap();
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

  // Navigating to another note dismisses lingering toasts — a message about
  // the previous interaction must not overlay unrelated content.
  useEffect(() => {
    dismissToasts();
  }, [openPath]);

  // SSE: keep tree + backlinks fresh; reload the open note on external change.
  // Re-subscribed whenever `admin` flips: the server filters the stream by the
  // session it saw AT CONNECTION TIME, so a stream opened before login keeps
  // visitor filtering (publish toggles would arrive as bogus "deleted" events)
  // and a stream opened as admin would keep leaking unpublished paths after
  // logout. A fresh EventSource carries the current cookie.
  useEffect(() => {
    const onEvent = (ev: VaultEvent) => {
      const store = useStore.getState();
      void store.loadTree();

      // New/renamed files may satisfy embeds that 404'd earlier.
      if (ev.kind === "created" || ev.kind === "renamed") clearBrokenEmbeds();

      if (ev.kind === "renamed" && ev.toPath) {
        store.remapPath(ev.path, ev.toPath);
      } else if (ev.kind === "deleted" && store.openTabs.includes(ev.path)) {
        store.closeTab(ev.path);
      } else if (ev.kind === "changed" && ev.path === store.openPath) {
        // A publish toggle rewrites the file too; its echo is handled by
        // togglePublish's own bumpReload, not the external-change path.
        const selfSave =
          Date.now() - lastSaveRef.current < SELF_SAVE_WINDOW_MS ||
          recentPublishWrite(SELF_SAVE_WINDOW_MS);
        if (!selfSave) {
          if (store.dirty[ev.path]) {
            toast(tf("changedOnDisk", { path: ev.path }));
          } else {
            store.bumpReload();
          }
        }
      }

      void store.refreshBacklinks();
      // Keep publish marks + "N published" fresh (external edits can flip
      // frontmatter flags too).
      if (store.admin) void store.loadPublished();
    };
    return subscribeEvents(onEvent);
  }, [admin]);

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

  // Global keyboard shortcuts.
  useEffect(() => {
    /** Is the caret inside the CodeMirror editor right now? */
    const inEditor = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest(".cm-editor") !== null;

    const onKeyDown = (e: KeyboardEvent) => {
      const store = useStore.getState();
      // Esc leaves zen. It never fires out from under something that owns Esc
      // itself: a modal or the palette (which close on it), a text field
      // (the sidebar search clears on it), or vim (mode key — sacred).
      if (e.key === "Escape" && store.zen) {
        if (
          store.paletteOpen ||
          store.loginOpen ||
          store.bannerModalOpen ||
          store.moderationOpen ||
          store.settingsOpen ||
          document.querySelector(".s-confirm-overlay") !== null
        ) {
          return;
        }
        if (store.vimMode && inEditor(e.target)) return;
        if (e.target instanceof Element && e.target.closest("input, textarea")) return;
        e.preventDefault();
        store.setZen(false);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      // Ctrl/Cmd+P, +K and +B are ALWAYS ours — swallow them before any early
      // return so the browser's print dialog / address-bar search / bookmarks
      // bar can never fire, modal open or not, and regardless of what CM does
      // downstream. (Ctrl+Shift+B is Chrome's bookmark bar, plain Ctrl+B is
      // Firefox's bookmarks sidebar: both have to die here.)
      if (key === "p" || key === "k" || key === "b") e.preventDefault();
      // A modal dialog owns the keyboard: app-level shortcuts firing behind
      // the login/banner/moderation/confirm overlays would steal focus (e.g.
      // Ctrl+K focusing the sidebar search under the modal) or stack modals.
      if (
        store.loginOpen ||
        store.bannerModalOpen ||
        store.moderationOpen ||
        store.settingsOpen ||
        document.querySelector(".s-confirm-overlay") !== null
      ) {
        return;
      }
      if (key === "p" && e.shiftKey) {
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
        window.dispatchEvent(new Event("vellum:quicksearch"));
      } else if (key === "g") {
        e.preventDefault();
        store.setView(store.view === "graph" ? "editor" : "graph");
      } else if (key === "e") {
        if (!store.admin) return; // visitors live in reading view
        e.preventDefault();
        store.toggleReading();
        if (store.view === "graph") store.setView("editor");
      } else if (key === "b" && e.shiftKey) {
        // Ctrl/Cmd+Shift+B — the right panel. Nothing in CM or vim wants it,
        // so it is unconditionally ours (and already preventDefault-ed above,
        // which is what keeps Chrome's bookmark bar out of the layout).
        e.stopPropagation();
        store.setPanelCollapsed(!store.panelCollapsed);
      } else if (key === "b") {
        // Ctrl/Cmd+B — the sidebar. Same shape as the Ctrl+D rule below: the
        // editor keeps plain Ctrl+B where the platform gave it a meaning
        // (vim's page-up; macOS's emacs-style char-left), and Cmd+B toggles
        // the sidebar from inside the editor on those setups.
        if (!e.metaKey && inEditor(e.target) && (store.vimMode || IS_MAC)) return;
        e.stopPropagation();
        store.setSidebarCollapsed(!store.sidebarCollapsed);
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
      } else if (key === "d") {
        if (!store.admin) return; // daily note may create a file
        // Vim's Ctrl+D (half-page scroll) keeps priority inside the editor.
        if (store.vimMode && inEditor(e.target) && !e.metaKey) return;
        e.preventDefault();
        void openDailyNote();
      } else if (key === "n") {
        if (!store.admin) return;
        e.preventDefault();
        const path = window.prompt(t("newNotePathPrompt"), "Untitled.md");
        if (!path) return;
        const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
        if (!trimmed) return;
        void store.createNote(trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`);
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
        <BlogShell />
        <PreviewBanner />
        <ConfirmHost />
      </>
    );
  }

  const shellClass = [
    "s-app",
    admin ? "" : "s-app--visitor",
    sidebarOpen ? "s-app--drawer" : "",
    flipped ? "s-app--flip" : "",
    sidebarCollapsed ? "s-app--nosidebar" : "",
    zen ? "s-app--zen" : "",
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
      <Sidebar />
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
          title={t("showSidebar")}
          aria-label={t("showSidebar")}
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
        <Tabs />
        <section className="s-view">
          {view === "graph" ? (
            <GraphView />
          ) : openPath ? (
            // Visitors read; only admins may mount the editor.
            readingMode || !admin ? (
              <ReadingView key={`${openPath}#${reloadTick}`} path={openPath} />
            ) : (
              <Suspense fallback={<div className="s-editor" />}>
                <Editor key={`${openPath}#${reloadTick}`} path={openPath} />
              </Suspense>
            )
          ) : locked ? (
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
            </div>
          )}
        </section>
      </main>
      <BacklinksPanel />
      <StatusBar />
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
      <PreviewBanner />
      {paletteOpen && <CommandPalette />}
      {loginOpen && <LoginModal />}
      {bannerModalOpen && admin && <BannerModal />}
      {moderationOpen && admin && <ModerationPanel />}
      {settingsOpen && admin && <SettingsModal />}
      <ConfirmHost />
    </div>
  );
}
