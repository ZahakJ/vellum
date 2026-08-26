// The workspace: what is open, where, and which pane the keyboard is in.
//
// PURE. No DOM, no store, no fetch, no imports from `client/state.ts` — every
// function here takes a Workspace and returns a new one. That is what lets
// `tests/workspace.test.ts` fuzz ten thousand mutated layouts through it the
// way `check-sections.mjs` already fuzzes the section model, and it is why the
// riskiest structural change in the product can be proven before any of it is
// wired to a component.
//
// TWO LEVELS, NEVER A TREE. Columns along the inline axis, at most two panes
// stacked in each. A recursive split tree buys infinite layouts and no way back
// to one: its drop targets cannot be enumerated by a gate, its serialization
// needs a version and a migration table the first time the shape moves, and a
// layout space too large to name kills presets — which are the reason to have
// splits at all. Three columns of two is small enough that every reachable
// layout has a name, a keystroke and a one-line description.
//
// COLUMN ORDER IS READING ORDER. `columns[0]` is the inline-START column: the
// left in English, the right in Arabic. The shell grid already follows the
// direction this way (`grid-template-areas: "sidebar main panel"` and its
// `--flip` counterpart in app.css), so a layout serialized on an English
// instance opens correctly mirrored on an Arabic one with nothing stored about
// sides. The one place this rule is deliberately broken is `paneInDirection` —
// see its comment.

import type { BookAnchor } from "../shared/bookAnchor.ts";
import { isNotePath } from "../shared/noteFormat.ts";

export type PaneId = string;

/** What a pane is showing. `library` sits here rather than on the shell's
 *  `View` because a book that cannot sit beside the note it is being cited into
 *  is the wrong product. */
export type PaneMode = "edit" | "reading" | "graph" | "library";

/** The surface a pane actually RENDERS. Total over any pane state, so no
 *  invariant has to be policed at the component boundary: a `.pdf` tab renders
 *  the reader whatever the mode says, which is exactly what makes Ctrl/Cmd+E a
 *  harmless no-op on a book instead of a mode the pane cannot honour. */
export type PaneSurface = "edit" | "reading" | "book" | "graph" | "library" | "empty";

/** Where in a book an open should land. There is ONE spelling of "where in a
 *  book" in this product — shared/bookAnchor.ts owns it, the citation wikilink
 *  carries it, and this model holds the same shape rather than a private
 *  translation of it that every consumer would have to convert. */
export type BookTarget = BookAnchor;

export interface TabState {
  /** A note (`.md`/`.tex`) or a book (`.pdf`). Nothing else opens as a tab. */
  path: string;
  pinned: boolean;
  /** A PREVIEW tab — opened by a single click from search, the palette or a
   *  wikilink. The next ephemeral open in the same pane REPLACES it, so forty
   *  tabs never accumulate in the first place. Committed by typing in it, by a
   *  double-click, by pinning, or by an explicit new-tab open. Prevention
   *  rather than the "close all tabs" cure.
   *
   *  Mutually exclusive with `pinned` by construction: pinning commits. */
  ephemeral: boolean;
}

export interface Pane {
  id: PaneId;
  tabs: TabState[];
  /** Index into `tabs`; exactly -1 when `tabs` is empty. */
  active: number;
  mode: PaneMode;
  /** A FOLLOWER renders `noteFocus`'s active note in its own mode and holds no
   *  tabs of its own. It can never BE the focus — clicking it focuses it for
   *  scrolling and selection only — so "everything follows everything" is not
   *  a reachable state and needs no cycle check. */
  follow: "note" | null;
  /** Book panes only: the page a citation asked for. Cleared once landed. */
  bookTarget: BookTarget | null;
}

export interface Layout {
  columns: PaneId[][];
  /** flex-grow per column, normalized to sum 1. */
  colWeights: number[];
  /** flex-grow per pane within its column, normalized to sum 1 per column. */
  rowWeights: Record<PaneId, number>;
}

export interface Workspace {
  panes: Record<PaneId, Pane>;
  layout: Layout;
  /** Where the keyboard is. */
  focus: PaneId;
  /** The last focused pane whose active tab is a NOTE.
   *
   *  `openPath` derives from THIS, not from `focus`, and the distinction is
   *  load-bearing rather than fussy: it is what lets a book pane hold the
   *  keyboard without `StatusBar` firing `getNote()` at a `.pdf` (which 400s on
   *  every open), without `router.ts` pushing a PDF as a permalink, and without
   *  the palette's note-gated commands going dark the moment you click into a
   *  book. It is also what lets the reader's cite key write into the note
   *  beside you with no dialog: "the note I was last in" is a thing the
   *  workspace already knows. */
  noteFocus: PaneId;
  /** The saved layout this was restored from, or null once it has been changed
   *  structurally. Names the window. */
  layoutName: string | null;
}

export const MAX_COLUMNS = 3;
export const MAX_ROWS = 2;
export const MAX_PANES = 6;

/** Books are the one non-note thing that opens as a tab. */
export function isBookPath(path: string): boolean {
  return /\.pdf$/i.test(path);
}

