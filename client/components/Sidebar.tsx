// Sidebar: vault tree (recursive, collapsible, folders first), debounced
// full-text search with <mark> snippets, and a tag list. Inline rename via
// double-click; context menu for new note / new folder / rename / delete.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { SearchHit, TagCount, TreeNode } from "../../shared/types.ts";
import { createFolder, getTags, search } from "../api.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { renderSnippet } from "./snippet.tsx";

const SEARCH_DEBOUNCE_MS = 200;

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
  const loadTree = useStore((s) => s.loadTree);
  const admin = useStore((s) => s.admin);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

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
      if (typeof detail === "string") setQuery(detail);
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

  const promptNewNote = (dir: string) => {
    const name = window.prompt("New note name:", "Untitled.md");
    if (!name || !name.trim()) return;
    void createNote(joinPath(dir, ensureMd(name.trim())));
  };

  const promptNewFolder = (dir: string) => {
    const name = window.prompt("New folder name:");
    if (!name || !name.trim()) return;
    createFolder(joinPath(dir, name.trim()))
      .then(() => loadTree())
      .catch((err: unknown) => {
        console.error("vellum: creating folder failed", err);
        toast(err instanceof Error ? err.message : "Creating folder failed");
      });
  };

  const confirmDelete = (node: TreeNode) => {
    if (window.confirm(`Delete "${node.path}"? This cannot be undone.`)) {
      void deleteNote(node.path);
    }
  };

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

  return (
    <aside className="s-sidebar">
      <header className="s-sidebar-header">
        <h1 className="s-title">
          <span className="s-title__star" aria-hidden="true">✦</span>
          Vellum
        </h1>
        {admin && (
          <span className="s-sidebar-actions">
            <button
              type="button"
              className="s-iconbtn"
              title="New note"
              aria-label="New note"
              onClick={() => promptNewNote("")}
            >
              <IconNewNote />
            </button>
            <button
              type="button"
              className="s-iconbtn"
              title="New folder"
              aria-label="New folder"
              onClick={() => promptNewFolder("")}
            >
              <IconNewFolder />
            </button>
          </span>
        )}
      </header>
      <div className="s-search">
        <input
          className="s-search__input"
          type="search"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
      </div>

      {hits !== null ? (
        <div className="s-search__results">
          {hits.length === 0 && <p className="s-search__none">No matches.</p>}
          {hits.map((hit) => (
            <button
              key={hit.path}
              type="button"
              className="s-search-hit"
              onClick={() => openNote(hit.path)}
            >
              <span className="s-search-hit__title">{hit.title}</span>
              <span className="s-search-hit__snippet">
                {renderSnippet(hit.snippet)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <nav
          className="s-tree"
          onContextMenu={(e) => {
            if (tree && e.target === e.currentTarget) openMenu(e, tree);
          }}
        >
          {tree?.children?.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={0}
              renaming={renaming}
              onOpen={openNote}
              onStartRename={startRename}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
              onMenu={openMenu}
            />
          ))}
        </nav>
      )}

      {tags.length > 0 && (
        <div className="s-tags">
          <h3 className="s-tags__title">Tags</h3>
          <div className="s-tags__list">
            {tags.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                className="s-tag"
                onClick={() => setQuery(`#${tag}`)}
                title={`Search #${tag}`}
              >
                <span className="s-tag__hash" aria-hidden="true">#</span>
                {tag}
                <span className="s-tag__count">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <footer className="s-sidebar-foot">
        {noteCount} note{noteCount === 1 ? "" : "s"}
      </footer>

      {menu && (
        <div
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
                  promptNewNote(menu.node.path);
                }}
              >
                New note here
              </button>
              <button
                type="button"
                className="s-menu__item"
                onClick={() => {
                  setMenu(null);
                  promptNewFolder(menu.node.path);
                }}
              >
                New folder
              </button>
            </>
          )}
          {menu.node.path !== "" && (
            <button
              type="button"
              className="s-menu__item"
              onClick={() => {
                setMenu(null);
                setRenaming(menu.node.path);
              }}
            >
              Rename
            </button>
          )}
          {menu.node.type === "file" && (
            <button
              type="button"
              className="s-menu__item s-menu__item--danger"
              onClick={() => {
                setMenu(null);
                confirmDelete(menu.node);
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  renaming: string | null;
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
    <div className="s-tree__node">
      <div
        className={classes}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => (isFolder ? toggle() : props.onOpen(node.path))}
        onDoubleClick={(e) => {
          e.stopPropagation();
          props.onStartRename(node.path);
        }}
        onContextMenu={(e) => props.onMenu(e, node)}
        role="treeitem"
        aria-expanded={isFolder ? isOpen : undefined}
      >
        {isFolder && (
          <span className={`s-tree__chevron${isOpen ? " s-tree__chevron--open" : ""}`}>
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
          <span className="s-tree__label">{label}</span>
        )}
      </div>
      {isFolder && isOpen && (
        <div className="s-tree__children" role="group">
          {node.children?.map((child) => (
            <TreeRow key={child.path} {...props} node={child} depth={depth + 1} />
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
