import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { THEMES, useStore } from "../state.ts";
import type { Theme } from "../state.ts";
import { search } from "../api.ts";
import { dailyNotePath, openDailyNote } from "../daily.ts";
import { t, tf, type I18nKey } from "../i18n.ts";
import { confirmModal, confirmModalEx } from "./Confirm.tsx";
import { runSyncNow, syncSnapshot } from "../sync.ts";
import { toast } from "../toast.ts";
import type { SearchHit } from "../../shared/types.ts";
import { renderSnippet, snippetIsEmpty } from "./snippet.tsx";
import { openThemePicker } from "./ThemePicker.tsx";

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
  /** Best known publish state of the open note. */
  openPublished: boolean;
  /** Admin currently previewing the public site. */
  preview: boolean;
}

interface Command {
  id: string;
  // Label and hint are thunks, not strings: COMMANDS is a module-level table
  // built once at import, while the chrome language can change at runtime.
  // Evaluating them per render keeps both the visible text and the fuzzy-match
  // haystack in the active language.
  label: () => string;
  hint?: () => string;
  /** Commands that need a text argument switch the palette into prompt mode. */
  prompt?: { placeholder: string; initial: () => string };
  /** Theme-switch commands show a color-dot glyph instead of the ⌘ icon. */
  themeDot?: Theme;
  available: (ctx: CommandCtx) => boolean;
}