/** A path that may occupy a tab at all. Anything else — an image, an audio
 *  file — belongs to the attachment viewer, which is a lightbox and not a
 *  workspace surface. */
export function isTabbablePath(path: string): boolean {
  return isNotePath(path) || isBookPath(path);
}

// ── ids ─────────────────────────────────────────────────────────────────────

let paneSeq = 0;

/** Unique within a window, and only ever compared for equality — never parsed,
 *  never ordered, never rendered. Seeded past anything already in a workspace
 *  when one is parsed, so a restored layout cannot collide with a pane minted
 *  afterwards. */
export function mintPaneId(): PaneId {
  paneSeq += 1;
  return `p${paneSeq}`;
}

function seedPaneSeq(ids: Iterable<string>): void {
  for (const id of ids) {
    const n = /^p(\d+)$/.exec(id);
    if (n) paneSeq = Math.max(paneSeq, Number(n[1]));
  }
}

// ── small helpers ───────────────────────────────────────────────────────────

export function paneAt(ws: Workspace, id: PaneId): Pane | null {
  return Object.prototype.hasOwnProperty.call(ws.panes, id) ? ws.panes[id] : null;
}

/** Column-major reading order: every pane of column 0 top to bottom, then
 *  column 1, and so on. The order `Tab`-between-panes walks and the order a
 *  layout is described in. */
export function panesInOrder(ws: Workspace): Pane[] {
  const out: Pane[] = [];
  for (const col of ws.layout.columns) {
    for (const id of col) {
      const pane = paneAt(ws, id);
      if (pane) out.push(pane);
    }
  }
  return out;
}

export function activeTabOf(p: Pane): TabState | null {
  return p.active >= 0 && p.active < p.tabs.length ? p.tabs[p.active] : null;
}

export function surfaceOf(p: Pane): PaneSurface {
  if (p.mode === "graph") return "graph";
  if (p.mode === "library") return "library";
  const tab = activeTabOf(p);
  if (p.follow === null && tab === null) return "empty";
  if (tab !== null && isBookPath(tab.path)) return "book";
  return p.mode === "reading" ? "reading" : "edit";
}

function newPane(id: PaneId, tabs: TabState[], active: number, mode: PaneMode): Pane {
  return { id, tabs, active, mode, follow: null, bookTarget: null };
}

function tab(path: string, pinned = false, ephemeral = false): TabState {
  return { path, pinned, ephemeral };
}

/** Positive, finite, summing to 1. A zero or NaN weight is a column nobody can
 *  see and no drag can recover, so normalization refuses the whole set rather
 *  than repairing it halfway. */
function normalize(weights: number[]): number[] {
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1));
  const total = clean.reduce((a, b) => a + b, 0);
  return clean.map((w) => w / total);
}

function evenWeights(n: number): number[] {
  return new Array(n).fill(1 / n);
}

/** Row weights for every pane, normalized within each column. */
function normalizeRows(columns: PaneId[][], current: Record<PaneId, number>): Record<PaneId, number> {
  const out: Record<PaneId, number> = {};
  for (const col of columns) {
    const raw = col.map((id) => {
      const w = current[id];
      return Number.isFinite(w) && w > 0 ? w : 1;
    });
    const total = raw.reduce((a, b) => a + b, 0);
    col.forEach((id, i) => {
      out[id] = raw[i] / total;
    });
  }
  return out;
}

function columnOf(ws: Workspace, id: PaneId): number {
  return ws.layout.columns.findIndex((col) => col.includes(id));
}

function paneCount(ws: Workspace): number {
  return ws.layout.columns.reduce((n, col) => n + col.length, 0);
}

/** Rebuild the derived halves of a workspace after any structural edit: drop
 *  empty columns, renormalize both weight sets, and make sure `focus` and
 *  `noteFocus` still name panes that exist and are allowed to hold them.
 *
 *  Every reducer ends here rather than each maintaining the invariants itself.
 *  That is deliberate: the bugs in a layout model are almost never in the edit,
 *  they are in the fifth thing the edit invalidated. */
