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
import { useDialog } from "../a11y.ts";
import { useStore } from "../state.ts";
import {
  selectionToolbarEnabled,
  setSelectionToolbarEnabled,
} from "./SelectionMenu.tsx";
import { choiceBase } from "../themes.ts";
import type { Theme } from "../state.ts";
import { search } from "../api.ts";
import { dailyNotePath, openDailyNote } from "../daily.ts";
import { popOutNote } from "../windows/coherence.ts";
import { insertTemplateCommand, newNoteFromTemplateCommand } from "../templateActions.ts";
import { localeNum, t, tf, type I18nKey } from "../i18n.ts";
import { isNotePath, noteLabelOf, stripNoteExt } from "../../shared/noteFormat.ts";
import { confirmModal, confirmModalEx } from "./Confirm.tsx";
import { moveViaPicker } from "./MovePicker.tsx";
import { confirmDeleteNote } from "./deleteFlow.ts";
import { runSyncNow, syncSnapshot } from "../sync.ts";
import { toast } from "../toast.ts";
import type { SearchHit } from "../../shared/types.ts";
import { renderSnippet, snippetIsEmpty } from "./snippet.tsx";
import { openThemePicker } from "./ThemePicker.tsx";
import { openDesigner } from "./design/openDesigner.ts";
import { installRecents, recentNotes } from "../recents.ts";
import { getNote } from "../api.ts";
import { noteAnchors, type NoteAnchor } from "../../shared/anchors.ts";

// The palette owns the recents ledger's install: visits are recorded for the
// palette's sake, so the palette is the module that switches recording on —
// state.ts keeps no dependency on the feature. Module load runs once, and
// installRecents guards itself besides.
installRecents(useStore);

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
  return stripNoteExt(base);
}

/** Folder part of a vault path ("" for notes at the vault root). */
function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/** A typed name → a note path. An extension the reader supplied is KEPT —
 *  typing "Paper.tex" must create a LaTeX note, not "Paper.tex.md" — and
 *  anything else gets `.md`, which is what "new note" has always meant. */
function ensureMd(path: string): string {
  return isNotePath(path) ? path : `${path}.md`;
}

