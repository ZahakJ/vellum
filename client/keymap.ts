// THE KEYMAP LEDGER — where a binding EXISTS, and the arithmetic that decides
// when two of them are the same keystroke.
//
// The `GROUPS` table in client/components/ShortcutsHelp.tsx is the ledger. It
// was already the closest thing the product had to a list of every binding —
// Ctrl/Cmd+/ prints it, in two languages — and docs/keymap.md was a SECOND
// hand-maintained copy of the same list. Two copies drift silently, and both
// of them can be wrong about the world at once: CodeMirror's `foldKeymap` is
// `Ctrl-Shift-[` (mac `Cmd-Alt-[`) for one section and `Ctrl-Alt-[` for the
// whole document on EVERY platform, so on a Mac the sheet's fold row prints a
// chord that binds nothing (Cmd+Shift+[) and its fold-all row prints one that
// folds a single section (Cmd+Alt+[). Nobody finds that by reading two lists;
// it needs subtraction — which is the one thing a gate is good at.
//
// And drift is the small half. The real cost is that a COLLISION — two rows
// claiming the same key, the same modifiers, in the same place — is invisible
// until a reader reports that a key does nothing, because the loser of a
// collision is silent by construction: one handler runs, the other never gets
// the event, and neither of them knows the other exists. There are two
// handlers today (the window listener in App.tsx and CodeMirror's keymap
// stack) and a desktop runtime is coming with a third. Forty more bindings
// through three doors is not a thing anyone audits by eye.
//
// So: `scripts/check-keymap.mjs` parses this ledger out of the .tsx SOURCE (it
// must never import it — the table is full of React and store closures, and a
// gate that needs a browser is a gate nobody runs), diffs it against
// docs/keymap.md, and fails the build on a collision. This module is the pure
// half: the chord grammar, the scope model, and the two parsers. It is
// deliberately free of DOM, React and node imports so `tests/keymap.test.ts`
// can drive it directly under `node --test`, exactly as client/keys.ts is.
//
// client/keys.ts is the RUNTIME answer to "which key was that" — layout first,
// physical position second. This module is the DESIGN-TIME answer to "which
// key is that, on paper". They meet at the character: a chord's key here is
// the same lowercase character `shortcutKey()` resolves an event to there.

// Type-only, so nothing here ever loads the .tsx at runtime — Node erases the
// import before it resolves it. One definition of "which shell", not two.
import type { Shell } from "./components/ShortcutsHelp.tsx";

/** Which runtime carries a binding. Unmarked rows are BOTH: the desktop app is
 *  the browser app in a window, and a binding that only exists there (a native
 *  menu accelerator, a global hotkey) is the exception that has to say so. */
export type Runtime = "browser" | "desktop";

/** One row of the ledger, as parsed out of the `GROUPS` source. `keys`/`via`
 *  mirror the `Binding` interface exactly; `line` is what makes a failure
 *  report something a reader can jump to. */
export interface LedgerRow {
  /** i18n key of the group title the row sits under. */
  group: string;
  /** i18n key of the row's label — its identity in every report below. */
  label: string;
  keys: string[] | null;
  via: string | null;
  admin: boolean;
  shell: Shell | null;
  desktop: boolean;
  /** 1-based line in ShortcutsHelp.tsx. */
  line: number;
}

/** A keystroke, normalized so that two spellings of it compare equal. */
export interface Chord {
  /** Canonical order: Ctrl/Cmd, then Alt, then Shift. */
  mods: string[];
  /** A single lowercase character, or a named key ("Esc", "Up", "F10"). */
  key: string;
  /** `Mod+Alt+Shift+b` — the tuple's first two thirds, as one string. */
  id: string;
}

/** THE MODIFIER VOCABULARY, and it is deliberately three tokens.
 *
 *  "Ctrl/Cmd" is ONE modifier, not two: every binding in this product is
 *  `Mod-` (CodeMirror's own spelling) and resolves to Cmd on a Mac and Ctrl
 *  everywhere else, so a chord spelled "Ctrl" on one row and "Ctrl/Cmd" on
 *  another would be the same keystroke wearing two names — the exact hiding
 *  place this gate exists to close. A future platform-only binding has to
 *  widen this map on purpose, and think about what `Mod` then overlaps. */
const MODIFIERS: Record<string, string> = {
  "Ctrl/Cmd": "Mod",
  Alt: "Alt",
  Shift: "Shift",
};

