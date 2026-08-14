// App shell: layout grid (sidebar | main | backlinks, status bar below),
// global keyboard shortcuts, and the single SSE subscription that keeps the
// tree, backlinks, and externally-changed open notes fresh.

import { lazy, Suspense, useEffect, useRef } from "react";
import type { VaultEvent } from "../shared/types.ts";
import { subscribeEvents } from "./api.ts";
import { clearBrokenEmbeds } from "./editor/embeds.ts";
import BacklinksPanel from "./components/BacklinksPanel.tsx";
import CommandPalette from "./components/CommandPalette.tsx";
import GraphView from "./components/GraphView.tsx";
import LoginModal from "./components/LoginModal.tsx";
import ReadingView from "./reading/ReadingView.tsx";
import Sidebar from "./components/Sidebar.tsx";
import StatusBar from "./components/StatusBar.tsx";
import Tabs from "./components/Tabs.tsx";
import { openDailyNote } from "./daily.ts";
import { applyUrl, installRouter, syncUrl } from "./router.ts";
import { recentPublishWrite, useStore } from "./state.ts";
import { dismissToasts, toast } from "./toast.ts";

/** Writes made by our own autosave echo back through the watcher; ignore
 *  "changed" events arriving within this window of a local save. */
const SELF_SAVE_WINDOW_MS = 1500;

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
  const reloadTick = useStore((s) => s.reloadTick);
  const admin = useStore((s) => s.admin);
  const authReady = useStore((s) => s.authReady);
  const locked = useStore((s) => !s.admin && !s.publicReads);
  const lastSaveRef = useRef(0);

  // Boot: /api/me, then tree + session restore / home note. Once the vault is
  // in, the router takes over the address bar: a pasted deep link outranks the
  // restored session and the home note, and back/forward walk visited notes.
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    void useStore.getState().bootstrap().then(() => {
      if (cancelled) return;
      cleanup = installRouter();
      const hadDeepLink = location.pathname !== "/" && location.pathname !== "/graph";
      // A locked vault keeps the deep link in the address bar: it resolves
      // right after login (see installRouter's tree watcher). A bare "/"
      // keeps what bootstrap opened (home note / restored session) and
      // syncUrl() canonicalizes the address bar to it.
      if (useStore.getState().tree !== null && !applyUrl(true)) {
        if (hadDeepLink) toast("That note does not exist (anymore)");
        syncUrl();
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

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
            toast(`${ev.path} changed on disk — your unsaved edits were kept`);
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

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const store = useStore.getState();
      const key = e.key.toLowerCase();
      if (key === "p" && e.shiftKey) {
        // Ctrl/Cmd+Shift+P: publish toggle (admin, note open) — never the palette.
        e.preventDefault();
        if (store.admin && store.openPath) void store.togglePublish(store.openPath);
      } else if (key === "p") {
        e.preventDefault();
        store.setPaletteOpen(!store.paletteOpen);
      } else if (key === "g") {
        e.preventDefault();
        store.setView(store.view === "graph" ? "editor" : "graph");
      } else if (key === "e") {
        if (!store.admin) return; // visitors live in reading view
        e.preventDefault();
        store.toggleReading();
        if (store.view === "graph") store.setView("editor");
      } else if (key === "d") {
        if (!store.admin) return; // daily note may create a file
        // Vim's Ctrl+D (half-page scroll) keeps priority inside the editor.
        const inEditor =
          e.target instanceof Element && e.target.closest(".cm-editor") !== null;
        if (store.vimMode && inEditor && !e.metaKey) return;
        e.preventDefault();
        void openDailyNote();
      } else if (key === "n") {
        if (!store.admin) return;
        e.preventDefault();
        const path = window.prompt("New note path (e.g. ideas/Untitled.md):", "Untitled.md");
        if (!path) return;
        const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
        if (!trimmed) return;
        void store.createNote(trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Until /api/me answers, render nothing — no flash of the wrong mode.
  if (!authReady) return <div className="s-app" />;

  return (
    <div className={`s-app${admin ? "" : " s-app--visitor"}`}>
      <Sidebar />
      <main className="s-main">
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
              <p className="s-empty__title">This vault is private.</p>
              <button
                type="button"
                className="s-btn s-btn--accent"
                onClick={() => useStore.getState().setLoginOpen(true)}
              >
                Sign in
              </button>
            </div>
          ) : (
            <div className="s-empty">
              <div className="s-empty__glyph" aria-hidden="true">✦</div>
              <p className="s-empty__title">The vault is open.</p>
              <div className="s-empty__keys">
                <span className="s-empty__key">
                  <kbd>Ctrl P</kbd> command palette
                </span>
                <span className="s-empty__key">
                  <kbd>Ctrl G</kbd> graph view
                </span>
                {admin && (
                  <>
                    <span className="s-empty__key">
                      <kbd>Ctrl N</kbd> new note
                    </span>
                    <span className="s-empty__key">
                      <kbd>Ctrl S</kbd> save now
                    </span>
                    <span className="s-empty__key">
                      <kbd>Ctrl E</kbd> reading view
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
      {paletteOpen && <CommandPalette />}
      {loginOpen && <LoginModal />}
    </div>
  );
}
