// Sidebar: vault tree (recursive, collapsible, folders first), debounced
// full-text search with <mark> snippets, and a tag list. Inline rename via
// double-click; context menu for new note / new folder / rename / delete.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { AttachmentKind, SearchHit, TagCount, TreeNode } from "../../shared/types.ts";
import { getGraph, getTags, search } from "../api.ts";
import { bannerSrc } from "../banner.ts";
import { collectNotes, resolveLink, type NoteRef } from "../editor/links.ts";
import { countPhrase, localeNum, t, tf, type Lang } from "../i18n.ts";
import { promptNewFolder, promptNewNote } from "../prompts.ts";
import { useStore } from "../state.ts";
import AttachmentViewer, { fileUrl, isViewable } from "./AttachmentViewer.tsx";
import { confirmModal, confirmModalEx } from "./Confirm.tsx";
import { renderSnippet, snippetIsEmpty } from "./snippet.tsx";

const SEARCH_DEBOUNCE_MS = 200;

// How many rows of one folder are rendered before a "show more" row takes
// over. A real vault keeps its images in ONE folder — the fixture this was
// measured against holds 1,158 of them, and a vault's biggest note folder here
// holds 715 — and mounting that many rows in a single commit is a visible
// stall on every expand. Chunking costs one extra click on the rare huge
// folder and nothing at all everywhere else.
const CHUNK = 300;

// The tree's attachment rows are a FILTER, not a fact of the vault: this
// remembers whether the reader wants them. Default on — the whole point is
// that files nobody could see were assumed lost.
const SHOW_ATTACHMENTS_KEY = "vellum.show-attachments";

function loadShowAttachments(): boolean {
  try {
    return localStorage.getItem(SHOW_ATTACHMENTS_KEY) !== "false";
  } catch {
    return true;
  }
}

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

/** Notes only — `.md` files, exactly what the server counts when it moves a
 *  folder to .trash. The tree now also carries attachments, so a plain
 *  "count every file node" would have made the delete dialog promise to move
 *  1,214 notes when it meant 800 notes and 414 images. */
function countNotes(node: TreeNode | null): number {
  if (!node) return 0;
  if (node.type === "file") return node.attachment ? 0 : 1;
  return (node.children ?? []).reduce((sum, child) => sum + countNotes(child), 0);
}

/** Attachments only — the other half of the sidebar footer's count. */
function countAttachments(node: TreeNode | null): number {
  if (!node) return 0;
  if (node.type === "file") return node.attachment ? 1 : 0;
  return (node.children ?? []).reduce((sum, child) => sum + countAttachments(child), 0);
}

// ── Attachment type glyphs ──────────────────────────────────────────────────
// One 14px mark per kind, so a row says what it holds before it is opened.

function IconImage() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M21 16l-5-5-6 6-2-2-5 5" />
    </svg>
  );
}

function IconPdf() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 16.5h4" />
    </svg>
  );
}

function IconAudio() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 17V6l9-2v11" />
      <circle cx="7" cy="17.5" r="3" />
      <circle cx="16" cy="15.5" r="3" />
    </svg>
  );
}

function IconVideo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="M17 10l4-2.5v9L17 14z" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function IconClip() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5l-8.8 8.8a5 5 0 0 1-7.1-7.1l9.2-9.2a3.3 3.3 0 0 1 4.7 4.7l-9.2 9.2a1.7 1.7 0 0 1-2.4-2.4l8.3-8.3" />
    </svg>
  );
}

