// THE TOUR'S DOOR, and the only part of it anybody pays for.
//
// WHY IT EXISTS. A real reader used this product for months without ever
// discovering that it has a site designer. Not because the designer is hidden
// — it has three doors — but because every one of them is a door you have to
// already know the name of: a glyph in the status bar, a row in Settings, and
// a command palette you have to think to search. Depth that can only be
// reached by searching for it is depth nobody meets.
//
// THE RULE THIS FILE ENFORCES: the tour is only ever ENTERED, never SHOWN.
// There is no autoplay, no first-run modal, no toast, no interstitial. Four
// doors and one quiet mark, and every one of them waits to be pressed. The
// mark is the whole of the nudge: the empty state's line wears a small gold
// dot until the tour has been opened once, and then it never appears again.
//
// WHY THE DOOR IS A MODULE OF ITS OWN, and not a re-export of the deck. The
// deck is fifteen folios, fifteen drawings and two languages of prose; its
// four call sites (the palette, the empty state, the shortcut sheet, and the
// deck's own re-entry) are all in surfaces the shell mounts on first paint. A
// static `import { openTour } from "./components/Tour.tsx"` in any one of them
// is an edge rollup has to honour, and the whole deck would land in the entry
// chunk in order to draw a line of text that might open it. Same argument,
// same shape, as client/components/design/openDesigner.ts.

const SEEN_KEY = "vellum.tour-seen";

/** Read once. A private window throws on the accessor, and "we have never
 *  shown the mark" is the safe answer there: a nudge that reappears on every
 *  load is the invasive thing this feature promised not to be. */
function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

let seen = readSeen();
const listeners = new Set<() => void>();

/** Has this browser opened the tour? The empty state's mark asks. */
export function tourSeen(): boolean {
  return seen;
}

/** Subscribe to the flag flipping (React's `useSyncExternalStore` contract).
 *  The mark has to go out on the same click that opens the deck, and the deck
 *  arrives a chunk-fetch later. */
export function subscribeTourSeen(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Open the tour, loading it on demand.
 *
 * Fire-and-forget, so the call sites stay plain event handlers. A failed chunk
 * fetch (offline, a deploy mid-session) is logged rather than thrown into an
 * event handler nobody is awaiting — the deck simply does not open, which is
 * what a failed click already looked like.
 *
 * The seen-flag is written HERE, before the import, and not inside the deck:
 * the reader has asked for the tour, which is the whole fact the mark exists
 * to record, and whether the chunk then arrives is not their business.
 */
export function openTour(): void {
  if (!seen) {
    seen = true;
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // storage unavailable — the mark still goes out for this session
    }
    for (const fn of [...listeners]) fn();
  }
  void import("./components/Tour.tsx")
    .then((mod) => mod.openTour())
    .catch((err: unknown) => {
      console.error("vellum: loading the tour failed", err);
    });
}
