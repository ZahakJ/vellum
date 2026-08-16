// WHAT THE READER'S OWN KEYBOARD TYPES, so the Ctrl/Cmd+/ sheet can stop
// printing a letter that is nowhere on their keycaps.
//
// The sheet says "Ctrl/Cmd + P". On an Arabic keyboard that key types ح; on a
// Russian one, з. The BINDING is right — client/keys.ts resolves a
// control-modified shortcut through the physical key when the layout produces
// no Latin letter — but a legend that names a letter the reader cannot type is
// still asking them to take it on faith. Where the browser will tell us, the
// sheet now prints both: the position (P) and what that position produces (ح).
//
// `navigator.keyboard.getLayoutMap()` is the source, and it is Chromium-only
// and secure-context-only. Everywhere else this resolves to an empty map, the
// sheet renders exactly as it did, and nothing has been claimed that is not
// known — which is the whole bar for a legend.
//
// LETTERS ONLY, deliberately. The layout map reports the UNSHIFTED character
// of each key, and a punctuation binding may live behind Shift: the Russian
// layout has no slash on the slash key at all (it types "."; the slash is
// Shift+Backslash, and `e.key` delivers it, so Ctrl+/ works there through the
// LAYOUT, not the position). Annotating "/" from the unshifted map would print
// "." beside it and be precisely the lie this is meant to remove.

type LayoutHints = ReadonlyMap<string, string>;

const EMPTY: LayoutHints = new Map();

let hints: LayoutHints | null = null;
let pending: Promise<LayoutHints> | null = null;

interface KeyboardLayoutAPI {
  getLayoutMap?: () => Promise<Map<string, string>>;
}

/** What this layout produces on the physical keys the shortcuts name, keyed by
 *  the Latin letter the sheet prints — and populated ONLY for letters this
 *  layout cannot type at all. A Dvorak or AZERTY reader gets an empty map on
 *  purpose: their `b` key is labelled B, they press it, and bold happens. */
export function layoutHints(): LayoutHints {
  return hints ?? EMPTY;
}

/** Read the layout once. Safe to call repeatedly; resolves to the same map. */
export function loadLayoutHints(): Promise<LayoutHints> {
  if (hints) return Promise.resolve(hints);
  if (pending) return pending;
  pending = (async () => {
    const built = new Map<string, string>();
    try {
      const api = (navigator as Navigator & { keyboard?: KeyboardLayoutAPI }).keyboard;
      const map = await api?.getLayoutMap?.();
      if (map) {
        // Everything this layout can type without Shift. If the letter is in
        // here, the reader has a key labelled with it and the sheet is already
        // telling the truth.
        const typeable = new Set<string>();
        for (const value of map.values()) {
          if (typeof value === "string" && value.length === 1) typeable.add(value.toLowerCase());
        }
        for (let i = 0; i < 26; i++) {
          const letter = String.fromCharCode(97 + i);
          if (typeable.has(letter)) continue;
          const produced = map.get(`Key${letter.toUpperCase()}`);
          if (typeof produced === "string" && produced !== "" && produced.toLowerCase() !== letter) {
            built.set(letter, produced);
          }
        }
      }
    } catch {
      // Unsupported, insecure context, or a permissions policy that says no.
      // An empty map is the honest answer to all three.
    }
    hints = built;
    pending = null;
    return built;
  })();
  return pending;
}
