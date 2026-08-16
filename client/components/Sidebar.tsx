// Sidebar: vault tree (recursive, collapsible, folders first), debounced
// full-text search with <mark> snippets, and a tag list. Inline rename via
// double-click; context menu for new note / new folder / rename / delete.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { SearchHit, TagCount, TreeNode } from "../../shared/types.ts";
import { createFolder, getGraph, getTags, search } from "../api.ts";
import { bannerSrc } from "../banner.ts";
import { collectNotes, resolveLink, type NoteRef } from "../editor/links.ts";
import { countPhrase, localeNum, t, tf, type Lang } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { confirmModal, confirmModalEx } from "./Confirm.tsx";
import { renderSnippet, snippetIsEmpty } from "./snippet.tsx";

const SEARCH_DEBOUNCE_MS = 200;

/** Margin the context menu keeps from every viewport edge. */
const MENU_EDGE = 8;

// Tags section collapse (tag-heavy vaults: the pill cloud can eat the tree's
// room) — persisted like the tree's folder expansion.
const TAGS_COLLAPSED_KEY = "vellum.tags-collapsed";

function loadTagsCollapsed(): boolean {
  try {
    return localStorage.getItem(TAGS_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function ensureMd(name: string): string {
  return name.endsWith(".md") ? name : `${name}.md`;
}

interface MenuState {
  x: number;
  y: number;
  node: TreeNode; // the root node (path "") stands in for "vault root"
  /** Opened from the keyboard (Shift+F10 / the menu key), so focus has to go
   *  INTO the menu and come back to the row when it closes. A pointer-opened
   *  menu leaves focus where the reader put it. */
  fromKeyboard?: boolean;
}

// ---------------------------------------------------------------------------
// Tree keyboard model.
//
// The tree is one tab stop, not 1,388 of them: the container holds the focus
// and `aria-activedescendant` names the row the reader is on. That is the
// ARIA tree pattern, and here it is also the only shape that survives the
// perf contract — a roving tabindex would have to re-render rows to move,
// and these rows are memoized precisely so a keystroke doesn't touch all of
// them. Everything below therefore reads the CURRENT tree out of the DOM:
// only expanded folders render children, so "the rows in the container" and
// "the rows the reader can see" are the same list by construction.
// ---------------------------------------------------------------------------

/** aria-activedescendant needs an id, and vault paths contain spaces and
 *  slashes — so the path is encoded, never interpolated raw. */
function rowId(path: string): string {
  return `s-tree-row-${encodeURIComponent(path)}`;
}

function findNode(root: TreeNode | null, path: string): TreeNode | null {
  if (!root) return null;
  if (root.path === path) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, path);
    if (hit) return hit;
  }
  return null;
}

function visibleRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".s-tree__item")];
}

// ---------------------------------------------------------------------------
// Folder expansion state. Kept OUTSIDE React (module map + localStorage) so
// each TreeRow owns only its own open flag: toggling a folder re-renders that
// subtree, not the whole tree — O(subtree) on a 1.4k-note vault — and the
// state survives tree reloads, search round-trips, and full page reloads.
// Default: top-level folders open, everything deeper collapsed.
// ---------------------------------------------------------------------------
const EXPANDED_KEY = "vellum.tree-expanded";

function loadExpanded(): Map<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) return new Map(Object.entries(JSON.parse(raw) as Record<string, boolean>));
  } catch {
    // corrupted or unavailable storage — start fresh
  }
  return new Map();
}

const expandedMap = loadExpanded();

function persistExpanded(): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(Object.fromEntries(expandedMap)));
  } catch {
    // storage full/unavailable — expansion still works for this session
  }
}

function defaultOpen(depth: number): boolean {
  return depth === 0;
}

// ---------------------------------------------------------------------------
// Visitor topic sections: per-section collapse persists like the tree's
// folder expansion (module map + localStorage; true = collapsed, default open).
// ---------------------------------------------------------------------------
const TOPICS_KEY = "vellum.topics-collapsed";

function loadTopicsCollapsed(): Map<string, boolean> {
  try {
    const raw = localStorage.getItem(TOPICS_KEY);
    if (raw) return new Map(Object.entries(JSON.parse(raw) as Record<string, boolean>));
  } catch {
    // corrupted or unavailable storage — start fresh
  }
  return new Map();
}

const topicsCollapsedMap = loadTopicsCollapsed();

function persistTopicsCollapsed(): void {
  try {
    localStorage.setItem(TOPICS_KEY, JSON.stringify(Object.fromEntries(topicsCollapsedMap)));
  } catch {
    // storage full/unavailable — collapse still works for this session
  }
}

interface TopicSectionData {
  key: string; // persistence key: "#<tag>" or "untagged"
  label: string; // "philosophy" / "Notes"
  notes: NoteRef[];
}

