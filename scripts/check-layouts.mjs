// Keyboard-layout gate (dev harness, not shipped): drives the REAL app with
// keydown events carrying non-Latin `key` values and correct `code`/keyCode —
// exactly what Chromium delivers when the system keyboard is Arabic, Russian,
// Greek or Hebrew — and asserts that every documented shortcut still fires.
//
//   node scripts/check-layouts.mjs http://localhost:7141 vellum7141
//   env: CHROMIUM=/usr/bin/chromium
//
// WHY THIS EXISTS. `e.key` is what the LAYOUT produced. On an Arabic keyboard
// the physical P key reports key="ح", so `e.key.toLowerCase() === "p"` is false
// and the command palette never opens. Every shortcut in the product died the
// moment the owner — who runs this instance in Arabic — switched his system
// layout, and no test noticed, because every test we had types Latin letters.
// So this harness types what the owner's keyboard types. Measured before the
// fix: 5 of 7 bindings dead under ar/ru/he, 4 of 7 under el.
//
// The events go in through the Chrome DevTools Protocol (Input.dispatchKeyEvent)
// rather than page.keyboard, because Playwright's keyboard always sends the US
// `key` for a given `code`; CDP lets us set key, code and windowsVirtualKeyCode
// independently, which is the whole point.
//
// THE MATRIX IS TWO-SIDED, and the second side is the one that keeps the fix
// honest. Non-Latin layouts prove the PHYSICAL fallback fires. Latin layouts
// that MOVE letters — AZERTY, Dvorak — prove it does not fire when it must
// not: on Dvorak the key under the `b` finger is physical KeyN, and the
// contract is that Ctrl+Alt there folds the pane while physical KeyB (which
// types `x`) does nothing. Layout first, physical only as the fallback.

import { chromium } from "playwright";

const [url = "http://localhost:7141", password = "vellum7141"] = process.argv.slice(2);
const executablePath = process.env.CHROMIUM;

/** A layout is described by what each physical key PRODUCES. Only the keys
 *  that differ from US QWERTY are listed; anything absent sits where US puts
 *  it. `latin: true` means the layout produces Latin letters, so `e.key`
 *  answers on its own and the physical fallback must stay out of the way. */