function AttachmentGlyph({ kind }: { kind: AttachmentKind }) {
  return (
    <span className="s-tree__glyph">
      {kind === "image" ? (
        <IconImage />
      ) : kind === "pdf" ? (
        <IconPdf />
      ) : kind === "audio" ? (
        <IconAudio />
      ) : kind === "video" ? (
        <IconVideo />
      ) : (
        <IconFile />
      )}
    </span>
  );
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
  const renameNote = useStore((s) => s.renameNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const deleteFolder = useStore((s) => s.deleteFolder);
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
  const [showAttachments, setShowAttachments] = useState(loadShowAttachments);
  // The open lightbox: the viewable attachments of ONE folder plus the
  // position inside it, so ← / → walk that folder and nothing else.
  const [viewer, setViewer] = useState<{ items: TreeNode[]; index: number } | null>(null);
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

  // Dismiss the context menu on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
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

  // One note deletes at the same two speeds as a folder, and for the same
  // reason — the dialog that says "cannot be undone" was telling the truth
  // about an `fs.rm` while the folder beside it in the same menu promised
  // .trash. Default: move; the erase is the quiet third route, and it asks a
  // second time wearing red.
  const confirmDelete = (node: TreeNode) => {
    void confirmModalEx({
      title: tf("deleteNoteTitle", { name: node.name }),
      body: tf("deleteNoteBody", { path: node.path }),
      confirmLabel: t("moveToTrash"),
      extraLabel: t("deletePermanently"),
    }).then((result) => {
      if (result === "confirm") {
        void deleteNote(node.path);
        return;
      }
      if (result !== "extra") return;
      void confirmModal({
        title: tf("deleteNotePermTitle", { name: node.name }),
        body: tf("deleteNotePermBody", { path: node.path }),
        confirmLabel: t("deletePermanently"),
        grave: true,
      }).then((ok) => {
        if (ok) void deleteNote(node.path, { permanent: true });
      });
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

  const noteCount = useMemo(() => countNotes(tree), [tree]);
  const attachmentCount = useMemo(() => countAttachments(tree), [tree]);

  const setAttachmentsShown = useCallback((next: boolean) => {
    setShowAttachments(next);
    try {
      localStorage.setItem(SHOW_ATTACHMENTS_KEY, String(next));
    } catch {
      // storage unavailable — the filter still works for this session
    }
  }, []);

  // Identity changes with the flag — which costs nothing: every row re-renders
  // on a toggle anyway, since the filter itself is one of their props.
  const toggleAttachments = useCallback(
    () => setAttachmentsShown(!showAttachments),
    [setAttachmentsShown, showAttachments],
  );

  const showAllAttachments = useCallback(
    () => setAttachmentsShown(true),
    [setAttachmentsShown],
  );

  /** A click on an attachment row. PDFs go to a browser tab, which renders
   *  them properly; everything else opens in the viewer, carrying its folder
   *  with it so the arrow keys have somewhere to go. */
  const openAttachment = useCallback((node: TreeNode, siblings: TreeNode[]) => {
    if (node.attachment?.kind === "pdf") {
      window.open(fileUrl(node.path), "_blank", "noopener,noreferrer");
      return;
    }
    const items = siblings.filter(isViewable);
    const index = Math.max(0, items.findIndex((n) => n.path === node.path));
    if (items.length > 0) setViewer({ items, index });
  }, []);

  // The tree is replaced wholesale on every vault event; a viewer left open on
  // a file that has since been deleted would keep showing a stale frame.
  useEffect(() => {
    setViewer((cur) => {
      if (!cur) return cur;
      const live = new Set<string>();
      const walk = (node: TreeNode): void => {
        if (node.type === "file") live.add(node.path);
        for (const child of node.children ?? []) walk(child);
      };
      if (tree) walk(tree);
      const items = cur.items.filter((n) => live.has(n.path));
      if (items.length === 0) return null;
      const at = cur.items[cur.index];
      const index = Math.max(0, items.findIndex((n) => n.path === at?.path));
      return { items, index };
    });
  }, [tree]);

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
    // Named by what it holds ("Notes sidebar"), never by the edge it is on:
    // that edge is right in Arabic and left in English.
    <aside className="s-sidebar" aria-label={t("paneNotes")}>
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
              onClick={() => void promptNewNote("")}
            >
              <IconNewNote />
            </button>
            <button
              type="button"
              className="s-iconbtn"
              title={t("newFolder")}
              aria-label={t("newFolder")}
              onClick={() => void promptNewFolder("")}
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
        <div className="s-search__results">
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
                  <span className="s-pubstar" title={t("published")} aria-label={t("published")}>
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
          onContextMenu={(e) => {
            if (tree && e.target === e.currentTarget) openMenu(e, tree);
          }}
        >
          <TreeChildren
            nodes={tree?.children ?? []}
            depth={0}
            renaming={renaming}
            lang={lang}
            showAttachments={showAttachments}
            onOpen={openNote}
            onStartRename={startRename}
            onCommitRename={commitRename}
            onCancelRename={cancelRename}
            onMenu={openMenu}
            onAttachment={openAttachment}
            onShowAttachments={showAllAttachments}
          />
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

      {/* The footer counts what is actually in the vault — notes AND the files
          beside them — and carries the filter that decides whether the second
          number is on screen. A hidden filter that removes a thousand rows is
          the bug this round is about, so the OFF state is drawn, not implied:
          the clip goes grey and the count is struck through. */}
      <footer
        className={`s-sidebar-foot${admin && attachmentCount > 0 ? " s-sidebar-foot--split" : ""}`}
      >
        <span>{countPhrase(noteCount, "notes")}</span>
        {admin && attachmentCount > 0 && (
          <button
            type="button"
            className={`s-attfilter s-attfilter--${showAttachments ? "on" : "off"}`}
            onClick={toggleAttachments}
            aria-pressed={showAttachments}
            title={showAttachments ? t("hideAttachments") : t("showAttachments")}
          >
            <span className="s-attfilter__clip">
              <IconClip />
            </span>
            <span className="s-attfilter__count">
              {showAttachments
                ? countPhrase(attachmentCount, "files")
                : tf("attachmentsHidden", { count: countPhrase(attachmentCount, "files") })}
            </span>
          </button>
        )}
      </footer>

      {menu && (
        <div
          ref={menuRef}
          className="s-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(menu.node.type === "folder" || menu.node.path === "") && (
            <>
              <button
                type="button"
                className="s-menu__item"
                onClick={() => {
                  setMenu(null);
                  void promptNewNote(menu.node.path);
                }}
              >
                {t("newNoteHere")}
              </button>
              <button
                type="button"
                className="s-menu__item"
                onClick={() => {
                  setMenu(null);
                  void promptNewFolder(menu.node.path);
                }}
              >
                {t("newFolder")}
              </button>
            </>
          )}
          {/* NOTES only: /api/rename and DELETE /api/note are markdown
              routes ("Not a markdown path" on anything else), so offering
              either on a folder row — or now on an attachment row — is a menu
              item whose only outcome is a toast. */}
          {menu.node.type === "file" && !menu.node.attachment && (
            <button
              type="button"
              className="s-menu__item"
              onClick={() => {
                setMenu(null);
                setRenaming(menu.node.path);
              }}
            >
              {t("rename")}
            </button>
          )}
          {menu.node.type === "file" && !menu.node.attachment && (
            <button
              type="button"
              className="s-menu__item s-menu__item--danger"
              onClick={() => {
                setMenu(null);
                confirmDelete(menu.node);
              }}
            >
              {t("delete")}
            </button>
          )}
          {/* A view filter among the mutations, and deliberately so: the
              reader who lost their files looks for them by right-clicking the
              folder that should hold them. */}
          {attachmentCount > 0 && (
            <button
              type="button"
              className="s-menu__item"
              onClick={() => {
                setMenu(null);
                toggleAttachments();
              }}
            >
              {showAttachments ? t("hideAttachments") : t("showAttachments")}
            </button>
          )}
          {/* Never on the root row: the vault itself is not deletable (the
              server 400s an empty path), and offering it would be a trap. */}
          {menu.node.type === "folder" && menu.node.path !== "" && (
            <button
              type="button"
              className="s-menu__item s-menu__item--danger"
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

      {viewer && (
        <AttachmentViewer
          items={viewer.items}
          index={viewer.index}
          onIndex={(index) => setViewer((cur) => (cur ? { ...cur, index } : cur))}
          onClose={() => setViewer(null)}
        />
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
  renaming: string | null;
  /** Active chrome language. Not read directly — it is a prop purely so a
   *  live language change busts memo() on every row and re-renders the
   *  t() tooltips, without paying for a store subscription per row. */
  lang: Lang;
  /** False hides every attachment row (the sidebar footer's filter). */
  showAttachments: boolean;
  /** The rows rendered beside this one, filter applied — what the viewer
   *  walks with ← / →. Stable per parent render (useMemo in TreeChildren), so
   *  it does not bust memo() on rows that did not change. */
  siblings: TreeNode[];
  onOpen(path: string): void;
  onStartRename(path: string): void;
  onCommitRename(node: TreeNode, name: string): void;
  onCancelRename(): void;
  onMenu(e: ReactMouseEvent, node: TreeNode): void;
  onAttachment(node: TreeNode, siblings: TreeNode[]): void;
  /** Turns the filter back on, from the row that says what it is hiding. */
  onShowAttachments(): void;
}

type TreeChildrenProps = Omit<TreeRowProps, "node" | "siblings"> & { nodes: TreeNode[] };

/** One level of the tree: the attachment filter, then the chunk cap, then the
 *  rows. Both live here rather than in TreeRow so a folder's children are
 *  filtered ONCE per render and every row of that folder shares one `siblings`
 *  array identity. */
function TreeChildren({ nodes, ...rest }: TreeChildrenProps) {
  const visible = useMemo(
    () => (rest.showAttachments ? nodes : nodes.filter((n) => !n.attachment)),
    [nodes, rest.showAttachments],
  );
  const [limit, setLimit] = useState(CHUNK);
  // A folder that shrank (delete, filter flip) must not keep a raised cap.
  const shown = visible.length <= limit ? visible : visible.slice(0, limit);
  const remaining = visible.length - shown.length;
  const hidden = nodes.length - visible.length;

  return (
    <>
      {shown.map((child) => (
        <TreeRow key={child.path} {...rest} node={child} siblings={visible} />
      ))}
      {/* The bug this round answers was a folder that opened onto NOTHING.
          With attachments hidden, an all-attachment folder would do exactly
          that again — so it says what it is holding back, indented where
          those rows would be, and the row itself is the way to see them. */}
      {visible.length === 0 && hidden > 0 && (
        <button
          type="button"
          className="s-tree__hidden"
          style={{ paddingInlineStart: `${rest.depth * 12 + 8}px` }}
          onClick={rest.onShowAttachments}
          title={t("showAttachments")}
        >
          <span className="s-tree__glyph">
            <IconClip />
          </span>
          {tf("attachmentsHidden", { count: countPhrase(hidden, "files") })}
        </button>
      )}
      {remaining > 0 && (
        <button
          type="button"
          className="s-tree__more"
          onClick={() => setLimit((n) => n + CHUNK)}
        >
          {tf("showMoreRows", { count: localeNum(remaining) })}
        </button>
      )}
    </>
  );
}

// Memoized: with stable callbacks from Sidebar, a folder toggle re-renders
// only its own subtree and opening a note re-renders only the two rows whose
// active flag flipped — not all 1.4k rows.
const TreeRow = memo(function TreeRow(props: TreeRowProps) {
  const { node, depth, renaming } = props;
  // Everything a child level needs: this row's own identity drops out, the
  // rest (callbacks, language, the attachment filter) travels down unchanged.
  const { node: _node, siblings: _siblings, ...childProps } = props;
  const isActive = useStore((s) => s.openPath === node.path);
  const isPublished = useStore(
    (s) => node.type === "file" && (s.publishedPaths?.has(node.path) ?? false),
  );
  const isFolder = node.type === "folder";
  const attachment = node.attachment;
  const [isOpen, setIsOpen] = useState(
    () => isFolder && (expandedMap.get(node.path) ?? defaultOpen(depth)),
  );
  // Attachments keep their extension — it is half of what the name says —
  // while a note sheds the ".md" it always has.
  const label = isFolder || attachment ? node.name : node.name.replace(/\.md$/, "");

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    expandedMap.set(node.path, next);
    persistExpanded();
  };

  const classes = [
    "s-tree__item",
    isFolder ? "s-tree__item--folder" : "s-tree__item--file",
    attachment ? "s-tree__item--att" : "",
    isActive ? "s-tree__item--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="s-tree__node">
      <div
        className={classes}
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
        onClick={() =>
          isFolder
            ? toggle()
            : attachment
              ? props.onAttachment(node, props.siblings)
              : props.onOpen(node.path)
        }
        onDoubleClick={(e) => {
          e.stopPropagation();
          // Same rule as the menu: /api/rename is a note route.
          if (!attachment) props.onStartRename(node.path);
        }}
        onContextMenu={(e) => props.onMenu(e, node)}
        role="treeitem"
        aria-expanded={isFolder ? isOpen : undefined}
        // Attachment names are long and the pane is narrow ("Pasted image
        // 20230906180811-10.png" is 38 characters); the tooltip is the only
        // place the whole one fits. Note rows keep their bare label.
        title={attachment ? node.name : undefined}
      >
        {isFolder && (
          <span className={`s-tree__chevron${isOpen ? " s-tree__chevron--open" : ""}`}>
            ›
          </span>
        )}
        {attachment && <AttachmentGlyph kind={attachment.kind} />}
        {renaming === node.path ? (
          <RenameInput
            initial={node.name}
            onCommit={(name) => props.onCommitRename(node, name)}
            onCancel={props.onCancelRename}
          />
        ) : (
          <span className="s-tree__label" dir="auto">
            {label}
            {isPublished && (
              <span className="s-pubstar" title={t("published")} aria-label={t("published")}>
                ✦
              </span>
            )}
          </span>
        )}
        {/* The glyph covers the five kinds; the badge names the exact type for
            the one that has no glyph of its own. */}
        {attachment?.kind === "other" && attachment.ext && (
          <span className="s-tree__ext">{attachment.ext}</span>
        )}
      </div>
      {isFolder && isOpen && (
        <div className="s-tree__children" role="group">
          <TreeChildren {...childProps} nodes={node.children ?? []} depth={depth + 1} />
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
