// What the desktop app remembers between launches, and the one rule that makes
// it worth remembering at all.
//
// ── WHY THE PORT IS PERSISTED, AND NEVER EPHEMERAL ──────────────────────────
//
// Every device preference in Vellum is `localStorage`: `vellum.theme`,
// `vellum.workspace`, `vellum.tabs`, `vellum.vim`, `vellum.reading`,
// `vellum.sidebarSide`, the fold state, the pane sizes. `localStorage` is keyed
// by ORIGIN, and this app's origin is `http://127.0.0.1:<port>` — the port IS
// the identity of the reader's settings.
//
// So a desktop app that asks the OS for a free port on each launch is a desktop
// app that hands the reader a brand-new browser profile every morning: theme
// back to default, tabs gone, folds gone, sidebar back on the other side. There
// is nowhere in the product that could explain that, because from the inside
// nothing went wrong — a different origin genuinely has no settings. It is the
// single worst bug available to this stage, it is silent, and it is one line of
// convenience away at all times.
//
// Hence: a port per vault, chosen once, written down, and reused. The choice is
// SEEDED from the vault path rather than counted upward, so a reader who
// reinstalls (or syncs their vault to a second machine) lands on the same port
// and keeps their layout without the preferences file having survived. When the
// remembered port is taken, we say so out loud rather than silently drifting —
// see `pickPort` below and the dialog in main.ts.
//
// Pure and electron-free: `tests/desktop.test.ts` drives this file directly,
// and the root `npm run typecheck` follows it in from there.

/** Where the desktop app's ports live. NOT 6801: that is the web deployment's
 *  default, and the reader running `npm start` in a terminal beside this app is
 *  the normal case, not a conflict to arbitrate. */
export const PORT_MIN = 6820;
export const PORT_MAX = 6899;

/** How many vaults the File ▸ Recent menu offers. */
export const MAX_RECENTS = 10;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface VaultPref {
  /** Absolute vault root, as the reader chose it. */
  path: string;
  /** The origin's port — see the note at the top of this file. */
  port: number;
  /** Last window geometry for this vault, or null while it has none. */
  bounds: Bounds | null;
  /** Epoch ms of the last open, for the recent list's order. */
  lastOpened: number;
}

export interface Prefs {
  vaults: VaultPref[];
  /** Whether the spellchecker is on. A device preference, like the rest. */
  spellcheck: boolean;
}

export const EMPTY_PREFS: Prefs = { vaults: [], spellcheck: true };

const MIN_WINDOW = 480;
/** Larger than any display anyone has, small enough that a corrupt number
 *  cannot ask the compositor for a 2-billion-pixel surface. */
const MAX_WINDOW = 20000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function saneBounds(value: unknown): Bounds | null {
  if (!isRecord(value)) return null;
  const nums = ["x", "y", "width", "height"].map((k) => value[k]);
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [x, y, width, height] = nums as number[];
  if (width < MIN_WINDOW || height < MIN_WINDOW) return null;
  if (width > MAX_WINDOW || height > MAX_WINDOW) return null;
  // x/y may legitimately be negative (a display to the left of the primary
  // one), so they are bounded rather than floored. Whether the rectangle is on
  // a display that still EXISTS is a question only `screen` can answer, and it
  // is asked in windows.ts — this file stays pure.
  if (Math.abs(x) > MAX_WINDOW || Math.abs(y) > MAX_WINDOW) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), maximized: value.maximized === true };
}

/** Read a preferences document that may be anything at all — hand-edited,
 *  truncated by a power cut, written by a future version. Every field is
 *  validated field-by-field and a bad one is DROPPED rather than failing the
 *  load: losing one vault's window position is a shrug, and refusing to start
 *  because a number went missing is not. */
export function parsePrefs(raw: unknown): Prefs {
  if (!isRecord(raw)) return { ...EMPTY_PREFS };
  const seen = new Set<string>();
  const vaults: VaultPref[] = [];
  const list = Array.isArray(raw.vaults) ? raw.vaults : [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const vaultPath = typeof entry.path === "string" ? entry.path : "";
    if (!vaultPath || seen.has(vaultPath)) continue;
    const port = typeof entry.port === "number" && Number.isInteger(entry.port) ? entry.port : 0;
    seen.add(vaultPath);
    vaults.push({
      path: vaultPath,
      // A port outside the desktop's range is not honored: it is either a
      // preferences file from a different scheme or a hand edit aiming at 80.
      port: port >= PORT_MIN && port <= PORT_MAX ? port : 0,
      bounds: saneBounds(entry.bounds),
      lastOpened: typeof entry.lastOpened === "number" && Number.isFinite(entry.lastOpened) ? entry.lastOpened : 0,
    });
  }
  vaults.sort((a, b) => b.lastOpened - a.lastOpened);
  return { vaults, spellcheck: raw.spellcheck !== false };
}