const LAYOUTS = [
  { id: "us", latin: true, produces: {} },

  // Arabic 101 — the owner's layout. Note KeyB: the Arabic layout puts the
  // lam-alef LIGATURE there, so `e.key` is TWO code points — which is also
  // why CodeMirror's own keyCode fallback does not cover it (its `isChar`
  // test requires a single code point).
  {
    id: "ar",
    produces: {
      KeyA: "ش", KeyB: "لا", KeyC: "ؤ", KeyD: "ي", KeyE: "ث", KeyF: "ب",
      KeyG: "ل", KeyH: "ا", KeyI: "ه", KeyJ: "ت", KeyK: "ن", KeyL: "م",
      KeyM: "ة", KeyN: "ى", KeyO: "خ", KeyP: "ح", KeyQ: "ض", KeyR: "ق",
      KeyS: "س", KeyT: "ف", KeyU: "ع", KeyV: "ر", KeyW: "ص", KeyX: "ء",
      KeyY: "غ", KeyZ: "ئ", Slash: "ظ",
    },
  },

  // Russian ЙЦУКЕН.
  {
    id: "ru",
    produces: {
      KeyA: "ф", KeyB: "и", KeyC: "с", KeyD: "в", KeyE: "у", KeyF: "а",
      KeyG: "п", KeyH: "р", KeyI: "ш", KeyJ: "о", KeyK: "л", KeyL: "д",
      KeyM: "ь", KeyN: "т", KeyO: "щ", KeyP: "з", KeyQ: "й", KeyR: "к",
      KeyS: "ы", KeyT: "е", KeyU: "г", KeyV: "м", KeyW: "ц", KeyX: "ч",
      KeyY: "н", KeyZ: "я", Slash: ".", Backslash: "\\",
    },
    // ЙЦУКЕН has no "/" on the slash key at all — it types "." there. The
    // slash lives on Shift+Backslash, and that is the key a Russian reader
    // presses for Ctrl+/. It arrives as key="/", so the LAYOUT answers and the
    // physical fallback correctly stays out of it.
    shifted: { Backslash: "/", Slash: "," },
  },

  // Greek. Slash still types "/" here — which is why Ctrl+/ was the ONE
  // binding that survived on this layout before the fix, and why "some of
  // them work" was never a reason to think the product was fine.
  {
    id: "el",
    produces: {
      KeyA: "α", KeyB: "β", KeyC: "ψ", KeyD: "δ", KeyE: "ε", KeyF: "φ",
      KeyG: "γ", KeyH: "η", KeyI: "ι", KeyJ: "ξ", KeyK: "κ", KeyL: "λ",
      KeyM: "μ", KeyN: "ν", KeyO: "ο", KeyP: "π", KeyQ: ";", KeyR: "ρ",
      KeyS: "σ", KeyT: "τ", KeyU: "θ", KeyV: "ω", KeyW: "ς", KeyX: "χ",
      KeyY: "υ", KeyZ: "ζ",
    },
  },

  // Hebrew.
  {
    id: "he",
    produces: {
      KeyA: "ש", KeyB: "נ", KeyC: "ב", KeyD: "ג", KeyE: "ק", KeyF: "כ",
      KeyG: "ע", KeyH: "י", KeyI: "ן", KeyJ: "ח", KeyK: "ל", KeyL: "ך",
      KeyM: "צ", KeyN: "מ", KeyO: "ם", KeyP: "פ", KeyQ: "/", KeyR: "ר",
      KeyS: "ד", KeyT: "א", KeyU: "ו", KeyV: "ה", KeyW: "'", KeyX: "ס",
      KeyY: "ט", KeyZ: "ז", Slash: ".",
    },
  },

  // French AZERTY — LATIN, and the control case: the letters move but stay
  // Latin, so `e.key` must keep winning. Physical KeyW types "z", so zen
  // (Ctrl+Shift+Z) has to fire from THERE, not from physical KeyZ.
  {
    id: "azerty",
    latin: true,
    produces: { KeyA: "q", KeyQ: "a", KeyW: "z", KeyZ: "w", KeyM: ",", Semicolon: "m" },
  },

  // Dvorak — LATIN, and the sharpest control: `b` lives on physical KeyN and
  // physical KeyB types `x`. A "physical codes always win" fix would fold the
  // pane from the wrong finger here and do nothing from the right one.
  {
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
  },
];

const PUNCT_CODES = {
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
};

/** What US QWERTY puts on a physical key. */
function usChar(code) {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter) return letter.toLowerCase();
  return PUNCT_CODES[code] ?? "";
}

const ALL_CODES = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Object.keys(PUNCT_CODES),
];

/** What this layout produces on a physical key, unshifted and shifted. */
function produced(layout, code, shift) {
  if (shift) {
    const explicit = layout.shifted?.[code];
    if (explicit !== undefined) return explicit;
    const base = layout.produces[code] ?? usChar(code);
    return /^[a-z]$/.test(base) ? base.toUpperCase() : base;
  }
  return layout.produces[code] ?? usChar(code);
}

/** The keystroke a reader of `layout` performs to type `char` — the physical
 *  key AND whether Shift is part of it. On a Latin layout that is wherever the
 *  layout put the letter (AZERTY's `z` is under physical W; the Russian `/` is
 *  under Shift+Backslash). On a layout with no such character at all there IS
 *  no such key, and the reader presses the US position — which is what the
 *  keycaps of an Arabic, Russian or Greek keyboard are printed with. */
function strokeFor(layout, char) {
  for (const code of ALL_CODES) if (produced(layout, code, false) === char) return { code, shift: false };
  for (const code of ALL_CODES) if (produced(layout, code, true) === char) return { code, shift: true };
  for (const code of ALL_CODES) if (usChar(code) === char) return { code, shift: false };
  throw new Error(`no physical key for "${char}" on ${layout.id}`);
}