/** Group published notes into blog-style topic sections by tag. Notes carrying
 *  several tags appear under each; untagged ones land in a final "Notes"
 *  section. Sections are ordered by size (ties alphabetical), "Notes" last. */
function buildTopics(
  notes: NoteRef[],
  homePath: string | null,
  tagsByPath: Map<string, string[]>,
): TopicSectionData[] {
  const byTag = new Map<string, NoteRef[]>();
  const untagged: NoteRef[] = [];
  for (const note of notes) {
    if (note.path === homePath) continue; // pinned above the sections
    const tags = tagsByPath.get(note.path) ?? [];
    if (tags.length === 0) {
      untagged.push(note);
      continue;
    }
    for (const tag of tags) {
      const bucket = byTag.get(tag);
      if (bucket) bucket.push(note);
      else byTag.set(tag, [note]);
    }
  }
  const sections: TopicSectionData[] = [...byTag.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([tag, list]) => ({ key: `#${tag}`, label: tag, notes: list }));
  if (untagged.length > 0) {
    sections.push({ key: "untagged", label: t("notes"), notes: untagged });
  }
  return sections;
}

function countNotes(node: TreeNode | null): number {
  if (!node) return 0;
  if (node.type === "file") return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countNotes(child), 0);
}

function IconNewNote() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 12v6M9 15h6" />
    </svg>
  );
}

function IconNewFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path d="M12 10v6M9 13h6" />
    </svg>
  );
}

