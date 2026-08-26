// Sidebar: vault tree (recursive, collapsible, folders first), debounced
// full-text search with <mark> snippets, and a tag list. Inline rename via
// double-click; context menu for new note / new folder / rename / delete.

import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { lazySurface } from "../lazySurface.tsx";
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { AttachmentKind, SearchHit, SearchMatch, TagCount, TreeNode } from "../../shared/types.ts";
import { getGraph, getTags, patchSettings, search, searchMatches, seedStatus, seedVault } from "../api.ts";
import {
  dragFileCount,
  dragHasFiles,
  droppedFiles,
  uploadDroppedFiles,
} from "../attachments.ts";
import { useBannerSrc } from "./BannerImg.tsx";
import { collectNotes, resolveLink, type NoteRef } from "../editor/links.ts";
import { useVaultGraph } from "../graphCache.ts";
import { countPhrase, localeNum, t, tf, type Lang } from "../i18n.ts";
// client/landing.ts (landOnLine, installNotePreviews) is reached by DYNAMIC
// import below: this chunk is inside the admin-first-paint budget that
// check-bundle measures, and a landing/hover module is interaction-time code.
// The reading view imports the same module statically, so there is exactly one
// instance either way.
// Tag chips print the vault's own display label when one exists (a tag page's
// `labels:` map, or settings.tagLabels); `data`/keys/searches stay canonical.
import { label as tagLabel, useTagLabels } from "../tagLabels.ts";
// Rename/merge a tag across the whole vault — the pill's one verb.
import { promptTagRename } from "../tagRename.ts";
import { beginTabDrag, endTabDrag } from "../dragTab.ts";
import { isTabbablePath } from "../workspace.ts";
import {
  autoScroll,
  beginDrag,
  canDrop,
  draggedItem,
  endDrag,
  itemLabel,
  itemOf,
  renameTo,
  makeDragGhost,
  moveTo,
  stopAutoScroll,
} from "../move.ts";
import { promptNewFolder, promptNewNote } from "../prompts.ts";
import { newNoteFromTemplateCommand } from "../templateActions.ts";
import { useStore } from "../state.ts";
import AttachmentViewer, { fileUrl, isViewable } from "./AttachmentViewer.tsx";
// The reader's door only — a tiny module whose heavy half (the shelf, the page
// renderer, pdf.js) is behind a dynamic import. See client/books/door.ts.
import { openBookPath } from "../books/door.ts";
import { confirmModal, confirmModalEx } from "./Confirm.tsx";
import { moveViaPicker } from "./MovePicker.tsx";
import {
  confirmDeleteAttachment,
  confirmDeleteFolder,
  confirmDeleteNote,
} from "./deleteFlow.ts";
import { renderSnippet, snippetIsEmpty } from "./snippet.tsx";
// Per-folder glyphs. The MARK is static — it paints on the tree's first frame,
// so it has to be in this chunk. The PICKER is not: it opens from a context
// menu, which is interaction time, and a lazy() boundary is what keeps its
// twenty labels and its popover out of the admin first paint that
// check-bundle measures (the same argument client/landing.ts makes above).
import FolderGlyph from "./FolderGlyph.tsx";
import type { IconPickState } from "./FolderIconPicker.tsx";
import type { FolderIcon } from "../../shared/folderIcons.ts";
import { toast } from "../toast.ts";
import "../styles/move.css";
import { isNotePath, noteLabelOf } from "../../shared/noteFormat.ts";

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

/** Put a context menu at the pointer without letting it leave the screen.
 *
 *  The pointer can be anywhere, and with the sidebar on the trailing edge (RTL
 *  by default, or a reader who moved it there) a menu that grows toward the
 *  trailing edge runs straight off the screen taking its last item with it. So
 *  it opens toward the reading direction, folds back when that edge has no
 *  room, and is clamped on both axes. Measured after mount, because a menu's
 *  size is its content's — and shared by the tree's menu and the tag shelf's,
 *  because two placement rules is how one of them ends up wrong. */
function placeMenu(el: HTMLElement | null, x: number, y: number, fromKeyboard: boolean): void {
  if (!el) return;
  const rtl = getComputedStyle(document.documentElement).direction === "rtl";
  const { width, height } = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let left = rtl ? x - width : x;
  if (left + width > vw - MENU_EDGE) left = x - width; // fold back
  if (left < MENU_EDGE) left = x; // …and back again if that overflows
  left = Math.max(MENU_EDGE, Math.min(left, vw - width - MENU_EDGE));
  let top = y;
  if (top + height > vh - MENU_EDGE) top = y - height;
  top = Math.max(MENU_EDGE, Math.min(top, vh - height - MENU_EDGE));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  // Opened from the keyboard: focus goes into the menu, or it is a menu that
  // only a mouse can reach.
  if (fromKeyboard) el.querySelector<HTMLButtonElement>(".s-menu__item")?.focus();
}

// Mount-gated on `iconPick`, with its own <Suspense> — the App.tsx rule: a
// boundary tears down everything under it, and this one wraps nothing but the
// popover, so the tree behind it never blinks while the chunk lands.
const FolderIconPicker = lazySurface(() => import("./FolderIconPicker.tsx"));

// The two v1.8 search surfaces, mount-gated for the same reason and split for
// one more: the replace panel carries the dry-run list, its own stylesheet and
// the confirm dialog, and it is opened by a fraction of sessions. Neither
// belongs in a chunk the sidebar downloads to draw a tree.
const ReplacePanel = lazySurface(() => import("./ReplacePanel.tsx"));
const SearchHelp = lazySurface(() => import("./SearchHelp.tsx"));

// How long a collapsed folder has to be hovered, mid-drag, before it opens —
// "spring-loaded folders", the thing that makes a deep destination reachable
// without dropping, expanding, and picking the item up again. 600ms is the
// Finder/Obsidian figure: long enough that passing OVER a folder on the way
// somewhere else never opens it, short enough that deliberately resting on one
// does not feel broken.
const SPRING_MS = 600;

// Tags section collapse (tag-heavy vaults: the pill cloud can eat the tree's
// room) — persisted like the tree's folder expansion.
const TAGS_COLLAPSED_KEY = "vellum.tags-collapsed";
/** How many tag pills the shelf shows before it offers the rest (F17) — a
 *  dozen is about four rows in a 292px sidebar, which leaves the tree the pane.
 *  The pills arrive sorted by count, so the twelve shown are the twelve used. */
const TAG_SHELF_CAP = 12;

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

