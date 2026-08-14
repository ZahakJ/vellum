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
import { dailyNotePath, openDailyNote } from "../daily.ts";
import { toast } from "../toast.ts";
import type { SearchHit } from "../../shared/types.ts";
import { renderSnippet } from "./snippet.tsx";

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

function titleOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

/** Folder part of a vault path ("" for notes at the vault root). */
function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

function ensureMd(path: string): string {
  return /\.md$/i.test(path) ? path : `${path}.md`;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** What a command needs to know to decide whether it applies right now. */
interface CommandCtx {
  openPath: string | null;
  admin: boolean;
  authProtected: boolean;
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  /** Commands that need a text argument switch the palette into prompt mode. */
  prompt?: { placeholder: string; initial: () => string };
  available: (ctx: CommandCtx) => boolean;
}

const COMMANDS: Command[] = [
  {
    id: "new-note",
    label: "New note",
    hint: "create",
    prompt: { placeholder: "path/to/note.md", initial: () => "" },
    available: ({ admin }) => admin,
  },
  {
    id: "daily-note",
    label: "Open daily note",
    hint: dailyNotePath(),
    available: ({ admin }) => admin,
  },
  {
    id: "toggle-graph",
    label: "Toggle graph",
    hint: "view",
    available: () => true,
  },
  {
    id: "toggle-reading",
    label: "Toggle reading view",
    hint: "Ctrl/Cmd E",
    available: ({ openPath, admin }) => admin && openPath !== null,
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
    available: ({ admin }) => admin,
  },
  {
    id: "rename-current",
    label: "Rename current note",
    hint: "move",
    prompt: {
      placeholder: "new/path.md",
      initial: () => useStore.getState().openPath ?? "",
    },
    available: ({ openPath, admin }) => admin && openPath !== null,
  },
  {
    id: "delete-current",
    label: "Delete current note",
    hint: "irreversible",
    available: ({ openPath, admin }) => admin && openPath !== null,
  },
  {
    id: "sign-in",
    label: "Sign in",
    hint: "unlock editing",
    available: ({ admin }) => !admin,
  },
  {
    id: "sign-out",
    label: "Sign out",
    hint: "back to reading",
    available: ({ admin, authProtected }) => admin && authProtected,
  },
];

type Item =
  | { kind: "command"; command: Command; indices: number[] }
  | { kind: "tab"; path: string }
  | { kind: "note"; hit: SearchHit };

const SECTION_LABEL: Record<Item["kind"], string> = {
  command: "Commands",
  tab: "Open tabs",
  note: "Notes",
};

function IconFile() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function IconCommand() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
    </svg>
  );
}

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
  const admin = useStore((s) => s.admin);
  const authProtected = useStore((s) => s.authProtected);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>({ type: "list" });
  const [selected, setSelected] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  /** True from the moment the query changes until THAT query's results are in
   *  `hits` (covers the debounce window too). While true, the note rows on
   *  screen belong to an older query and Enter must not open them. */
  const [inFlight, setInFlight] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Token of the most recently dispatched query; a response only lands if it
   *  still carries the current token. */
  const seqRef = useRef(0);
  /** Enter was pressed while results were in flight: run the selection as soon
   *  as the current query's results land. */
  const pendingEnterRef = useRef(false);

  // Reset on open.
  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setMode({ type: "list" });
      setSelected(0);
      setHits([]);
      setInFlight(false);
      seqRef.current++; // invalidate any response still in flight
      pendingEnterRef.current = false;
      // Focus after the modal renders.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  // Debounced live note search while typing in list mode. Token + abort per
  // query: only the latest query's results may land in `hits`.
  useEffect(() => {
    if (!paletteOpen || mode.type !== "list") return;
    const token = ++seqRef.current;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setInFlight(false);
      return;
    }
    setInFlight(true);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      search(q, ctrl.signal)
        .then((results) => {
          if (token !== seqRef.current) return;
          setHits(results);
          setInFlight(false);
        })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted || token !== seqRef.current) return;
          setHits([]);
          setInFlight(false);
          console.error("CommandPalette: search failed", err);
        });
    }, 120);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [paletteOpen, mode.type, query]);

  const items = useMemo<Item[]>(() => {
    if (mode.type === "prompt") return [];
    const q = query.trim();
    const ctx: CommandCtx = { openPath, admin, authProtected };
    const available = COMMANDS.filter((c) => c.available(ctx));
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
  }, [mode.type, query, openPath, admin, authProtected, openTabs, hits]);

  // Keep selection in bounds as results change.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Keep the selected row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector(".s-palette-item--active")
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
        case "daily-note":
          void openDailyNote();
          break;
        case "toggle-graph":
          store.setView(store.view === "graph" ? "editor" : "graph");
          break;
        case "toggle-reading":
          store.toggleReading();
          if (store.view === "graph") store.setView("editor");
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
        case "sign-in":
          store.setLoginOpen(true);
          break;
        case "sign-out":
          void store.logout();
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
        // Never open a stale row: while a search is in flight the note rows
        // belong to an older query, so Enter registers intent and fires when
        // THIS query's results land. Commands/tabs are matched synchronously
        // against the current query and stay safe to run immediately.
        if (inFlight && (!item || item.kind === "note")) {
          pendingEnterRef.current = true;
          return;
        }
        if (item) execute(item);
      }
    },
    [mode.type, items, selected, inFlight, close, execute, submitPrompt],
  );

  // Deferred Enter: fires once the in-flight query's results have landed.
  useEffect(() => {
    if (inFlight || !pendingEnterRef.current) return;
    pendingEnterRef.current = false;
    if (!paletteOpen || mode.type !== "list") return;
    const item = items[Math.min(selected, items.length - 1)];
    if (item) execute(item);
  }, [inFlight, paletteOpen, mode.type, items, selected, execute]);

  if (!paletteOpen) return null;

  const isPrompt = mode.type === "prompt";

  return (
    <div className="s-palette-overlay" onMouseDown={close}>
      <div
        className="s-palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {isPrompt && mode.command && (
          <div className="s-palette-prompt-label">{mode.command.label}</div>
        )}
        <input
          ref={inputRef}
          className="s-palette-input"
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
            pendingEnterRef.current = false; // typing again cancels a queued Enter
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {!isPrompt && (
          <div className="s-palette-list" ref={listRef}>
            {items.map((item, i) => {
              const active = i === selected;
              const cls = `s-palette-item${active ? " s-palette-item--active" : ""}`;
              const key =
                item.kind === "command"
                  ? `cmd:${item.command.id}`
                  : item.kind === "tab"
                    ? `tab:${item.path}`
                    : `note:${item.hit.path}`;
              const heading =
                items[i - 1]?.kind !== item.kind ? (
                  <div className="s-palette-section">{SECTION_LABEL[item.kind]}</div>
                ) : null;
              return (
                <div key={key}>
                  {heading}
                  <div
                    className={cls}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => execute(item)}
                  >
                    <span className="s-palette-item-icon" aria-hidden="true">
                      {item.kind === "command" ? <IconCommand /> : <IconFile />}
                    </span>
                    {item.kind === "command" && (
                      <>
                        <span className="s-palette-item-title">
                          {highlight(item.command.label, item.indices)}
                        </span>
                        {item.command.hint && (
                          <span className="s-palette-item-hint">
                            {item.command.hint}
                          </span>
                        )}
                      </>
                    )}
                    {item.kind === "tab" && (
                      <>
                        <span className="s-palette-item-title">
                          {titleOf(item.path)}
                        </span>
                        {folderOf(item.path) && (
                          <span className="s-palette-item-path">
                            {folderOf(item.path)}
                          </span>
                        )}
                      </>
                    )}
                    {item.kind === "note" && (
                      <>
                        <span className="s-palette-item-title">
                          {item.hit.title}
                        </span>
                        <span className="s-palette-item-snippet">
                          {renderSnippet(item.hit.snippet)}
                        </span>
                        {folderOf(item.hit.path) && (
                          <span className="s-palette-item-path">
                            {folderOf(item.hit.path)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="s-palette-empty">No matches</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