const COMMANDS: Command[] = [
  {
    id: "new-note",
    label: () => t("newNote"),
    hint: () => t("cmdCreateHint"),
    prompt: { placeholder: "path/to/note.md", initial: () => "" },
    available: ({ admin }) => admin,
  },
  {
    id: "daily-note",
    label: () => t("cmdDailyNote"),
    hint: () => dailyNotePath(),
    available: ({ admin }) => admin,
  },
  {
    id: "toggle-graph",
    label: () => t("cmdToggleGraph"),
    hint: () => t("cmdViewHint"),
    available: () => true,
  },
  {
    id: "toggle-reading",
    label: () => t("cmdToggleReading"),
    hint: () => "Ctrl/Cmd E",
    available: ({ openPath, admin }) => admin && openPath !== null,
  },
  {
    // The browsing surface, not a sixteenth switch: the fifteen rows below
    // jump straight to a theme by name, this one opens the panel that shows
    // all of them with a live preview and an Esc that puts things back.
    id: "theme-picker",
    label: () => t("browseThemes"),
    hint: () => t("cmdAppearanceHint"),
    available: () => true,
  },
  ...THEMES.map<Command>((theme) => ({
    id: `theme-${theme}`,
    label: () => tf("cmdTheme", { t: theme }),
    hint: () => t("cmdAppearanceHint"),
    themeDot: theme,
    available: () => true,
  })),
  // Shell layout. Available to visitors too: where the panes sit and how much
  // chrome is on screen is the reader's business, not the admin's.
  {
    id: "zen-mode",
    label: () => t("cmdZen"),
    hint: () => t("cmdZenHint"),
    available: () => true,
  },
  // Panes are named by WHAT THEY ARE, never by the edge they happen to be on:
  // in Arabic the notes sidebar sits right and the outline panel left, so
  // "toggle left panel" would name the wrong pane half the time.
  {
    id: "toggle-sidebar",
    label: () => t("cmdTogglePaneNotes"),
    hint: () => "Ctrl/Cmd B",
    available: () => true,
  },
  {
    id: "toggle-panel",
    label: () => t("cmdTogglePaneOutline"),
    hint: () => "Ctrl/Cmd Shift B",
    available: () => true,
  },
  // Three commands, not one toggle. The old single command named the edge you
  // were NOT on, which made the third state — "follow the language" — both
  // unreachable and invisible: the first use of it pinned the side forever.
  // The hint says which one is in force, because a list of three options with
  // no marked answer is a list of three questions.
  ...(["auto", "left", "right"] as const).map<Command>((pref) => ({
    id: `sidebar-side-${pref}`,
    label: () =>
      t(pref === "auto" ? "cmdPaneSideAuto" : pref === "left" ? "cmdPaneSideLeft" : "cmdPaneSideRight"),
    hint: () =>
      useStore.getState().sidebarSidePref === pref ? t("cmdLayoutCurrentHint") : t("cmdLayoutHint"),
    available: () => true,
  })),
  {
    id: "shortcuts",
    label: () => t("shortcutsTitle"),
    hint: () => "Ctrl/Cmd /",
    available: () => true,
  },
  {
    id: "toggle-vim",
    label: () => t("cmdToggleVim"),
    hint: () => t("cmdEditorHint"),
    available: ({ admin }) => admin,
  },
  {
    id: "publish-note",
    label: () => t("cmdPublishNote"),
    hint: () => t("cmdPublishHint"),
    available: ({ openPath, admin, openPublished }) =>
      admin && openPath !== null && !openPublished,
  },
  {
    id: "unpublish-note",
    label: () => t("cmdUnpublishNote"),
    hint: () => t("cmdUnpublishHint"),
    available: ({ openPath, admin, openPublished }) =>
      admin && openPath !== null && openPublished,
  },
  {
    id: "set-banner",
    label: () => t("cmdSetBanner"),
    hint: () => t("cmdSetBannerHint"),
    available: ({ openPath, admin }) => admin && openPath !== null,
  },
  {
    id: "remove-banner",
    label: () => t("cmdRemoveBanner"),
    hint: () => t("cmdRemoveBannerHint"),
    available: ({ openPath, admin }) => admin && openPath !== null,
  },
  {
    id: "rename-current",
    label: () => t("cmdRenameCurrent"),
    hint: () => t("cmdMoveHint"),
    prompt: {
      placeholder: "new/path.md",
      initial: () => useStore.getState().openPath ?? "",
    },
    available: ({ openPath, admin }) => admin && openPath !== null,
  },
  {
    id: "delete-current",
    label: () => t("cmdDeleteCurrent"),
    hint: () => t("cmdIrreversibleHint"),
    available: ({ openPath, admin }) => admin && openPath !== null,
  },
  {
    id: "moderate-comments",
    label: () => t("cmdModerateComments"),
    hint: () => t("cmdMarginaliaHint"),
    available: ({ admin }) => admin,
  },
  {
    id: "site-settings",
    label: () => t("siteSettings"),
    hint: () => t("cmdSiteSettingsHint"),
    available: ({ admin, preview }) => admin && !preview,
  },
  {
    // Offered only once backup & sync is switched on with a remote — the
    // status the badge reads is the same one this consults.
    id: "sync-now",
    label: () => t("syncNow"),
    hint: () => t("cmdSyncHint"),
    available: ({ admin, preview }) => {
      const s = syncSnapshot();
      return admin && !preview && s !== null && s.enabled && s.configured;
    },
  },
  {
    id: "preview-visitor",
    label: () => t("previewAsVisitor"),
    hint: () => t("cmdPreviewHint"),
    available: ({ admin, preview }) => admin && !preview,
  },
  {
    id: "exit-preview",
    label: () => t("cmdExitPreview"),
    hint: () => t("cmdExitPreviewHint"),
    available: ({ preview }) => preview,
  },
  {
    id: "sign-in",
    label: () => t("signIn"),
    hint: () => t("cmdSignInHint"),
    available: ({ admin, preview }) => !admin && !preview,
  },
  {
    id: "sign-out",
    label: () => t("signOut"),
    hint: () => t("cmdSignOutHint"),
    available: ({ admin, authProtected }) => admin && authProtected,
  },
];

type Item =
  | { kind: "command"; command: Command; indices: number[] }
  | { kind: "tab"; path: string }
  | { kind: "note"; hit: SearchHit };