function settle(ws: Workspace): Workspace {
  const columns = ws.layout.columns.map((col) => col.filter((id) => paneAt(ws, id) !== null))
    .filter((col) => col.length > 0);
  const live = new Set(columns.flat());
  const panes: Record<PaneId, Pane> = {};
  for (const id of live) {
    const pane = ws.panes[id];
    // `active` is settled HERE and nowhere else. Every reducer that removes a
    // tab has its own idea of where the selection should land, and a rename
    // that collapses two tabs into one has no idea at all — so rather than ask
    // each of them to clamp, the one function that owns the invariants owns
    // this one too. The property test found it at seed 0: `remapWorkspace`
    // merging a tab onto one the pane already held left `active` pointing past
    // the end of the shortened list.
    const active = pane.tabs.length === 0 ? -1 : Math.min(Math.max(pane.active, 0), pane.tabs.length - 1);
    panes[id] = active === pane.active ? pane : { ...pane, active };
  }

  if (columns.length === 0) {
    // Nothing survived. A workspace always has at least one pane to type into.
    const id = mintPaneId();
    return {
      panes: { [id]: newPane(id, [], -1, "edit") },
      layout: { columns: [[id]], colWeights: [1], rowWeights: { [id]: 1 } },
      focus: id,
      noteFocus: id,
      layoutName: null,
    };
  }

  const colWeights =
    ws.layout.colWeights.length === columns.length
      ? normalize(ws.layout.colWeights)
      : evenWeights(columns.length);

  const order = columns.flat();
  // A follower can never hold the keyboard: it has no tabs, so every command
  // gated on "the open note" would find nothing.
  const focusable = order.filter((id) => panes[id].follow === null);
  const focus = focusable.includes(ws.focus) ? ws.focus : (focusable[0] ?? order[0]);

  // noteFocus keeps its value while it still names a pane showing a note, and
  // otherwise falls back to the nearest pane that does — searching from the
  // focused pane outward in reading order, so "the note beside you" means the
  // one you would point at.
  const holdsNote = (id: PaneId): boolean => {
    const t = activeTabOf(panes[id]);
    return t !== null && !isBookPath(t.path);
  };
  let noteFocus = ws.noteFocus;
  if (!live.has(noteFocus) || !holdsNote(noteFocus)) {
    noteFocus = holdsNote(focus) ? focus : (order.find(holdsNote) ?? focus);
  }

  return {
    panes,
    layout: { columns, colWeights, rowWeights: normalizeRows(columns, ws.layout.rowWeights) },
    focus,
    noteFocus,
    layoutName: ws.layoutName,
  };
}

// ── construction ────────────────────────────────────────────────────────────

export function soloWorkspace(tabs: TabState[], active: string | null): Workspace {
  const id = mintPaneId();
  const at = active === null ? -1 : tabs.findIndex((t) => t.path === active);
  const pane = newPane(id, tabs, at >= 0 ? at : tabs.length > 0 ? 0 : -1, "edit");
  return {
    panes: { [id]: pane },
    layout: { columns: [[id]], colWeights: [1], rowWeights: { [id]: 1 } },
    focus: id,
    noteFocus: id,
    layoutName: null,
  };
}

export function emptyWorkspace(): Workspace {
  return soloWorkspace([], null);
}

// ── panes ───────────────────────────────────────────────────────────────────

/** Split `from`, optionally carrying a tab into the new pane. Returns null when
 *  the cap is reached — the caller says so by name and with the measure,
 *  because a split that silently does nothing reads as a broken keystroke. */
export function splitPane(
  ws: Workspace,
  from: PaneId,
  axis: "inline" | "block",
  carry: TabState | null,
  before = false,
): Workspace | null {
  const col = columnOf(ws, from);
  if (col < 0) return null;
  if (paneCount(ws) >= MAX_PANES) return null;

  const id = mintPaneId();
  const source = ws.panes[from];
  const tabs = carry === null ? [] : [{ ...carry, ephemeral: false }];
  const pane = newPane(id, tabs, tabs.length > 0 ? 0 : -1, source.mode === "graph" ? "edit" : source.mode);

  const columns = ws.layout.columns.map((c) => [...c]);
  let colWeights = [...ws.layout.colWeights];

  // `before` puts the new pane on the START side of `from` (above, or
  // inline-start). It exists for the drop zones: a tab dropped on a pane's
  // leading edge means "split, and land me on THAT side" — an insert that only
  // knew "after" would answer both edges with the same geometry and one of
  // them would feel mirrored.
  if (axis === "inline") {
    if (columns.length >= MAX_COLUMNS) return null;
    columns.splice(before ? col : col + 1, 0, [id]);
    // The new column takes half of the one it split off, so the reader's other
    // columns keep the widths they chose.
    const share = colWeights[col] / 2;
    colWeights[col] = share;
    colWeights.splice(before ? col : col + 1, 0, share);
  } else {
    if (columns[col].length >= MAX_ROWS) return null;
    const at = columns[col].indexOf(from);
    columns[col].splice(before ? at : at + 1, 0, id);
  }

  return settle({
    ...ws,
    panes: { ...ws.panes, [id]: pane },
    layout: { columns, colWeights, rowWeights: { ...ws.layout.rowWeights, [id]: 1 } },
    focus: id,
    layoutName: null,
  });
}

/** Close a pane. Its tabs are ADOPTED by a neighbour rather than dropped —
 *  closing a container must never close the reader's notes, which is the same
 *  rule the tab-close rows follow when they name what they are about to take. */
