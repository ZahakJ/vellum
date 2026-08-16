// THE LAYOUT MATRIX. Every documented control-modified shortcut, resolved from
// the keydown a real keyboard sends on Arabic, Persian, Russian, Greek, Hebrew,
// AZERTY, Dvorak and US QWERTY.
//
// This is the regression the product shipped with: `client/App.tsx` compared
// `e.key.toLowerCase()` to Latin letters, and `e.key` is whatever the LAYOUT
// produced. On the owner's Arabic keyboard the physical P key reports "ح", so
// Ctrl+P opened nothing — in an app that ships a complete Arabic translation
// and mirrors its entire layout for it. Five of seven bindings were dead, and
// no test noticed, because every test typed Latin letters.
//
// Two halves, and the second is what keeps the fix from over-correcting:
//   - NON-LATIN layouts must reach the binding through the PHYSICAL key.
//   - LATIN layouts that MOVE letters (AZERTY, Dvorak) must keep reaching it
//     through the letter, and must NOT fire from the physical position. On
//     Dvorak `b` is under physical KeyN and physical KeyB types `x`; a reader
//     who learned "Ctrl+B is bold" learned it about the b finger.
//
// The browser-level companion is scripts/check-layouts.mjs, which drives the
// real app through the DevTools Protocol. This file is where the cases that
// harness CANNOT deliver live — chiefly Arabic's lam-alef, a TWO-code-point
// `key` that Chromium's Input.dispatchKeyEvent flattens to "".

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isKey, layoutKey, physicalKey, shortcutKey, type ShortcutEvent } from "../client/keys.ts";

/** A layout, as a physical-key → produced-character table. Only the keys that
 *  differ from US QWERTY are listed. */
interface Layout {
  id: string;
  /** The layout produces Latin letters, so `e.key` answers on its own. */
  latin?: boolean;
  produces: Record<string, string>;
  /** Characters this layout reaches only WITH Shift, where that differs from
   *  "the same character uppercased" — ЙЦУКЕН's slash is Shift+Backslash. */
  shifted?: Record<string, string>;
}

const PUNCT_CODES: Record<string, string> = {
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
};

function usChar(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter) return letter.toLowerCase();
  return PUNCT_CODES[code] ?? "";
}

const ARABIC: Layout = {
  id: "ar",
  produces: {
    KeyA: "ش", KeyB: "لا", KeyC: "ؤ", KeyD: "ي", KeyE: "ث", KeyF: "ب",
    KeyG: "ل", KeyH: "ا", KeyI: "ه", KeyJ: "ت", KeyK: "ن", KeyL: "م",
    KeyM: "ة", KeyN: "ى", KeyO: "خ", KeyP: "ح", KeyQ: "ض", KeyR: "ق",
    KeyS: "س", KeyT: "ف", KeyU: "ع", KeyV: "ر", KeyW: "ص", KeyX: "ء",
    KeyY: "غ", KeyZ: "ئ", Slash: "ظ",
  },
};

const PERSIAN: Layout = {
  id: "fa",
  produces: {
    KeyA: "ش", KeyB: "ذ", KeyC: "ز", KeyD: "ی", KeyE: "ث", KeyF: "ب",
    KeyG: "ل", KeyH: "ا", KeyI: "ه", KeyJ: "ت", KeyK: "ن", KeyL: "م",
    KeyM: "ئ", KeyN: "د", KeyO: "خ", KeyP: "ح", KeyQ: "ض", KeyR: "ق",
    KeyS: "س", KeyT: "ف", KeyU: "ع", KeyV: "ر", KeyW: "ص", KeyX: "ط",
    KeyY: "غ", KeyZ: "ظ", Slash: "/",
  },
};

