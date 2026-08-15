// Dev harness (not shipped): screenshot the Backup & sync section and the
// status-bar badge's detail panel, in a given theme and language, and print
// the rendered text of both — which is how the bidi work is checked, since a
// torn line is visible in the DOM order as well as on screen.
//   node scripts/shoot-sync.mjs http://localhost:7006 test1234 /outdir
// env: THEME=parchment  LANGSET=ar  CHROMIUM=/usr/bin/chromium
// LANGSET writes the instance language through the API — point it at a scratch
// instance, not at anything you care about.
import { chromium } from "playwright";

const [url = "http://localhost:7006", password = "test1234", out = "shots"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

await page.goto(url, { waitUntil: "load" });
await page.evaluate(async (pw) => {
  await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
}, password);
if (process.env.LANGSET) {
  await page.evaluate(async (lang) => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: lang, blogLocale: lang === "ar" ? "ar" : null }),
    });
  }, process.env.LANGSET);
}
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
if (process.env.THEME) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), process.env.THEME);
  await page.waitForTimeout(200);
}
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

// The status-bar badge's detail panel (it replaced the native title tooltip).
await page.locator(".s-sync").click();
await page.waitForTimeout(600);
await shot("badge-popover");
console.log("[popover text]", JSON.stringify(await page.locator(".s-syncpop").innerText()));
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

await page.locator(".s-statusbar__gear").click();
await page.waitForTimeout(1200);
await page.locator(".s-smodal__railbtn").last().click();
await page.waitForTimeout(900);
await shot("sync-section");
const block = page.locator(".s-smodal__sync");
console.log("[status block]", JSON.stringify(await block.innerText()));
// Geometry of the failure line: one box per rendered line tells us whether
// bidi tore it apart.
console.log(
  "[git line]",
  JSON.stringify(
    await page.evaluate(() => {
      const el = document.querySelector(".s-smodal__syncgittext");
      if (!el) return null;
      return { text: el.textContent, dir: el.getAttribute("dir"), rects: el.getClientRects().length };
    }),
  ),
);
await browser.close();
