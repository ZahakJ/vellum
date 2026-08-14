// Sidebar: vault tree (recursive, collapsible, folders first), debounced
// full-text search with <mark> snippets, and a tag list. Inline rename via
// double-click; context menu for new note / new folder / rename / delete.

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { SearchHit, TagCount, TreeNode } from "../../shared/types.ts";
import { createFolder, getTags, search } from "../api.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";

const SEARCH_DEBOUNCE_MS = 200;

/** Escape everything, then let only literal <mark>/</mark> tags through. */
function sanitizeSnippet(snippet: string): string {
  return snippet
    .split(/(<\/?mark>)/g)
    .map((part) =>
      part === "<mark>" || part === "</mark>"
        ? part
        : part
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;"),
    )
    .join("");
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

export default function Sidebar() {
  const tree = useStore((s) => s.tree);
  const openNote = useStore((s) => s.openNote);
  const createNote = useStore((s) => s.createNote);
  const renameNote = useStore((s) => s.renameNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const loadTree = useStore((s) => s.loadTree);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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

  const toggleFolder = (path: string) =>
    setExpanded((e) => ({ ...e, [path]: !e[path] }));

  const commitRename = (node: TreeNode, rawName: string) => {
    setRenaming(null);
    const name = rawName.trim();
    if (!name || name === node.name || name.includes("/")) return;
    const finalName = node.type === "file" ? ensureMd(name) : name;
    void renameNote(node.path, joinPath(parentOf(node.path), finalName));
  };

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

  const openMenu = (e: ReactMouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };

  return (
    <aside className="s-sidebar">
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
              <span
                className="s-search-hit__snippet"
                dangerouslySetInnerHTML={{ __html: sanitizeSnippet(hit.snippet) }}
              />
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
              expanded={expanded}
              renaming={renaming}
              onToggle={toggleFolder}
              onOpen={openNote}
              onStartRename={setRenaming}
              onCommitRename={commitRename}
              onCancelRename={() => setRenaming(null)}
              onMenu={openMenu}
            />
          ))}
        </nav>
      )}

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
              #{tag}
              <span className="s-tag__count">{count}</span>
            </button>
          ))}
        </div>
      </div>

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
  expanded: Record<string, boolean>;
  renaming: string | null;
  onToggle(path: string): void;
  onOpen(path: string): void;
  onStartRename(path: string): void;
  onCommitRename(node: TreeNode, name: string): void;
  onCancelRename(): void;
  onMenu(e: ReactMouseEvent, node: TreeNode): void;
}

function TreeRow(props: TreeRowProps) {
  const { node, depth, expanded, renaming } = props;
  const openPath = useStore((s) => s.openPath);
  const isFolder = node.type === "folder";
  const isOpen = isFolder && !!expanded[node.path];
  const isActive = node.path === openPath;
  const label = isFolder ? node.name : node.name.replace(/\.md$/, "");

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
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => (isFolder ? props.onToggle(node.path) : props.onOpen(node.path))}
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
}

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