/** Canonical modifier order. The sheet prints chords in this order and so does
 *  every report here, so a text diff of two chords is a diff of the chords. */
const MOD_ORDER = ["Mod", "Alt", "Shift"];

/** Keys with names rather than characters. The arrow GLYPHS are what the sheet
 *  prints (a `<kbd>↑</kbd>` is legible in both languages where "ArrowUp" is
 *  not), and they normalize to the names the rest of the codebase uses. */
const NAMED_KEYS: Record<string, string> = {
  "↑": "Up",
  "↓": "Down",
  "←": "Left",
  "→": "Right",
  Esc: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Space: "Space",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

/** What a row's `keys` array parsed to, or why it could not be parsed. */
export interface ParsedKeys {
  chords: Chord[];
  error: string | null;
}

function makeChord(mods: string[], key: string): Chord {
  const ordered = MOD_ORDER.filter((m) => mods.includes(m));
  return { mods: ordered, key, id: [...ordered, key].join("+") };
}

/** One key token → the key it names. `null` when the token is not a key this
 *  vocabulary knows: an unknown word ("Cmd", "Meta", "Super") must FAIL rather
 *  than quietly become a chord nothing can collide with. */
function normalizeKey(token: string): string | null {
  const named = NAMED_KEYS[token];
  if (named !== undefined) return named;
  if (/^F([1-9]|1[0-2])$/.test(token)) return token;
  if (token.length === 1) {
    const cp = token.codePointAt(0) ?? 0;
    // Printable ASCII, same window client/keys.ts resolves an event into.
    if (cp > 0x20 && cp <= 0x7e) return token.toLowerCase();
  }
  return null;
}

/** THE SHAPE A ROW'S `keys` MUST HAVE: zero or more modifiers in canonical
 *  order, then exactly one key token, which may name ALTERNATIVES — the sheet
 *  prints `Ctrl/Cmd` `↑ / ↓` as one row because move-line-up and
 *  move-line-down are one thing to learn, and that row is two chords here.
 *
 *  Order is enforced rather than sorted. `["Ctrl/Cmd", "Shift", "Alt", "T"]`
 *  would render a chip sequence no other row in the sheet uses, and a reader
 *  comparing two rows by eye is comparing the printed order. */
export function parseKeys(tokens: string[]): ParsedKeys {
  if (tokens.length === 0) return { chords: [], error: "empty keys array" };
  const mods: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const mod = MODIFIERS[tokens[i]];
    if (mod === undefined) {
      return { chords: [], error: `“${tokens[i]}” is not a modifier (expected ${Object.keys(MODIFIERS).join(", ")})` };
    }
    if (mods.includes(mod)) return { chords: [], error: `modifier “${tokens[i]}” twice` };
    if (MOD_ORDER.indexOf(mod) < MOD_ORDER.indexOf(mods[mods.length - 1] ?? "Mod")) {
      return { chords: [], error: `modifiers out of order — canonical is ${MOD_ORDER.join(", ")}` };
    }
    mods.push(mod);
  }
  const last = tokens[tokens.length - 1];
  if (MODIFIERS[last] !== undefined) return { chords: [], error: `“${last}” is a modifier, not a key` };
  const chords: Chord[] = [];
  // Split on a SPACED slash. The separator the sheet prints between
  // alternatives is `↑ / ↓`, with air on both sides, and the naked character
  // is a key in its own right — `Ctrl/Cmd` `/` opens this very sheet, and
  // splitting that on "/" yields two empty alternatives and a dead binding.
  for (const alt of last.split(/\s+\/\s+/).map((s) => s.trim())) {
    if (alt === "") return { chords: [], error: `empty alternative in “${last}”` };
    const key = normalizeKey(alt);
    if (key === null) return { chords: [], error: `“${alt}” is not a key this vocabulary knows` };
    chords.push(makeChord(mods, key));
  }
  return { chords, error: null };
}

/** WHICH SHELLS A ROW IS PRESSABLE IN. Unmarked means both — Ctrl/Cmd+K is
 *  answered by the sidebar in the app and by the blog's own overlay, and the
 *  sheet says so by not marking it. */
export function shellsOf(row: Pick<LedgerRow, "shell">): Shell[] {
  return row.shell ? [row.shell] : ["app", "blog"];
}