const RUSSIAN: Layout = {
  id: "ru",
  produces: {
    KeyA: "ф", KeyB: "и", KeyC: "с", KeyD: "в", KeyE: "у", KeyF: "а",
    KeyG: "п", KeyH: "р", KeyI: "ш", KeyJ: "о", KeyK: "л", KeyL: "д",
    KeyM: "ь", KeyN: "т", KeyO: "щ", KeyP: "з", KeyQ: "й", KeyR: "к",
    KeyS: "ы", KeyT: "е", KeyU: "г", KeyV: "м", KeyW: "ц", KeyX: "ч",
    KeyY: "н", KeyZ: "я", Slash: ".", Backslash: "\\",
  },
  // ЙЦУКЕН has no slash on the slash key — it types "." there. The Russian
  // reader's "/" is Shift+Backslash, and it arrives as key="/", so the LAYOUT
  // answers Ctrl+/ and the physical fallback correctly stays out of it.
  shifted: { Backslash: "/", Slash: "," },
};

const GREEK: Layout = {
  id: "el",
  produces: {
    KeyA: "α", KeyB: "β", KeyC: "ψ", KeyD: "δ", KeyE: "ε", KeyF: "φ",
    KeyG: "γ", KeyH: "η", KeyI: "ι", KeyJ: "ξ", KeyK: "κ", KeyL: "λ",
    KeyM: "μ", KeyN: "ν", KeyO: "ο", KeyP: "π", KeyQ: ";", KeyR: "ρ",
    KeyS: "σ", KeyT: "τ", KeyU: "θ", KeyV: "ω", KeyW: "ς", KeyX: "χ",
    KeyY: "υ", KeyZ: "ζ",
  },
};

const HEBREW: Layout = {
  id: "he",
  produces: {
    KeyA: "ש", KeyB: "נ", KeyC: "ב", KeyD: "ג", KeyE: "ק", KeyF: "כ",
    KeyG: "ע", KeyH: "י", KeyI: "ן", KeyJ: "ח", KeyK: "ל", KeyL: "ך",
    KeyM: "צ", KeyN: "מ", KeyO: "ם", KeyP: "פ", KeyQ: "/", KeyR: "ר",
    KeyS: "ד", KeyT: "א", KeyU: "ו", KeyV: "ה", KeyW: "'", KeyX: "ס",
    KeyY: "ט", KeyZ: "ז", Slash: ".",
  },
};

const US: Layout = { id: "us", latin: true, produces: {} };

const AZERTY: Layout = {
  id: "azerty",
  latin: true,
  produces: { KeyA: "q", KeyQ: "a", KeyW: "z", KeyZ: "w", KeyM: ",", Semicolon: "m" },
};

const DVORAK: Layout = {
  id: "dvorak",
  latin: true,
  produces: {
    KeyQ: "'", KeyW: ",", KeyE: ".", KeyR: "p", KeyT: "y", KeyY: "f",
    KeyU: "g", KeyI: "c", KeyO: "r", KeyP: "l", BracketLeft: "/", BracketRight: "=",
    KeyA: "a", KeyS: "o", KeyD: "e", KeyF: "u", KeyG: "i", KeyH: "d",
    KeyJ: "h", KeyK: "t", KeyL: "n", Semicolon: "s", Quote: "-",
    KeyZ: ";", KeyX: "q", KeyC: "j", KeyV: "k", KeyB: "x", KeyN: "b",
    KeyM: "m", Comma: "w", Period: "v", Slash: "z", Minus: "[", Equal: "]",
  },
};

const NON_LATIN = [ARABIC, PERSIAN, RUSSIAN, GREEK, HEBREW];
const LATIN = [US, AZERTY, DVORAK];

const ALL_CODES = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Object.keys(PUNCT_CODES),
];

/** What this layout produces on a physical key, unshifted and shifted. */
function produces(layout: Layout, code: string, shift: boolean): string {
  if (shift) {
    const explicit = layout.shifted?.[code];
    if (explicit !== undefined) return explicit;
    const base = layout.produces[code] ?? usChar(code);
    return /^[a-z]$/.test(base) ? base.toUpperCase() : base;
  }
  return layout.produces[code] ?? usChar(code);
}

/** The keystroke a reader of `layout` performs to type `char` — the physical
 *  key AND whether Shift is part of reaching it. Latin layouts have such a
 *  key; a non-Latin layout has no Latin letters at all, and its reader presses
 *  the US position — what the second alphabet on their keycaps says. */
