// Dev harness (not shipped): screenshot the settings panel's CONTROL SYSTEM —
// every tab, with a picker OPEN, in both languages and several themes, at two
// widths. What it is proving: no native select/checkbox chrome anywhere, and
// every popover contained inside the window.
//   node scripts/shoot-controls.mjs http://localhost:7021 test1234 /outdir
// env: THEME=parchment LANGSET=ar W=1280 H=800 CHROMIUM=/usr/bin/chromium
import { chromium } from "playwright";

const [url = "http://localhost:7021", password = "test1234", out = "shots"] = process.argv.slice(2);
const executablePath = process.env.CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const width = Number(process.env.W || 1440);
const height = Number(process.env.H || 900);
const ctx = await browser.newContext({ viewport: { width, height } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));

const tag = `${process.env.LANGSET || "en"}-${process.env.THEME || "iron-gall"}-${width}x${height}`;

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
await page.waitForTimeout(1000);
if (process.env.THEME) {
  await page.evaluate((theme) => {
    localStorage.setItem("vellum.theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, process.env.THEME);
  await page.waitForTimeout(200);
}

await page.evaluate(() => document.querySelector(".s-statusbar__gear, [title*='ettings'], [title*='إعداد']")?.click());
await page.waitForTimeout(500);
if (!(await page.locator(".s-smodal").count())) {
  // Fall back to the palette command.
  await page.keyboard.press("Control+p");
  await page.waitForTimeout(300);
  await page.keyboard.type("settings");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
}
const shot = (name) => page.screenshot({ path: `${out}/${tag}-${name}.png` });

const tabs = await page.locator(".s-smodal__railbtn").allTextContents();
console.log("[tabs]", tabs.join(" | "));

for (let i = 0; i < tabs.length; i++) {
  await page.locator(".s-smodal__railbtn").nth(i).click();
  await page.waitForTimeout(450);
  await shot(`tab${i}-closed`);
  // Open the LAST select-ish control on the tab: the one most likely to run
  // off the bottom of the panel, which is the containment claim.
  const triggers = page.locator(".s-smodal__body [role='combobox']:not([disabled])");
  const n = await triggers.count();
  if (n > 0) {
    await triggers.nth(n - 1).click();
    await page.waitForTimeout(600);
    await shot(`tab${i}-open`);
    // Prove containment numerically as well as visually.
    const box = await page.locator(".s-ctl-pop").boundingBox();
    if (box) {
      const overflow = {
        top: Math.round(box.y),
        bottom: Math.round(height - (box.y + box.height)),
        left: Math.round(box.x),
        right: Math.round(width - (box.x + box.width)),
      };
      const flipped = await page.locator(".s-ctl-pop--up").count();
      console.log(`[pop ${tabs[i]}]`, JSON.stringify({ ...overflow, flipped: flipped > 0 }));
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

// Typography, with the font picker open on the Arabic slot: the specimen must
// still be visible above it.
const typo = tabs.findIndex((label) => /typograph|الطباعة/i.test(label));
if (typo >= 0) {
  await page.locator(".s-smodal__railbtn").nth(typo).click();
  await page.waitForTimeout(400);
  const pickers = page.locator(".s-smodal__body [role='combobox']:not([disabled])");
  for (const [i, name] of [[0, "prose"], [3, "arabic"]]) {
    if ((await pickers.count()) > i) {
      // Nudge the row clear of the sticky specimen first: the browser's own
      // scroll-into-view does not know a sticky block is overlapping.
      await page.evaluate((idx) => {
        const body = document.querySelector(".s-smodal__body");
        const trigger = body?.querySelectorAll("[role='combobox']:not([disabled])")[idx];
        const spec = document.querySelector(".s-smodal__specwrap");
        if (!body || !trigger || !spec) return;
        body.scrollTop += trigger.getBoundingClientRect().top - spec.getBoundingClientRect().bottom - 12;
      }, i);
      // `.s-smodal__body` scrolls smoothly, so the click has to wait for the
      // scroll to land or it aims at where the row used to be.
      await page.waitForTimeout(800);
      await pickers.nth(i).click();
      await page.waitForTimeout(900);
      await shot(`fonts-${name}-open`);
      const specimen = await page.locator(".s-smodal__specwrap").boundingBox();
      const pop = await page.locator(".s-ctl-pop").boundingBox();
      if (specimen && pop) {
        const covered = pop.y < specimen.y + specimen.height && pop.y + pop.height > specimen.y;
        console.log(`[specimen ${name}] visible=${specimen.y >= 0} coveredByPopover=${covered}`);
      }
      // Type into the filter to prove the filter + face rendering.
      await page.keyboard.type("a");
      await page.waitForTimeout(700);
      await shot(`fonts-${name}-filter`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }
  }
}

await browser.close();
console.log("[shoot-controls] done ->", out);
