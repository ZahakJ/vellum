// The editor half of the non-Latin keyboard fix — see client/keys.ts for the
// rule and the reasoning. This file exists because CodeMirror resolves keys
// ITSELF, one layer below App.tsx's listener, and the two have to agree.
//
// WHAT CODEMIRROR ALREADY DOES. `runHandlers` in @codemirror/view looks the
// binding up under `keyName(event)` — that is `e.key`, the LAYOUT's answer —
// and, when the event carries ctrl/meta/alt and the layout's answer is a
// single character that found nothing, tries `base[event.keyCode]` from
// w3c-keyname: the US-QWERTY name for that legacy key code. So Ctrl+B does
// bold on a Russian or Greek keyboard already, and — importantly — does NOT
// bold from the physical B key on Dvorak, because there the keyCode follows
// the letter the layout produces. That is exactly the convention client/keys.ts
// settled on, arrived at independently. Good.
//
// WHERE IT FAILS, and why this extension is not redundant:
//
//  1. `isChar` requires the layout's output to be ONE code point. The Arabic
//     101 layout puts the lam-alef ligature "لا" — two code points — on the
//     physical B key, so `isChar` is false, the keyCode fallback is skipped
//     entirely, and Ctrl+B is dead on the owner's own keyboard. Chromium also
//     reports an EMPTY `key` for some multi-code-point layout output, which
//     lands in the same hole from the other side.
//  2. `keyCode` is deprecated, and the browsers that have begun freezing it
//     (and the virtual keyboards and IMEs that never set it) leave CodeMirror
//     with nothing. `code` is the supported signal and is what this uses.
//  3. On Windows CodeMirror declines the fallback for any ctrl+alt event
//     (`!(browser.windows && event.ctrlKey && event.altKey)`) because ctrl+alt
//     is AltGr — a blanket rule that also drops Ctrl+Alt bindings pressed with
//     the LEFT Alt, which are not AltGr at all. client/keys.ts asks
//     `getModifierState("AltGraph")` instead, which is the precise question.
//
// HOW. Nothing is re-bound. When — and only when — the layout produced no
// usable Latin character, this handler synthesizes the keydown the same
// physical key would have sent on a US keyboard and pushes it back through
// CodeMirror's OWN `runScopeHandlers`. Every binding in the editor answers:
// ours (bold, italic, save, focus-section), the defaults (undo, select-all),
// search, autocomplete — with no table here to drift out of step with them.
// On any layout that produces Latin letters this handler returns immediately
// and CodeMirror behaves exactly as it did before.

import { Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { layoutKey, physicalKey } from "../keys.ts";

/** US virtual-key codes, so the synthetic event can walk CodeMirror's own
 *  `base[keyCode]` / `shift[keyCode]` path. That path is what resolves a
 *  Shift binding: `Mod-Shift-x` is stored as "Ctrl-Shift-x", and a real US
 *  event reaches it as key "X" plus keyCode 88 — the uppercase name misses and
 *  the keyCode name (with Shift re-applied) hits. A synthetic event without a
 *  keyCode would find bold but never strikethrough. */
function usKeyCode(char: string): number {
  if (/^[a-z]$/.test(char)) return char.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(char)) return char.charCodeAt(0);
  return (
    { ";": 186, "=": 187, ",": 188, "-": 189, ".": 190, "/": 191, "`": 192, "[": 219, "\\": 220, "]": 221, "'": 222 }[
      char
    ] ?? 0
  );
}

/** Shifted US ASCII, for the same reason: on a US keyboard Shift+/ arrives as
 *  "?", and a binding spelled `Mod-Shift-/` is matched through that name. */
const SHIFTED: Record<string, string> = {
  "`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^",
  "7": "&", "8": "*", "9": "(", "0": ")", "-": "_", "=": "+",
  "[": "{", "]": "}", "\\": "|", ";": ":", "'": '"', ",": "<", ".": ">", "/": "?",
};

/** Front-runs CodeMirror's keymap for keydowns whose layout produced no Latin
 *  character, and hands the physical-key equivalent to the SAME keymap.
 *
 *  `Prec.highest` puts this ahead of every KEYMAP — which are all facet-level
 *  `domEventHandlers` — while still leaving VIM in front of it: vim arrives as
 *  a ViewPlugin, and `InputState.runHandlers` runs plugin handlers before
 *  facet handlers whatever their precedence. So vim keeps first refusal on
 *  Ctrl+D and Ctrl+U exactly as it does on a US keyboard, and this only sees
 *  what vim declined. */
export const layoutFallback = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      // Only control-modified keystrokes, and Ctrl/Cmd is required — every
      // binding in this editor carries `Mod-`. Plain typing is the layout's
      // job and must never be rewritten: it is how the Arabic in a note gets
      // typed, and on macOS how Option+letter reaches a special character.
      if (!(event.ctrlKey || event.metaKey)) return false;
      // AltGr is typing too (Polish AltGr+E is "ę"), never a command.
      if (event.getModifierState("AltGraph")) return false;
      // The layout answered in Latin: leave CodeMirror alone. This is the
      // branch every US, AZERTY, Dvorak and Colemak keystroke takes.
      if (layoutKey(event) !== null) return false;
      const physical = physicalKey(event);
      if (physical === null) return false;

      // With Shift, send what a US keyboard would have sent — "X", "?" — not
      // the bare key. CodeMirror looks a shifted binding up through BOTH the
      // shifted name and `shift[keyCode]`, and a synthetic event that skipped
      // the first would find bold but never strikethrough.
      const key = event.shiftKey
        ? /^[a-z]$/.test(physical)
          ? physical.toUpperCase()
          : (SHIFTED[physical] ?? physical)
        : physical;
      const synthetic = new KeyboardEvent("keydown", {
        key,
        code: event.code,
        keyCode: usKeyCode(physical),
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        bubbles: false,
        cancelable: true,
      });
      // `defaultPrevented` as well as the return value: a binding declared
      // `preventDefault: true` whose command declined still means "this key is
      // spoken for", and Ctrl+S must not fall through to the browser's Save
      // dialog. Returning true is what stops the REAL event — CodeMirror's
      // `runHandlers` calls `preventDefault` on it for us; calling it on the
      // synthetic one would stop nothing at all.
      return runScopeHandlers(view, synthetic, "editor") || synthetic.defaultPrevented;
    },
  }),
);
