// Dev harness (not shipped): screenshot the settings panel, logged in as
// admin — the chrome shoot.mjs never signs in to see. Captures every tab
// through the rail and prints the panel's scroll geometry, the ⓘ env
// disclosure's geometry and the specimen font sizes, which is how the
// typography, the panel shape and the disclosure are measured rather than
// eyeballed.
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

// The ⓘ disclosure, measured rather than eyeballed: it is a REGION in the flow,
// so the two things worth asserting are that opening one does not resize the
// panel (a popover would have, and a panel that jumps under the pointer is the
// bug the fixed height exists to prevent) and that the .env line it reveals
// stays inside the scrolling body's own box.
// Identity, not the first tab: "This device" holds no server settings, so it
// has no environment variable to disclose — which is the whole point of it.
await rail.nth(1).click();
await page.waitForTimeout(300);
const disclosure = await page.evaluate(async () => {
  const btn = document.querySelector(".s-smodal__envbtn");
  if (!btn) return null;
  const modal = document.querySelector(".s-smodal");
  const before = Math.round(modal.getBoundingClientRect().height);
  btn.click();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const region = document.querySelector(".s-smodal__env:not([hidden])");
  const body = document.querySelector(".s-smodal__body").getBoundingClientRect();
  const box = region?.getBoundingClientRect() ?? null;
  return {
    expanded: btn.getAttribute("aria-expanded"),
    controls: btn.getAttribute("aria-controls") === region?.id,
    line: region?.querySelector(".s-smodal__envline")?.textContent ?? null,
    panelHeightBefore: before,
    panelHeightAfter: Math.round(modal.getBoundingClientRect().height),
    insideBody: box ? box.left >= body.left - 1 && box.right <= body.right + 1 : null,
  };
});
console.log("[env disclosure]", JSON.stringify(disclosure));
await shot("settings-env-disclosure");

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