function ensureMd(name: string): string {
  return isNotePath(name) ? name : `${name}.md`;
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

/** The tag shelf's own context menu. A separate state from the tree's because
 *  a tag is not a tree node — it has no path, no parent and exactly one verb —
 *  and threading an optional node through every row of the menu above would
 *  have made eleven guards out of one. They share the placement rule and the
 *  `.s-menu` chrome, which is the part that has to agree. */
interface TagMenuState {
  x: number;
  y: number;
  tag: string;
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

/** Up/Down inside a WRAPPED row of chips: the index of the nearest chip on the
 *  next (`dir` 1) or previous (`dir` -1) visual line, measured from the centre
 *  of the one you are on. `offsetTop` is the line: chips on one line share it,
 *  and it is the only thing that knows where the text wrapped. Returns -1 when
 *  there is no such line. */
function rowStep(chips: HTMLElement[], at: number, dir: 1 | -1): number {
  const from = chips[at];
  if (!from) return -1;
  const line = from.offsetTop;
  const centre = from.offsetLeft + from.offsetWidth / 2;
  /** Is `a` further along in the travel direction than `b`? */
  const beyond = (a: number, b: number): boolean => (a - b) * dir > 0;
  let bestLine: number | null = null;
  let best = -1;
  let bestDx = Infinity;
  for (let i = 0; i < chips.length; i++) {
    const top = chips[i].offsetTop;
    // Only lines strictly past the current one, and only the FIRST such line.
    if (!beyond(top, line)) continue;
    if (bestLine !== null && beyond(top, bestLine)) continue;
    const dx = Math.abs(chips[i].offsetLeft + chips[i].offsetWidth / 2 - centre);
    if (bestLine !== null && top === bestLine && dx >= bestDx) continue;
    bestLine = top;
    bestDx = dx;
    best = i;
  }
  return best;
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

/** Fold or unfold EVERY folder. A 1,400-note vault's tree is a place a reader
 *  navigates, and after twenty minutes of browsing it is a place they have to
 *  dig themselves out of one chevron at a time — the single most-asked-for
 *  small thing Obsidian has and this tree did not. Writes the whole map, then
 *  asks the tree to re-seed (the rows keep their open state locally for cheap
 *  toggles, so a bulk write has to be followed by a remount — `treeEpoch` in
 *  the component below is that ask). */
function setAllFolders(tree: TreeNode | null, open: boolean): void {
  const walk = (node: TreeNode): void => {
    for (const child of node.children ?? []) {
      if (child.type === "folder") {
        expandedMap.set(child.path, open);
        walk(child);
      }
    }
  };
  if (tree) walk(tree);
  persistExpanded();
}

/** Open every ancestor of `path`, so a reveal can scroll to a row that is
 *  actually on screen. */
function expandAncestors(path: string): void {
  const parts = path.split("/");
  let at = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    at = at === "" ? parts[i] : `${at}/${parts[i]}`;
    expandedMap.set(at, true);
  }
  persistExpanded();
}

/** The two window events other surfaces drive the tree with. Events rather
 *  than store actions because the tree's expansion has never lived in the
 *  store — it is this module's own map — and the palette and the tab menu
 *  should not need a second copy of that fact. */
export const TREE_ALL_EVENT = "vellum:tree-all";
export const TREE_REVEAL_EVENT = "vellum:tree-reveal";

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
    // The KEY stays canonical (it is a localStorage persistence key and must
    // survive a label being renamed); only the LABEL is localised.
    .map(([tag, list]) => ({ key: `#${tag}`, label: tagLabel(tag), notes: list }));
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

function IconCollapseAll() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 10l5-5 5 5" />
      <path d="M7 19l5-5 5 5" />
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
  const admin = useStore((s) => s.admin);
  const homeNote = useStore((s) => s.homeNote);
  const siteName = useStore((s) => s.siteName);
  // Re-renders the chrome strings on a live language change; also threaded
  // into the memoized rows below so their tooltips follow.
  const lang = useStore((s) => s.language);
  const logo = useStore((s) => s.logo);
  // The logo is an admin-typed image reference, so it climbs the same
  // resolution ladder a note's `banner:` does (client/banner.ts): a bare
  // "mark.svg" finds brand/mark.svg. Unresolvable falls back to the wordmark
  // — the identity the sidebar has always had — never to a broken <img>.
  const logoSrc = useBannerSrc(logo).src;
  const publishedFilter = useStore((s) => s.publishedFilter);
  const publishedPaths = useStore((s) => s.publishedPaths);

  const [query, setQuery] = useState("");
  /** Replace mode (admin only). It takes over the results region rather than
   *  stacking under it — a dry run squeezed between a tree and a tag cloud is
   *  a dry run nobody reads, and reading it is the whole feature. */
  const [replacing, setReplacing] = useState(false);
  /** The operator card. Open one at a time with replace mode: both hang off
   *  the same field, and two popovers over one input is a shell arguing with
   *  itself. */
  const [helpOpen, setHelpOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  /** Hit rows expanded to their per-line matches (chevron). Query-scoped:
   *  both reset with the results they annotate. */
  const [expandedHits, setExpandedHits] = useState<Set<string>>(() => new Set());
  /** Match lines per expanded path — "loading" while the fetch is out,
   *  "error" is rendered as the honest empty state rather than a toast (the
   *  whole-note click beside it still works). */
  const [hitMatches, setHitMatches] = useState<Map<string, SearchMatch[] | "loading" | "error">>(
    () => new Map(),
  );
  /** What the matches on screen were fetched FOR — a late response for an
   *  abandoned query must die here, not repopulate the new query's rows. */
  const matchQueryRef = useRef("");
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagsCollapsed, setTagsCollapsed] = useState(loadTagsCollapsed);
  /** Which tag pill currently carries the shelf's single tab stop. Null until
   *  the reader moves it; the derivation below is what decides where Tab
   *  lands before that, and it re-decides whenever the tag list changes under
   *  it (an SSE reindex can drop the tag the cursor was parked on). */
  const [tagCursor, setTagCursor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [tagMenu, setTagMenu] = useState<TagMenuState | null>(null);
  /** The open folder-icon popover (feature A). Null = closed. */
  const [iconPick, setIconPick] = useState<IconPickState | null>(null);
  const [showAttachments, setShowAttachments] = useState(loadShowAttachments);
  // The open lightbox: the viewable attachments of ONE folder plus the
  // position inside it, so ← / → walk that folder and nothing else.
  const [viewer, setViewer] = useState<{ items: TreeNode[]; index: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // The tree's own scroller — the auto-scroll target during a drag, and the
  // element that wears the vault-root drop ring. NOT the same element as
  // `treeRef` below: that one is the inner `role="tree"` div, which is the
  // single tab stop and carries aria-activedescendant. The scroller is the
  // <nav> around it, because scrolling and dropping are the outer element's
  // job and focus is the inner one's.
  const treeScrollRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // The vault ROOT is the one folder with no row of its own, and "put this back
  // at the top level" has to be a gesture. Two surfaces stand in for it, both
  // wired here so they cannot drift apart:
  //   - the tree's own empty space under the last row, which is the obvious
  //     place to reach for — and is exactly what a 1,375-note vault does not
  //     have, since the rows fill the pane;
  //   - the sidebar HEADER, which carries the vault's name, is on screen at
  //     every scroll position, and never moves. That one is the answer for a
  //     full tree.
  // A sticky "vault root" row inside the tree was the other candidate and was
  // rejected: appearing at dragstart it pushes every row down 26px under a
  // pointer that has already picked something up.
  // Dropping OS files anywhere on the tree attaches them to the vault: onto a
  // folder row for that folder, onto the tree's own ground for the root. The
  // attachment-location setting has the last word on where they actually land
  // (the toast names it), and every type /api/upload accepts is welcome —
  // anything else is refused before a byte goes on the wire.
  const onDropFiles = useCallback((dir: string, files: File[]) => {
    if (!useStore.getState().admin) return;
    void uploadDroppedFiles(files, dir);
  }, []);

  //
  // ONE set of handlers for BOTH drags that can land on the vault root: an
  // in-app move (a tree path, `draggedItem()` set) and files from the desktop.
  // They compose here rather than as two spreads on the same element, because
  // two objects each carrying `onDragOver` would silently mean "the second
  // one" — the first would be dropped by the spread and its affordance would
  // simply stop appearing. Which drag is in flight is decided once, at the
  // top of each handler, and the two never overlap.
  const rootDropProps = useCallback((ref: { current: HTMLElement | null }, cls: string) => ({
    onDragEnter: (e: ReactDragEvent) => {
      if (!admin || draggedItem() || !dragHasFiles(e.dataTransfer)) return;
      setRootDrag(dragFileCount(e.dataTransfer));
    },
    onDragOver: (e: ReactDragEvent) => {
      const item = draggedItem();
      if (!item) {
        if (!admin || !dragHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        return;
      }
      const ok = canDrop(item, "");
      // preventDefault is what allows the drop; withholding it is the refusal.
      if (ok) e.preventDefault();
      e.dataTransfer.dropEffect = ok ? "move" : "none";
      ref.current?.classList.toggle(cls, ok);
    },
    onDragLeave: (e: ReactDragEvent) => {
      if (!draggedItem() && dragHasFiles(e.dataTransfer)) {
        if (e.currentTarget === e.target) setRootDrag(0);
        return;
      }
      if (ref.current?.contains(e.relatedTarget as Node | null)) return;
      ref.current?.classList.remove(cls);
    },
    onDrop: (e: ReactDragEvent) => {
      e.preventDefault();
      ref.current?.classList.remove(cls);
      const item = draggedItem();
      endDrag();
      if (!item) {
        setRootDrag(0);
        // "" is the vault root as CONTEXT — the attachment-location setting
        // still has the last word on where the files actually land.
        if (admin && dragHasFiles(e.dataTransfer)) onDropFiles("", droppedFiles(e.dataTransfer));
        return;
      }
      if (canDrop(item, "")) void moveTo(item, "");
    },
  }), [admin, onDropFiles]);
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

  /** Chevron: fold or unfold one hit's match lines, fetching them once per
   *  query. The list can be empty for a real hit — fuzzy/title/alias matches
   *  have no line that SAYS the words — and the row states that instead of
   *  pretending (see searchMatches in server/indexer.ts). */
  const toggleHitMatches = useCallback((path: string) => {
    setExpandedHits((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    const q = matchQueryRef.current;
    if (!q) return;
    setHitMatches((prev) => {
      if (prev.has(path)) return prev; // fetched (or in flight) for this query
      searchMatches(path, q)
        .then((list) => {
          if (matchQueryRef.current !== q) return; // the reader typed on
          setHitMatches((cur) => new Map(cur).set(path, list));
        })
        .catch((err: unknown) => {
          console.error("vellum: loading search matches failed", err);
          if (matchQueryRef.current !== q) return;
          setHitMatches((cur) => new Map(cur).set(path, "error"));
        });
      return new Map(prev).set(path, "loading");
    });
  }, []);

  // Hover previews over the hit rows — the blog shell's engine with the admin
  // wiring (client/landing.ts). Installed on the results region, which mounts
  // and unmounts with the query; re-installed on a language flip because a
  // rendered card carries t() chrome.
  const hasResults = hits !== null;
  useEffect(() => {
    if (!hasResults) return;
    let dispose: (() => void) | null = null;
    let dead = false;
    void import("../landing.ts").then((m) => {
      if (dead || !resultsRef.current) return;
      dispose = m.installNotePreviews(resultsRef.current, resultsRef.current);
    });
    return () => {
      dead = true;
      dispose?.();
    };
  }, [hasResults, lang]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    // Expansions and their fetched lines belong to the query that earned
    // them; a new query starts folded.
    matchQueryRef.current = q;
    setExpandedHits(new Set());
    setHitMatches(new Map());
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
  // is publish-scoped for visitors). It comes from the shared cache, which is
  // what keeps SSE freshness without refetching the whole vault graph once
  // per changed file (client/graphCache.ts).
  const visitorGraph = useVaultGraph(!admin);
  const noteTags = useMemo<Map<string, string[]> | null>(
    () =>
      visitorGraph
        ? new Map(visitorGraph.nodes.map((n) => [n.id, n.tags] as [string, string[]]))
        : null,
    [visitorGraph],
  );

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

  // Pick (or clear) a folder's glyph. The map is REPLACED whole, which is what
  // makes "no icon" possible at all — a merging PATCH could add a key but
  // never remove one, so the cleared folder's mark would come back on the next
  // read. The store is updated from the server's own answer rather than
  // optimistically: this is one small PATCH on an explicit click, and a row
  // that shows a glyph the disk does not have is the worse failure.
  const chooseFolderIcon = useCallback((path: string, icon: FolderIcon | null) => {
    setIconPick(null);
    const next: Record<string, FolderIcon> = { ...useStore.getState().folderIcons };
    if (icon === null) delete next[path];
    else next[path] = icon;
    void (async () => {
      try {
        const saved = await patchSettings({ folderIcons: next });
        useStore.getState().setFolderIcons(saved.effective.folderIcons);
      } catch {
        toast(t("folderIconFailed"), "error");
      }
    })();
  }, []);

  const commitRename = useCallback((node: TreeNode, rawName: string) => {
    setRenaming(null);
    const name = rawName.trim();
    if (!name || name === node.name || name.includes("/")) return;
    // ONE path for both kinds. `renameTo` dispatches a folder to
    // /api/folder/move and a note to /api/rename, which is the difference that
    // kept folders unrenameable — and both now get the collision message, the
    // remap-before-reload ordering and the undo toast that the drag has had all
    // along. `ensureMd` still puts the extension back on a note: a reader
    // typing a new title should not have to remember it.
    void renameTo(itemOf(node), node.type === "file" ? ensureMd(name) : name);
  }, []);

  const cancelRename = useCallback(() => setRenaming(null), []);

  // Every delete dialog in the product now lives in ONE module
  // (components/deleteFlow.ts) and every surface calls it. Two surfaces
  // building the same dialog is how the palette ended up saying
  // "irreversible" over an action this menu promised was recoverable — and
  // how the folder dialog could count markdown while the folder held four
  // images. The flow asks /api/delete-preview first: the counts and the
  // "…still embedded by ‘essay’" line come from the server's own walk of the
  // files the delete will actually move, not from this component's tree.

  // How many desktop files are hovering the tree's own ground (the vault
  // root). Separate from the rows' own count so a row's highlight never leaves
  // the whole pane lit; `rootDropProps` above sets it.
  const [rootDrag, setRootDrag] = useState(0);

  // The context menu opens at the pointer, but the pointer can be anywhere —
  // and with the sidebar on the trailing edge (RTL by default, or a reader who
  // moved it there) a menu that grows toward the trailing edge runs straight
  // off the screen, taking its last item with it. So it opens toward the
  // reading direction, folds back when that edge has no room, and is clamped
  // into the viewport on both axes. Measured after mount, because the menu's
  // size is its content's.
  const menuRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (menu) placeMenu(menuRef.current, menu.x, menu.y, menu.fromKeyboard === true);
  }, [menu]);

  // The tag shelf's menu, placed by the same rule — one function, so a menu on
  // an RTL instance cannot open toward the screen edge in one place and away
  // from it in the other.
  const tagMenuRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (tagMenu) placeMenu(tagMenuRef.current, tagMenu.x, tagMenu.y, tagMenu.fromKeyboard === true);
  }, [tagMenu]);

  // …and dismissed by the same rule. Focus goes back to the pill it was opened
  // from, for the reason the tree's does: Escape must not drop a keyboard
  // reader on <body>.
  useEffect(() => {
    if (!tagMenu) return;
    const close = (): void => {
      if (tagMenu.fromKeyboard) {
        document
          .querySelector<HTMLElement>(`.s-tag[data-tag="${CSS.escape(tagMenu.tag)}"]`)
          ?.focus();
      }
      setTagMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [tagMenu]);

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
  // Bumped when the expansion map is rewritten WHOLESALE (collapse all,
  // expand all, reveal): rows keep their open state locally for cheap
  // per-chevron toggles, so a bulk write is followed by a keyed remount and
  // every row re-seeds from the map.
  const [treeEpoch, setTreeEpoch] = useState(0);
  useEffect(() => {
    const onAll = (e: Event): void => {
      const open = (e as CustomEvent<{ open: boolean }>).detail?.open === true;
      setAllFolders(useStore.getState().tree, open);
      setTreeEpoch((n) => n + 1);
    };
    const onReveal = (e: Event): void => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (typeof path !== "string" || path === "") return;
      expandAncestors(path);
      setTreeEpoch((n) => n + 1);
      setCursor(path);
      // After the remount has painted the now-visible row.
      requestAnimationFrame(() => {
        treeScrollRef.current
          ?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)
          ?.scrollIntoView({ block: "center" });
      });
    };
    window.addEventListener(TREE_ALL_EVENT, onAll);
    window.addEventListener(TREE_REVEAL_EVENT, onReveal);
    return () => {
      window.removeEventListener(TREE_ALL_EVENT, onAll);
      window.removeEventListener(TREE_REVEAL_EVENT, onReveal);
    };
  }, []);
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
          // The SAME flow the context menu runs (components/deleteFlow.ts):
          // the keyboard route must not be the one that skips the preview and
          // its "…still embedded by ‘essay’" warning.
          if (node.type === "folder") void confirmDeleteFolder(node.path);
          else if (node.attachment) void confirmDeleteAttachment(node.path);
          else void confirmDeleteNote(node.path);
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

  // ── The tag shelf, capped ────────────────────────────────────────────────
  /** THE SHELF SHOWS A DOZEN AND OFFERS THE REST (v1.8 audit, F17: twenty-three
   *  tags ate a quarter of the pane before the tree got a row).
   *
   *  `max-height: 24vh` with its own scroll (app.css) was the cap, and a cap
   *  that is a quarter of the window is still a quarter of the window: the
   *  pills arrive sorted by count, so what a reader loses is the BOTTOM of
   *  their own tree to the TAIL of a list they have mostly never clicked. The
   *  tree's own "Show N more" (attachments.css) is the idiom already in this
   *  pane, and it is the honest one — the count is on the button, so nothing
   *  is silently truncated. The scroll cap stays for the expanded case.
   *
   *  One pill is never worth a row that says "one more", so the cap only
   *  applies once there are at least two to hide. */
  const [allTags, setAllTags] = useState(false);
  const shownTags = useMemo(() => {
    if (allTags || tags.length <= TAG_SHELF_CAP + 1) return tags;
    const head = tags.slice(0, TAG_SHELF_CAP);
    // The tag DOING the filtering is on the shelf wherever it sorts: a filter
    // whose own pill is hidden is a filter with no way to clear it.
    const filtering = query.trim().startsWith("#") ? query.trim().slice(1) : null;
    if (filtering !== null && !head.some((e) => e.tag === filtering)) {
      const pinned = tags.find((e) => e.tag === filtering);
      if (pinned) return [...head.slice(0, TAG_SHELF_CAP - 1), pinned];
    }
    return head;
  }, [tags, allTags, query]);

  // ── The tag shelf's single tab stop ──────────────────────────────────────
  /** Where Tab enters the shelf: the reader's own cursor while it still names
   *  a tag, else the tag currently filtering the search (so Tab lands on the
   *  filter you are looking at), else the first pill. */
  const tagStop = useMemo(() => {
    // Over the SHOWN pills, not every tag: a stop on a pill that is not on the
    // shelf leaves the shelf with no tabIndex 0 in it at all, i.e. unreachable.
    const has = (tag: string | null): boolean =>
      tag !== null && shownTags.some((entry) => entry.tag === tag);
    if (has(tagCursor)) return tagCursor;
    const filtering = query.trim().startsWith("#") ? query.trim().slice(1) : null;
    if (has(filtering)) return filtering;
    return shownTags[0]?.tag ?? null;
  }, [tagCursor, query, shownTags]);

  /**
   * ARROWS WALK THE PILLS. The shelf is a WRAPPED grid, so both axes have to
   * mean something: Left/Right step one pill in READING order (logical, so
   * they swap under RTL — the same rule the tree's Left/Right keep), and
   * Up/Down step a visual ROW, landing on the pill nearest the one you left in
   * the inline direction. Home/End go to the ends of the shelf. Geometry comes
   * out of the DOM rather than the model because only the DOM knows where the
   * lines broke.
   */
  const onTagsKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const rtl = document.documentElement.getAttribute("dir") === "rtl";
    const pills = [...e.currentTarget.querySelectorAll<HTMLElement>(".s-tag")];
    const at = pills.findIndex((pill) => pill === document.activeElement);
    if (at < 0) return;
    let to = -1;
    if (e.key === "Home") to = 0;
    else if (e.key === "End") to = pills.length - 1;
    else if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) to = at + 1;
    else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) to = at - 1;
    else if (e.key === "ArrowDown") to = rowStep(pills, at, 1);
    else if (e.key === "ArrowUp") to = rowStep(pills, at, -1);
    else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      // The keyboard's right-click, on the pill the roving stop is parked on.
      // "Rename tag…" is admin-only and mouse-only without it, and the reader
      // who cannot drag a tree row is the same reader who cannot right-click.
      if (!useStore.getState().admin) return;
      e.preventDefault();
      const box = pills[at].getBoundingClientRect();
      setTagMenu({
        x: Math.round(box.left + 12),
        y: Math.round(box.bottom),
        tag: pills[at].dataset.tag ?? "",
        fromKeyboard: true,
      });
      return;
    } else return;
    if (to < 0 || to >= pills.length) return;
    e.preventDefault();
    const next = pills[to];
    setTagCursor(next.dataset.tag ?? null);
    next.focus();
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

  /** A click on an attachment row. A PDF is a BOOK: it opens in the reader
   *  (client/books/), which remembers the page, gives it zathura's keys and
   *  puts it on a shelf with the vault's other books. It used to open a
   *  browser tab, which renders a PDF perfectly well and cannot do any of
   *  those three things. Everything else opens in the viewer, carrying its
   *  folder with it so the arrow keys have somewhere to go. */
  const openAttachment = useCallback((node: TreeNode, siblings: TreeNode[]) => {
    if (node.attachment?.kind === "pdf") {
      openBookPath(node.path);
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
  // "The labels moved" — a settings save, a tag page edited, a session change.
  // A version number rather than the map: see client/tagLabels.ts.
  const tagLabelsVersion = useTagLabels();
  const topics = useMemo(() => {
    if (admin || !flatNotes || noteTags === null) return null;
    return buildTopics(flatNotes.notes, flatNotes.home, noteTags);
    // `lang` and the label version are dependencies because buildTopics bakes
    // the DISPLAY label into each section — a topic renamed in Settings must
    // repaint without a reload.
  }, [admin, flatNotes, noteTags, lang, tagLabelsVersion]);

  return (
    // Named by what it holds ("Notes sidebar"), never by the edge it is on:
    // that edge is right in Arabic and left in English.
    <aside
      className="s-sidebar"
      aria-label={t("paneNotes")}
      // A file dragged in from the desktop and dropped ANYWHERE in this pane
      // that is not a folder row must do nothing — the browser's default is to
      // navigate away to the image, which throws the reader's whole session
      // out for missing a 26px row by a few pixels. Folder rows stop `dragover`
      // from reaching here and set their own "copy"; everything else answers
      // "none", which both paints the refusal and suppresses the navigation.
      onDragOver={(e) => {
        if (draggedItem() || !dragHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "none";
      }}
    >
      {/* The header doubles as the vault-root drop target — see rootDropProps.
          It is the only part of the sidebar that names the vault and is on
          screen at every scroll position. */}
      <header
        className="s-sidebar-header"
        ref={headerRef}
        {...(admin ? rootDropProps(headerRef, "s-sidebar-header--dropok") : {})}
      >
        {admin ? (
          // The wordmark doubles as the preview toggle: one click shows the
          // site exactly as a visitor gets it (same path as the status-bar eye).
          <button
            type="button"
            className="s-title"
            title={t("viewPublicSite")}
            onClick={() => void useStore.getState().setPreviewVisitor(true)}
          >
            {logoSrc ? (
              <img className="s-title__logo" src={logoSrc} alt={siteName} />
            ) : (
              <>
                <span className="s-title__star" aria-hidden="true">✦</span>
                {siteName}
              </>
            )}
          </button>
        ) : (
          <h1 className="s-title">
            {logoSrc ? (
              <img className="s-title__logo" src={logoSrc} alt={siteName} />
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
              title={t("collapseAll")}
              aria-label={t("collapseAll")}
              onClick={() =>
                window.dispatchEvent(new CustomEvent(TREE_ALL_EVENT, { detail: { open: false } }))
              }
            >
              <IconCollapseAll />
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
        {/* The card is positioned against THIS box, so it hangs from the field
            it explains rather than from the pane. */}
        {helpOpen && (
          <Suspense fallback={null}>
            <SearchHelp onClose={() => setHelpOpen(false)} />
          </Suspense>
        )}
      </div>

      {/* Two doors under the box (v1.8): a grammar nobody can guess, and the
          rewrite nobody trusts. Both are quiet icon buttons — the search box
          is unchanged for a reader who wants none of it. */}
      <div className="s-searchbar">
        <button
          type="button"
          className={`s-iconbtn${helpOpen ? " s-searchbar__on" : ""}`}
          aria-expanded={helpOpen}
          title={t("searchHelpOpen")}
          aria-label={t("searchHelpOpen")}
          onClick={() => {
            setHelpOpen((v) => !v);
            setReplacing(false);
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.6 9.2a2.5 2.5 0 1 1 3 2.4v1.4" />
            <path d="M12.6 16.6h-.01" />
          </svg>
        </button>
        {admin && (
          <button
            type="button"
            className={`s-iconbtn${replacing ? " s-searchbar__on" : ""}`}
            aria-expanded={replacing}
            title={replacing ? t("replaceClose") : t("replaceOpen")}
            aria-label={replacing ? t("replaceClose") : t("replaceOpen")}
            onClick={() => {
              setReplacing((v) => !v);
              setHelpOpen(false);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h11l-3-3M20 17H9l3 3" />
            </svg>
          </button>
        )}
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

      {admin && replacing ? (
        <Suspense fallback={null}>
          <ReplacePanel query={query} onClose={() => setReplacing(false)} />
        </Suspense>
      ) : hits !== null ? (
        // A results list that swaps in silently is a list a screen-reader user
        // never learns about — the count is announced politely as it lands.
        <div className="s-search__results" role="region" aria-label={t("searchResultsAria")} ref={resultsRef}>
          <p className="s-sr-only" role="status">
            {hits.length === 0 ? t("noResultsAria") : tf("resultCount", { count: localeNum(hits.length) })}
          </p>
          {hits.length === 0 && <p className="s-search__none">{t("noMatchesDot")}</p>}
          {hits.map((hit) => (
            <div key={hit.path} className="s-search-row" data-preview-path={hit.path}>
            <button
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
              {/* WHY this row is here, when the title does not say so. An
                  alias is often a word the note's own text never contains, so
                  without this line the hit looks like a search bug — and when
                  two notes claim one alias, this is where the reader can see
                  which one answered. */}
              {hit.alias !== undefined && (
                <span className="s-search-hit__why" dir="auto">
                  {tf("searchMatchedAlias", { alias: hit.alias })}
                </span>
              )}
              {!snippetIsEmpty(hit.snippet) && (
                <span className="s-search-hit__snippet" dir="auto">
                  {renderSnippet(hit.snippet)}
                </span>
              )}
            </button>
            {/* The chevron is the hit's SIBLING, not its child — a button may
                not contain a button, and the row click keeps meaning "open the
                note" exactly as before. */}
            <button
              type="button"
              className="s-search-expand s-iconbtn"
              onClick={() => toggleHitMatches(hit.path)}
              aria-expanded={expandedHits.has(hit.path)}
              aria-label={tf(expandedHits.has(hit.path) ? "searchHitMatchesHide" : "searchHitMatches", { label: hit.title })}
              title={tf(expandedHits.has(hit.path) ? "searchHitMatchesHide" : "searchHitMatches", { label: hit.title })}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            {expandedHits.has(hit.path) && (() => {
              const state = hitMatches.get(hit.path);
              if (state === undefined || state === "loading") return null;
              if (state === "error" || state.length === 0) {
                // An honest empty state: the NOTE matched (fuzzy spelling, its
                // title, an alias) even though no line contains the words —
                // and a fetch error earns the same quiet row, because the
                // whole-note click above it still works either way.
                return <p className="s-search-matches__none">{t("noMatchesDot")}</p>;
              }
              return (
                <div className="s-search-matches">
                  {state.map((m) => (
                    <button
                      key={m.line}
                      type="button"
                      className="s-search-match"
                      onClick={() =>
                        void import("../landing.ts").then((mod) => mod.landOnLine(hit.path, m.line))
                      }
                    >
                      <span className="s-search-match__line" aria-hidden="true">
                        {localeNum(m.line)}
                      </span>
                      <span className="s-search-match__text" dir="auto">
                        {renderSnippet(m.text)}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })()}
            </div>
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
          // The dropping class and its title come from the desktop-drop work;
          // everything else on this element is the in-app move machinery. They
          // decorate the same <nav> but never at the same moment — one drag
          // carries OS files, the other carries a tree path.
          className={`s-tree${rootDrag > 0 ? " s-tree--dropping" : ""}`}
          title={rootDrag > 0 ? t("dropFilesTitle") : undefined}
          ref={treeScrollRef}
          onContextMenu={(e) => {
            if (tree && e.target === e.currentTarget) openMenu(e, tree);
          }}
          // CAPTURE phase, deliberately: the rows stop dragover from bubbling
          // (so a row inside a folder never lights the root up), and auto-scroll
          // has to run while the pointer is over ROWS — which is all of the
          // time. This is the only handler that sees every dragover.
          onDragOverCapture={(e) => {
            if (draggedItem() && treeScrollRef.current) {
              autoScroll(treeScrollRef.current, e.clientY);
            }
          }}
          // The other vault-root surface: the tree's own empty space below the
          // last row (rows stop dragover from bubbling, so anything arriving
          // here came from the container itself).
          {...rootDropProps(treeScrollRef, "s-tree--droproot")}
          // …plus the one thing the shared handler cannot know: a pointer that
          // has left the tree entirely must stop the auto-scroll it started.
          onDragLeave={(e) => {
            if (treeScrollRef.current?.contains(e.relatedTarget as Node | null)) return;
            treeScrollRef.current?.classList.remove("s-tree--droproot");
            stopAutoScroll();
          }}
        >
          {/* One tab stop for the whole vault. `aria-activedescendant` names
              the row the reader is on (see the tree keyboard model above); the
              roles make it a tree to a screen reader instead of a pile of
              unlabelled divs, which is what it was. A 1,388-row vault that
              spends 1,388 tab stops before the note is a tree nobody tabs
              past twice. */}
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
            {/* TreeChildren, not a bare map: it is what knows about
                attachments, the "show more" row that keeps a 1,158-file folder
                from janking, and the folders-first ordering. It threads
                index/setSize down to each row for aria-posinset/setsize. */}
            <TreeChildren
              key={treeEpoch}
              nodes={tree?.children ?? []}
              depth={0}
              renaming={renaming}
              lang={lang}
              admin={admin}
              showAttachments={showAttachments}
              onOpen={openNote}
              onStartRename={startRename}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
              onMenu={openMenu}
              onAttachment={openAttachment}
              onShowAttachments={showAllAttachments}
              onDropFiles={onDropFiles}
            />
          </div>
          {/* A VAULT WITH NOTHING IN IT IS THE FIRST SCREEN SOMEBODY SEES, and
              it was 292 pixels of nothing (v1.8 UX audit F41). The two doors
              are the two answers: write something, or take the guide the
              server stopped writing into people's own directories unasked
              (server/seed.ts — this is the offer that replaced it). */}
          {tree !== null && (tree.children?.length ?? 0) === 0 && <TreeEmpty />}
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
          /* ONE TAB STOP FOR THE WHOLE TAG SHELF, for the reason the tree
             beside it is one: on the 1,388-note fixture this list is 113
             pills, and 113 plain buttons made the sidebar 120 tab stops —
             measured, the first control PAST the pane arrived at stop #121,
             and arrives at #10 now. Same argument, same pane; the tree took
             it and this list had not. A single-select listbox is
             what it already behaves like (one tag filters, clicking it again
             clears), so the roles say so and `aria-selected` carries the state
             the gold pill was carrying alone. Roving tabindex rather than
             `aria-activedescendant`: these are real buttons, there are a
             hundred of them and not a thousand, and moving the stop is one
             attribute on two nodes. */
          <div
            className="s-tags__list"
            role="listbox"
            aria-label={t("tags")}
            onKeyDown={onTagsKeyDown}
          >
            {shownTags.map(({ tag, count }) => {
              const active = query.trim() === `#${tag}`;
              return (
              <button
                key={tag}
                type="button"
                role="option"
                data-tag={tag}
                aria-selected={active}
                tabIndex={tag === tagStop ? 0 : -1}
                className={active ? "s-tag s-tag--active" : "s-tag"}
                onClick={() => {
                  // The stop follows the pointer too, so the arrows continue
                  // from where the reader last clicked (the tree does the
                  // same on mousedown, for the same reason).
                  setTagCursor(tag);
                  setQuery(active ? "" : `#${tag}`);
                }}
                title={tf(active ? "clearTagFilter" : "searchTag", { tag })}
                /* A TAG IS A THING YOU CAN RENAME. It was the one object in
                   this sidebar with no verbs on it at all — Obsidian's sixth
                   most-requested feature, eight years old — and right-clicking
                   the pill is where every reader already looks for it. */
                onContextMenu={(e) => {
                  if (!useStore.getState().admin) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setTagCursor(tag);
                  setTagMenu({ x: e.clientX, y: e.clientY, tag });
                }}
              >
                {/* The hash belongs TO the tag name, so the two share one
                    bidi isolate: without it the RTL shell drew a Latin tag as
                    "baby #", the hash flush against the pill's right edge.
                    The count stays outside the isolate — it is chrome, and
                    keeps the pill's own inline order. Same rendering as the
                    blog's .s-blog-chip. */}
                <bdi className="s-tag__name">
                  <span className="s-tag__hash" aria-hidden="true">#</span>
                  {tagLabel(tag)}
                </bdi>
                <span className="s-tag__count">{localeNum(count)}</span>
              </button>
              );
            })}
          </div>
          )}
          {/* OUTSIDE the listbox: a control that is not one of the options may
              not sit among them. It is one extra tab stop and it earns it —
              the shelf's whole tail lives behind it. */}
          {!tagsCollapsed && shownTags.length < tags.length && (
            <button
              type="button"
              className="s-tags__more"
              onClick={() => setAllTags(true)}
            >
              {tf("showMoreRows", { count: localeNum(tags.length - shownTags.length) })}
            </button>
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
                  void promptNewNote(menu.node.path);
                }}
              >
                {t("newNoteHere")}
              </button>
              {/* The third door into templates, and the one that carries a
                  DESTINATION: the palette and the keystroke create wherever
                  the reader last was, while this one creates in the folder
                  under the pointer — which is the whole reason someone
                  right-clicked a folder. */}
              <button
                type="button"
                className="s-menu__item"
                onClick={() => {
                  const dir = menu.node.path;
                  setMenu(null);
                  void newNoteFromTemplateCommand(dir);
                }}
              >
                {t("cmdNewFromTemplate")}
              </button>
              <button
                type="button"
                className="s-menu__item"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void promptNewFolder(menu.node.path);
                }}
              >
                {t("newFolder")}
              </button>
            </>
          )}
          {/* Notes AND FOLDERS, never an attachment, never the vault root.
              This row was notes-only because it called the note rename route,
              which answers "Not a markdown path" to a folder — while
              /api/folder/move, which has always been able to do it and rewrites
              every wikilink across the subtree, sat one menu row below under
              "Move to…". Renaming a folder cost three operations, one of them
              semi-destructive. Attachments stay out: their move endpoints are
              note routes. */}
          {menu.node.path !== "" && !menu.node.attachment && (
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
          {/* A folder's own property, edited at the folder — beside Rename,
              which is the other verb that belongs to this row rather than to
              the instance. Never the vault ROOT: its key would be the empty
              path, which is not a folder anything can be keyed by. Notes and
              attachments never get one (DESIGN.md's no-icon-clutter rule for
              files stands; only folders were exempted). */}
          {menu.node.type === "folder" && menu.node.path !== "" && (
            <button
              type="button"
              className="s-menu__item"
              role="menuitem"
              onClick={() => {
                const node = menu.node;
                const fromKeyboard = menu.fromKeyboard === true;
                setMenu(null);
                setIconPick({
                  path: node.path,
                  name: node.name,
                  current: useStore.getState().folderIcons[node.path] ?? null,
                  x: menu.x,
                  y: menu.y,
                  fromKeyboard,
                });
              }}
            >
              {t("folderIcon")}
            </button>
          )}
          {/* The keyboard and touch route to the same operation the drag
              performs. It is not a convenience: HTML5 drag does not exist on a
              touch screen and cannot be reached from the keyboard at all, so
              without this row the tree's ONLY way to move a note is mouse-only.
              Offered on notes and folders alike — never on an attachment (the
              move endpoints are note routes) and never on the vault root. */}
          {menu.node.path !== "" && !menu.node.attachment && (
            <button
              type="button"
              className="s-menu__item"
              onClick={() => {
                const node = menu.node;
                setMenu(null);
                void moveViaPicker(itemOf(node));
              }}
            >
              {t("moveTo")}
            </button>
          )}
          {menu.node.type === "file" && !menu.node.attachment && (
            <button
              type="button"
              className="s-menu__item s-menu__item--danger"
                role="menuitem"
              onClick={() => {
                setMenu(null);
                void confirmDeleteNote(menu.node.path);
              }}
            >
              {t("delete")}
            </button>
          )}
          {/* ATTACHMENTS only. The tree has listed a vault's images, PDFs and
              recordings since attachments landed and offered no verb on a
              single one of them — so the only way to remove a stale upload was
              to delete the folder around it, which is exactly the gesture that
              took a published essay's four images with it. Its own route
              (DELETE /api/attachment), its own dialog, and a warning naming
              the notes that embed it. */}
          {menu.node.type === "file" && menu.node.attachment && (
            <button
              type="button"
              className="s-menu__item s-menu__item--danger"
              onClick={() => {
                setMenu(null);
                void confirmDeleteAttachment(menu.node.path);
              }}
            >
              {t("deleteAttachment")}
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
                role="menuitem"
              onClick={() => {
                setMenu(null);
                void confirmDeleteFolder(menu.node.path);
              }}
            >
              {t("deleteFolder")}
            </button>
          )}
        </div>
      )}

      {/* The tag shelf's menu. One verb today, and it is the verb the forum has
          been asking for since 2018: rename (and, onto a name that exists,
          merge). Same chrome and same placement as the tree's menu above; a
          separate element because a tag is not a tree node. */}
      {tagMenu && (
        <div
          ref={tagMenuRef}
          className="s-menu"
          role="menu"
          aria-label={t("tagActions")}
          style={{ left: tagMenu.x, top: tagMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key !== "Tab") return;
            setTagMenu(null);
          }}
        >
          <button
            type="button"
            className="s-menu__item"
            role="menuitem"
            onClick={() => {
              const tag = tagMenu.tag;
              const known = tags.map((entry) => entry.tag);
              setTagMenu(null);
              void promptTagRename(tag, known);
            }}
          >
            {t("renameTag")}
          </button>
        </div>
      )}

      {iconPick && (
        <Suspense fallback={null}>
          <FolderIconPicker
            state={iconPick}
            onPick={(icon) => chooseFolderIcon(iconPick.path, icon)}
            onClose={() => {
              // Same courtesy the context menu does: a popover a keyboard
              // reader opened must put them back on the tree, not on <body>.
              if (iconPick.fromKeyboard) treeRef.current?.focus();
              setIconPick(null);
            }}
          />
        </Suspense>
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

/** THE EMPTY VAULT'S INVITATION.
 *
 *  Three marks and two doors, the shape every other empty state in this
 *  product settled on (the designer's, the graph's): a glyph, one sentence
 *  saying what is true, and something to press. The guide door only appears
 *  when there IS a guide to copy and nothing of the reader's to copy it over —
 *  `GET /api/seed` answers both questions, and a button that would 409 is a
 *  button that should not be drawn.
 *
 *  Asked once, on mount. This component exists only while the vault is empty,
 *  which is a state a vault leaves exactly once. */
function TreeEmpty() {
  const [seed, setSeed] = useState<{ available: boolean; guide: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useStore((s) => s.language); // re-render the chrome strings on language change

  useEffect(() => {
    let disposed = false;
    seedStatus()
      .then((s) => {
        if (!disposed) setSeed(s);
      })
      .catch(() => {
        // A visitor gets a 404 here by design, and a visitor has no folders in
        // their sidebar to begin with: no door, no noise.
        if (!disposed) setSeed({ available: false, guide: "" });
      });
    return () => {
      disposed = true;
    };
  }, []);

  const takeSeed = (): void => {
    setBusy(true);
    seedVault()
      .then(async ({ guide }) => {
        await useStore.getState().loadTree();
        // Straight into the guide, and NO toast: thirteen rows appearing where
        // there were none and the guide opening in the pane is a louder
        // confirmation than a sentence, and a toast fired here would be swept
        // away by App.tsx's own navigation dismissal a frame later anyway.
        useStore.getState().openNote(guide);
      })
      .catch((err: unknown) => {
        console.error("vellum: seeding the vault failed", err);
        toast(t("seedFailed"), "error");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="s-tree__empty">
      <span className="s-tree__empty-star" aria-hidden="true">✦</span>
      <p className="s-tree__empty-body">{t("vaultEmptyBody")}</p>
      <div className="s-tree__empty-acts">
        <button
          type="button"
          className="s-btn s-btn--accent"
          disabled={busy}
          onClick={() => void promptNewNote("")}
        >
          {t("newNote")}
        </button>
        {seed?.available === true && (
          <button type="button" className="s-btn" disabled={busy} onClick={takeSeed}>
            {t("vaultEmptySeed")}
          </button>
        )}
      </div>
    </div>
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
  /** Whether this session may mutate the vault — what makes a row draggable
   *  and what makes it a drop target. A visitor's tree is a reading surface.
   *  Passed down rather than subscribed to per row: 1.4k store subscriptions
   *  to learn one boolean is not a price worth paying. */
  admin: boolean;
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
  /** Files dropped on this row from the desktop: attach them to `dir`. */
  onDropFiles(dir: string, files: File[]): void;
}

type TreeChildrenProps = Omit<TreeRowProps, "node" | "siblings" | "index" | "setSize"> & {
  nodes: TreeNode[];
};

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
      {/* posinset/setsize describe the rows a reader can actually reach, so
          they count `visible` — the filtered list — not `nodes`. A tree that
          announces "3 of 47" while showing three rows is worse than silence. */}
      {shown.map((child, i) => (
        <TreeRow
          key={child.path}
          {...rest}
          node={child}
          siblings={visible}
          index={i}
          setSize={visible.length}
        />
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
  // MEMO DISCIPLINE. The selector returns a STRING or undefined, never the map
  // — 1.4k rows subscribing to an object identity would each re-render on
  // every /api/me, and a selector that built `{ icon }` per call would
  // re-render on every store change of any kind. Read here rather than
  // threaded from Sidebar so an icon change repaints one row.
  const folderIcon = useStore((s) => (node.type === "folder" ? s.folderIcons[node.path] : undefined));
  const attachment = node.attachment;
  const [isOpen, setIsOpen] = useState(
    () => isFolder && (expandedMap.get(node.path) ?? defaultOpen(depth)),
  );
  // Attachments keep their extension — it is half of what the name says —
  // while a note sheds the ".md" it always has.
  const label = isFolder || attachment ? node.name : noteLabelOf(node.name);

  const open = (): void => {
    setIsOpen(true);
    expandedMap.set(node.path, true);
    persistExpanded();
  };

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    expandedMap.set(node.path, next);
    persistExpanded();
  };

  // ── Drag and drop ─────────────────────────────────────────────────────────
  // TWO drags land on this row and they are not the same gesture:
  //
  //   - an in-app drag carrying a tree path (move this note into that folder),
  //     recognised by `draggedItem()` being set;
  //   - an OS drag carrying files from the desktop (attach these here),
  //     recognised by `dragHasFiles`.
  //
  // Each has its own affordance vocabulary — --dropok/--dropbad for the move,
  // --dropping plus a file count for the attach — and the two can never be
  // live at once, because a drag is one or the other from the moment it
  // starts. The in-app drop state lives on the DOM node, not in React state: a
  // drag crosses hundreds of rows, and a `dropTarget` prop would bust memo()
  // on all 1.4k of them every time the pointer moved one row, twelve times a
  // second, to repaint one background. The FILE state is React state because
  // it carries a number the row has to print.
  const rowRef = useRef<HTMLDivElement>(null);
  const springRef = useRef(0);

  // The target folder for dropped files is this row when it IS a folder, and
  // the row's parent when it is a note — dropping onto a note means "beside
  // this note", which is the answer a reader expects and the one the
  // same-folder attachment mode would have given anyway.
  const dropDir = isFolder ? node.path : parentOf(node.path);
  // dragenter/dragleave fire for every child element the pointer crosses, so
  // the state is a DEPTH, not a boolean: a plain flag flickers off the moment
  // the pointer reaches the row's own label.
  const dragDepth = useRef(0);
  const [dropCount, setDropCount] = useState(0);

  const clearDropState = useCallback(() => {
    rowRef.current?.classList.remove("s-tree__item--dropok", "s-tree__item--dropbad");
    if (springRef.current !== 0) {
      window.clearTimeout(springRef.current);
      springRef.current = 0;
    }
  }, []);

  /** An OS file drag entering this row. Counted, not flagged — see dragDepth. */
  const onDragEnterFiles = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (!props.admin || draggedItem() || !dragHasFiles(e.dataTransfer)) return;
    e.stopPropagation();
    dragDepth.current++;
    setDropCount(dragFileCount(e.dataTransfer));
  };

  const clearFileDropState = (): void => {
    dragDepth.current = 0;
    setDropCount(0);
  };

  useEffect(() => clearDropState, [clearDropState]);

  const onDragStart = (e: ReactDragEvent<HTMLDivElement>): void => {
    const item = itemOf(node);
    // Two drags share this row, and they are DIFFERENT permissions. The tree
    // MOVE (drop on a folder) is the admin's and never an attachment's — the
    // move endpoints are note routes. The tab LIFT (drop on a pane) is for
    // anything a pane can host, books included, admin or reader: dropping a
    // note beside another to read them side by side mutates nothing.
    if (props.admin && !node.attachment) beginDrag(item);
    e.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag with an empty payload.
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.setDragImage(makeDragGhost(item), 14, 14);
    rowRef.current?.classList.add("s-tree__item--dragging");
    // A note or a book lifted off the tree is ALSO a tab drag (the owner:
    // "cannot simply grab a note/book from the filesystem and drop it on one
    // of my split windows"): the panes raise their drop zones, and dropping
    // opens the file there — beside the tree's own drops, which keep meaning
    // "move the file into that folder". `pane: null` is what tells the drop
    // there is no tab to remove anywhere.
    if (!item.isFolder && isTabbablePath(node.path)) {
      beginTabDrag({ pane: null, path: node.path });
    }
  };

  const onDragEnd = (): void => {
    rowRef.current?.classList.remove("s-tree__item--dragging");
    endDrag();
    endTabDrag();
  };

  const onDragOver = (e: ReactDragEvent<HTMLDivElement>): void => {
    const item = draggedItem();
    if (!item) {
      // Files dragged in from the DESKTOP. Without this branch the browser's
      // default takes over on drop and navigates the whole app away to the
      // file — the reader loses their vault to a gesture the tree invites.
      // EVERY row takes them, not only folders: a note row means "beside this
      // note", and refusing there sent the reader hunting for the folder row.
      if (!props.admin || !dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      return;
    }
    // Answered here, so it never reaches the tree's own root handler: a pointer
    // resting on a row inside a folder must not light the VAULT ROOT up.
    e.stopPropagation();
    if (!isFolder) {
      // A note is not a container. No colour (every file row flashing red on
      // the way past its folder would be noise), just the browser's own refusal.
      e.dataTransfer.dropEffect = "none";
      return;
    }
    // Spring-loading arms for ANY folder, including one this item cannot land
    // in: resting on the folder you are dragging out of is exactly how you
    // reach the sub-folder you are dragging into.
    if (!isOpen && springRef.current === 0) {
      springRef.current = window.setTimeout(() => {
        springRef.current = 0;
        open();
      }, SPRING_MS);
    }
    const ok = canDrop(item, node.path);
    // preventDefault is what ALLOWS the drop. Withholding it on a refused
    // target is what makes the cursor say no, and it is why an invalid drop
    // cannot fire at all rather than being caught later.
    if (ok) e.preventDefault();
    e.dataTransfer.dropEffect = ok ? "move" : "none";
    rowRef.current?.classList.toggle("s-tree__item--dropok", ok);
    rowRef.current?.classList.toggle("s-tree__item--dropbad", !ok);
  };

  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (!draggedItem() && dragHasFiles(e.dataTransfer)) {
      // The file drag counts down instead of testing containment: `dragDepth`
      // is exactly the mechanism that survives the pointer crossing onto the
      // row's own label, which is where a boolean flickers.
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDropCount(0);
      return;
    }
    // dragleave also fires when the pointer crosses onto a CHILD of the row
    // (the label span, the chevron). Cancelling the spring timer there would
    // make the folder never open.
    if (rowRef.current?.contains(e.relatedTarget as Node | null)) return;
    clearDropState();
  };

  const onDrop = (e: ReactDragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation(); // the tree's own ground must not also take it
    clearDropState();
    const item = draggedItem();
    endDrag();
    if (!item) {
      // Desktop files. Every accepted type, screened for size and kind before
      // a byte goes on the wire and sniffed for magic bytes at the far end.
      clearFileDropState();
      if (props.admin && dragHasFiles(e.dataTransfer)) {
        props.onDropFiles(dropDir, droppedFiles(e.dataTransfer));
      }
      return;
    }
    // Dropping onto a COLLAPSED folder works, and does not expand it: the
    // spring is an aid for reaching deeper, never a precondition.
    if (isFolder && canDrop(item, node.path)) void moveTo(item, node.path);
  };

  const classes = [
    "s-tree__item",
    isFolder ? "s-tree__item--folder" : "s-tree__item--file",
    attachment ? "s-tree__item--att" : "",
    isActive ? "s-tree__item--active" : "",
    dropCount > 0 ? "s-tree__item--dropping" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="s-tree__node" role="none">
      <div
        ref={rowRef}
        // The id and data-path are what aria-activedescendant and the keyboard
        // model address this row BY — the tree's single tab stop names a row
        // rather than focusing it, so the row has to be nameable.
        id={rowId(node.path)}
        data-tree-path={node.path}
        className={classes}
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
        // Draggable for either of the row's two drags (see onDragStart): the
        // admin's tree MOVE, or the tab LIFT that anything pane-hostable gets
        // — which is what makes a BOOK liftable although attachments do not
        // move (the move endpoints are note routes). A row being renamed is
        // not draggable: the field inside it needs its text selectable.
        draggable={
          renaming !== node.path &&
          ((props.admin && !attachment) || (!isFolder && isTabbablePath(node.path)))
        }
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragEnter={onDragEnterFiles}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
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
        // Attachment names are long and the pane is narrow ("Pasted image
        // 20230906180811-10.png" is 38 characters); the tooltip is the only
        // place the whole one fits. Note rows keep their bare label.
        title={attachment ? node.name : undefined}
      >
        {isFolder && (
          <span
            className={`s-tree__chevron${isOpen ? " s-tree__chevron--open" : ""}`}
            aria-hidden="true"
          >
            ›
          </span>
        )}
        {/* The folder's own mark, in the attachment glyph's slot and at its
            size: chevron, glyph, name. A folder without one is not padded to
            match — the glyph sits in the row's flex flow, so unmarked folders
            keep the alignment they have always had and marked ones step in by
            one slot. That is the same mixed-row look the attachment rows
            already have under their notes, and it is what makes the mark read
            as a mark rather than as a column. */}
        {isFolder && folderIcon && (
          <span className="s-tree__glyph">
            <FolderGlyph icon={folderIcon} />
          </span>
        )}
        {attachment && <AttachmentGlyph kind={attachment.kind} />}
        {renaming === node.path ? (
          <RenameInput
            initial={node.name}
            // A FILE wears an extension and a folder does not: "Notes v1.8"
            // must not be pre-selected down to "Notes v1".
            hasExt={node.type === "file"}
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
        {/* The glyph covers the five kinds; the badge names the exact type for
            the one that has no glyph of its own. */}
        {attachment?.kind === "other" && attachment.ext && (
          <span className="s-tree__ext">{attachment.ext}</span>
        )}
        {/* How many files are about to land here — chrome, so it sits
            OUTSIDE the label's isolate and keeps the row's own direction. */}
        {dropCount > 0 && (
          <span className="s-drop-count">{countPhrase(dropCount, "files")}</span>
        )}
      </div>
      {isFolder && isOpen && (
        // role="none" and not "group": in the FLAT tree model the level and
        // position come off each row (aria-level/posinset/setsize), and a real
        // group here would describe an ownership this markup does not have —
        // the children div is a SIBLING of the row that opens it.
        <div className="s-tree__children" role="none">
          <TreeChildren {...childProps} nodes={node.children ?? []} depth={depth + 1} />
        </div>
      )}
    </div>
  );
});

function RenameInput({
  initial,
  hasExt = false,
  onCommit,
  onCancel,
}: {
  initial: string;
  hasExt?: boolean;
  onCommit(name: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    // The STEM, not the whole filename (v1.8 audit, F10). Renaming pre-selected
    // "Ledger.md" whole, so the first keystroke ate the extension and the note
    // was saved back as a `.md` by `ensureMd` whatever it had been — a `.tex`
    // note renamed by hand quietly changed format. The dialog prompt has
    // selected only the stem since it shipped (client/components/Confirm.tsx);
    // the inline rename is the same gesture and now answers the same way.
    const dot = hasExt ? initial.lastIndexOf(".") : -1;
    ref.current?.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial, hasExt]);

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
