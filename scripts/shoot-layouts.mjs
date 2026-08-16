// Dev harness (not shipped): the Ctrl/Cmd+/ sheet as a reader on a non-Latin
// keyboard sees it — the keycap letter plus what that key actually types.
//
//   node scripts/shoot-layouts.mjs http://localhost:7141 vellum7141 /outdir
//   env: LANGSET=ar  THEME=parchment  CHROMIUM=/usr/bin/chromium
//
// A headless browser has no system keyboard layout, so
// `navigator.keyboard.getLayoutMap()` would report US QWERTY and the sheet
// would render exactly as it always has. The layout map is therefore STUBBED
// here, with the real Arabic 101 and Russian ЙЦУКЕН tables — this shot is
// about whether client/layoutMap.ts and ShortcutsHelp.tsx draw the annotation
// correctly (and whether it survives RTL), not about the browser API, which
// scripts/check-layouts.mjs has no need of at all.

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [url = "http://localhost:7141", password = "vellum7141", out = "shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const ARABIC = {
  KeyA: "ش", KeyB: "لا", KeyC: "ؤ", KeyD: "ي", KeyE: "ث", KeyF: "ب",
  KeyG: "ل", KeyH: "ا", KeyI: "ه", KeyJ: "ت", KeyK: "ن", KeyL: "م",
  KeyM: "ة", KeyN: "ى", KeyO: "خ", KeyP: "ح", KeyQ: "ض", KeyR: "ق",
  KeyS: "س", KeyT: "ف", KeyU: "ع", KeyV: "ر", KeyW: "ص", KeyX: "ء",
  KeyY: "غ", KeyZ: "ئ", Slash: "ظ",
};
const RUSSIAN = {
  KeyA: "ф", KeyB: "и", KeyC: "с", KeyD: "в", KeyE: "у", KeyF: "а",
  KeyG: "п", KeyH: "р", KeyI: "ш", KeyJ: "о", KeyK: "л", KeyL: "д",
  KeyM: "ь", KeyN: "т", KeyO: "щ", KeyP: "з", KeyQ: "й", KeyR: "к",
  KeyS: "ы", KeyT: "е", KeyU: "г", KeyV: "м", KeyW: "ц", KeyX: "ч",
  KeyY: "н", KeyZ: "я",
};

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

async function shoot(name, table, lang) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  if (table) {
    await ctx.addInitScript((entries) => {
      Object.defineProperty(navigator, "keyboard", {
        configurable: true,
        value: { getLayoutMap: async () => new Map(entries) },
      });
    }, Object.entries(table));
  }
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
  if (lang) {
    await page.evaluate(async (l) => {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: l, blogLocale: l === "ar" ? "ar" : null }),
      });
    }, lang);
  }
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1400);
  if (process.env.THEME) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), process.env.THEME);
  }
  await page.keyboard.press("Control+/");
  await page.waitForTimeout(700);
  const sheet = page.locator(".s-shortcuts");
  if (!(await sheet.count())) {
    console.log(`[shoot-layouts] ${name}: the sheet did not open`);
  } else {
    await sheet.screenshot({ path: `${out}/${name}.png` });
    const annotated = await page.locator(".s-shortcuts__typed").count();
    const note = await page.locator(".s-shortcuts__layout").count();
    console.log(`[shoot-layouts] ${name}: ${annotated} annotated keys, ${note} explanation`);
  }
  await ctx.close();
}

await shoot("sheet-ar-arabic-keyboard", ARABIC, "ar");
await shoot("sheet-en-russian-keyboard", RUSSIAN, "en");
await shoot("sheet-en-us-keyboard", null, "en");
await browser.close();