/** FNV-1a over the vault path. Not a security hash — a spreader. It exists so
 *  the FIRST port a vault is offered is a function of the vault rather than of
 *  how many vaults happened to be opened before it, which is what lets a
 *  reinstall (or the same vault on a second machine) land on the same origin
 *  and keep its stored layout. */
export function seedFor(vaultPath: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < vaultPath.length; i++) {
    hash ^= vaultPath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The order this vault's port is looked for in: the one it had (if it had one)
 * first, then a linear probe from its seed, skipping ports this preferences
 * file has already given to OTHER vaults.
 *
 * A list rather than a choice, and sync rather than async, because the part
 * worth testing is the SEARCH — "does a remembered port come first", "is
 * another vault's port skipped", "does the probe wrap and cover the whole
 * range" — and none of those questions needs a socket. Binding is the caller's
 * job (electron/server.ts), which walks this list and takes the first port that
 * answers.
 *
 * The list always covers the whole band, so it is empty only if the band is.
 */
export function portCandidates(vaultPath: string, prefs: Prefs): number[] {
  const remembered = prefs.vaults.find((v) => v.path === vaultPath)?.port ?? 0;
  const taken = new Set(
    prefs.vaults.filter((v) => v.path !== vaultPath && v.port !== 0).map((v) => v.port),
  );
  const out: number[] = [];
  if (remembered !== 0) out.push(remembered);
  const span = PORT_MAX - PORT_MIN + 1;
  const start = seedFor(vaultPath) % span;
  for (let i = 0; i < span; i++) {
    const port = PORT_MIN + ((start + i) % span);
    if (port === remembered || taken.has(port)) continue;
    out.push(port);
  }
  return out;
}

/** The port a vault WANTS — what it had last time, or 0 for a vault that has
 *  never been opened. The caller compares this against the port it actually
 *  bound: a difference is the moment this vault's theme, tabs and folds stop
 *  being findable, and the reader is told rather than left to discover it. */
export function rememberedPort(vaultPath: string, prefs: Prefs): number {
  return prefs.vaults.find((v) => v.path === vaultPath)?.port ?? 0;
}

/** Record an open: the vault moves to the head of the recent list, keeps its
 *  port and bounds, and the list is trimmed. Returns a NEW Prefs — the store
 *  writes whole documents, so nothing here mutates what a caller still holds. */
export function rememberVault(prefs: Prefs, vaultPath: string, port: number, now: number): Prefs {
  const existing = prefs.vaults.find((v) => v.path === vaultPath);
  const updated: VaultPref = {
    path: vaultPath,
    port,
    bounds: existing?.bounds ?? null,
    lastOpened: now,
  };
  const rest = prefs.vaults.filter((v) => v.path !== vaultPath);
  return { ...prefs, vaults: [updated, ...rest].slice(0, MAX_RECENTS) };
}

/** Record a window's geometry against its vault. A vault we have never opened
 *  is not invented here: geometry without an open is a write from a stale
 *  window, and inventing the row would resurrect a vault the reader removed. */
export function rememberBounds(prefs: Prefs, vaultPath: string, bounds: Bounds): Prefs {
  const clean = saneBounds(bounds);
  if (!clean) return prefs;
  let touched = false;
  const vaults = prefs.vaults.map((v) => {
    if (v.path !== vaultPath) return v;
    touched = true;
    return { ...v, bounds: clean };
  });
  return touched ? { ...prefs, vaults } : prefs;
}

/** Drop a vault from the recent list (its port and geometry go with it). */
export function forgetVault(prefs: Prefs, vaultPath: string): Prefs {
  return { ...prefs, vaults: prefs.vaults.filter((v) => v.path !== vaultPath) };
}

/** Most recent first — the order the File ▸ Recent menu is drawn in. */
export function recentVaults(prefs: Prefs): VaultPref[] {
  return [...prefs.vaults].sort((a, b) => b.lastOpened - a.lastOpened);
}

/** Is this rectangle still on a display that exists?
 *
 *  A remembered position is a promise about a monitor, and monitors are
 *  unplugged. Restoring a window to a second screen that is no longer there
 *  puts it at coordinates the compositor will happily accept and the reader
 *  cannot see — an app that "does not start" while it is in fact running,
 *  fully, off the side of the desk. Intersection rather than containment: a
 *  window half off the edge is a window the reader can grab. */
export function onSomeDisplay(bounds: Bounds, displays: { bounds: { x: number; y: number; width: number; height: number } }[]): boolean {
  const NEED = 80; // enough of a title bar to grab
  return displays.some((display) => {
    const d = display.bounds;
    const overlapX = Math.min(bounds.x + bounds.width, d.x + d.width) - Math.max(bounds.x, d.x);
    const overlapY = Math.min(bounds.y + bounds.height, d.y + d.height) - Math.max(bounds.y, d.y);
    return overlapX >= NEED && overlapY >= NEED;
  });
}
