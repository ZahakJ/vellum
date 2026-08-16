// HOW A CONTROL-MODIFIED SHORTCUT FINDS ITS KEY.
//
// `KeyboardEvent.key` is what the LAYOUT produced. On an Arabic keyboard the
// physical P key reports `key === "ح"`, on a Russian one `"з"`, on Greek `"π"`,
// on Hebrew `"פ"` — so `e.key.toLowerCase() === "p"` is false and Ctrl+P opens
// nothing. That was the state of this product: every global shortcut except two
// died the moment the reader's system keyboard left the Latin alphabet, in an
// app that ships a complete Arabic translation and mirrors its whole layout for
// it. `scripts/check-layouts.mjs` measured 5 of 7 bindings dead under Arabic.
//
// `KeyboardEvent.code` is the PHYSICAL key — "KeyP" for whatever sits where a
// US keyboard has P, whatever that key types. It is layout-blind, which is the
// fix and also the trap:
//
// THE RULE, AND IT IS NOT "physical wins".
//   1. If the layout produced a usable ASCII character, THAT is the key.
//   2. Only when it did not — a non-Latin script, a dead key, an Alt-mangled
//      character, an empty `key` — fall back to the physical position.
//
// Layout first, because on Dvorak `b` is under the physical N key and `x` is
// under the physical B key. A reader who has learned "Ctrl+B is bold" has
// learned it about the key that TYPES b, not about a position on the plastic.
// Resolving by `code` alone would bold from the x finger and do nothing from
// the b finger — which is the same class of bug as the one being fixed here,
// just aimed at a different reader. The same is true of AZERTY (a/q and w/z
// swap) and of Colemak.
//
// Physical second, because a layout that produces no Latin letters at ALL can
// never satisfy rule 1, and its reader still has to be able to open the
// palette. Their keycaps are printed with both alphabets; the position IS the
// mnemonic there. This is the convention VS Code, Chrome and Firefox settled
// on, and CodeMirror's own keymap already does the same thing one layer down
// (see `layoutFallback` in client/editor/layoutKeys.ts) — the two now agree.
//
// AltGraph is excluded outright. On many European layouts Right-Alt reports as
// ctrl+alt, and AltGr+E on Polish is how you type "ę": resolving that to the
// physical E and toggling the reading view would break TYPING to fix commands.
//
// This module is deliberately free of DOM and React imports so the layout
// matrix in tests/shortcuts.test.ts can drive it directly under node --test.

/** The shape this module needs from a KeyboardEvent. Real events satisfy it;
 *  so do the plain objects the layout matrix synthesizes. */
export interface ShortcutEvent {
  key: string;
  code?: string;
  /** Legacy, and only ever the last resort — some virtual keyboards and IMEs
   *  send no `code` at all. Browsers report the US-position keyCode under a
   *  non-Latin layout, which is exactly the mapping we want from it. */
  keyCode?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  getModifierState?: (key: string) => boolean;
}

/** Punctuation that a `code` names by position. Digits and letters are matched
 *  by pattern below; these are the ones with names of their own. */
const CODE_CHARS: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/** The same set through the legacy keyCode door. */
const KEYCODE_CHARS: Record<number, string> = {
  186: ";",
  187: "=",
  188: ",",
  189: "-",
  190: ".",
  191: "/",
  192: "`",
  219: "[",
  220: "\\",
  221: "]",
  222: "'",
};

/** True when this event is AltGr — a reader typing a character, not commanding. */
function isAltGraph(e: ShortcutEvent): boolean {
  return typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
}

/** The character the LAYOUT produced, lowercased — or null when the layout
 *  cannot answer a Latin-alphabet question.
 *
 *  Null covers more than "not Latin": `""` (Chromium sends an empty key for
 *  some multi-code-point layout output), `"Dead"`, `"Unidentified"`, `"Escape"`
 *  and every other named key, "∫" (macOS Option+B), and "لا" — the Arabic
 *  lam-alef LIGATURE that sits on the physical B key and arrives as TWO code
 *  points, which is also the case CodeMirror's own fallback misses. */
export function layoutKey(e: ShortcutEvent): string | null {
  const key = e.key;
  if (typeof key !== "string" || key.length !== 1) return null;
  const cp = key.codePointAt(0) ?? 0;
  // Printable ASCII only, and not the space bar (bindings spell that "Space").
  if (cp <= 0x20 || cp > 0x7e) return null;
  return key.toLowerCase();
}

/** The character the US-QWERTY position of this physical key carries — or null
 *  when the event names no character key. `code` first (modern and exact),
 *  `keyCode` behind it (for the IMEs and virtual keyboards that send neither a
 *  usable `key` nor a `code`). */
export function physicalKey(e: ShortcutEvent): string | null {
  const code = e.code;
  if (typeof code === "string" && code !== "") {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) return letter[1].toLowerCase();
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (digit) return digit[1];
    const punct = CODE_CHARS[code];
    if (punct !== undefined) return punct;
    return null;
  }
  const kc = e.keyCode;
  if (typeof kc !== "number" || kc === 0) return null;
  if (kc >= 65 && kc <= 90) return String.fromCharCode(kc + 32);
  if (kc >= 48 && kc <= 57) return String.fromCharCode(kc);
  if (kc >= 96 && kc <= 105) return String.fromCharCode(kc - 48);
  return KEYCODE_CHARS[kc] ?? null;
}

/** THE resolver. Which character key a control-modified shortcut should be
 *  matched against — the layout's own answer where it has one, the physical
 *  position where it has none, and null when the event is AltGr (typing) or
 *  names no character key at all (Escape, F1, the arrows: match those on
 *  `e.key` directly, they are layout-independent already). */
export function shortcutKey(e: ShortcutEvent): string | null {
  if (isAltGraph(e)) return null;
  return layoutKey(e) ?? physicalKey(e);
}

/** Shifted ASCII punctuation, mapped back to the key it shares. Only used to
 *  ANSWER a binding, never to resolve one: `Ctrl+?` and `Ctrl+/` are the same
 *  keystroke to a US reader, and on a German layout `/` is Shift+7 and arrives
 *  as "/" already. Letters are handled by lowercasing, not by this table. */
const SHIFT_PAIRS: Record<string, string> = {
  "?": "/",
  "{": "[",
  "}": "]",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  _: "-",
  "+": "=",
  "~": "`",
  "|": "\\",
};

/** Does this event mean `binding` (a single lowercase character)? Accepts the
 *  shifted twin of a punctuation binding, so `Ctrl+/` answers to Ctrl+Shift+/
 *  on a US keyboard without every caller spelling out both. */
export function isKey(e: ShortcutEvent, binding: string): boolean {
  const resolved = shortcutKey(e);
  if (resolved === null) return false;
  return resolved === binding || SHIFT_PAIRS[resolved] === binding;
}