/** Same rule for the runtime. */
export function runtimesOf(row: Pick<LedgerRow, "desktop">): Runtime[] {
  return row.desktop ? ["desktop"] : ["browser", "desktop"];
}

/** The overlap of two rows' scopes, or null when they can never both be live.
 *
 *  ADMIN IS NOT SCOPE, and that is the one that looks wrong. `admin` narrows
 *  the AUDIENCE, not the surface: an admin session sees every row a visitor
 *  sees plus its own, so an admin-only binding and an everyone binding on the
 *  same chord collide for exactly the reader who has both. Filtering by it
 *  here would make the gate blind in the session that carries the most keys. */
export function scopeOverlap(
  a: Pick<LedgerRow, "shell" | "desktop">,
  b: Pick<LedgerRow, "shell" | "desktop">,
): { shells: Shell[]; runtimes: Runtime[] } | null {
  const shells = shellsOf(a).filter((s) => shellsOf(b).includes(s));
  if (shells.length === 0) return null;
  const runtimes = runtimesOf(a).filter((r) => runtimesOf(b).includes(r));
  if (runtimes.length === 0) return null;
  return { shells, runtimes };
}

/** A collision that is REAL, ARGUED and RESOLVED somewhere in the code — the
 *  gate's only escape hatch, and it costs a paragraph to use.
 *
 *  An entry that no longer collides is itself a failure, for the reason
 *  check-i18n fails on a dead dictionary key: an exception nobody can trip is
 *  a claim about the code that has stopped being true, and the next reader
 *  believes it. */
export interface ResolvedOverlap {
  /** Chord id, e.g. `Mod+Shift+z`. */
  chord: string;
  /** The two `label` keys, in the order the ledger lists them. */
  rows: [string, string];
  /** Where the tie is broken, and by what rule. Prose, not a shrug. */
  why: string;
}

export const RESOLVED: ResolvedOverlap[] = [
  {
    chord: "Mod+Shift+z",
    rows: ["scRedo", "cmdZen"],
    why:
      "Redo is CodeMirror's, zen is the shell's, and on macOS Cmd+Shift+Z is CodeMirror's ONLY " +
      "redo binding (redo is Mod-y everywhere else) — so the editor cannot simply give it up. " +
      "client/App.tsx breaks the tie by CARET: `if (e.metaKey && inEditor(e.target)) return` " +
      "hands the keystroke to the editor when the caret is in it on a Mac, and takes it for zen " +
      "everywhere else, stopPropagation included so one press can never both redo and leave zen. " +
      "Ctrl+Shift+Z, the palette row and zen's own ✕ all still enter zen from inside the editor.",
  },
];

// ── Parsing the ledger out of the .tsx source ──────────────────────────────

/** Two views of the source, from one pass.
 *
 *  `mask[i]` is true where character i is CODE — false inside a string literal
 *  or a comment — and it is what brace matching runs on: the comments in this
 *  repo are PROSE by house rule, and the prose above the Sections group opens
 *  a brace nobody meant as structure.
 *
 *  `stripped` is the same source with every comment character replaced by a
 *  space (newlines kept, so every index and every line number still lines up).
 *  Field splitting runs on THAT, because a field is `name: value` and the
 *  house comment style is full of colons and commas — "SECTIONS ARE THEIR OWN
 *  GROUP for the reason Formatting is: a heading is…" sits directly above
 *  `title:`, and read as code it swallowed two whole groups of the ledger. */
function scanSource(src: string): { mask: boolean[]; stripped: string } {
  const mask = new Array<boolean>(src.length).fill(true);
  // split(""), not [...src]: index parity with the original string is the
  // whole contract here, and spreading walks CODE POINTS.
  const chars = src.split("");
  const blank = (i: number) => {
    if (chars[i] !== "\n") chars[i] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        blank(i);
        mask[i++] = false;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        blank(i);
        mask[i++] = false;
      }
      for (let n = 0; n < 2 && i < src.length; n++) {
        blank(i);
        mask[i++] = false;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      mask[i++] = false;
      while (i < src.length) {
        if (src[i] === "\\") {
          mask[i++] = false;
          if (i < src.length) mask[i++] = false;
          continue;
        }
        const done = src[i] === quote;
        mask[i++] = false;
        if (done) break;
      }
      continue;
    }
    i++;
  }
  return { mask, stripped: chars.join("") };
}

const OPENERS = "([{";
const CLOSERS = ")]}";

