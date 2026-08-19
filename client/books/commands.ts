// THE COMMAND LINE. `:` in the reader, parsed here.
//
// Zathura's `:` is not a power-user ornament — it is the escape hatch that
// makes a chrome-free reader honest. Every state the keyboard can reach has a
// name here, so a reader who cannot remember whether fit-page is `s` or `a`
// can type `:fit page`, and a reader on a keyboard where `d` is somewhere
// surprising still has `:dual`. It is also the only door to the things that
// have no key at all (`:forget`, `:zoom 150`), because a book reader with a
// dozen keys and no way to say what they did is a puzzle, not a tool.
//
// Parsing lives apart from the component and returns a plain value, never
// performs an action: that is what lets tests/books.test.ts assert the whole
// grammar — including the abbreviations, which are the part that rots — under
// `node --test` with no browser anywhere.

import type { BookFit, BookInvert } from "../../shared/bookAnchor.ts";

export type BookCommand =
  /** `:212` — the bare number, which is most of what anyone types. `:+3` and
   *  `:-3` set `relative`, and step from where the reader is. */
  | { kind: "goto"; page: number; relative: boolean }
  | { kind: "quit" }
  | { kind: "library" }
  | { kind: "zoom"; percent: number }
  | { kind: "fit"; fit: BookFit }
  | { kind: "rotate"; quarters: number }
  | { kind: "dual"; on: boolean | null }
  | { kind: "invert"; mode: BookInvert | null }
  /** `:rtl` / `:ltr` — the reader overriding the direction we guessed. */
  | { kind: "direction"; rtl: boolean }
  | { kind: "mark"; name: string }
  | { kind: "jump"; name: string }
  | { kind: "search"; query: string }
  | { kind: "outline" }
  | { kind: "forget" }
  | { kind: "help" }
  /** `:highlight` — ink whatever is selected, exactly as `h` does. */
  | { kind: "highlight" }
  /** `:ink 3` picks one of the six page inks; a bare `:ink` steps to the next,
   *  which is what `H` does. */
  | { kind: "ink"; ink: number | null }
  /** `:cite` quotes the selection into the note beside you; `:cite pick` asks
   *  which note first, which is `Shift+C`. */
  | { kind: "cite"; pick: boolean }
  /** `:note` — a note in the margin (`e`). */
  | { kind: "note" }
  /** `:annotations` — the list of marked passages (`A`). */
  | { kind: "annotations" }
  /** Parsed fine, means nothing — the reader gets their own word back in the
   *  message, because "unknown command" without the word is a shrug. */
  | { kind: "unknown"; word: string };

/** Every command name, with the shortest unambiguous abbreviation each will
 *  answer to. The abbreviations are the contract a
 *  reader builds muscle memory on, so they are DATA rather than a chain of
 *  `startsWith` — the moment they are code, two of them silently overlap. */
const NAMES: { full: string; short: string }[] = [
  { full: "quit", short: "q" },
  { full: "library", short: "lib" },
  { full: "zoom", short: "z" },
  { full: "fit", short: "f" },
  { full: "rotate", short: "rot" },
  { full: "dual", short: "du" },
  { full: "invert", short: "inv" },
  { full: "rtl", short: "rtl" },
  { full: "ltr", short: "ltr" },
  { full: "mark", short: "ma" },
  { full: "jump", short: "ju" },
  { full: "search", short: "s" },
  { full: "outline", short: "o" },
  { full: "forget", short: "forget" }, // no abbreviation: it discards a position
  { full: "help", short: "h" },
  // The annotation half. `highlight` deliberately sits AFTER `help`, so that a
  // bare `:h` keeps meaning help — the vi rule resolves the first name whose
  // abbreviation the typed word satisfies, and a reader with `:h` in their
  // fingers must not have it silently start inking their selection.
  { full: "highlight", short: "hi" },
  { full: "ink", short: "in" },
  { full: "cite", short: "c" },
  { full: "note", short: "no" },
  { full: "annotations", short: "an" },
];

/** Resolve a typed word to a command name. A word matches when it is at least
 *  the abbreviation and is a prefix of the full name — the vi rule. */
function resolveName(word: string): string | null {
  const w = word.toLowerCase();
  for (const { full, short } of NAMES) {
    if (w.length >= short.length && full.startsWith(w)) return full;
  }
  return null;
}

/** The number a reader typed, in Latin OR Eastern Arabic digits. An Arabic
 *  instance prints page numbers as ٢١٢ everywhere else in the chrome; being
 *  refused when you type back what you were just shown is the kind of small
 *  betrayal that makes a whole feature feel foreign. */