/** The keydown Chromium delivers for that physical key under that layout. */
function eventFor(layout, code, shift) {
  const key = produced(layout, code, shift);
  // Windows virtual-key codes follow the LETTER on a Latin layout and fall
  // back to the US position on a non-Latin one. This is what makes
  // CodeMirror's own base[keyCode] fallback work — where it works at all.
  const base = layout.latin ? produced(layout, code, false) : usChar(code);
  const vk = /^[a-z]$/.test(base)
    ? base.toUpperCase().charCodeAt(0)
    : { ";": 186, "=": 187, ",": 188, "-": 189, ".": 190, "/": 191, "`": 192, "[": 219, "\\": 220, "]": 221, "'": 222 }[base] ?? 0;
  return { key, code, vk };
}

let cdp;
/** Press the keystroke that TYPES `char` on this layout, with the given
 *  modifiers. Shift is the union of what the caller asked for and what the
 *  layout needs to reach that character. */
async function press(page, layout, char, { ctrl = true, shift = false, alt = false, code } = {}) {
  const stroke = code ? { code, shift } : strokeFor(layout, char);
  const physical = stroke.code;
  shift = shift || stroke.shift;
  const ev = eventFor(layout, physical, shift);
  let modifiers = 0;
  if (alt) modifiers |= 1;
  if (ctrl) modifiers |= 2;
  if (shift) modifiers |= 8;
  const common = {
    modifiers,
    key: ev.key,
    code: ev.code,
    windowsVirtualKeyCode: ev.vk,
    nativeVirtualKeyCode: ev.vk,
  };
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
  await page.waitForTimeout(150);
}

