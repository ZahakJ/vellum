// Who this window is.
//
// Not a user identity — a WINDOW identity, and it has to survive a reload of
// this tab while being different from every other tab on the same vault. That
// is exactly what `sessionStorage` is: per-tab, and kept across a refresh.
// `localStorage` would give every tab the same id (it is per ORIGIN), and a
// module-level constant would mint a new one on every reload, so a window that
// refreshed would look like a stranger to its own peers and its write lease
// would be held by a ghost until the heartbeat timed out.

const ID_KEY = "vellum.windowId";
const BORN_KEY = "vellum.windowBorn";

function readOrMint(key: string, mint: () => string): string {
  try {
    const found = sessionStorage.getItem(key);
    if (found !== null && found !== "") return found;
    const made = mint();
    sessionStorage.setItem(key, made);
    return made;
  } catch {
    // Private mode, or storage disabled. A per-load id is worse than a stable
    // one and much better than none: the bus still works, and a reload simply
    // looks like a new window — which, without storage, it genuinely is.
    return mint();
  }
}

function mintId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** This window's id, stable across reloads of this tab. */
export const windowId: string = readOrMint(ID_KEY, mintId);

/** When this window first opened. The lease's tie-break: the OLDEST claim
 *  wins, so the window a reader has had open longest keeps the pen, and a
 *  window that reloads does not steal it back from whoever took over. */
export const windowBornAt: number = Number(
  readOrMint(BORN_KEY, () => String(Date.now())),
);

/** Deterministic ordering between two windows, identically computed on both
 *  sides so neither has to be told the answer. Older first; on a tie — two
 *  windows opened in the same millisecond, which happens when a pop-out is
 *  scripted — the smaller id, which is arbitrary and, crucially, agreed. */
export function winsAgainst(
  a: { at: number; id: string },
  b: { at: number; id: string },
): boolean {
  if (a.at !== b.at) return a.at < b.at;
  return a.id < b.id;
}