export function parseNumber(text: string): number | null {
  let out = "";
  for (const ch of text.trim()) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch >= "0" && ch <= "9") out += ch;
    else if (cp >= 0x0660 && cp <= 0x0669) out += String(cp - 0x0660); // Arabic-Indic
    else if (cp >= 0x06f0 && cp <= 0x06f9) out += String(cp - 0x06f0); // Extended (Persian)
    else if (ch === "." || ch === "٫") out += ".";
    else if (ch === "-" || ch === "+") out += ch;
    else return null;
  }
  if (out === "" || out === "-" || out === "+") return null;
  const n = Number(out);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a command line, WITHOUT its leading `:`.
 *
 * Returns null for a line with nothing on it — pressing `:` and then Enter is
 * a change of mind, not an error worth a message.
 */
export function parseCommand(line: string): BookCommand | null {
  const text = line.trim();
  if (text === "") return null;

  // `:212` and `:+3` / `:-3`. The bare number is the command a reader reaches
  // for most, so it is answered before any name lookup.
  const bare = parseNumber(text);
  if (bare !== null) {
    const relative = text.startsWith("+") || text.startsWith("-");
    return { kind: "goto", page: Math.round(bare), relative };
  }

  const [word, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");
  const name = resolveName(word);
  if (name === null) return { kind: "unknown", word };

  switch (name) {
    case "quit":
      return { kind: "quit" };
    case "library":
      return { kind: "library" };
    case "outline":
      return { kind: "outline" };
    case "forget":
      return { kind: "forget" };
    case "help":
      return { kind: "help" };
    case "highlight":
      return { kind: "highlight" };
    case "note":
      return { kind: "note" };
    case "annotations":
      return { kind: "annotations" };
    case "cite": {
      const a = arg.trim().toLowerCase();
      if (a === "") return { kind: "cite", pick: false };
      if (a === "pick" || a === "into" || a === "?") return { kind: "cite", pick: true };
      return { kind: "unknown", word: text };
    }
    case "ink": {
      if (arg === "") return { kind: "ink", ink: null }; // step, like `H`
      const n = parseNumber(arg);
      if (n === null || !Number.isInteger(n)) return { kind: "unknown", word: text };
      return { kind: "ink", ink: n };
    }
    case "rtl":
      return { kind: "direction", rtl: true };
    case "ltr":
      return { kind: "direction", rtl: false };
    case "search":
      return { kind: "search", query: arg };
    case "zoom": {
      const percent = parseNumber(arg);
      // A bare `:zoom` means 100%: the reader has lost their place in the
      // scale and wants the page back at its own size.
      if (arg === "") return { kind: "zoom", percent: 100 };
      return percent === null ? { kind: "unknown", word: text } : { kind: "zoom", percent };
    }
    case "fit": {
      const a = arg.toLowerCase();
      if (a === "" || a === "width" || a === "w") return { kind: "fit", fit: "width" };
      if (a === "page" || a === "p" || a === "height" || a === "h") return { kind: "fit", fit: "page" };
      return { kind: "unknown", word: text };
    }
    case "rotate": {
      if (arg === "") return { kind: "rotate", quarters: 1 };
      const deg = parseNumber(arg);
      if (deg === null || deg % 90 !== 0) return { kind: "unknown", word: text };
      return { kind: "rotate", quarters: Math.round(deg / 90) };
    }
    case "dual":
      return { kind: "dual", on: onOff(arg) };
    case "invert": {
      const a = arg.toLowerCase();
      if (a === "") return { kind: "invert", mode: null }; // cycle, like `i`
      if (a === "off" || a === "no") return { kind: "invert", mode: "off" };
      if (a === "night" || a === "dark" || a === "on") return { kind: "invert", mode: "night" };
      if (a === "flip" || a === "full") return { kind: "invert", mode: "flip" };
      return { kind: "unknown", word: text };
    }
    case "mark":
    case "jump": {
      // Marks are single characters — Latin, Arabic or anything else the
      // reader's keyboard makes. More than one character is a typo, and
      // silently using the first would set a mark they cannot find again.
      const chars = [...arg];
      if (chars.length !== 1) return { kind: "unknown", word: text };
      return name === "mark" ? { kind: "mark", name: chars[0] } : { kind: "jump", name: chars[0] };
    }
    default:
      return { kind: "unknown", word };
  }
}

/** `on`/`off`/`toggle` — null means toggle, which is also what a bare name
 *  means, because that is what pressing the key does. */
function onOff(arg: string): boolean | null {
  const a = arg.trim().toLowerCase();
  if (a === "on" || a === "yes" || a === "1") return true;
  if (a === "off" || a === "no" || a === "0") return false;
  return null;
}
