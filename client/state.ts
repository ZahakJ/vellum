// Global zustand store — the single source of truth for the shell.
// Shape follows the State interface pinned in CONTRACTS.md, plus three small
// shell-internal extensions: setDirty (the channel the Editor uses to report
// dirty state), remapPath (tab bookkeeping on renames), and reloadTick
// (bumped when the open note changed on disk, so the Editor remounts).

import { create } from "zustand";
import type { Backlink, TreeNode } from "../shared/types.ts";
import * as api from "./api.ts";
import { toast } from "./toast.ts";

const THEME_KEY = "vellum.theme";
const VIM_KEY = "vellum.vim";

export type Theme = "iron-gall" | "parchment";
export type View = "editor" | "graph";

export interface State {
  tree: TreeNode | null;
  openPath: string | null;
  openTabs: string[];
  dirty: Record<string, boolean>;
  view: View;
  theme: Theme;
  vimMode: boolean;
  paletteOpen: boolean;
  backlinks: Backlink[];
  /** Bumped when the open note changed externally; App keys the Editor on it. */
  reloadTick: number;

  loadTree(): Promise<void>;
  openNote(path: string): void;
  closeTab(path: string): void;
  setView(v: View): void;
  setTheme(t: Theme): void;
  toggleVim(): void;
  setPaletteOpen(b: boolean): void;
  refreshBacklinks(): Promise<void>;
  createNote(path: string): Promise<void>;
  renameNote(path: string, toPath: string): Promise<void>;
  deleteNote(path: string): Promise<void>;

  /** Editor reports unsaved-changes state here. */
  setDirty(path: string, dirty: boolean): void;
  /** Rewrite a path (or folder prefix) across tabs/openPath/dirty after a rename. */
  remapPath(path: string, toPath: string): void;
  /** Signal that the open note's on-disk content changed externally. */
  bumpReload(): void;
}

function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "parchment" ? "parchment" : "iron-gall";
}

function readVim(): boolean {
  return localStorage.getItem(VIM_KEY) === "true";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

function remap(current: string, from: string, to: string): string {
  if (current === from) return to;
  if (current.startsWith(`${from}/`)) return to + current.slice(from.length);
  return current;
}

async function guarded(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`vellum: ${label} failed`, err);
    toast(err instanceof Error ? err.message : `${label} failed`);
  }
}

export const useStore = create<State>()((set, get) => {
  const initialTheme = readTheme();
  applyTheme(initialTheme);

  return {
    tree: null,
    openPath: null,
    openTabs: [],
    dirty: {},
    view: "editor",
    theme: initialTheme,
    vimMode: readVim(),
    paletteOpen: false,
    backlinks: [],
    reloadTick: 0,

    loadTree: () =>
      guarded("loading vault tree", async () => {
        const tree = await api.getTree();
        set({ tree });
      }),

    openNote: (path) => {
      set((s) => ({
        openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
        openPath: path,
        view: "editor",
      }));
      void get().refreshBacklinks();
    },

    closeTab: (path) => {
      set((s) => {
        const index = s.openTabs.indexOf(path);
        if (index === -1) return s;
        const openTabs = s.openTabs.filter((p) => p !== path);
        const dirty = { ...s.dirty };
        delete dirty[path];
        let openPath = s.openPath;
        if (openPath === path) {
          openPath = openTabs[Math.min(index, openTabs.length - 1)] ?? null;
        }
        return { ...s, openTabs, dirty, openPath };
      });
      void get().refreshBacklinks();
    },

    setView: (view) => set({ view }),

    setTheme: (theme) => {
      localStorage.setItem(THEME_KEY, theme);
      applyTheme(theme);
      set({ theme });
    },

    toggleVim: () => {
      const vimMode = !get().vimMode;
      localStorage.setItem(VIM_KEY, String(vimMode));
      set({ vimMode });
    },

    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

    refreshBacklinks: async () => {
      const { openPath } = get();
      if (!openPath) {
        set({ backlinks: [] });
        return;
      }
      try {
        const backlinks = await api.getBacklinks(openPath);
        // Ignore stale responses if the open note changed mid-flight.
        if (get().openPath === openPath) set({ backlinks });
      } catch (err) {
        console.error("vellum: loading backlinks failed", err);
      }
    },

    createNote: (path) =>
      guarded(`creating ${path}`, async () => {
        await api.createNote(path);
        await get().loadTree();
        get().openNote(path);
      }),

    renameNote: (path, toPath) =>
      guarded(`renaming ${path}`, async () => {
        await api.renameNote(path, toPath);
        get().remapPath(path, toPath);
        await get().loadTree();
        void get().refreshBacklinks();
      }),

    deleteNote: (path) =>
      guarded(`deleting ${path}`, async () => {
        await api.deleteNote(path);
        get().closeTab(path);
        await get().loadTree();
      }),

    setDirty: (path, isDirty) =>
      set((s) =>
        s.dirty[path] === isDirty ? s : { dirty: { ...s.dirty, [path]: isDirty } },
      ),

    remapPath: (path, toPath) =>
      set((s) => {
        const openTabs = s.openTabs.map((p) => remap(p, path, toPath));
        const dirty: Record<string, boolean> = {};
        for (const [p, d] of Object.entries(s.dirty)) dirty[remap(p, path, toPath)] = d;
        const openPath = s.openPath === null ? null : remap(s.openPath, path, toPath);
        return { openTabs, dirty, openPath };
      }),

    bumpReload: () => set((s) => ({ reloadTick: s.reloadTick + 1 })),
  };
});
