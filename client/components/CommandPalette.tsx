import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useStore } from "../state.ts";
import { search } from "../api.ts";
import { toast } from "../toast.ts";
import type { SearchHit } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// Fuzzy matching (subsequence with consecutive/word-start bonuses)
// ---------------------------------------------------------------------------

interface FuzzyResult {
  score: number;
  indices: number[];
}

function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    score += found === prev + 1 ? 8 : 1; // consecutive runs score high
    if (found === 0 || /[\s/\-_.]/.test(t[found - 1])) score += 6; // word starts
    score -= Math.min(3, found - ti); // mild gap penalty
    indices.push(found);
    prev = found;
    ti = found + 1;
  }
  return { score, indices };
}

function highlight(text: string, indices: number[]): ReactNode {
  if (indices.length === 0) return text;
  const set = new Set(indices);
  const out: ReactNode[] = [];
  let run = "";
  let runMarked = set.has(0);
  for (let i = 0; i < text.length; i++) {
    const marked = set.has(i);
    if (marked !== runMarked) {
      out.push(runMarked ? <mark key={i}>{run}</mark> : run);
      run = "";
      runMarked = marked;
    }
    run += text[i];
  }
  out.push(runMarked ? <mark key="tail">{run}</mark> : run);
  return out;
}

/** Server snippets wrap matches in <mark>…</mark>; render them without innerHTML. */
function renderSnippet(snippet: string): ReactNode {
  const parts = snippet.split(/<mark>(.*?)<\/mark>/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <mark key={i}>{part}</mark> : part,
  );
}

function titleOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