const SECTION_KEY: Record<Item["kind"], I18nKey> = {
  command: "paletteCommands",
  tab: "paletteOpenTabs",
  note: "paletteNotes",
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
  const preview = useStore((s) => s.previewVisitor);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const openPublished = useStore(
    (s) =>
      s.openPublished ??
      (s.openPath !== null && (s.publishedPaths?.has(s.openPath) ?? false)),
  );

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
  // ---- Pointer arming -----------------------------------------------------
  // Enter must run the KEYBOARD's selection. The palette opens under wherever
  // the cursor happens to be resting, and `mouseenter` fires on whatever row
  // materializes there — so the row the reader never chose silently became the
  // one Enter ran. Hover is therefore ignored until the mouse actually MOVES:
  // we arm on a mousemove whose coordinates differ from the previous one
  // (browsers emit a synthetic move after layout/scroll changes, and one of
  // those must not count), and disarm on every keystroke, so arrowing away
  // from a stationary cursor is never undone by the cursor sitting there.
  const armedRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const onListMouseMove = useCallback((e: ReactMouseEvent) => {
    const last = lastPointRef.current;
    if (last && (last.x !== e.clientX || last.y !== e.clientY)) armedRef.current = true;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
  }, []);

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
      armedRef.current = false;
      lastPointRef.current = null;
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
    const ctx: CommandCtx = { openPath, admin, authProtected, openPublished, preview };
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
    // The hint is visible text on the row ("marginalia" / «الحواشي»), so it is
    // searchable too — typing what you can read must never answer "no matches".
    // A hint hit carries no highlight indices (they index the LABEL) and ranks
    // below every label hit.
    const HINT_PENALTY = 1000;
    const matchedCommands = available
      .map((command) => {
        const onLabel = fuzzyMatch(q, command.label());
        if (onLabel) return { command, indices: onLabel.indices, score: onLabel.score };
        const hint = command.hint?.();
        const onHint = hint ? fuzzyMatch(q, hint) : null;
        return onHint ? { command, indices: [], score: onHint.score - HINT_PENALTY } : null;
      })
      .filter((x): x is { command: Command; indices: number[]; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .map<Item>(({ command, indices }) => ({ kind: "command", command, indices }));
    return [...matchedCommands, ...hits.map<Item>((hit) => ({ kind: "note", hit }))];
  }, [mode.type, query, openPath, admin, authProtected, openPublished, preview, openTabs, hits]);

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
      if (command.themeDot) {
        store.setTheme(command.themeDot);
        close();
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
        case "toggle-vim":
          store.toggleVim();
          break;
        case "zen-mode":
          store.setZen(!store.zen);
          break;
        case "shortcuts":
          store.setShortcutsOpen(true);
          break;
        case "theme-picker":
          openThemePicker();
          break;
        case "toggle-sidebar":
          store.setSidebarCollapsed(!store.sidebarCollapsed);
          break;
        case "toggle-panel":
          store.setPanelCollapsed(!store.panelCollapsed);
          break;
        case "sidebar-side-auto":
          store.setSidebarSidePref("auto");
          break;
        case "sidebar-side-left":
          store.setSidebarSidePref("left");
          break;
        case "sidebar-side-right":
          store.setSidebarSidePref("right");
          break;
        case "delete-current":
          if (store.openPath) {
            const path = store.openPath;
            const name = path.split("/").pop() ?? path;
            const remove = (permanent: boolean) => {
              useStore
                .getState()
                .deleteNote(path, { permanent })
                .catch((err: unknown) => {
                  console.error("CommandPalette: delete failed", err);
                  toast(t("couldNotDeleteNote"));
                });
            };
            // The same two speeds the tree's own delete offers (Sidebar.tsx):
            // one command must not be the harsher one just because it was
            // reached from the palette.
            void confirmModalEx({
              title: tf("deleteNoteTitle", { name }),
              body: tf("deleteNoteBody", { path }),
              confirmLabel: t("moveToTrash"),
              extraLabel: t("deletePermanently"),
            }).then((result) => {
              if (result === "confirm") {
                remove(false);
                return;
              }
              if (result !== "extra") return;
              void confirmModal({
                title: tf("deleteNotePermTitle", { name }),
                body: tf("deleteNotePermBody", { path }),
                confirmLabel: t("deletePermanently"),
                grave: true,
              }).then((ok) => {
                if (ok) remove(true);
              });
            });
          }
          break;
        case "publish-note":
          if (store.openPath) void store.togglePublish(store.openPath, true);
          break;
        case "unpublish-note":
          if (store.openPath) void store.togglePublish(store.openPath, false);
          break;
        case "set-banner":
          if (store.openPath) store.setBannerModalOpen(true);
          break;
        case "remove-banner":
          if (store.openPath) void store.setBanner(store.openPath, null);
          break;
        case "moderate-comments":
          store.setModerationOpen(true);
          break;
        case "site-settings":
          store.setSettingsOpen(true);
          break;
        case "sync-now":
          void runSyncNow();
          break;
        case "preview-visitor":
          void store.setPreviewVisitor(true);
          break;
        case "exit-preview":
          void store.setPreviewVisitor(false);
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
          toast(t("couldNotCreateNote"));
        });
    } else if (command.id === "rename-current" && store.openPath) {
      store.renameNote(store.openPath, ensureMd(value)).catch((err: unknown) => {
        console.error("CommandPalette: rename failed", err);
        toast(t("couldNotRenameNote"));
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
      // Any keystroke hands the selection back to the keyboard: a cursor
      // parked over row 5 must not re-steal it after ↓ moved to row 2.
      armedRef.current = false;
      lastPointRef.current = null;
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
        aria-label={t("keyPalette")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {isPrompt && mode.command && (
          <div className="s-palette-prompt-label">{mode.command.label()}</div>
        )}
        <input
          ref={inputRef}
          className="s-palette-input"
          type="text"
          // The field holds note-derived text — a title being searched for, a
          // vault path being edited — so its DIRECTION is the value's, not the
          // chrome's. In an Arabic shell the rename prompt opened pre-filled
          // with "1 - Source Material/Research Page.md" and DREW it as
          // "Source Material/Research Page.md - 1": the leading digits are
          // bidi-weak, so the RTL paragraph swept them to the far end. That is
          // the string the reader is about to rename a file to.
          // While the field is EMPTY it carries no direction of its own and
          // inherits the shell's, so the Arabic placeholder still sets
          // right-aligned: `dir="auto"` reads the VALUE, and an empty one
          // resolves to ltr, which left-aligned «اكتب أمرًا أو ابحث في
          // الملاحظات…» inside an RTL panel.
          dir={query === "" ? undefined : "auto"}
          value={query}
          placeholder={
            isPrompt
              ? mode.command?.prompt?.placeholder
              : t("palettePlaceholder")
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0); // a new query is a new list — selection starts at the top
            pendingEnterRef.current = false; // typing again cancels a queued Enter
            armedRef.current = false;
            lastPointRef.current = null;
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {!isPrompt && (
          <div className="s-palette-list" ref={listRef} onMouseMove={onListMouseMove}>
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
                  <div className="s-palette-section">{t(SECTION_KEY[item.kind])}</div>
                ) : null;
              return (
                <div key={key}>
                  {heading}
                  <div
                    className={cls}
                    onMouseMove={() => {
                      if (armedRef.current) setSelected(i);
                    }}
                    onClick={() => execute(item)}
                  >
                    <span className="s-palette-item-icon" aria-hidden="true">
                      {item.kind === "command" ? (
                        item.command.themeDot ? (
                          <span
                            className="s-palette-dot"
                            data-theme-dot={item.command.themeDot}
                          />
                        ) : (
                          <IconCommand />
                        )
                      ) : (
                        <IconFile />
                      )}
                    </span>
                    {item.kind === "command" && (
                      <>
                        <span className="s-palette-item-title">
                          {highlight(item.command.label(), item.indices)}
                        </span>
                        {item.command.hint && (
                          <span className="s-palette-item-hint">
                            {/* Hints are a mixed bag — localized words
                                ("appearance" / «المظهر»), keystrokes
                                ("Ctrl/Cmd Shift B") and a real vault path
                                (the daily note's). The last two are Latin
                                runs with weak leading characters, so each
                                hint isolates itself rather than reordering
                                against the Arabic row around it. */}
                            <bdi>{item.command.hint()}</bdi>
                          </span>
                        )}
                      </>
                    )}
                    {item.kind === "tab" && (
                      <>
                        <span className="s-palette-item-title" dir="auto">
                          {titleOf(item.path)}
                        </span>
                        {folderOf(item.path) && (
                          <span className="s-palette-item-path" dir="auto">
                            {folderOf(item.path)}
                          </span>
                        )}
                      </>
                    )}
                    {item.kind === "note" && (
                      <>
                        <span className="s-palette-item-title" dir="auto">
                          {item.hit.title}
                        </span>
                        {!snippetIsEmpty(item.hit.snippet) && (
                          <span className="s-palette-item-snippet" dir="auto">
                            {renderSnippet(item.hit.snippet)}
                          </span>
                        )}
                        {folderOf(item.hit.path) && (
                          <span className="s-palette-item-path" dir="auto">
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
              <div className="s-palette-empty">{t("paletteNoMatches")}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