export default function Sidebar() {
  const tree = useStore((s) => s.tree);
  const openNote = useStore((s) => s.openNote);
  const createNote = useStore((s) => s.createNote);
  const renameNote = useStore((s) => s.renameNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const loadTree = useStore((s) => s.loadTree);
  const admin = useStore((s) => s.admin);
  const homeNote = useStore((s) => s.homeNote);
  const siteName = useStore((s) => s.siteName);
  // Re-renders the chrome strings on a live language change; also threaded
  // into the memoized rows below so their tooltips follow.
  const lang = useStore((s) => s.language);
  const logo = useStore((s) => s.logo);
  const publishedFilter = useStore((s) => s.publishedFilter);
  const publishedPaths = useStore((s) => s.publishedPaths);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagsCollapsed, setTagsCollapsed] = useState(loadTagsCollapsed);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Set when a reveal had to happen first; the effect below focuses once the
  // pane is actually on screen (see revealSidebar).
  const focusWhenShown = useRef(false);
  const zen = useStore((s) => s.zen);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);

  /** Bring the sidebar back before anything tries to use it. A collapsed pane
   *  (and zen) is `visibility: hidden` until React commits the class removal,
   *  and a hidden field CANNOT take focus — calling focus() in the same tick
   *  silently does nothing and the reader's next keystrokes go to the page.
   *  So when a reveal was needed, the focus waits for the commit. */
  const revealSidebar = (): boolean => {
    const store = useStore.getState();
    const hidden = store.zen || store.sidebarCollapsed;
    if (store.zen) store.setZen(false);
    if (store.sidebarCollapsed) store.setSidebarCollapsed(false);
    return hidden;
  };

  const focusSearch = (): void => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };

  useEffect(() => {
    if (!focusWhenShown.current || zen || sidebarCollapsed) return;
    focusWhenShown.current = false;
    focusSearch();
  }, [zen, sidebarCollapsed]);

  // Ctrl/Cmd+K (App dispatches "vellum:quicksearch"): focus the search box.
  // If the chrome is out of the way, bring it back first — focusing a search
  // field the reader cannot see would swallow every keystroke that follows.
  useEffect(() => {
    const onQuickSearch = () => {
      if (revealSidebar()) focusWhenShown.current = true;
      else focusSearch();
    };
    window.addEventListener("vellum:quicksearch", onQuickSearch);
    return () => window.removeEventListener("vellum:quicksearch", onQuickSearch);
  }, []);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const timer = window.setTimeout(() => {
      search(q).then(setHits).catch((err: unknown) => {
        console.error("vellum: search failed", err);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Editor wiring: clicking a #tag pill in the editor (inline or in the
  // frontmatter properties card) pushes a search query here.
  useEffect(() => {
    const onSearch = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      if (typeof detail !== "string") return;
      // Clicking a #tag in the editor asks for RESULTS; show the pane holding
      // them (same reasoning as the quick-search reveal above).
      revealSidebar();
      setQuery(detail);
    };
    window.addEventListener("vellum:search", onSearch);
    return () => window.removeEventListener("vellum:search", onSearch);
  }, []);

  // Tags track the tree: refetch whenever the vault changes shape/content.
  useEffect(() => {
    getTags().then(setTags).catch((err: unknown) => {
      console.error("vellum: loading tags failed", err);
    });
  }, [tree]);

  // Visitor topic sections need per-note tags; /api/graph carries them (and
  // is publish-scoped for visitors). Keyed on the tree so SSE keeps it fresh.
  const [noteTags, setNoteTags] = useState<Map<string, string[]> | null>(null);
  useEffect(() => {
    if (admin) return;
    let cancelled = false;
    getGraph()
      .then((data) => {
        if (!cancelled) setNoteTags(new Map(data.nodes.map((n) => [n.id, n.tags])));
      })
      .catch((err: unknown) => {
        console.error("vellum: loading note tags failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [admin, tree]);

  // Dismiss the context menu on any outside click or Escape. A menu opened
  // from the keyboard hands focus back to the tree when it goes — otherwise
  // Escape drops the reader on <body> and they have to Tab in from the top.
  useEffect(() => {
    if (!menu) return;
    const close = () => {
      if (menu.fromKeyboard) treeRef.current?.focus();
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  const commitRename = useCallback(
    (node: TreeNode, rawName: string) => {
      setRenaming(null);
      const name = rawName.trim();
      if (!name || name === node.name || name.includes("/")) return;
      const finalName = node.type === "file" ? ensureMd(name) : name;
      void renameNote(node.path, joinPath(parentOf(node.path), finalName));
    },
    [renameNote],
  );

  const cancelRename = useCallback(() => setRenaming(null), []);

  const promptNewNote = (dir: string) => {
    const name = window.prompt(t("newNotePrompt"), "Untitled.md");
    if (!name || !name.trim()) return;
    void createNote(joinPath(dir, ensureMd(name.trim())));
  };

  const promptNewFolder = (dir: string) => {
    const name = window.prompt(t("newFolderPrompt"));
    if (!name || !name.trim()) return;
    createFolder(joinPath(dir, name.trim()))
      .then(() => loadTree())
      .catch((err: unknown) => {
        console.error("vellum: creating folder failed", err);
        toast(err instanceof Error ? err.message : t("creatingFolderFailed"));
      });
  };

  const confirmDelete = (node: TreeNode) => {
    void confirmModal({
      title: t("deleteNoteTitle"),
      body: tf("deleteNoteBody", { path: node.path }),
    }).then((ok) => {
      if (ok) void deleteNote(node.path);
    });
  };

  // Folders delete in two speeds. The default is Obsidian's: move the whole
  // subtree to the vault's .trash/, which the copy promises and the toast
  // repeats. Erasing it outright is the quiet third route in the dialog, and
  // it asks a second time — by then the reader has read the word "permanently"
  // twice and clicked it twice.
  const confirmDeleteFolder = (node: TreeNode) => {
    const count = countPhrase(countNotes(node), "notes");
    void confirmModalEx({
      title: tf("deleteFolderTitle", { name: node.name }),
      body: tf("deleteFolderBody", { count }),
      confirmLabel: t("moveToTrash"),
      extraLabel: t("deletePermanently"),
    }).then((result) => {
      if (result === "confirm") {
        void deleteFolder(node.path);
        return;
      }
      if (result !== "extra") return;
      void confirmModal({
        title: tf("deleteFolderPermTitle", { name: node.name }),
        body: tf("deleteFolderPermBody", { count }),
        confirmLabel: t("deletePermanently"),
        // Nothing here is recoverable, so nothing here looks like the dialog
        // that was: red at rest, and Enter is not armed (Confirm.tsx).
        grave: true,
      }).then((ok) => {
        if (ok) void deleteFolder(node.path, { permanent: true });
      });
    });
  };

  // The context menu opens at the pointer, but the pointer can be anywhere —
  // and with the sidebar on the trailing edge (RTL by default, or a reader who
  // moved it there) a menu that grows toward the trailing edge runs straight
  // off the screen, taking its last item with it. So it opens toward the
  // reading direction, folds back when that edge has no room, and is clamped
  // into the viewport on both axes. Measured after mount, because the menu's
  // size is its content's.
  const menuRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    const { width, height } = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = rtl ? menu.x - width : menu.x;
    if (left + width > vw - MENU_EDGE) left = menu.x - width; // fold back
    if (left < MENU_EDGE) left = menu.x; // …and back again if that overflows
    left = Math.max(MENU_EDGE, Math.min(left, vw - width - MENU_EDGE));
    let top = menu.y;
    if (top + height > vh - MENU_EDGE) top = menu.y - height;
    top = Math.max(MENU_EDGE, Math.min(top, vh - height - MENU_EDGE));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // Opened from the keyboard: focus goes into the menu, or it is a menu
    // that only a mouse can reach.
    if (menu.fromKeyboard) el.querySelector<HTMLButtonElement>(".s-menu__item")?.focus();
  }, [menu]);

  const openMenu = useCallback((e: ReactMouseEvent, node: TreeNode) => {
    if (!useStore.getState().admin) return; // menu holds only mutating actions
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const startRename = useCallback((path: string) => {
    if (!useStore.getState().admin) return;
    setRenaming(path);
  }, []);

  // ── Tree cursor (aria-activedescendant) ────────────────────────────────
  const treeRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  /** The cursor as a DOM class + activedescendant, applied imperatively so
   *  moving it costs one attribute write instead of a re-render of the tree. */
  const paintCursor = useCallback((path: string | null, scroll = true) => {
    const container = treeRef.current;
    if (!container) return;
    for (const el of container.querySelectorAll(".s-tree__item--cursor")) {
      el.classList.remove("s-tree__item--cursor");
    }
    if (path === null) {
      container.removeAttribute("aria-activedescendant");
      return;
    }
    const row = container.querySelector<HTMLElement>(
      `[data-tree-path="${CSS.escape(path)}"]`,
    );
    if (!row) {
      container.removeAttribute("aria-activedescendant");
      return;
    }
    row.classList.add("s-tree__item--cursor");
    container.setAttribute("aria-activedescendant", row.id);
    if (scroll) row.scrollIntoView({ block: "nearest" });
  }, []);

  const moveCursor = useCallback(
    (path: string | null) => {
      setCursor(path);
      paintCursor(path);
    },
    [paintCursor],
  );

  // The tree re-renders under the cursor constantly (SSE, folder toggles,
  // publish marks). Repaint after every commit so the highlight and the
  // activedescendant keep pointing at a row that still exists.
  useLayoutEffect(() => {
    paintCursor(cursor, false);
  });

  /** Where the cursor should start: the open note if it is on screen, else
   *  the first row. Never nothing — a tree you can focus but not steer is a
   *  dead end. (openPath is read off the store rather than subscribed to:
   *  Sidebar re-rendering on every note switch would cost more than this
   *  one lookup on focus.) */
  const initialCursor = useCallback((): string | null => {
    const container = treeRef.current;
    if (!container) return null;
    const rows = visibleRows(container);
    if (rows.length === 0) return null;
    const open = useStore.getState().openPath;
    const found = open ? rows.find((r) => r.dataset.treePath === open) : undefined;
    return (found ?? rows[0]).dataset.treePath ?? null;
  }, []);

  const onTreeKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const container = treeRef.current;
      if (!container) return;
      // A rename input inside a row owns its own keys (it stops propagation),
      // so anything arriving here is the tree's.
      const rows = visibleRows(container);
      if (rows.length === 0) return;
      const at = Math.max(
        0,
        rows.findIndex((r) => r.dataset.treePath === cursor),
      );
      const row = rows[at];
      const path = row?.dataset.treePath ?? null;
      const isFolder = row?.getAttribute("aria-expanded") !== null;
      const isOpen = row?.getAttribute("aria-expanded") === "true";
      const step = (to: number): void => {
        e.preventDefault();
        moveCursor(rows[Math.max(0, Math.min(rows.length - 1, to))]?.dataset.treePath ?? null);
      };

      switch (e.key) {
        case "ArrowDown":
          step(at + 1);
          return;
        case "ArrowUp":
          step(at - 1);
          return;
        case "Home":
          step(0);
          return;
        case "End":
          step(rows.length - 1);
          return;
        case "ArrowRight":
        case "ArrowLeft": {
          // Logical, not physical: in an RTL sidebar the key that opens a
          // folder is the one pointing INTO the indent, which is Left.
          const rtl = getComputedStyle(container).direction === "rtl";
          const forward = rtl ? e.key === "ArrowLeft" : e.key === "ArrowRight";
          e.preventDefault();
          if (forward) {
            if (isFolder && !isOpen) row.click(); // expand
            else if (isFolder && isOpen) step(at + 1); // …then walk in
            return;
          }
          if (isFolder && isOpen) {
            row.click(); // collapse
            return;
          }
          // Otherwise climb to the parent row: the nearest row above whose
          // indent is shallower than this one's.
          if (!path) return;
          const parent = parentOf(path);
          const parentRow = rows.find((r) => r.dataset.treePath === parent);
          if (parentRow) moveCursor(parent);
          return;
        }
        case "Enter":
        case " ":
          if (!row) return;
          e.preventDefault();
          row.click();
          return;
        case "F2":
          if (path && useStore.getState().admin) {
            e.preventDefault();
            startRename(path);
          }
          return;
        case "Delete": {
          if (!path || !useStore.getState().admin) return;
          const node = findNode(tree, path);
          if (!node) return;
          e.preventDefault();
          if (node.type === "folder") confirmDeleteFolder(node);
          else confirmDelete(node);
          return;
        }
        case "ContextMenu":
          break;
        case "F10":
          if (!e.shiftKey) return;
          break;
        default:
          return;
      }
      // Shift+F10 / the context-menu key: the keyboard's right-click. It
      // opens at the row, not at the last place the mouse happened to be.
      if (!path || !useStore.getState().admin) return;
      const node = findNode(tree, path);
      if (!node) return;
      e.preventDefault();
      const box = row.getBoundingClientRect();
      setMenu({ x: Math.round(box.left + 12), y: Math.round(box.bottom), node, fromKeyboard: true });
    },
    [cursor, moveCursor, startRename, tree],
  );

  const noteCount = useMemo(() => countNotes(tree), [tree]);

  // Visitor collection: flat, alphabetical (collectNotes sorts by title),
  // with the home note pinned first. Also reused for the admin's
  // "published only" sidebar filter.
  const flatNotes = useMemo(() => {
    if (admin && !publishedFilter) return null;
    let notes = collectNotes(tree);
    if (admin) notes = notes.filter((n) => publishedPaths?.has(n.path));
    const home = homeNote ? resolveLink(homeNote, tree) : null;
    if (home) {
      const i = notes.findIndex((n) => n.path === home);
      if (i > 0) notes = [notes[i], ...notes.slice(0, i), ...notes.slice(i + 1)];
    }
    return { notes, home };
  }, [admin, publishedFilter, publishedPaths, tree, homeNote]);

  // Visitor sidebar: blog-style topic sections derived from published notes'
  // tags. Falls back to the flat list until the tag map has loaded. The admin
  // sidebar (tree + "published only" filter) is untouched.
  const topics = useMemo(() => {
    if (admin || !flatNotes || noteTags === null) return null;
    return buildTopics(flatNotes.notes, flatNotes.home, noteTags);
  }, [admin, flatNotes, noteTags]);

  return (
    // Two <aside>s in this shell (this and the backlinks panel) become two
    // "complementary" landmarks with identical names — which is to say, none.
    <aside className="s-sidebar" aria-label={t("sidebarAria")}>
      <header className="s-sidebar-header">
        {admin ? (
          // The wordmark doubles as the preview toggle: one click shows the
          // site exactly as a visitor gets it (same path as the status-bar eye).
          <button
            type="button"
            className="s-title"
            title={t("viewPublicSite")}
            onClick={() => void useStore.getState().setPreviewVisitor(true)}
          >
            {logo ? (
              <img className="s-title__logo" src={bannerSrc(logo)} alt={siteName} />
            ) : (
              <>
                <span className="s-title__star" aria-hidden="true">✦</span>
                {siteName}
              </>
            )}
          </button>
        ) : (
          <h1 className="s-title">
            {logo ? (
              <img className="s-title__logo" src={bannerSrc(logo)} alt={siteName} />
            ) : (
              <>
                <span className="s-title__star" aria-hidden="true">✦</span>
                {siteName}
              </>
            )}
          </h1>
        )}
        {admin && (
          <span className="s-sidebar-actions">
            <button
              type="button"
              className="s-iconbtn"
              title={t("newNote")}
              aria-label={t("newNote")}
              onClick={() => promptNewNote("")}
            >
              <IconNewNote />
            </button>
            <button
              type="button"
              className="s-iconbtn"
              title={t("newFolder")}
              aria-label={t("newFolder")}
              onClick={() => promptNewFolder("")}
            >
              <IconNewFolder />
            </button>
          </span>
        )}
      </header>
      <div className="s-search">
        <input
          ref={searchRef}
          className="s-search__input"
          type="search"
          placeholder={t("searchPlaceholder")}
          // A placeholder is not a label: it disappears the moment the reader
          // types, and several screen readers never announce it at all.
          aria-label={t("searchTitle")}
          title={t("searchTitle")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          spellCheck={false}
        />
      </div>

      {admin && publishedFilter && (
        <div className="s-filterbar">
          <span className="s-filterbar__label">
            <span aria-hidden="true">✦</span> {t("publishedOnly")}
          </span>
          <button
            type="button"
            className="s-filterbar__clear"
            onClick={() => useStore.getState().setPublishedFilter(false)}
          >
            {t("showAll")}
          </button>
        </div>
      )}

      {hits !== null ? (
        // A results list that swaps in silently is a list a screen-reader user
        // never learns about — the count is announced politely as it lands.
        <div className="s-search__results" role="region" aria-label={t("searchResultsAria")}>
          <p className="s-sr-only" role="status">
            {hits.length === 0 ? t("noResultsAria") : tf("resultCount", { count: localeNum(hits.length) })}
          </p>
          {hits.length === 0 && <p className="s-search__none">{t("noMatchesDot")}</p>}
          {hits.map((hit) => (
            <button
              key={hit.path}
              type="button"
              className="s-search-hit"
              onClick={() => openNote(hit.path)}
            >
              {/* Direction per note, alignment per chrome (see BacklinksPanel):
                  the isolate goes around the title, not around the line that
                  also carries the ✦ published star. */}
              <span className="s-search-hit__title">
                <bdi>{hit.title}</bdi>
                {admin && publishedPaths?.has(hit.path) && (
                  <span className="s-pubstar" role="img" title={t("published")} aria-label={t("published")}>
                    ✦
                  </span>
                )}
              </span>
              {!snippetIsEmpty(hit.snippet) && (
                <span className="s-search-hit__snippet" dir="auto">
                  {renderSnippet(hit.snippet)}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : topics !== null && flatNotes !== null ? (
        <nav className="s-publist s-topics" aria-label={t("notesByTopic")}>
          {flatNotes.home !== null &&
            flatNotes.notes
              .filter((note) => note.path === flatNotes.home)
              .map((note) => (
                <PubRow
                  key={note.path}
                  path={note.path}
                  title={note.title}
                  isHome
                  lang={lang}
                  onOpen={openNote}
                />
              ))}
          {flatNotes.home !== null && topics.length > 0 && (
            <div className="s-topics__rule" aria-hidden="true" />
          )}
          {topics.map((section) => (
            <TopicSection key={section.key} section={section} lang={lang} onOpen={openNote} />
          ))}
          {flatNotes.notes.length === 0 && (
            <p className="s-publist__none">{t("nothingPublished")}</p>
          )}
        </nav>
      ) : flatNotes !== null ? (
        <nav className="s-publist" aria-label={admin ? t("publishedNotes") : t("notes")}>
          {admin && (
            <div className="s-publist__head">
              <span className="s-publist__headstar" aria-hidden="true">✦</span>
              {t("publishedOnly")}
            </div>
          )}
          {flatNotes.notes.map((note) => (
            <PubRow
              key={note.path}
              path={note.path}
              title={note.title}
              isHome={note.path === flatNotes.home}
              lang={lang}
              onOpen={openNote}
            />
          ))}
          {flatNotes.notes.length === 0 && (
            <p className="s-publist__none">{t("nothingPublished")}</p>
          )}
        </nav>
      ) : (
        <nav
          className="s-tree"
          aria-label={t("vaultTree")}
          onContextMenu={(e) => {
            if (tree && e.target === e.currentTarget) openMenu(e, tree);
          }}
        >
          {/* One tab stop for the whole vault. `aria-activedescendant` names
              the row the reader is on (see the tree keyboard model above);
              the roles make it a tree to a screen reader instead of a pile
              of unlabelled divs, which is what it was. */}
          <div
            ref={treeRef}
            className="s-tree__root"
            role="tree"
            aria-label={t("vaultTree")}
            tabIndex={0}
            onKeyDown={onTreeKeyDown}
            onFocus={(e) => {
              if (e.target !== e.currentTarget) return;
              if (cursor === null) moveCursor(initialCursor());
            }}
            onMouseDown={(e) => {
              // Clicking a row moves the cursor there, so the arrows continue
              // from where the reader last pointed rather than from wherever
              // the keyboard left off.
              const row = (e.target as HTMLElement).closest<HTMLElement>(".s-tree__item");
              if (row?.dataset.treePath !== undefined) setCursor(row.dataset.treePath);
            }}
          >
            {tree?.children?.map((child, i) => (
              <TreeRow
                key={child.path}
                node={child}
                depth={0}
                index={i}
                setSize={tree.children?.length ?? 1}
                renaming={renaming}
                lang={lang}
                onOpen={openNote}
                onStartRename={startRename}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onMenu={openMenu}
              />
            ))}
          </div>
        </nav>
      )}

      {tags.length > 0 && (
        <div className={`s-tags${tagsCollapsed ? " s-tags--collapsed" : ""}`}>
          <button
            type="button"
            className="s-tags__toggle"
            onClick={() => {
              const next = !tagsCollapsed;
              setTagsCollapsed(next);
              try {
                localStorage.setItem(TAGS_COLLAPSED_KEY, String(next));
              } catch {
                // storage unavailable — collapse still works for this session
              }
            }}
            aria-expanded={!tagsCollapsed}
            title={tagsCollapsed ? t("showTags") : t("hideTags")}
          >
            <span
              className={`s-tree__chevron${tagsCollapsed ? "" : " s-tree__chevron--open"}`}
              aria-hidden="true"
            >
              ›
            </span>
            <span className="s-tags__title">{t("tags")}</span>
            <span className="s-tags__total">{localeNum(tags.length)}</span>
          </button>
          {!tagsCollapsed && (
          <div className="s-tags__list">
            {tags.map(({ tag, count }) => {
              const active = query.trim() === `#${tag}`;
              return (
              <button
                key={tag}
                type="button"
                className={active ? "s-tag s-tag--active" : "s-tag"}
                onClick={() => setQuery(active ? "" : `#${tag}`)}
                title={tf(active ? "clearTagFilter" : "searchTag", { tag })}
              >
                {/* The hash belongs TO the tag name, so the two share one
                    bidi isolate: without it the RTL shell drew a Latin tag as
                    "baby #", the hash flush against the pill's right edge.
                    The count stays outside the isolate — it is chrome, and
                    keeps the pill's own inline order. Same rendering as the
                    blog's .s-blog-chip. */}
                <bdi className="s-tag__name">
                  <span className="s-tag__hash" aria-hidden="true">#</span>
                  {tag}
                </bdi>
                <span className="s-tag__count">{localeNum(count)}</span>
              </button>
              );
            })}
          </div>
          )}
        </div>
      )}

      <footer className="s-sidebar-foot">{countPhrase(noteCount, "notes")}</footer>

      {menu && (
        <div
          ref={menuRef}
          className="s-menu"
          role="menu"
          aria-label={t("rowActions")}
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Arrows walk the items, Tab leaves (a menu is not a tab ring),
            // Escape is handled by the global listener above.
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Tab") return;
            const items = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>(".s-menu__item"),
            ];
            if (e.key === "Tab") {
              treeRef.current?.focus();
              setMenu(null);
              return;
            }
            e.preventDefault();
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            const step = e.key === "ArrowDown" ? 1 : -1;
            items[(Math.max(0, at) + step + items.length) % items.length]?.focus();
          }}
        >
          {(menu.node.type === "folder" || menu.node.path === "") && (
            <>
              <button
                type="button"
                className="s-menu__item"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  promptNewNote(menu.node.path);
                }}
              >
                {t("newNoteHere")}
              </button>
              <button
                type="button"
                className="s-menu__item"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  promptNewFolder(menu.node.path);
                }}
              >
                {t("newFolder")}
              </button>
            </>
          )}
          {/* Files only: /api/rename is a note route ("Not a markdown path"
              on a folder), so offering it on a folder row was a menu item
              whose only outcome was a toast. */}
          {menu.node.type === "file" && (
            <button
              type="button"
              className="s-menu__item"
                role="menuitem"
              onClick={() => {
                setMenu(null);
                setRenaming(menu.node.path);
              }}
            >
              {t("rename")}
            </button>
          )}
          {menu.node.type === "file" && (
            <button
              type="button"
              className="s-menu__item s-menu__item--danger"
                role="menuitem"
              onClick={() => {
                setMenu(null);
                confirmDelete(menu.node);
              }}
            >
              {t("delete")}
            </button>
          )}
          {/* Never on the root row: the vault itself is not deletable (the
              server 400s an empty path), and offering it would be a trap. */}
          {menu.node.type === "folder" && menu.node.path !== "" && (
            <button
              type="button"
              className="s-menu__item s-menu__item--danger"
                role="menuitem"
              onClick={() => {
                setMenu(null);
                confirmDeleteFolder(menu.node);
              }}
            >
              {t("deleteFolder")}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

/** One row of the flat curated list (visitor sidebar / admin publish filter). */
const PubRow = memo(function PubRow({
  path,
  title,
  isHome,
  onOpen,
}: {
  path: string;
  title: string;
  isHome: boolean;
  lang: Lang; // memo-buster for the t() tooltip; see TreeRowProps.lang
  onOpen(path: string): void;
}) {
  const isActive = useStore((s) => s.openPath === path);
  return (
    <button
      type="button"
      className={`s-publist__item${isActive ? " s-publist__item--active" : ""}`}
      onClick={() => onOpen(path)}
      title={title}
    >
      {isHome && (
        <span className="s-publist__home" title={t("home")} aria-hidden="true">
          ✦
        </span>
      )}
      <span className="s-publist__title" dir="auto">{title}</span>
    </button>
  );
});

/** One collapsible topic section of the visitor sidebar (serif small-caps
 *  header + count, notes beneath). Collapse persists per section key. */
const TopicSection = memo(function TopicSection({
  section,
  lang,
  onOpen,
}: {
  section: TopicSectionData;
  lang: Lang; // memo-buster for the t() tooltips; see TreeRowProps.lang
  onOpen(path: string): void;
}) {
  const [open, setOpen] = useState(
    () => !(topicsCollapsedMap.get(section.key) ?? false),
  );

  const toggle = () => {
    const next = !open;
    setOpen(next);
    topicsCollapsedMap.set(section.key, !next);
    persistTopicsCollapsed();
  };

  return (
    <section className="s-topic">
      <button
        type="button"
        className="s-topic__head"
        onClick={toggle}
        aria-expanded={open}
        title={tf(open ? "collapseSection" : "expandSection", { label: section.label })}
      >
        <span
          className={`s-tree__chevron${open ? " s-tree__chevron--open" : ""}`}
          aria-hidden="true"
        >
          ›
        </span>
        <span className="s-topic__label" dir="auto">{section.label}</span>
        <span className="s-topic__count">{localeNum(section.notes.length)}</span>
      </button>
      {open && (
        <div className="s-topic__list" role="group">
          {section.notes.map((note) => (
            <PubRow
              key={note.path}
              path={note.path}
              title={note.title}
              isHome={false}
              lang={lang}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </section>
  );
});

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  /** 0-based position among its siblings, and how many siblings there are —
   *  the flat tree model states both on every row (aria-posinset/setsize). */
  index: number;
  setSize: number;
  renaming: string | null;
  /** Active chrome language. Not read directly — it is a prop purely so a
   *  live language change busts memo() on every row and re-renders the
   *  t() tooltips, without paying for a store subscription per row. */
  lang: Lang;
  onOpen(path: string): void;
  onStartRename(path: string): void;
  onCommitRename(node: TreeNode, name: string): void;
  onCancelRename(): void;
  onMenu(e: ReactMouseEvent, node: TreeNode): void;
}

// Memoized: with stable callbacks from Sidebar, a folder toggle re-renders
// only its own subtree and opening a note re-renders only the two rows whose
// active flag flipped — not all 1.4k rows.
const TreeRow = memo(function TreeRow(props: TreeRowProps) {
  const { node, depth, renaming } = props;
  const isActive = useStore((s) => s.openPath === node.path);
  const isPublished = useStore(
    (s) => node.type === "file" && (s.publishedPaths?.has(node.path) ?? false),
  );
  const isFolder = node.type === "folder";
  const [isOpen, setIsOpen] = useState(
    () => isFolder && (expandedMap.get(node.path) ?? defaultOpen(depth)),
  );
  const label = isFolder ? node.name : node.name.replace(/\.md$/, "");

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    expandedMap.set(node.path, next);
    persistExpanded();
  };

  const classes = [
    "s-tree__item",
    isFolder ? "s-tree__item--folder" : "s-tree__item--file",
    isActive ? "s-tree__item--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="s-tree__node" role="none">
      <div
        id={rowId(node.path)}
        data-tree-path={node.path}
        className={classes}
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
        onClick={() => (isFolder ? toggle() : props.onOpen(node.path))}
        onDoubleClick={(e) => {
          e.stopPropagation();
          props.onStartRename(node.path);
        }}
        onContextMenu={(e) => props.onMenu(e, node)}
        role="treeitem"
        // The FLAT tree model (ARIA APG's second shape): every row states its
        // own level and position instead of relying on nested role="group"
        // containers. The nesting here cannot express ownership anyway — the
        // children div is a SIBLING of the row that opens it, because the row
        // is a fixed-height flex line and the subtree is not inside it — and
        // aria-owns is the weaker-supported of the two escapes.
        aria-level={depth + 1}
        aria-posinset={props.index + 1}
        aria-setsize={props.setSize}
        aria-selected={isActive}
        aria-expanded={isFolder ? isOpen : undefined}
      >
        {isFolder && (
          <span
            className={`s-tree__chevron${isOpen ? " s-tree__chevron--open" : ""}`}
            aria-hidden="true"
          >
            ›
          </span>
        )}
        {renaming === node.path ? (
          <RenameInput
            initial={node.name}
            onCommit={(name) => props.onCommitRename(node, name)}
            onCancel={props.onCancelRename}
          />
        ) : (
          <span className="s-tree__label" dir="auto">
            {label}
            {/* A bare aria-label on a <span> is not reliably exposed — the
                star needs a role before it counts as a labelled thing. */}
            {isPublished && (
              <span className="s-pubstar" role="img" title={t("published")} aria-label={t("published")}>
                ✦
              </span>
            )}
          </span>
        )}
      </div>
      {isFolder && isOpen && (
        <div className="s-tree__children" role="none">
          {node.children?.map((child, i) => (
            <TreeRow
              key={child.path}
              {...props}
              node={child}
              depth={depth + 1}
              index={i}
              setSize={node.children?.length ?? 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit(name: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      className="s-tree__rename"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
    />
  );
}