function strokeFor(layout: Layout, char: string): { code: string; shift: boolean } {
  for (const code of ALL_CODES) if (produces(layout, code, false) === char) return { code, shift: false };
  for (const code of ALL_CODES) if (produces(layout, code, true) === char) return { code, shift: true };
  for (const code of ALL_CODES) if (usChar(code) === char) return { code, shift: false };
  throw new Error(`no physical key for "${char}" on ${layout.id}`);
}

interface Mods {
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  altGraph?: boolean;
}

/** The keydown a browser delivers when a reader of `layout` presses the key
 *  that types `char`, with Ctrl (or Cmd) held. */
function keydown(layout: Layout, char: string, mods: Mods = {}): ShortcutEvent {
  const stroke = strokeFor(layout, char);
  const code = stroke.code;
  const shift = !!mods.shift || stroke.shift;
  const base = produces(layout, code, false);
  const key = produces(layout, code, shift);
  // Windows virtual-key codes follow the letter on a Latin layout and the US
  // position on a non-Latin one — which is what browsers report.
  const vkChar = layout.latin ? base : usChar(code);
  const keyCode = /^[a-z]$/.test(vkChar)
    ? vkChar.toUpperCase().charCodeAt(0)
    : ({ ";": 186, "=": 187, ",": 188, "-": 189, ".": 190, "/": 191, "`": 192, "[": 219, "\\": 220, "]": 221, "'": 222 } as Record<string, number>)[vkChar] ?? 0;
  return {
    key,
    code,
    keyCode,
    ctrlKey: !mods.meta,
    metaKey: !!mods.meta,
    shiftKey: shift,
    altKey: !!mods.alt || !!mods.altGraph,
    getModifierState: (name: string) => name === "AltGraph" && !!mods.altGraph,
  };
}

/** Every binding the product documents in the Ctrl/Cmd+/ sheet that is matched
 *  on a single character. If a row is added to ShortcutsHelp and not to this
 *  list, the new row is untested under every non-Latin keyboard on earth. */
const BINDINGS: { name: string; char: string; mods?: Mods }[] = [
  { name: "command palette (Ctrl+P)", char: "p" },
  { name: "publish note (Ctrl+Shift+P)", char: "p", mods: { shift: true } },
  { name: "search (Ctrl+K)", char: "k" },
  { name: "graph view (Ctrl+G)", char: "g" },
  { name: "reading view (Ctrl+E)", char: "e" },
  { name: "daily note (Ctrl+D)", char: "d" },
  { name: "new note (Ctrl+N)", char: "n" },
  { name: "zen (Ctrl+Shift+Z)", char: "z", mods: { shift: true } },
  { name: "shortcut sheet (Ctrl+/)", char: "/" },
  { name: "notes pane (Ctrl+Alt+B)", char: "b", mods: { alt: true } },
  { name: "outline pane (Ctrl+Alt+Shift+B)", char: "b", mods: { alt: true, shift: true } },
  { name: "insert template (Ctrl+Alt+T)", char: "t", mods: { alt: true } },
  { name: "new from template (Ctrl+Alt+Shift+T)", char: "t", mods: { alt: true, shift: true } },
  // The editor's own keymap resolves through the same two signals.
  { name: "save (Ctrl+S)", char: "s" },
  { name: "bold (Ctrl+B)", char: "b" },
  { name: "italic (Ctrl+I)", char: "i" },
  { name: "underline (Ctrl+U)", char: "u" },
  { name: "strikethrough (Ctrl+Shift+X)", char: "x", mods: { shift: true } },
  { name: "highlight (Ctrl+Shift+H)", char: "h", mods: { shift: true } },
  { name: "focus section (Ctrl+Alt+F)", char: "f", mods: { alt: true } },
  { name: "find (Ctrl+F)", char: "f" },
  { name: "undo (Ctrl+Z)", char: "z" },
];