/** Index of the bracket closing the one at `open`, or -1. */
function matchBracket(src: string, mask: boolean[], open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (!mask[i]) continue;
    if (OPENERS.includes(src[i])) depth++;
    else if (CLOSERS.includes(src[i])) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The `{…}` object literals sitting directly inside `[from, to)`. */
function objectsIn(src: string, mask: boolean[], from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = from;
  while (i < to) {
    if (mask[i] && src[i] === "{") {
      const end = matchBracket(src, mask, i);
      if (end === -1 || end >= to) break;
      out.push([i, end]);
      i = end + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** Split an object literal's interior on its OWN commas — the ones at depth
 *  zero. `run: () => { … }` is one field, however many commas it holds. */
function fieldsOf(src: string, mask: boolean[], open: number, close: number): Map<string, string> {
  const fields = new Map<string, string>();
  let depth = 0;
  let start = open + 1;
  const flush = (end: number) => {
    const part = src.slice(start, end);
    const colon = part.indexOf(":");
    if (colon !== -1) {
      const name = part.slice(0, colon).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fields.set(name, part.slice(colon + 1).trim());
    }
    start = end + 1;
  };
  for (let i = open + 1; i < close; i++) {
    if (!mask[i]) continue;
    if (OPENERS.includes(src[i])) depth++;
    else if (CLOSERS.includes(src[i])) depth--;
    else if (src[i] === "," && depth === 0) flush(i);
  }
  flush(close);
  return fields;
}

const STRING_LITERAL = /"((?:[^"\\]|\\.)*)"/;

function stringValue(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const m = STRING_LITERAL.exec(raw.trim());
  return m ? m[1] : null;
}

function arrayValue(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  if (!raw.trim().startsWith("[")) return null;
  // UNESCAPED, because this reads SOURCE TEXT and a source string is not its
  // own value. The pattern already tolerates escapes so it does not stop at a
  // `\"`; without also undoing them, the one key that needs an escape — the
  // backslash the pane split is bound to — arrives here as the two characters
  // `\\`, which is not a single printable character and so "is not a key this
  // vocabulary knows". The gate was refusing a binding for being spelled
  // correctly in TypeScript.
  return [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1].replace(/\\(.)/g, "$1"),
  );
}

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === "\n") line++;
  return line;
}

export interface ParsedLedger {
  rows: LedgerRow[];
  errors: string[];
}

/** Read `const GROUPS: Group[] = […]` out of ShortcutsHelp.tsx's source text.
 *  Source text, and not an import: the table's rows carry `run:` closures over
 *  the zustand store and the theme picker, so importing it drags React and the
 *  whole app into a script whose entire point is that it runs in a second with
 *  no browser. check-i18n.mjs reads the DICT block the same way. */
export function parseGroups(src: string): ParsedLedger {
  const errors: string[] = [];
  const rows: LedgerRow[] = [];
  const DECL = "const GROUPS: Group[] = [";
  const anchor = src.indexOf(DECL);
  if (anchor === -1) {
    return { rows, errors: [`ShortcutsHelp.tsx: no \`${DECL}\` — the ledger moved or was renamed`] };
  }
  // Everything below reads `code` — the source with its comments blanked to
  // spaces, index for index — so a colon or a comma inside a prose comment can
  // never be read as a field boundary.
  const { mask, stripped: code } = scanSource(src);
  // The LAST bracket of the declaration, not the first one after it: `Group[]`
  // carries a pair of its own, and matching from there closes immediately and
  // yields an empty table — which the gate then reports as "zero rows" rather
  // than as the collisions it was built to find.
  const open = anchor + DECL.length - 1;
  const close = matchBracket(code, mask, open);
  if (close === -1) return { rows, errors: ["ShortcutsHelp.tsx: the GROUPS array is not closed"] };

  for (const [gOpen, gClose] of objectsIn(code, mask, open + 1, close)) {
    const group = fieldsOf(code, mask, gOpen, gClose);
    const title = stringValue(group.get("title"));
    const itemsRaw = group.get("items");
    if (title === null) {
      errors.push(`ShortcutsHelp.tsx:${lineOf(code, gOpen)}: a group with no \`title:\``);
      continue;
    }
    if (itemsRaw === undefined) {
      errors.push(`ShortcutsHelp.tsx:${lineOf(code, gOpen)}: group ${title} has no \`items:\``);
      continue;
    }
    // `fieldsOf` handed back the items array's TEXT; the mask is indexed
    // against the source, so find the bracket itself again to walk it.
    const itemsOpen = code.indexOf("[", code.indexOf("items:", gOpen));
    const itemsClose = matchBracket(code, mask, itemsOpen);
    for (const [iOpen, iClose] of objectsIn(code, mask, itemsOpen + 1, itemsClose)) {
      const item = fieldsOf(code, mask, iOpen, iClose);
      const label = stringValue(item.get("label"));
      const line = lineOf(code, iOpen);
      if (label === null) {
        errors.push(`ShortcutsHelp.tsx:${line}: a row with no \`label:\``);
        continue;
      }
      const shell = stringValue(item.get("shell"));
      if (shell !== null && shell !== "app" && shell !== "blog") {
        errors.push(`ShortcutsHelp.tsx:${line}: ${label} has shell “${shell}”, which is not a shell`);
      }
      rows.push({
        group: title,
        label,
        keys: arrayValue(item.get("keys")),
        via: stringValue(item.get("via")),
        admin: item.get("admin")?.trim() === "true",
        shell: shell === "app" || shell === "blog" ? shell : null,
        desktop: item.get("desktop")?.trim() === "true",
        line,
      });
    }
  }
  if (rows.length === 0) errors.push("ShortcutsHelp.tsx: the GROUPS array parsed to zero rows");
  return { rows, errors };
}