export function closePane(ws: Workspace, id: PaneId): Workspace {
  const victim = paneAt(ws, id);
  if (victim === null) return ws;
  if (paneCount(ws) <= 1) return ws; // the last pane stays, possibly empty

  const order = panesInOrder(ws).map((p) => p.id);
  const at = order.indexOf(id);
  const heirId = order[at + 1] ?? order[at - 1];
  const panes = { ...ws.panes };
  delete panes[id];

  if (heirId !== undefined && victim.tabs.length > 0 && panes[heirId].follow === null) {
    const heir = panes[heirId];
    const have = new Set(heir.tabs.map((t) => t.path));
    const adopted = victim.tabs.filter((t) => !have.has(t.path));
    panes[heirId] = { ...heir, tabs: [...heir.tabs, ...adopted] };
  }

  const columns = ws.layout.columns.map((col) => col.filter((c) => c !== id));
  const keptCols = ws.layout.columns
    .map((col, i) => (columns[i].length > 0 ? ws.layout.colWeights[i] : null))
    .filter((w): w is number => w !== null);

  return settle({
    ...ws,
    panes,
    layout: { ...ws.layout, columns, colWeights: keptCols },
    focus: heirId ?? ws.focus,
    layoutName: null,
  });
}

export function focusPane(ws: Workspace, id: PaneId): Workspace {
  if (paneAt(ws, id) === null || ws.focus === id) return ws;
  return settle({ ...ws, focus: id });
}

export function setPaneMode(ws: Workspace, id: PaneId, mode: PaneMode): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null || pane.mode === mode) return ws;
  return settle({ ...ws, panes: { ...ws.panes, [id]: { ...pane, mode } } });
}

export function setFollow(ws: Workspace, id: PaneId, follow: "note" | null): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null || pane.follow === follow) return ws;
  // A follower holds no tabs of its own; adopting them out would be a second
  // meaning for "close", so they simply move to the pane it follows.
  const panes = { ...ws.panes, [id]: { ...pane, follow, tabs: follow === null ? pane.tabs : [], active: follow === null ? pane.active : -1 } };
  return settle({ ...ws, panes, layoutName: null });
}

export function setBookTarget(ws: Workspace, id: PaneId, target: BookTarget | null): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null) return ws;
  return { ...ws, panes: { ...ws.panes, [id]: { ...pane, bookTarget: target } } };
}

export function resizeCols(ws: Workspace, gapIndex: number, ratio: number): Workspace {
  const w = [...ws.layout.colWeights];
  if (gapIndex < 0 || gapIndex + 1 >= w.length) return ws;
  const pair = w[gapIndex] + w[gapIndex + 1];
  const clamped = Math.min(0.9, Math.max(0.1, ratio));
  w[gapIndex] = pair * clamped;
  w[gapIndex + 1] = pair * (1 - clamped);
  return { ...ws, layout: { ...ws.layout, colWeights: normalize(w) }, layoutName: null };
}

export function resizeRows(ws: Workspace, col: number, ratio: number): Workspace {
  const column = ws.layout.columns[col];
  if (column === undefined || column.length < 2) return ws;
  const clamped = Math.min(0.9, Math.max(0.1, ratio));
  const rowWeights = { ...ws.layout.rowWeights };
  rowWeights[column[0]] = clamped;
  rowWeights[column[1]] = 1 - clamped;
  return {
    ...ws,
    layout: { ...ws.layout, rowWeights: normalizeRows(ws.layout.columns, rowWeights) },
    layoutName: null,
  };
}

// ── tabs ────────────────────────────────────────────────────────────────────

export interface OpenHow {
  /** A preview tab. Default for palette rows, search hits and single clicks. */
  ephemeral?: boolean;
  /** Force a new tab even over a standing ephemeral one. */
  newTab?: boolean;
  heading?: string | null;
  book?: BookTarget;
}

function withTabs(ws: Workspace, id: PaneId, tabs: TabState[], active: number): Workspace {
  const pane = ws.panes[id];
  const at = tabs.length === 0 ? -1 : Math.min(Math.max(active, 0), tabs.length - 1);
  return settle({ ...ws, panes: { ...ws.panes, [id]: { ...pane, tabs, active: at } } });
}

export function openInPane(ws: Workspace, id: PaneId, path: string, how: OpenHow = {}): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null || pane.follow !== null) return ws;

  // A citation into a book rides the open itself: `how.book` lands on the
  // pane's one-shot `bookTarget`, whether the book is newly opened or already
  // sitting in a tab — a citation into an open book must still jump.
  const aim = (w: Workspace): Workspace =>
    how.book === undefined ? w : setBookTarget(w, id, how.book);

  const at = pane.tabs.findIndex((t) => t.path === path);
  if (at >= 0) {
    // Already here. Re-opening a tab COMMITS it: a second visit is intent, and
    // an ephemeral tab that survives being returned to would be replaced out
    // from under the reader by the next search result.
    const tabs = pane.tabs.map((t, i) => (i === at ? { ...t, ephemeral: false } : t));
    return aim(focusPane(withTabs(ws, id, tabs, at), id));
  }

  const ephemeral = how.ephemeral === true && how.newTab !== true;
  const tabs = [...pane.tabs];
  let index: number;
  const standing = ephemeral ? tabs.findIndex((t) => t.ephemeral && !t.pinned) : -1;
  if (standing >= 0) {
    // The preview slot: one per pane, reused rather than accumulated.
    tabs[standing] = tab(path, false, true);
    index = standing;
  } else {
    index = pane.active >= 0 ? pane.active + 1 : tabs.length;
    tabs.splice(index, 0, tab(path, false, ephemeral));
  }
  return aim(focusPane(withTabs(ws, id, tabs, index), id));
}