describe("every documented shortcut, on every layout", () => {
  for (const layout of [...LATIN, ...NON_LATIN]) {
    it(`resolves all ${BINDINGS.length} bindings on ${layout.id}`, () => {
      for (const binding of BINDINGS) {
        const event = keydown(layout, binding.char, binding.mods);
        assert.equal(
          shortcutKey(event),
          binding.char,
          `${binding.name} on ${layout.id}: key=${JSON.stringify(event.key)} code=${event.code}`,
        );
      }
    });
  }

  // The bug as the owner met it, spelled out on its own so a regression names
  // itself rather than hiding inside a loop of twenty-two.
  it("Ctrl+P opens the palette on an Arabic keyboard", () => {
    const event = keydown(ARABIC, "p");
    assert.equal(event.key, "ح", "the Arabic layout puts ح on the physical P key");
    assert.equal(event.key.toLowerCase() === "p", false, "the OLD comparison — this is the bug");
    assert.equal(shortcutKey(event), "p");
  });

  it("Ctrl+Shift+P still means publish, not the palette, on Arabic", () => {
    const event = keydown(ARABIC, "p", { shift: true });
    assert.equal(shortcutKey(event), "p");
    assert.equal(event.shiftKey, true);
  });
});

describe("the physical fallback does not over-reach", () => {
  it("Dvorak's Ctrl+B is the key that TYPES b, not the physical B key", () => {
    // Physical KeyN types "b" on Dvorak — that is the reader's bold key.
    assert.equal(shortcutKey({ key: "b", code: "KeyN", keyCode: 66, ctrlKey: true }), "b");
    // Physical KeyB types "x" there, and must stay "x".
    assert.equal(shortcutKey({ key: "x", code: "KeyB", keyCode: 88, ctrlKey: true }), "x");
  });

  it("AZERTY's Ctrl+Shift+Z is the key that TYPES z (physical W)", () => {
    assert.equal(shortcutKey({ key: "Z", code: "KeyW", keyCode: 90, ctrlKey: true, shiftKey: true }), "z");
    // Physical KeyZ types "w" on AZERTY — and Ctrl+Shift+W closes the window,
    // which is precisely why nothing of ours may answer to it.
    assert.equal(shortcutKey({ key: "W", code: "KeyZ", keyCode: 87, ctrlKey: true, shiftKey: true }), "w");
  });

  it("a Latin letter from the layout always beats the physical position", () => {
    for (const layout of LATIN) {
      for (const binding of BINDINGS) {
        const event = keydown(layout, binding.char, binding.mods);
        assert.equal(layoutKey(event), binding.char, `${layout.id} ${binding.name}`);
      }
    }
  });

  it("AltGr is typing, not commanding", () => {
    // Polish AltGr+E is "ę". Resolving that to the physical E would toggle the
    // reading view every time a Polish reader typed a word with ę in it.
    const polish: ShortcutEvent = {
      key: "ę",
      code: "KeyE",
      keyCode: 69,
      ctrlKey: true,
      altKey: true,
      getModifierState: (name) => name === "AltGraph",
    };
    assert.equal(shortcutKey(polish), null);
    // The same physical key with a plain left Ctrl+Alt is still a command.
    const plain: ShortcutEvent = { ...polish, getModifierState: () => false, key: "ε" };
    assert.equal(shortcutKey(plain), "e");
  });
});

