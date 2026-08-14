// Global zustand store — the single source of truth for the shell.
// Shape follows the State interface pinned in CONTRACTS.md, plus three small
// shell-internal extensions: setDirty (the channel the Editor uses to report
// dirty state), remapPath (tab bookkeeping on renames), and reloadTick
// (bumped when the open note changed on disk, so the Editor remounts).

import { create } from "zustand";
import type { Backlink, TreeNode } from "../shared/types.ts";
import * as api from "./api.ts";
import { collectNotes, resolveLink } from "./editor/links.ts";
import { toast } from "./toast.ts";

const THEME_KEY = "vellum.theme";
const VIM_KEY = "vellum.vim";
const READING_KEY = "vellum.reading";
const TABS_KEY = "vellum.tabs";

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
  /** Ctrl/Cmd+E: render the open note read-only instead of editing. */
  readingMode: boolean;
  paletteOpen: boolean;
  backlinks: Backlink[];
  /** Bumped when the open note changed externally; App keys the Editor on it. */
  reloadTick: number;
  /** Heading to scroll to once the next opened note finishes loading
   *  ([[Note#Heading]] navigation); consumed by Editor / ReadingView. */
  pendingHeading: string | null;

  // ------------------------------------------------------------------ auth
  /** This session may mutate the vault (server said so via /api/me). */
  admin: boolean;
  /** /api/me answered — App renders nothing until then to avoid mode flashes. */
  authReady: boolean;
  /** An admin password hash is configured server-side (sign in/out matters). */
  authProtected: boolean;
  /** Reads are open without a session (PUBLIC != false). */
  publicReads: boolean;
  /** Note path/name opened for fresh visitors (HOME_NOTE). */
  homeNote: string | null;
  loginOpen: boolean;

  /** Boot: fetch /api/me, then load the vault + restore session/home note. */
  bootstrap(): Promise<void>;
  loadMe(): Promise<void>;
  /** Verify the password; throws (with the server message) on failure. */
  login(password: string): Promise<void>;
  logout(): Promise<void>;
  setLoginOpen(b: boolean): void;

  loadTree(): Promise<void>;
  openNote(path: string): void;
  closeTab(path: string): void;
  setView(v: View): void;
  setTheme(t: Theme): void;
  toggleVim(): void;
  toggleReading(): void;
  setReadingMode(b: boolean): void;
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
  /** Queue (or clear) a heading for the next opened note to scroll to. */
  setPendingHeading(h: string | null): void;
}

function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "parchment" ? "parchment" : "iron-gall";
}

function readVim(): boolean {
  return localStorage.getItem(VIM_KEY) === "true";
}

function readReading(): boolean {
  return localStorage.getItem(READING_KEY) === "true";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

// Open tabs survive reloads; their absence marks a fresh visitor (→ home note).
interface StoredTabs {
  tabs: string[];
  open: string | null;
}

function readStoredTabs(): StoredTabs | null {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTabs>;
    if (!Array.isArray(parsed.tabs)) return null;
    return {
      tabs: parsed.tabs.filter((t): t is string => typeof t === "string"),
      open: typeof parsed.open === "string" ? parsed.open : null,
    };
  } catch {
    return null; // corrupted or unavailable storage
  }
}

function persistTabs(tabs: string[], open: string | null): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, open }));
  } catch {
    // storage full/unavailable — session restore just won't work
  }
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

  /** Load the tree, then restore last session's tabs — or open the home note
   *  for fresh visitors (no tabs remembered in localStorage). */
  const enterVault = async (): Promise<void> => {
    await get().loadTree();
    const tree = get().tree;
    const existing = new Set(collectNotes(tree).map((n) => n.path));
    const stored = readStoredTabs();
    const tabs = (stored?.tabs ?? []).filter((p) => existing.has(p));
    if (tabs.length > 0) {
      const remembered = stored?.open;
      const open =
        remembered && tabs.includes(remembered) ? remembered : tabs[tabs.length - 1];
      set({ openTabs: tabs, openPath: open });
      void get().refreshBacklinks();
      return;
    }
    const home = get().homeNote;
    // A deep link in the address bar outranks the home note — the router
    // applies it right after bootstrap (client/router.ts).
    const deepLinked = location.pathname !== "/" && location.pathname !== "/graph";
    if (home && !deepLinked) {
      const path = resolveLink(home, tree);
      if (path) get().openNote(path);
      else console.warn(`vellum: home note "${home}" not found in the vault`);
    }
  };

  return {
    tree: null,
    openPath: null,
    openTabs: [],
    dirty: {},
    view: "editor",
    theme: initialTheme,
    vimMode: readVim(),
    readingMode: readReading(),
    paletteOpen: false,
    backlinks: [],
    reloadTick: 0,
    pendingHeading: null,

    admin: true,
    authReady: false,
    authProtected: false,
    publicReads: true,
    homeNote: null,
    loginOpen: false,

    bootstrap: async () => {
      await get().loadMe();
      const { admin, publicReads } = get();
      if (!admin && !publicReads) {
        // Locked vault: nothing is readable until sign-in.
        set({ authReady: true, loginOpen: true });
        return;
      }
      await enterVault();
      set({ authReady: true });
    },

    loadMe: async () => {
      try {
        const me = await api.getMe();
        set({
          admin: me.admin,
          publicReads: me.public,
          authProtected: me.protected ?? false,
          homeNote: me.homeNote ?? null,
        });
      } catch (err) {
        // Server unreachable/old — behave like open local mode.
        console.error("vellum: fetching /api/me failed", err);
        set({ admin: true, publicReads: true, authProtected: false });
      }
    },

    login: async (password) => {
      await api.login(password); // throws with server message on 401/429
      await get().loadMe();
      set({ loginOpen: false });
      if (get().tree === null) await enterVault(); // vault was locked until now
    },

    logout: () =>
      guarded("signing out", async () => {
        await api.logout();
        await get().loadMe();
        const { admin, publicReads } = get();
        if (!admin && !publicReads) {
          // Vault is locked again for this session — drop everything readable.
          set({ tree: null, openTabs: [], openPath: null, backlinks: [], view: "editor" });
        }
      }),

    setLoginOpen: (loginOpen) => set({ loginOpen }),

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

    toggleReading: () => get().setReadingMode(!get().readingMode),

    setReadingMode: (readingMode) => {
      localStorage.setItem(READING_KEY, String(readingMode));
      set({ readingMode });
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
        // A just-created note is empty — reading view would be a blank pane.
        if (get().readingMode) get().setReadingMode(false);
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

    setPendingHeading: (pendingHeading) => set({ pendingHeading }),
  };
});

// Remember open tabs across reloads (their absence marks a fresh visitor,
// who gets the home note instead). Persist only after the session restored,
// so a slow boot never clobbers the stored tabs with the empty initial state.
useStore.subscribe((s, prev) => {
  if (!s.authReady) return;
  if (s.openTabs !== prev.openTabs || s.openPath !== prev.openPath) {
    persistTabs(s.openTabs, s.openPath);
  }
});