// ── Parsing the ledger's RENDERING in docs/keymap.md ───────────────────────

export const DOC_BEGIN = "<!-- keymap:begin -->";
export const DOC_END = "<!-- keymap:end -->";

export interface DocChord {
  chord: Chord;
  /** 1-based line in docs/keymap.md. */
  line: number;
  /** The Keys cell it came out of, for the report. */
  cell: string;
}

export interface ParsedDoc {
  chords: DocChord[];
  errors: string[];
}

/** Every chord claimed between the two markers in docs/keymap.md.
 *
 *  The markers exist because the page is not ONLY the ledger: it also names
 *  the surfaces that carry no keystroke (a click, the slash menu, a drag in
 *  the outline), the designer's own keys, and — in the prose about non-Latin
 *  layouts — chords belonging to the BROWSER (`Ctrl Shift W` closes your
 *  window). A gate that swept the whole file would demand Vellum bind them.
 *
 *  Inside the region a table row's first cell is a chord or the region is
 *  wrong. `` `Ctrl/Cmd ↑` / `↓` `` is how the page has always written a pair,
 *  so a span carrying no modifier inherits the previous span's — the reader's
 *  own reading of that line, made mechanical. */
export function parseKeymapDoc(src: string): ParsedDoc {
  const chords: DocChord[] = [];
  const errors: string[] = [];
  const begin = src.indexOf(DOC_BEGIN);
  const end = src.indexOf(DOC_END);
  if (begin === -1 || end === -1 || end < begin) {
    return { chords, errors: [`docs/keymap.md: missing or inverted ${DOC_BEGIN} … ${DOC_END} markers`] };
  }
  const lines = src.split("\n");
  const firstLine = lineOf(src, begin);
  const lastLine = lineOf(src, end);
  for (let n = firstLine; n <= lastLine; n++) {
    const line = lines[n - 1];
    if (!line.startsWith("|")) continue;
    const cell = line.slice(1, line.indexOf("|", 1) === -1 ? undefined : line.indexOf("|", 1)).trim();
    if (cell === "Keys" || /^[\s:|-]*$/.test(cell)) continue; // header, separator
    const spans = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    if (spans.length === 0) {
      errors.push(`docs/keymap.md:${n}: a row inside the ledger region whose Keys cell holds no chord — “${cell}”`);
      continue;
    }
    let inherited: string[] = [];
    for (const span of spans) {
      const tokens = span.split(/\s+/);
      const bare = tokens.every((tok) => MODIFIERS[tok] === undefined);
      const parsed = parseKeys(bare && inherited.length > 0 ? [...inherited, ...tokens] : tokens);
      if (parsed.error !== null) {
        errors.push(`docs/keymap.md:${n}: “${span}” — ${parsed.error}`);
        continue;
      }
      if (!bare) inherited = tokens.slice(0, -1);
      for (const chord of parsed.chords) chords.push({ chord, line: n, cell });
    }
  }
  return { chords, errors };
}