/** The same, defaulting to LaTeX: the "New LaTeX note" command's ending. */
function ensureTex(path: string): string {
  return isNotePath(path) ? path : `${path}.tex`;
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
  /** Shows a color-dot glyph instead of the ⌘ icon. A thunk, not a value:
   *  the one row that carries it previews the theme that is ON right now,
   *  and the table is built once at import. */
  themeDot?: () => Theme;
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
    // LaTeX is a first-class note format, not an import path, so creating one
    // belongs beside "New note" rather than behind a rename.
    id: "new-tex-note",
    label: () => t("newTexNote"),
    hint: () => t("cmdCreateHint"),
    prompt: { placeholder: "path/to/paper.tex", initial: () => "" },
    available: ({ admin }) => admin,
  },
  {
    // The macro package a `.tex` note needs to compile OUTSIDE Vellum. It is
    // the promise the whole `\note{…}` syntax rests on, and a promise nobody
    // can find is not one — so it sits in the palette, one search away.
    id: "vellum-sty",
    label: () => t("cmdCopyVellumSty"),
    hint: () => t("cmdCopyVellumStyHint"),
    available: () => true,
  },
  {
    id: "daily-note",
    label: () => t("cmdDailyNote"),
    hint: () => dailyNotePath(),
    available: ({ admin }) => admin,
  },
  // Pop the note out into a real second window — same origin, so it shares the
  // session cookie, the theme, the stored workspace and the bus that keeps the
  // two coherent, without being handed any of it. Admin-only and note-gated:
  // there is nothing to pop out of a blog page, and a visitor has no second
  // window to keep in step.
  {
    id: "collapse-folders",
    label: () => t("collapseAll"),
    available: ({ admin }) => admin,
  },
  {
    id: "expand-folders",
    label: () => t("expandAll"),
    available: ({ admin }) => admin,
  },
  {
    id: "pop-out",
    label: () => t("cmdPopOut"),
    available: ({ admin, openPath }) => admin && openPath !== null,
  },
  // Templates. Two rows, because they are two different actions on two
  // different objects — one edits the note you are in, the other makes a new
  // one — and collapsing them into "Templates…" would put a mode question in
  // front of both. The hints print the keystrokes, which is the only place
  // outside the Ctrl/Cmd+/ sheet that they appear.
  {
    id: "insert-template",
    label: () => t("cmdInsertTemplate"),
    hint: () => "Ctrl/Cmd Alt T",
    available: ({ admin, openPath }) => admin && openPath !== null,
  },
  {
    id: "new-from-template",
    label: () => t("cmdNewFromTemplate"),
    hint: () => "Ctrl/Cmd Alt Shift T",
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
    // ONE row for fifteen rooms. There used to be sixteen: this one plus a
    // `Theme: <id>` command per theme, which is 15 of the palette's 41
    // entries — 37% of the command list spent on one preference, and every
    // one of them a blind jump. The picker it opens is strictly the better
    // surface: grouped dark/light, arrow keys preview live against the real
    // app, Enter keeps, Esc puts back what you started with. A family that is
    // one parameter with N values belongs behind the surface that shows the
    // values, not spread across N rows of a list you are trying to search.
    // The dot previews the theme in force, so the row still answers "which
    // one am I in" at a glance.
    id: "theme-picker",
    label: () => t("browseThemes"),
    hint: () => t("cmdAppearanceHint"),
    // choiceBase, not the raw choice: the dot is painted from the CONSTANT
    // --swatch-<id>-* tokens, which are keyed on the fifteen built-in ids, so
    // a custom theme previews as the room it was built on.
    themeDot: () => choiceBase(useStore.getState().theme),
    available: () => true,
  },
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
    hint: () => "Ctrl/Cmd Alt B",
    available: () => true,
  },
  {
    id: "toggle-panel",
    label: () => t("cmdTogglePaneOutline"),
    hint: () => "Ctrl/Cmd Alt Shift B",
    available: () => true,
  },
  // The floating formatting toolbar's only way BACK. It defaults on and the
  // selection menu's last row turns it off, so without this row the switch
  // would be one-way — the classic trap of a hidden default-on affordance.
  // Admin only: it acts on the editor, which a read-only session never mounts.
  {
    id: "toggle-selection-toolbar",
    label: () => t("cmdSelectionToolbar"),
    hint: () => t("cmdSelectionToolbarHint"),
    available: () => useStore.getState().admin,
  },
  // Three commands, not one toggle. The old single command named the edge you
  // were NOT on, which made the third state — "follow the language" — both
  // unreachable and invisible: the first use of it pinned the side forever.
  // The hint says which one is in force, because a list of three options with
  // no marked answer is a list of three questions.
  //
  // AUDITED against the theme family and KEPT. The fifteen `Theme:` rows went
  // because a theme is a ROOM — it has to be looked at, the picker previews it
  // live, and one row per value was 37% of the list. These three are the
  // complete enumeration of a three-state preference, each row a finished end
  // state that runs in one keystroke, with the one in force marked — the same
  // shape as publish/unpublish, which are two rows for two genuine states.
  // Collapsing them would trade three direct actions for a modal, a tab and a
  // scroll (Settings → Appearance & language carries the identical segmented
  // control), which is the opposite of what the theme change bought.
  ...(["auto", "left", "right"] as const).map<Command>((pref) => ({
    id: `sidebar-side-${pref}`,
    label: () =>
      t(pref === "auto" ? "cmdPaneSideAuto" : pref === "left" ? "cmdPaneSideLeft" : "cmdPaneSideRight"),
    hint: () =>
      useStore.getState().sidebarSidePref === pref ? t("cmdLayoutCurrentHint") : t("cmdLayoutHint"),
    available: () => true,
  })),
  // The editor's own chrome language, in the palette for a reason the
  // settings row cannot cover: this is the affordance you need precisely when
  // you cannot read the interface. Admin only — a visitor's language lives on
  // the public EN/ع switch and must never be settable from in here, which is
  // the whole point of the split (langPref.ts).
  ...([null, "en", "ar"] as const).map<Command>((pref) => ({
    id: `editor-lang-${pref ?? "follow"}`,
    label: () =>
      t(pref === null ? "cmdEditorLangFollow" : pref === "en" ? "cmdEditorLangEn" : "cmdEditorLangAr"),
    hint: () =>
      useStore.getState().editorLangPref === pref ? t("cmdEditorLangCurrentHint") : t("cmdEditorLangHint"),
    available: ({ admin }) => admin,
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
    // The palette's half of drag-and-drop. `rename-current` above can also
    // move a note — it takes a whole path — but typing "Zombies/Cache
    // Locality.md" from memory is not the same affordance as picking a folder
    // from a filtered list, and a reader who cannot drag (touch, keyboard) needs
    // the second one. It opens exactly the picker the tree's row menu opens.
    id: "move-current",
    label: () => t("cmdMoveCurrent"),
    hint: () => t("cmdMoveFolderHint"),
    available: ({ openPath, admin }) => admin && openPath !== null,
  },
  {
    id: "delete-current",
    label: () => t("cmdDeleteCurrent"),
    hint: () => t("cmdTrashHint"),
    available: ({ openPath, admin }) => admin && openPath !== null,
  },
  {
    // The door to the bin every delete dialog promises. It sits next to the
    // delete command on purpose: the reader who has just read "recoverable
    // from disk" and wants the file back looks here, not in a terminal.
    id: "open-trash",
    label: () => t("cmdOpenTrash"),
    hint: () => t("cmdOpenTrashHint"),
    available: ({ admin, preview }) => admin && !preview,
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
    // The design engine's one door. Like the theme picker, what it opens is a
    // browsing-and-building surface rather than a list, so it is one row.
    id: "design-site",
    label: () => t("designTitle"),
    hint: () => t("designPaletteHint"),
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
  | { kind: "recent"; path: string }
  | { kind: "tab"; path: string }
  | { kind: "note"; hit: SearchHit }
  | { kind: "heading"; anchor: NoteAnchor; indices: number[] };

const SECTION_KEY: Record<Item["kind"], I18nKey> = {
  recent: "paletteRecent",
  command: "paletteCommands",
  tab: "paletteOpenTabs",
  note: "paletteNotes",
  heading: "paletteHeadings",
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
  /** SNAPSHOT of the recents ledger, taken once per palette-open. A snapshot
   *  rather than a live read on purpose: opening the palette IS a visit to
   *  wherever you are, and a list that reshuffled under the second Ctrl+P of
   *  the evening would break exactly the muscle memory it exists to serve. */
  const [recent, setRecent] = useState<string[]>([]);
  /** The open note's anchors (headings + LaTeX \labels), fetched lazily the
   *  first time the query enters heading mode ("@…"); null = not loaded. */
  const [anchors, setAnchors] = useState<NoteAnchor[] | null>(null);
  /** True from the moment the query changes until THAT query's results are in
   *  `hits` (covers the debounce window too). While true, the note rows on
   *  screen belong to an older query and Enter must not open them. */
  const [inFlight, setInFlight] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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
      // Recents: pruned against the CURRENT tree at this read (a deleted or
      // unpublished note's path never surfaces a title), minus the note the
      // reader is looking at — "jump back to where I just was" never means
      // "here". Ten rows: enough for an evening's trail, few enough that the
      // commands stay one glance away.
      const s = useStore.getState();
      setRecent(recentNotes(s.tree, { exclude: s.openPath, limit: 10 }));
      setAnchors(null);
      seqRef.current++; // invalidate any response still in flight
      pendingEnterRef.current = false;
      armedRef.current = false;
      lastPointRef.current = null;
      // Focus after the modal renders.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  /** Heading mode: "@…" jumps within the OPEN note — one palette, one more
   *  prefix, rather than a second Ctrl+Shift+O surface to learn. */
  const headingMode = mode.type === "list" && query.startsWith("@");

  // Debounced live note search while typing in list mode. Token + abort per
  // query: only the latest query's results may land in `hits`.
  useEffect(() => {
    if (!paletteOpen || mode.type !== "list") return;
    const token = ++seqRef.current;
    const q = headingMode ? "" : query.trim();
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
  }, [paletteOpen, mode.type, query, headingMode]);

  // Heading mode's data: the open note's anchor table, via the API rather
  // than the live editor buffer — the palette must stay importable without
  // pulling CodeMirror into its chunk (the same wall bufferBridge.ts guards),
  // and autosave (600ms) keeps the server copy close enough that the heading
  // you typed a breath ago is the only thing that can be missing. Fetched
  // once per palette-open, on first entering "@".
  useEffect(() => {
    if (!paletteOpen || !headingMode || anchors !== null) return;
    const path = useStore.getState().openPath;
    if (path === null || !isNotePath(path)) {
      setAnchors([]);
      return;
    }
    let dead = false;
    getNote(path)
      .then((note) => {
        if (!dead) setAnchors(noteAnchors(path, note.content));
      })
      .catch((err: unknown) => {
        console.error("CommandPalette: loading anchors failed", err);
        if (!dead) setAnchors([]);
      });
    return () => {
      dead = true;
    };
  }, [paletteOpen, headingMode, anchors]);

  const items = useMemo<Item[]>(() => {
    if (mode.type === "prompt") return [];
    if (headingMode) {
      // "@" then fuzzy over the open note's anchors. Empty query = the whole
      // outline in document order — the "where am I" glance for free.
      const hq = query.slice(1).trim();
      const list = anchors ?? [];
      if (!hq) return list.map<Item>((anchor) => ({ kind: "heading", anchor, indices: [] }));
      return list
        .map((anchor) => {
          const onTitle = fuzzyMatch(hq, anchor.title);
          if (onTitle) return { anchor, indices: onTitle.indices, score: onTitle.score };
          // The id is how a \label is actually remembered ("eq:fourier"), so
          // it is a haystack too — highlighting stays on the title, which is
          // what the row displays.
          const onId = fuzzyMatch(hq, anchor.id);
          return onId ? { anchor, indices: [], score: onId.score - 1 } : null;
        })
        .filter((x): x is { anchor: NoteAnchor; indices: number[]; score: number } => x !== null)
        .sort((a, b) => b.score - a.score)
        .map<Item>(({ anchor, indices }) => ({ kind: "heading", anchor, indices }));
    }
    const q = query.trim();
    const ctx: CommandCtx = { openPath, admin, authProtected, openPublished, preview };
    const available = COMMANDS.filter((c) => c.available(ctx));
    if (!q) {
      // Empty palette: the notes you were just in FIRST — that is the jump a
      // writer opens Ctrl+P for — then the commands, then whatever open tabs
      // the recents section didn't already name (a duplicate row would make
      // arrow-key distances change with usage, the muscle-memory killer).
      const shown = new Set(recent);
      // Filtered BEFORE the spread: `filter(...).map<Item>` reads to the
      // check-i18n scanner like a JSX tag with English text in front of it.
      const restTabs = openTabs.filter((path) => !shown.has(path));
      return [
        ...recent.map<Item>((path) => ({ kind: "recent", path })),
        ...available.map<Item>((command) => ({
          kind: "command",
          command,
          indices: [],
        })),
        ...restTabs.map<Item>((path) => ({ kind: "tab", path })),
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
  }, [mode.type, query, openPath, admin, authProtected, openPublished, preview, openTabs, hits, headingMode, anchors, recent]);

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

  // Tab is trapped inside the panel, and closing hands focus back to whatever
  // opened the palette — a reader who pressed Ctrl+P from the middle of a
  // note lands back in the note, not on <body>. The palette focuses its own
  // input (see the reset effect above), hence manualFocus.
  useDialog(panelRef, { active: paletteOpen, manualFocus: true });

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
        case "collapse-folders":
          window.dispatchEvent(new CustomEvent("vellum:tree-all", { detail: { open: false } }));
          break;
        case "expand-folders":
          window.dispatchEvent(new CustomEvent("vellum:tree-all", { detail: { open: true } }));
          break;
        case "pop-out": {
          const open = useStore.getState().openPath;
          if (open !== null) popOutNote(open);
          break;
        }
        case "insert-template":
          void insertTemplateCommand();
          break;
        case "new-from-template":
          void newNoteFromTemplateCommand();
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
          store.toggleSidebar();
          break;
        case "toggle-panel":
          store.setPanelCollapsed(!store.panelCollapsed);
          break;
        case "toggle-selection-toolbar":
          setSelectionToolbarEnabled(!selectionToolbarEnabled());
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
        case "editor-lang-follow":
          store.setEditorLang(null);
          break;
        case "editor-lang-en":
          store.setEditorLang("en");
          break;
        case "editor-lang-ar":
          store.setEditorLang("ar");
          break;
        case "move-current":
          if (store.openPath) {
            const path = store.openPath;
            void moveViaPicker({
              path,
              name: path.slice(path.lastIndexOf("/") + 1),
              isFolder: false,
            });
          }
          break;
        case "delete-current":
          // Literally the same call the tree row makes (components/
          // deleteFlow.ts). A command must not be the harsher gesture merely
          // because it was reached from the palette, and the only way to
          // guarantee that forever is for there to be one implementation of
          // it — two copies of the same dialog is what let the palette hint
          // say "irreversible" over a move to .trash.
          if (store.openPath) void confirmDeleteNote(store.openPath);
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
        case "open-trash":
          store.setTrashOpen(true);
          break;
        case "moderate-comments":
          store.setModerationOpen(true);
          break;
        case "site-settings":
          store.setSettingsOpen(true);
          break;
        case "design-site":
          openDesigner();
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
        case "vellum-sty":
          window.open("/api/vellum.sty", "_blank", "noopener");
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
    if (command.id === "new-note" || command.id === "new-tex-note") {
      const path = command.id === "new-tex-note" ? ensureTex(value) : ensureMd(value);
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
      if (item.kind === "heading") {
        // The same event the outline's rows dispatch, with the same payload
        // (TocPanel): the editor consumes `line`, the reading view `slug`, so
        // one dispatch lands in whichever surface is showing the note. No
        // pendingHeading — that is for a note that is about to MOUNT, and
        // this note is on screen behind the palette right now.
        window.dispatchEvent(
          new CustomEvent("vellum:goto-heading", {
            detail: { slug: item.anchor.id, line: item.anchor.line, text: item.anchor.title },
          }),
        );
        close();
        return;
      }
      const path = item.kind === "note" ? item.hit.path : item.path;
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
        ref={panelRef}
        className="s-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("keyPalette")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {isPrompt && mode.command && (
          <div className="s-palette-prompt-label">{mode.command.label()}</div>
        )}
        {/* The palette IS a combobox: a text field whose arrow keys drive a
            list of options that live somewhere else in the DOM. Said out
            loud, that is exactly the role/aria-controls/aria-activedescendant
            trio — without it a screen reader announces the typing and nothing
            about what is selected underneath. */}
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
          role={isPrompt ? undefined : "combobox"}
          aria-expanded={isPrompt ? undefined : items.length > 0}
          aria-controls={isPrompt ? undefined : "s-palette-list"}
          aria-autocomplete={isPrompt ? undefined : "list"}
          aria-activedescendant={
            !isPrompt && items[selected] ? `s-palette-opt-${selected}` : undefined
          }
          aria-label={isPrompt ? mode.command?.label() : t("keyPalette")}
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
          <>
            {/* The count, spoken. The list repopulates on every keystroke and
                a screen reader is told nothing by the typing alone. */}
            <p className="s-sr-only" role="status">
              {items.length === 0
                ? t("noResultsAria")
                : tf("resultCount", { count: localeNum(items.length) })}
            </p>
            <div
              className="s-palette-list"
              id="s-palette-list"
              role="listbox"
              aria-label={t("paletteResultsAria")}
              ref={listRef}
              onMouseMove={onListMouseMove}
            >
            {items.map((item, i) => {
              const active = i === selected;
              const cls = `s-palette-item${active ? " s-palette-item--active" : ""}`;
              const key =
                item.kind === "command"
                  ? `cmd:${item.command.id}`
                  : item.kind === "recent"
                    ? `recent:${item.path}`
                    : item.kind === "tab"
                      ? `tab:${item.path}`
                      : item.kind === "heading"
                        ? `head:${item.anchor.id}`
                        : `note:${item.hit.path}`;
              const heading =
                items[i - 1]?.kind !== item.kind ? (
                  <div className="s-palette-section" role="presentation">
                    {t(SECTION_KEY[item.kind])}
                  </div>
                ) : null;
              return (
                // A listbox may only own options (and groups), so the grouping
                // wrappers and the section captions step out of the tree.
                <div key={key} role="presentation">
                  {heading}
                  <div
                    className={cls}
                    id={`s-palette-opt-${i}`}
                    role="option"
                    aria-selected={active}
                    // onMouseMove, not onMouseEnter: the palette opens under a
                    // stationary cursor, and `mouseenter` on whichever row
                    // lands beneath it would move the selection the reader
                    // never touched. Genuine movement arms it (see
                    // onListMouseMove); every keystroke disarms it again.
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
                            data-theme-dot={item.command.themeDot()}
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
                                ("Ctrl/Cmd Alt Shift B") and a real vault path
                                (the daily note's). The last two are Latin
                                runs with weak leading characters, so each
                                hint isolates itself rather than reordering
                                against the Arabic row around it. */}
                            <bdi>{item.command.hint()}</bdi>
                          </span>
                        )}
                      </>
                    )}
                    {(item.kind === "tab" || item.kind === "recent") && (
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
                    {item.kind === "heading" && (
                      <>
                        <span className="s-palette-item-title" dir="auto">
                          {highlight(item.anchor.title, item.indices)}
                        </span>
                        {/* A \label's id IS its name ("eq:fourier"); a
                            heading's id merely restates the title as a slug,
                            which would be noise on every row. */}
                        {item.anchor.kind !== "heading" && (
                          <span className="s-palette-item-path" dir="auto">
                            {item.anchor.id}
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
              <div className="s-palette-empty" role="presentation">
                {t("paletteNoMatches")}
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