function ensureMd(path: string): string {
  return /\.md$/i.test(path) ? path : `${path}.md`;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

interface Command {
  id: string;
  label: string;
  hint?: string;
  /** Commands that need a text argument switch the palette into prompt mode. */
  prompt?: { placeholder: string; initial: () => string };
  available: (openPath: string | null) => boolean;
}

const COMMANDS: Command[] = [
  {
    id: "new-note",
    label: "New note",
    hint: "create",
    prompt: { placeholder: "path/to/note.md", initial: () => "" },
    available: () => true,
  },
  {
    id: "toggle-graph",
    label: "Toggle graph",
    hint: "view",
    available: () => true,
  },
  {
    id: "toggle-theme",
    label: "Toggle theme",
    hint: "iron-gall / parchment",
    available: () => true,
  },
  {
    id: "toggle-vim",
    label: "Toggle vim",
    hint: "editor",
    available: () => true,
  },
  {
    id: "rename-current",
    label: "Rename current note",
    hint: "move",
    prompt: {
      placeholder: "new/path.md",
      initial: () => useStore.getState().openPath ?? "",
    },
    available: (openPath) => openPath !== null,
  },
  {
    id: "delete-current",
    label: "Delete current note",
    hint: "irreversible",
    available: (openPath) => openPath !== null,
  },
];

type Item =
  | { kind: "command"; command: Command; indices: number[] }
  | { kind: "tab"; path: string }
  | { kind: "note"; hit: SearchHit };

interface Mode {
  type: "list" | "prompt";
  command?: Command;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CommandPalette() {
  const paletteOpen = useStore((s) => s.paletteOpen);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const openTabs = useStore((s) => s.openTabs);
  const openPath = useStore((s) => s.openPath);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>({ type: "list" });
  const [selected, setSelected] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on open.
  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setMode({ type: "list" });
      setSelected(0);
      setHits([]);
      // Focus after the modal renders.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  // Debounced live note search while typing in list mode.
  useEffect(() => {
    if (!paletteOpen || mode.type !== "list") return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      search(q)
        .then((results) => {
          if (!stale) setHits(results);
        })
        .catch((err: unknown) => {
          console.error("CommandPalette: search failed", err);
        });
    }, 120);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [paletteOpen, mode.type, query]);

  const items = useMemo<Item[]>(() => {
    if (mode.type === "prompt") return [];
    const q = query.trim();
    const available = COMMANDS.filter((c) => c.available(openPath));
    if (!q) {
      return [
        ...available.map<Item>((command) => ({
          kind: "command",
          command,
          indices: [],
        })),
        ...openTabs.map<Item>((path) => ({ kind: "tab", path })),
      ];
    }
    const matchedCommands = available
      .map((command) => ({ command, match: fuzzyMatch(q, command.label) }))
      .filter((x): x is { command: Command; match: FuzzyResult } => x.match !== null)
      .sort((a, b) => b.match.score - a.match.score)
      .map<Item>(({ command, match }) => ({
        kind: "command",
        command,
        indices: match.indices,
      }));
    return [...matchedCommands, ...hits.map<Item>((hit) => ({ kind: "note", hit }))];
  }, [mode.type, query, openPath, openTabs, hits]);

  // Keep selection in bounds as results change.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Keep the selected row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector(".s-palette__item--active")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, items]);

  const close = useCallback(() => setPaletteOpen(false), [setPaletteOpen]);

  const runCommand = useCallback(
    (command: Command) => {
      const store = useStore.getState();
      if (command.prompt) {
        setMode({ type: "prompt", command });
        setQuery(command.prompt.initial());
        setSelected(0);
        requestAnimationFrame(() => inputRef.current?.select());
        return;
      }
      switch (command.id) {
        case "toggle-graph":
          store.setView(store.view === "graph" ? "editor" : "graph");
          break;
        case "toggle-theme":
          store.setTheme(store.theme === "iron-gall" ? "parchment" : "iron-gall");
          break;
        case "toggle-vim":
          store.toggleVim();
          break;
        case "delete-current":
          if (store.openPath) {
            store.deleteNote(store.openPath).catch((err: unknown) => {
              console.error("CommandPalette: delete failed", err);
              toast("Could not delete note");
            });
          }
          break;
      }
      close();
    },
    [close],
  );

  const submitPrompt = useCallback(() => {
    const command = mode.command;
    const value = query.trim();
    if (!command || !value) return;
    const store = useStore.getState();
    if (command.id === "new-note") {
      const path = ensureMd(value);
      store
        .createNote(path)
        .then(() => store.openNote(path))
        .catch((err: unknown) => {
          console.error("CommandPalette: create failed", err);
          toast("Could not create note");
        });
    } else if (command.id === "rename-current" && store.openPath) {
      store.renameNote(store.openPath, ensureMd(value)).catch((err: unknown) => {
        console.error("CommandPalette: rename failed", err);
        toast("Could not rename note");
      });
    }
    close();
  }, [mode.command, query, close]);

  const execute = useCallback(
    (item: Item) => {
      if (item.kind === "command") {
        runCommand(item.command);
        return;
      }
      const path = item.kind === "tab" ? item.path : item.hit.path;
      useStore.getState().openNote(path);
      close();
    },
    [runCommand, close],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (mode.type === "prompt") {
        if (e.key === "Enter") {
          e.preventDefault();
          submitPrompt();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (items.length ? (s + 1) % items.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) =>
          items.length ? (s - 1 + items.length) % items.length : 0,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selected];
        if (item) execute(item);
      }
    },
    [mode.type, items, selected, close, execute, submitPrompt],
  );

  if (!paletteOpen) return null;

  const isPrompt = mode.type === "prompt";
  const showTabsHeading =
    !isPrompt && !query.trim() && openTabs.length > 0;

  return (
    <div className="s-palette-backdrop" onMouseDown={close}>
      <div
        className="s-palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {isPrompt && mode.command && (
          <div className="s-palette__prompt-label">{mode.command.label}</div>
        )}
        <input
          ref={inputRef}
          className="s-palette__input"
          type="text"
          value={query}
          placeholder={
            isPrompt
              ? mode.command?.prompt?.placeholder
              : "Type a command or search notes…"
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {!isPrompt && (
          <div className="s-palette__list" ref={listRef}>
            {items.map((item, i) => {
              const active = i === selected;
              const cls = `s-palette__item${active ? " s-palette__item--active" : ""}`;
              const key =
                item.kind === "command"
                  ? `cmd:${item.command.id}`
                  : item.kind === "tab"
                    ? `tab:${item.path}`
                    : `note:${item.hit.path}`;
              const heading =
                showTabsHeading && item.kind === "tab" && items[i - 1]?.kind !== "tab" ? (
                  <div className="s-palette__section">Open tabs</div>
                ) : null;
              return (
                <div key={key}>
                  {heading}
                  <div
                    className={cls}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => execute(item)}
                  >
                    {item.kind === "command" && (
                      <>
                        <span className="s-palette__item-title">
                          {highlight(item.command.label, item.indices)}
                        </span>
                        {item.command.hint && (
                          <span className="s-palette__item-hint">
                            {item.command.hint}
                          </span>
                        )}
                      </>
                    )}
                    {item.kind === "tab" && (
                      <>
                        <span className="s-palette__item-title">
                          {titleOf(item.path)}
                        </span>
                        <span className="s-palette__item-hint">{item.path}</span>
                      </>
                    )}
                    {item.kind === "note" && (
                      <>
                        <span className="s-palette__item-title">
                          {item.hit.title}
                        </span>
                        <span className="s-palette__item-snippet">
                          {renderSnippet(item.hit.snippet)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="s-palette__empty">No matches</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
