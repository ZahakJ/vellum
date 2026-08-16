// Dev harness (not shipped): the theme library's screenshot gate.
//   node scripts/shoot-themes.mjs http://localhost:7012 test1234 /outdir
// env: CHROMIUM=/usr/bin/chromium  ONLY=cinnabar,linen  (skip the full sweep)
//
// Captures, in order:
//   theme-<id>            every built-in theme, editor with a real note open
//   cinnabar-graph        the constellation in the owner's theme
//   cinnabar-blog         a published article in the blog shell, as a visitor
//   picker-dark/-light    the theme picker open, in both kinds of room
// Reads nothing back — Read the PNGs.
import { chromium } from "playwright";
import { THEMES } from "../shared/themes.ts";

const [url = "http://localhost:7012", password = "test1234", out = "shots"] = process.argv.slice(2);
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const themes = only ?? THEMES;

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200)); });

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

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

// A real note, so the sweep judges prose, headings, links and the chrome at once.
const posts = await page.evaluate(async () => (await fetch("/api/posts")).json());
const notePath = posts[0]?.path;
if (notePath) {
  await page.evaluate((p) => {
    window.dispatchEvent(new CustomEvent("noop"));
    return p;
  }, notePath);
}
const row = page.locator(".s-tree__item--file").first();
if (await row.count()) {
  await row.click();
  await page.waitForTimeout(1200);
}

const setTheme = async (id) => {
  await page.evaluate((t) => {
    localStorage.setItem("vellum.theme", t);
    document.documentElement.setAttribute("data-theme", t);
  }, id);
  await page.waitForTimeout(280);
};

for (const id of themes) {
  await setTheme(id);
  await shot(`theme-${id}`);
}

// cinnabar in the two other rooms.
await setTheme("cinnabar");
await page.keyboard.press("Control+g");
await page.waitForTimeout(2500);
await shot("cinnabar-graph");
await page.keyboard.press("Control+g");
await page.waitForTimeout(500);

// The picker, open, in a dark theme and in a light one — from the status bar's
// own control when it opens it, else from the settings Appearance tab.
const openPicker = async () => {
  const themeBtn = page.locator(".s-statusbar__theme");
  if (await themeBtn.count()) {
    await themeBtn.first().click();
    await page.waitForTimeout(400);
    if (await page.locator(".s-tpick").count()) return "statusbar";
  }
  await page.locator(".s-statusbar__gear").click();
  await page.waitForTimeout(700);
  await page.locator(".s-smodal__railbtn").nth(1).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Browse themes|تصفح السمات/ }).click();
  await page.waitForTimeout(400);
  return "settings";
};

const via = await openPicker();
console.log("[picker opened via]", via);
await shot("picker-dark");
// Arrow-key preview: the room behind the panel must change with the highlight.
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(400);
await shot("picker-preview");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await shot("picker-reverted");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

await setTheme("linen");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);
const row2 = page.locator(".s-tree__item--file").first();
if (await row2.count()) { await row2.click(); await page.waitForTimeout(900); }
await openPicker();
await shot("picker-light");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
await page.keyboard.press("Escape");

// The blog shell, as an anonymous reader, in cinnabar.
const post = posts[0];
if (post) {
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await anon.newPage();
  await p2.goto(url, { waitUntil: "load" });
  await p2.evaluate(() => localStorage.setItem("vellum.theme", "cinnabar"));
  const slug = post.path.replace(/\.md$/, "").split("/").map(encodeURIComponent).join("/");
  await p2.goto(`${url}/${slug}`, { waitUntil: "load" });
  await p2.waitForTimeout(1800);
  await p2.screenshot({ path: `${out}/cinnabar-blog.png` });
  await p2.screenshot({ path: `${out}/cinnabar-blog-full.png`, fullPage: false });
  await anon.close();
}

await browser.close();
console.log("[shoot-themes] done →", out);