describe("the keys a layout mangles in other ways", () => {
  it("Arabic's lam-alef ligature is TWO code points, and still resolves", () => {
    // The Arabic 101 layout puts "لا" on the physical B key. It is the case
    // CodeMirror's own keyCode fallback misses (its `isChar` test requires a
    // single code point), and the one Chromium's DevTools Protocol cannot even
    // deliver — so it lives here rather than in scripts/check-layouts.mjs.
    const event: ShortcutEvent = { key: "لا", code: "KeyB", keyCode: 66, ctrlKey: true };
    assert.equal(event.key.length, 2);
    assert.equal(layoutKey(event), null);
    assert.equal(shortcutKey(event), "b");
  });

  it("an empty key (Chromium's answer to the same ligature) resolves", () => {
    assert.equal(shortcutKey({ key: "", code: "KeyB", keyCode: 66, ctrlKey: true }), "b");
  });

  it("macOS Option+B is '∫', and still folds the pane", () => {
    assert.equal(shortcutKey({ key: "∫", code: "KeyB", keyCode: 66, metaKey: true, altKey: true }), "b");
    assert.equal(shortcutKey({ key: "†", code: "KeyT", keyCode: 84, metaKey: true, altKey: true }), "t");
  });

  it("a dead key resolves through the physical position", () => {
    assert.equal(shortcutKey({ key: "Dead", code: "KeyP", keyCode: 80, ctrlKey: true }), "p");
    assert.equal(shortcutKey({ key: "Unidentified", code: "KeyK", keyCode: 75, ctrlKey: true }), "k");
  });

  it("an IME that sends no code at all falls back to the legacy keyCode", () => {
    assert.equal(shortcutKey({ key: "ح", code: "", keyCode: 80, ctrlKey: true }), "p");
    assert.equal(shortcutKey({ key: "ظ", keyCode: 191, ctrlKey: true }), "/");
  });

  it("an event with nothing usable resolves to null rather than guessing", () => {
    assert.equal(shortcutKey({ key: "ح", code: "", keyCode: 0, ctrlKey: true }), null);
    assert.equal(shortcutKey({ key: "Escape", code: "Escape", keyCode: 27 }), null);
    assert.equal(shortcutKey({ key: "ArrowUp", code: "ArrowUp", keyCode: 38, ctrlKey: true }), null);
  });
});

describe("Ctrl+/ — the one binding that is punctuation", () => {
  it("answers to the layout's own slash wherever it lives", () => {
    // US: Slash. German: Shift+7. Dvorak: the physical [ key. All arrive as "/".
    assert.equal(isKey({ key: "/", code: "Slash", keyCode: 191, ctrlKey: true }, "/"), true);
    assert.equal(isKey({ key: "/", code: "Digit7", keyCode: 55, ctrlKey: true, shiftKey: true }, "/"), true);
    assert.equal(isKey({ key: "/", code: "BracketLeft", keyCode: 219, ctrlKey: true }, "/"), true);
  });

  it("answers to Ctrl+? — Shift+/ on a US keyboard", () => {
    assert.equal(isKey({ key: "?", code: "Slash", keyCode: 191, ctrlKey: true, shiftKey: true }, "/"), true);
  });

  it("answers to the physical slash key on Arabic, which types ظ", () => {
    assert.equal(isKey({ key: "ظ", code: "Slash", keyCode: 191, ctrlKey: true }, "/"), true);
  });

  it("does NOT answer to Dvorak's physical slash key, which types z", () => {
    // Ctrl+z there is undo, and undo it must stay.
    assert.equal(isKey({ key: "z", code: "Slash", keyCode: 90, ctrlKey: true }, "/"), false);
    assert.equal(shortcutKey({ key: "z", code: "Slash", keyCode: 90, ctrlKey: true }), "z");
  });

  it("does NOT answer to the Russian physical slash key, which types a period", () => {
    // ЙЦУКЕН has no slash there at all; the Russian reader's "/" is
    // Shift+Backslash, and it arrives as "/" — the layout answers.
    assert.equal(isKey({ key: ".", code: "Slash", keyCode: 190, ctrlKey: true }, "/"), false);
    assert.equal(isKey({ key: "/", code: "Backslash", keyCode: 220, ctrlKey: true, shiftKey: true }, "/"), true);
  });
});

describe("physicalKey", () => {
  it("names every letter, digit and bound punctuation key by position", () => {
    assert.equal(physicalKey({ key: "", code: "KeyQ" }), "q");
    assert.equal(physicalKey({ key: "", code: "Digit4" }), "4");
    assert.equal(physicalKey({ key: "", code: "Numpad4" }), "4");
    assert.equal(physicalKey({ key: "", code: "BracketRight" }), "]");
    assert.equal(physicalKey({ key: "", code: "Backslash" }), "\\");
  });

  it("names nothing for the keys that are not characters", () => {
    for (const code of ["Escape", "F1", "ArrowLeft", "Enter", "Tab", "Space", "ShiftLeft"]) {
      assert.equal(physicalKey({ key: "", code }), null, code);
    }
  });
});
