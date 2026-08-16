// Dev harness (not shipped): screenshot the site settings panel, logged in as
// admin — the chrome shoot.mjs never signs in to see. Captures every section
// through the rail and prints the panel's scroll geometry and the specimen
// font sizes, which is how the typography and panel-shape work is measured.
//   node scripts/shoot-settings.mjs http://localhost:7006 test1234 /outdir
// env: THEME=parchment  LANGSET=ar  HEIGHT=768  CHROMIUM=/usr/bin/chromium
// LANGSET writes the instance language through the API — point it at a scratch
// instance, not at anything you care about.
import { chromium } from "playwright";

const [url = "http://localhost:7006", password = "test1234", out = "shots"] = process.argv.slice(2);
const executablePath = process.env.CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const height = Number(process.env.HEIGHT || 900);
const ctx = await browser.newContext({ viewport: { width: 1440, height } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));

await page.goto(url, { waitUntil: "load" });
await page.evaluate(async (pw) => {
  await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
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
await page.waitForTimeout(1200);

const theme = process.env.THEME;
if (theme) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(200);
}

await page.locator(".s-statusbar__gear").click();
await page.waitForTimeout(1200);

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
await shot("settings-top");

// Measure the panel geometry the review complained about.
const geo = await page.evaluate(() => {
  const modal = document.querySelector(".s-smodal");
  const body = document.querySelector(".s-smodal__body");
  if (!modal || !body) return null;
  return {
    modalH: Math.round(modal.getBoundingClientRect().height),
    modalW: Math.round(modal.getBoundingClientRect().width),
    bodyH: Math.round(body.clientHeight),
    scrollH: Math.round(body.scrollHeight),
    screens: +(body.scrollHeight / body.clientHeight).toFixed(2),
  };
});
console.log("[geometry]", JSON.stringify(geo));

// Jump to each section through the rail when it exists.
const rail = page.locator(".s-smodal__railbtn");
const n = await rail.count();
console.log("[rail buttons]", n);
for (let i = 0; i < n; i++) {
  await rail.nth(i).click();
  await page.waitForTimeout(500);
  await shot(`settings-section-${i}`);
}
if (n === 0) {
  for (const y of [700, 1400, 2100, 2800]) {
    await page.evaluate((yy) => { document.querySelector(".s-smodal__body").scrollTop = yy; }, y);
    await page.waitForTimeout(300);
    await shot(`settings-scroll-${y}`);
  }
}

// Specimen font sizes — the typography blocker's measurement.
const spec = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".s-smodal__specline")) {
    const cs = getComputedStyle(el);
    out.push({
      cls: el.parentElement.className.split(" ").pop(),
      dir: el.getAttribute("dir") ?? el.querySelector("[dir]")?.getAttribute("dir") ?? "inherit",
      fontSize: cs.fontSize,
      family: cs.fontFamily.slice(0, 40),
      rect: Math.round(el.getBoundingClientRect().width),
    });
  }
  return out;
});
console.log("[specimens]", JSON.stringify(spec, null, 1));

await browser.close();