/** Promote the pane's ephemeral tab for `path` to a real one. Called when the
 *  reader types in it, double-clicks it, or pins it — anything that says they
 *  meant to keep it. */
export function commitTab(ws: Workspace, id: PaneId, path: string): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null) return ws;
  if (!pane.tabs.some((t) => t.path === path && t.ephemeral)) return ws;
  const tabs = pane.tabs.map((t) => (t.path === path ? { ...t, ephemeral: false } : t));
  return withTabs(ws, id, tabs, pane.active);
}

/** Walk `delta` tabs along the strip, wrapping at both ends (v1.8 audit, F12:
 *  the tab bar was reachable only by pointer — every other pane operation had a
 *  chord and the tabs inside them had none).
 *
 *  It does NOT commit an ephemeral tab, unlike opening one: cycling past a
 *  preview tab is a glance, not the second visit that says "keep this". */
export function stepTab(ws: Workspace, id: PaneId, delta: number): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null || pane.active < 0 || pane.tabs.length < 2) return ws;
  const n = pane.tabs.length;
  const at = (((pane.active + delta) % n) + n) % n;
  return withTabs(ws, id, pane.tabs, at);
}

function dropTabs(ws: Workspace, id: PaneId, doomed: (t: TabState, i: number) => boolean): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null) return ws;
  const active = activeTabOf(pane);
  // A PINNED TAB IS A PROMISE, and it is the same promise in every row: pin
  // means "not this one", so no bulk close takes one. Without that rule "close
  // others" and "close all" would each need their own answer, and a reader
  // would have to remember which.
  const tabs = pane.tabs.filter((t, i) => t.pinned || !doomed(t, i));
  // A split pane whose last tab leaves closes with it (the owner: "deleting
  // the tab from the split window keeps the window even though it would have
  // no tabs left"). An empty pane is a thing you ASK for (a bare split); it is
  // not a thing a close should leave behind. closePane refuses on the last
  // pane, so the solo empty state survives exactly as before. Emptied FIRST:
  // closePane adopts a closing pane's tabs into a neighbour, and adopting the
  // very tab being closed would turn every last-tab close into a move.
  if (tabs.length === 0) return closePane(withTabs(ws, id, tabs, -1), id);
  const keptActive = active !== null ? tabs.findIndex((t) => t.path === active.path) : -1;
  return withTabs(ws, id, tabs, keptActive >= 0 ? keptActive : Math.min(pane.active, tabs.length - 1));
}

export function closeTabIn(ws: Workspace, id: PaneId, path: string): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null) return ws;
  const at = pane.tabs.findIndex((t) => t.path === path);
  if (at < 0) return ws;
  const tabs = pane.tabs.filter((_, i) => i !== at);
  // The same collapse dropTabs makes: a split pane whose LAST tab closes goes
  // with it (emptied first — closePane adopts a closing pane's tabs, and
  // adopting the tab being closed would turn the close into a move).
  if (tabs.length === 0) return closePane(withTabs(ws, id, tabs, -1), id);
  // Closing the active tab lands on its neighbour, preferring the one after it
  // — the direction the reader was travelling.
  const active = pane.active > at ? pane.active - 1 : Math.min(pane.active, tabs.length - 1);
  return withTabs(ws, id, tabs, active);
}

export function closeOthersIn(ws: Workspace, id: PaneId, keep: string): Workspace {
  return dropTabs(ws, id, (t) => t.path !== keep);
}

export function closeAfterIn(ws: Workspace, id: PaneId, from: string): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null) return ws;
  const at = pane.tabs.findIndex((t) => t.path === from);
  if (at < 0) return ws;
  return dropTabs(ws, id, (_t, i) => i > at);
}

export function closeAllIn(ws: Workspace, id: PaneId): Workspace {
  return dropTabs(ws, id, () => true);
}

/** Every note in this WINDOW — the row the owner asked for by name. Panes and
 *  layout survive; only their tabs go. */
export function closeAllPanes(ws: Workspace): Workspace {
  let out = ws;
  for (const pane of panesInOrder(ws)) out = closeAllIn(out, pane.id);
  return out;
}

export function setPinned(ws: Workspace, id: PaneId, path: string, pinned: boolean): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null) return ws;
  const active = activeTabOf(pane);
  // Pinned tabs sort to the head, so the row a reader pinned does not drift
  // away under a pile of preview tabs. Pinning also commits — the two states
  // are opposite promises about the same tab.
  const next = pane.tabs.map((t) => (t.path === path ? { ...t, pinned, ephemeral: pinned ? false : t.ephemeral } : t));
  const tabs = [...next.filter((t) => t.pinned), ...next.filter((t) => !t.pinned)];
  const at = active !== null ? tabs.findIndex((t) => t.path === active.path) : -1;
  return withTabs(ws, id, tabs, at >= 0 ? at : pane.active);
}

