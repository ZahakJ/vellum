// App shell: layout grid (sidebar | main | backlinks, status bar below),
// global keyboard shortcuts, and the single SSE subscription that keeps the
// tree, backlinks, and externally-changed open notes fresh.

import { useEffect, useRef } from "react";
import type { VaultEvent } from "../shared/types.ts";
import { subscribeEvents } from "./api.ts";
import BacklinksPanel from "./components/BacklinksPanel.tsx";
import CommandPalette from "./components/CommandPalette.tsx";
import Editor from "./components/Editor.tsx";
import GraphView from "./components/GraphView.tsx";
import Sidebar from "./components/Sidebar.tsx";
import StatusBar from "./components/StatusBar.tsx";
import Tabs from "./components/Tabs.tsx";
import { useStore } from "./state.ts";
import { toast } from "./toast.ts";

/** Writes made by our own autosave echo back through the watcher; ignore
 *  "changed" events arriving within this window of a local save. */
const SELF_SAVE_WINDOW_MS = 1500;

export default function App() {
  const view = useStore((s) => s.view);
  const openPath = useStore((s) => s.openPath);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const reloadTick = useStore((s) => s.reloadTick);
  const lastSaveRef = useRef(0);

  // Initial data load.
  useEffect(() => {
    void useStore.getState().loadTree();
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

  // SSE: keep tree + backlinks fresh; reload the open note on external change.
  useEffect(() => {
    const onEvent = (ev: VaultEvent) => {
      const store = useStore.getState();
      void store.loadTree();

      if (ev.kind === "renamed" && ev.toPath) {
        store.remapPath(ev.path, ev.toPath);
      } else if (ev.kind === "deleted" && store.openTabs.includes(ev.path)) {
        store.closeTab(ev.path);
      } else if (ev.kind === "changed" && ev.path === store.openPath) {
        const selfSave = Date.now() - lastSaveRef.current < SELF_SAVE_WINDOW_MS;
        if (!selfSave) {
          if (store.dirty[ev.path]) {
            toast(`${ev.path} changed on disk — your unsaved edits were kept`);
          } else {
            store.bumpReload();
          }
        }
      }

      void store.refreshBacklinks();
    };
    return subscribeEvents(onEvent);
  }, []);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const store = useStore.getState();
      const key = e.key.toLowerCase();
      if (key === "p") {
        e.preventDefault();
        store.setPaletteOpen(!store.paletteOpen);
      } else if (key === "g") {
        e.preventDefault();
        store.setView(store.view === "graph" ? "editor" : "graph");
      } else if (key === "n") {
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

  return (
    <div className="s-app">
      <Sidebar />
      <main className="s-main">
        <Tabs />
        <section className="s-view">
          {view === "graph" ? (
            <GraphView />
          ) : openPath ? (
            <Editor key={`${openPath}#${reloadTick}`} path={openPath} />
          ) : (
            <div className="s-empty">
              <p className="s-empty__title">Vellum</p>
              <p className="s-empty__hint">
                Open a note from the sidebar, or press <kbd>Ctrl/Cmd+P</kbd> for the palette
                and <kbd>Ctrl/Cmd+N</kbd> for a new note.
              </p>
            </div>
          )}
        </section>
      </main>
      <BacklinksPanel />
      <StatusBar />
      {paletteOpen && <CommandPalette />}
    </div>
  );
}