const results = [];
function record(layout, name, ok, detail = "") {
  results.push({ layout, name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} [${layout}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

await page.goto(url, { waitUntil: "load" });
await page.evaluate(async (pw) => {
  await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
}, password);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
cdp = await ctx.newCDPSession(page);

const firstNote = page.locator(".s-tree__item--file").first();
if (await firstNote.count()) {
  await firstNote.click();
  await page.waitForTimeout(1200);
}

// State is read off the DOM, not off a store handle: the question this harness
// answers is "did the reader see anything happen", and a store probe would
// answer a different one (and would put a test hook into shipped code).
const seen = () => page.evaluate(() => {
  const cls = document.querySelector(".s-app")?.className ?? "";
  return {
    palette: document.querySelector(".s-palette:not(.s-shortcuts)") !== null,
    shortcuts: document.querySelector(".s-shortcuts") !== null,
    graph: document.querySelector(".s-graph") !== null,
    zen: cls.includes("s-app--zen"),
    reading: document.querySelector(".s-reading") !== null,
    nosidebar: cls.includes("s-app--nosidebar"),
  };
});

// Esc is layout-independent — it is a NAMED key, never a character — so it is
// the one keystroke this harness can lean on to get back to a clean slate.
const us = LAYOUTS[0];
async function reset() {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
  }
  let s = await seen();
  if (s.graph) { await press(page, us, "g"); s = await seen(); }
  if (s.reading) { await press(page, us, "e"); s = await seen(); }
  if (s.nosidebar) { await press(page, us, "b", { alt: true }); }
  await page.waitForTimeout(150);
}

async function focusEditor() {
  await page.evaluate(() => document.querySelector(".s-view .cm-content")?.focus());
  await page.waitForTimeout(200);
}

for (const layout of LAYOUTS) {
  await reset();

  await press(page, layout, "p");
  record(layout.id, "Ctrl+P opens the palette", (await seen()).palette);
  await reset();

  await press(page, layout, "g");
  record(layout.id, "Ctrl+G opens the graph", (await seen()).graph);
  await reset();

  await press(page, layout, "/");
  record(layout.id, "Ctrl+/ opens the shortcut sheet", (await seen()).shortcuts);
  await reset();

  await press(page, layout, "z", { shift: true });
  record(layout.id, "Ctrl+Shift+Z enters zen", (await seen()).zen);
  await reset();

  await press(page, layout, "e");
  record(layout.id, "Ctrl+E enters reading view", (await seen()).reading);
  await reset();

  // Ctrl+K is the only binding a blog visitor has, so it is the one that
  // matters most to a reader who never signs in.
  await press(page, layout, "k");
  const inSearch = await page.evaluate(
    () => document.activeElement?.closest(".s-search") !== null && document.activeElement?.closest(".s-search") !== undefined,
  );
  record(layout.id, "Ctrl+K focuses the search box", inSearch);
  await reset();

  const before = (await seen()).nosidebar;
  await press(page, layout, "b", { alt: true });
  const after = (await seen()).nosidebar;
  record(layout.id, "Ctrl+Alt+B folds the notes pane", before !== after, `nosidebar ${before} -> ${after}`);
  await reset();

  // The editor keymap (CodeMirror), not App's listener. A UNIQUE token per
  // layout: a shared one lets an earlier round's bold markers pass a later
  // round that did nothing at all.
  const editorText = () =>
    page.evaluate(() => document.querySelector(".s-view .cm-content")?.innerText ?? "");

  // Bold — the binding every reader arrives with.
  await focusEditor();
  const bold = `zzb${layout.id}zz`;
  await page.keyboard.type(bold);
  await page.waitForTimeout(200);
  for (let i = 0; i < bold.length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await press(page, layout, "b");
  await page.waitForTimeout(250);
  record(layout.id, "Ctrl+B bolds in the editor", (await editorText()).includes(`**${bold}**`));
  for (let i = 0; i < 14; i++) await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);

  // Strikethrough — Ctrl+Shift+X, and the reason it is here rather than any
  // other formatting key: a SHIFTED binding is the one CodeMirror resolves
  // through `shift[keyCode]` rather than through the key name, so it is the
  // case a fallback that forgot to carry a keyCode would silently miss.
  await focusEditor();
  const strike = `zzs${layout.id}zz`;
  await page.keyboard.type(strike);
  await page.waitForTimeout(200);
  for (let i = 0; i < strike.length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await press(page, layout, "x", { shift: true });
  await page.waitForTimeout(250);
  record(layout.id, "Ctrl+Shift+X strikes through in the editor", (await editorText()).includes(`~~${strike}~~`));
  for (let i = 0; i < 14; i++) await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  await reset();
}

// NEGATIVE SIDE. On Dvorak the physical B key types "x"; a fix that resolved
// control shortcuts by physical code alone would fold the notes pane from
// there, under a finger that means "x" to the reader. It must do nothing.
const dvorak = LAYOUTS.find((l) => l.id === "dvorak");
await reset();
const wrongBefore = (await seen()).nosidebar;
await press(page, dvorak, null, { alt: true, code: "KeyB" }); // types "x" on Dvorak
const wrongAfter = (await seen()).nosidebar;
record("dvorak", "Ctrl+Alt on the key that types 'x' does NOT fold the pane", wrongBefore === wrongAfter);
await reset();

// Same shape for the palette: physical KeyP types "l" on Dvorak.
const pBefore = (await seen()).palette;
await press(page, dvorak, null, { code: "KeyP" }); // types "l" on Dvorak
record("dvorak", "Ctrl on the key that types 'l' does NOT open the palette", (await seen()).palette === pBefore);
await reset();

// THE BLOG SHELL, signed out. Ctrl/Cmd+K is the only binding an anonymous
// reader has — every other one belongs to chrome that is not on their page —
// so it is the one binding whose failure a visitor experiences as "this site's
// search does not work". A fresh context: no cookie, no admin, blog layout.
{
  const visitor = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const vPage = await visitor.newPage();
  await vPage.goto(url, { waitUntil: "load" });
  await vPage.waitForTimeout(1200);
  const vCdp = await visitor.newCDPSession(vPage);
  const savedCdp = cdp;
  cdp = vCdp;
  for (const layout of LAYOUTS) {
    await press(vPage, layout, "k");
    const open = await vPage.evaluate(() => document.querySelector(".s-palette-overlay .s-palette") !== null);
    record(layout.id, "Ctrl+K opens the BLOG search overlay (signed out)", open);
    await vPage.keyboard.press("Escape");
    await vPage.waitForTimeout(150);
  }
  cdp = savedCdp;
  await visitor.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\ncheck-layouts: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  const byLayout = {};
  for (const f of failed) (byLayout[f.layout] ??= []).push(f.name);
  for (const [id, names] of Object.entries(byLayout)) {
    console.log(`  ${id}: ${names.length} failing — ${names.join("; ")}`);
  }
}
await browser.close();
process.exit(failed.length ? 1 : 0);