export function reorderTab(ws: Workspace, id: PaneId, path: string, to: number): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null) return ws;
  const from = pane.tabs.findIndex((t) => t.path === path);
  if (from < 0) return ws;
  const active = activeTabOf(pane);
  const tabs = [...pane.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(Math.min(Math.max(to, 0), tabs.length), 0, moved);
  const at = active !== null ? tabs.findIndex((t) => t.path === active.path) : -1;
  return withTabs(ws, id, tabs, at >= 0 ? at : pane.active);
}

/** Drag a tab from one pane to another. Moving a tab onto a pane that already
 *  has it just focuses it there — two tabs on one note in one pane is a state
 *  with no way back. */
export function moveTab(ws: Workspace, from: PaneId, path: string, to: PaneId, index: number): Workspace {
  const src = paneAt(ws, from);
  const dst = paneAt(ws, to);
  if (src === null || dst === null || dst.follow !== null) return ws;
  const at = src.tabs.findIndex((t) => t.path === path);
  if (at < 0) return ws;
  if (from === to) return reorderTab(ws, from, path, index);

  const moved = src.tabs[at];
  let out = closeTabIn(ws, from, path);
  const target = paneAt(out, to);
  if (target === null) return ws;
  const have = target.tabs.findIndex((t) => t.path === path);
  if (have >= 0) return focusPane(withTabs(out, to, target.tabs, have), to);
  const tabs = [...target.tabs];
  const put = Math.min(Math.max(index, 0), tabs.length);
  tabs.splice(put, 0, { ...moved, ephemeral: false });
  return focusPane(withTabs(out, to, tabs, put), to);
}

/** Which side of a pane a dragged tab was dropped on. Logical, never "left":
 *  the zones are laid out with logical insets, so the same edge name means the
 *  same reading-order side in both directions. */
export type DropEdge = "start-inline" | "end-inline" | "start-block" | "end-block";

/** The drag-a-tab-to-an-edge gesture, whole: take `path` out of `from`, split
 *  `to` on `edge`, land the tab in the new pane. One reducer rather than a
 *  sequence in the store, because the halves are not independently meaningful
 *  — a close whose split then hits the pane cap must refuse ENTIRELY (the tab
 *  stays where it was; a gesture that half-applies eats a tab) — and because
 *  living here puts it under the property tests with everything else. */
export function dropTabSplit(
  ws: Workspace,
  from: PaneId | null,
  path: string,
  to: PaneId,
  edge: DropEdge,
): Workspace {
  const dst = paneAt(ws, to);
  if (dst === null || dst.follow !== null) return ws;
  // `from === null` is a drag that never lived in a pane — a note or a book
  // lifted straight off the TREE — so there is nothing to remove; the tab is
  // born in the new pane.
  let moved: TabState = tab(path);
  let emptied = ws;
  if (from !== null) {
    const src = paneAt(ws, from);
    if (src === null) return ws;
    const held = src.tabs.find((t) => t.path === path);
    if (held === undefined) return ws;
    // Dragging a pane's only tab onto that pane's own edge would close the
    // pane and remake it one slot over — a no-op wearing a layout change.
    if (from === to && src.tabs.length === 1) return ws;
    moved = held;
    // closeTabIn folds a pane its last tab leaves, so no manual sweep here.
    emptied = closeTabIn(ws, from, path);
  }
  const split = splitPane(
    emptied,
    to,
    edge === "start-inline" || edge === "end-inline" ? "inline" : "block",
    { ...moved },
    edge === "start-inline" || edge === "start-block",
  );
  return split ?? ws; // at a cap: the whole gesture refuses
}

// ── queries the rest of the shell asks ──────────────────────────────────────

/** Every distinct path open anywhere in this workspace. The buffer registry's
 *  refcount source: a document may be released exactly when this stops naming
 *  it. */
export function allPaths(ws: Workspace): string[] {
  const seen = new Set<string>();
  for (const pane of panesInOrder(ws)) for (const t of pane.tabs) seen.add(t.path);
  return [...seen];
}

/** How many panes hold `path`. Two panes on one note is one document typed
 *  into twice, so this is a refcount and never a boolean. */
export function holdersOf(ws: Workspace, path: string): number {
  let n = 0;
  for (const pane of panesInOrder(ws)) if (pane.tabs.some((t) => t.path === path)) n += 1;
  return n;
}

/** A rename arrived: every tab on the old path now names the new one.
 *
 *  PREFIX-AWARE, because a FOLDER rename is the same event one level up — the
 *  shell's own `remap()` has always worked this way, and a workspace that only
 *  understood exact paths would leave every tab under a renamed folder pointing
 *  at a file that no longer exists. */
export function remapWorkspace(ws: Workspace, from: string, to: string): Workspace {
  const move = (p: string): string =>
    p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p;
  let touched = false;
  const panes: Record<PaneId, Pane> = {};
  for (const [id, pane] of Object.entries(ws.panes)) {
    if (!pane.tabs.some((t) => move(t.path) !== t.path)) {
      panes[id] = pane;
      continue;
    }
    touched = true;
    // The pane may already hold `to` — a rename onto an open note. Collapse
    // rather than leaving two tabs that are now the same file.
    const seen = new Set<string>();
    const tabs: TabState[] = [];
    for (const t of pane.tabs) {
      const path = move(t.path);
      if (seen.has(path)) continue;
      seen.add(path);
      tabs.push(path === t.path ? t : { ...t, path });
    }
    const active = pane.tabs[pane.active]?.path;
    const want = active === undefined ? undefined : move(active);
    panes[id] = { ...pane, tabs, active: want === undefined ? -1 : Math.max(0, tabs.findIndex((t) => t.path === want)) };
  }
  return touched ? settle({ ...ws, panes }) : ws;
}

/** Drop tabs whose note is no longer visible to this session — a sign-out, a
 *  preview-as-visitor, a language filter that just hid half the vault. */
export function pruneWorkspace(ws: Workspace, visible: Set<string>): Workspace {
  let out = ws;
  for (const pane of panesInOrder(ws)) {
    out = dropTabsUnconditional(out, pane.id, (t) => !visible.has(t.path));
  }
  return out;
}

/** A folder went away: everything under it closes. */
export function closePathsUnder(ws: Workspace, prefix: string): Workspace {
  const dir = prefix.endsWith("/") ? prefix : `${prefix}/`;
  let out = ws;
  for (const pane of panesInOrder(ws)) {
    out = dropTabsUnconditional(out, pane.id, (t) => t.path === prefix || t.path.startsWith(dir));
  }
  return out;
}

/** The one closer that IGNORES pins, because these are not the reader choosing
 *  to close anything — the file is gone, or is no longer theirs to see. A pin
 *  is a promise about the reader's intent, not about the vault's contents. */
function dropTabsUnconditional(
  ws: Workspace,
  id: PaneId,
  doomed: (t: TabState) => boolean,
): Workspace {
  const pane = paneAt(ws, id);
  if (pane === null) return ws;
  const active = activeTabOf(pane);
  const tabs = pane.tabs.filter((t) => !doomed(t));
  if (tabs.length === pane.tabs.length) return ws;
  // Same collapse as dropTabs: a pane emptied by the vault changing underneath
  // (a delete, a rename, a visitor's pruning) folds rather than sitting as a
  // grey box the reader never asked to keep. Emptied first — closePane adopts.
  if (tabs.length === 0) return closePane(withTabs(ws, id, tabs, -1), id);
  const at = active !== null ? tabs.findIndex((t) => t.path === active.path) : -1;
  return withTabs(ws, id, tabs, at >= 0 ? at : Math.min(pane.active, tabs.length - 1));
}

/** Pane focus is GEOMETRIC, resolved from live rects, so "left" is the reader's
 *  left in Arabic exactly as in English.
 *
 *  This is a deliberate exception to the logical arrow swap in `Tabs.tsx`, and
 *  the two are not in conflict: a tab bar is a one-dimensional list where
 *  "next" is a fact about reading order, and a pane grid is two-dimensional
 *  where "left" is a fact about the screen. A reader pressing ← at a grid is
 *  pointing, not reading. `scripts/check-panes.mjs` presses it in `dir=rtl` to
 *  prove it, because this is exactly the kind of rule a later refactor
 *  "corrects". */
export function paneInDirection(
  rects: Record<PaneId, DOMRect>,
  from: PaneId,
  dir: "left" | "right" | "up" | "down",
): PaneId | null {
  const here = rects[from];
  if (here === undefined) return null;
  const cx = here.left + here.width / 2;
  const cy = here.top + here.height / 2;
  let best: PaneId | null = null;
  let bestScore = Infinity;
  for (const [id, r] of Object.entries(rects)) {
    if (id === from) continue;
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    if (along <= 1) continue; // not in that direction at all
    // Distance along the axis, plus the drift across it — so the pane straight
    // across wins over one that is nearer but diagonal.
    const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

// ── serialization ───────────────────────────────────────────────────────────

export interface StoredWorkspace {
  v: 2;
  workspace: Workspace;
}

export function serializeWorkspace(ws: Workspace): StoredWorkspace {
  return { v: 2, workspace: ws };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseTab(raw: unknown): TabState | null {
  if (!isRecord(raw)) return null;
  const path = raw.path;
  if (typeof path !== "string" || path === "" || !isTabbablePath(path)) return null;
  const pinned = raw.pinned === true;
  return { path, pinned, ephemeral: pinned ? false : raw.ephemeral === true };
}

const MODES: readonly PaneMode[] = ["edit", "reading", "graph", "library"];

function parsePane(raw: unknown): Pane | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  if (typeof id !== "string" || id === "") return null;
  const follow = raw.follow === "note" ? "note" : null;
  const seen = new Set<string>();
  const tabs: TabState[] = [];
  if (follow === null && Array.isArray(raw.tabs)) {
    for (const t of raw.tabs) {
      const parsed = parseTab(t);
      if (parsed === null || seen.has(parsed.path)) continue;
      seen.add(parsed.path);
      tabs.push(parsed);
    }
  }
  const mode = MODES.includes(raw.mode as PaneMode) ? (raw.mode as PaneMode) : "edit";
  const rawActive = typeof raw.active === "number" ? Math.trunc(raw.active) : 0;
  const active = tabs.length === 0 ? -1 : Math.min(Math.max(rawActive, 0), tabs.length - 1);
  return { id, tabs, active, mode, follow, bookTarget: null };
}

/** TOTAL: never throws, and returns null only when there is nothing to
 *  recover. Anything structurally damaged collapses to a solo workspace holding
 *  whatever paths were readable — **a corrupt layout must never cost the reader
 *  their open notes.** That rule is why this function reads rather than
 *  validates: it takes what it understands and discards the rest. */
export function parseWorkspace(raw: unknown): Workspace | null {
  if (!isRecord(raw) || raw.v !== 2 || !isRecord(raw.workspace)) return null;
  const w = raw.workspace;

  const panes: Record<PaneId, Pane> = {};
  if (isRecord(w.panes)) {
    for (const value of Object.values(w.panes)) {
      const pane = parsePane(value);
      if (pane !== null) panes[pane.id] = pane;
    }
  }
  const recovered = (): Workspace | null => {
    const tabs = Object.values(panes).flatMap((p) => p.tabs);
    const seen = new Set<string>();
    const unique = tabs.filter((t) => (seen.has(t.path) ? false : (seen.add(t.path), true)));
    return unique.length > 0 ? soloWorkspace(unique, unique[0].path) : null;
  };
  if (Object.keys(panes).length === 0) return null;
  seedPaneSeq(Object.keys(panes));

  if (!Array.isArray(w.layout ? (w.layout as Record<string, unknown>).columns : null)) {
    return recovered();
  }
  const layoutRaw = w.layout as Record<string, unknown>;
  const placed = new Set<PaneId>();
  const columns: PaneId[][] = [];
  for (const col of layoutRaw.columns as unknown[]) {
    if (!Array.isArray(col)) continue;
    const ids: PaneId[] = [];
    for (const id of col) {
      // Each pane appears exactly ONCE. A duplicate id is the damage that would
      // otherwise render one pane twice and make every close ambiguous.
      if (typeof id !== "string" || !panes[id] || placed.has(id)) continue;
      placed.add(id);
      ids.push(id);
      if (ids.length >= MAX_ROWS) break;
    }
    if (ids.length > 0) columns.push(ids);
    if (columns.length >= MAX_COLUMNS) break;
  }
  if (columns.length === 0) return recovered();

  // A pane the layout never placed is unreachable; its tabs are not.
  const orphans = Object.values(panes).filter((p) => !placed.has(p.id));
  if (orphans.length > 0) {
    const first = columns[0][0];
    const have = new Set(panes[first].tabs.map((t) => t.path));
    const adopted = orphans.flatMap((p) => p.tabs).filter((t) => !have.has(t.path) && (have.add(t.path), true));
    panes[first] = { ...panes[first], tabs: [...panes[first].tabs, ...adopted] };
    if (panes[first].active < 0 && panes[first].tabs.length > 0) panes[first] = { ...panes[first], active: 0 };
    for (const p of orphans) delete panes[p.id];
  }

  const colWeights = Array.isArray(layoutRaw.colWeights)
    ? (layoutRaw.colWeights as unknown[]).filter((n): n is number => typeof n === "number")
    : [];
  const rowWeights: Record<PaneId, number> = {};
  if (isRecord(layoutRaw.rowWeights)) {
    for (const [id, n] of Object.entries(layoutRaw.rowWeights)) {
      if (typeof n === "number" && Number.isFinite(n) && n > 0) rowWeights[id] = n;
    }
  }

  const flat = columns.flat();
  const focus = typeof w.focus === "string" && flat.includes(w.focus) ? w.focus : flat[0];
  const noteFocus = typeof w.noteFocus === "string" && flat.includes(w.noteFocus) ? w.noteFocus : focus;

  return settle({
    panes,
    layout: {
      columns,
      colWeights: colWeights.length === columns.length ? colWeights : evenWeights(columns.length),
      rowWeights,
    },
    focus,
    noteFocus,
    layoutName: typeof w.layoutName === "string" ? w.layoutName : null,
  });
}

/** Migration from `vellum.tabs` — `{ tabs: string[]; open: string | null }`,
 *  the shape every existing instance has in localStorage. Nobody's open notes
 *  are lost to the upgrade, which is the only thing this has to get right. */
export function fromStoredTabs(v: { tabs: string[]; open: string | null }): Workspace {
  const seen = new Set<string>();
  const tabs: TabState[] = [];
  for (const path of Array.isArray(v.tabs) ? v.tabs : []) {
    if (typeof path !== "string" || seen.has(path) || !isTabbablePath(path)) continue;
    seen.add(path);
    tabs.push(tab(path));
  }
  const open = typeof v.open === "string" && seen.has(v.open) ? v.open : (tabs[0]?.path ?? null);
  return soloWorkspace(tabs, open);
}
