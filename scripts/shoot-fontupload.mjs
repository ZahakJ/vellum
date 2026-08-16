// Dev harness (not shipped): exercise the font UPLOAD path in the real UI —
// a genuine .woff2 (accepted, family read from the font's own name table) and
// a PNG renamed .woff2 (refused on the magic bytes), plus the delete flow and
// its in-use protection.
//   node scripts/shoot-fontupload.mjs http://localhost:7021 test1234 /outdir /path/to/font.woff2
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [url = "http://localhost:7021", password = "test1234", out = "shots", fontPath] =
  process.argv.slice(2);
const executablePath = process.env.CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

// A PNG with a .woff2 name: the file the sniffer exists for.
const fake = "/tmp/not-a-font.woff2";
writeFileSync(fake, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(512)]));

await page.goto(url, { waitUntil: "load" });
await page.evaluate(async (pw) => {
  await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
}, password);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector(".s-statusbar__gear")?.click());
await page.waitForTimeout(500);
await page.locator(".s-smodal__railbtn").nth(3).click();
await page.waitForTimeout(500);
await page.evaluate(() => {
  const body = document.querySelector(".s-smodal__body");
  if (body) body.scrollTop = body.scrollHeight;
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/upload-0-section.png` });

const input = page.locator(".s-smodal__fonts input[type=file]");

// 1. The refusal.
await input.setInputFiles(fake);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/upload-1-rejected.png` });
console.log("[reject toast]", await page.locator(".s-toast").allTextContents());

await page.waitForTimeout(2500);

// 2. The real face.
if (fontPath) {
  await input.setInputFiles(fontPath);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/upload-2-accepted.png` });
  console.log("[accept toast]", await page.locator(".s-toast").allTextContents());
  console.log("[rows]", await page.locator(".s-smodal__fontrow").allTextContents());
}

// 3. Delete: the confirm dialog, then the row is gone.
const remove = page.locator(".s-smodal__fontrow .s-btn--danger").last();
if (await remove.count()) {
  await remove.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/upload-3-confirm.png` });
  await page.locator(".s-confirm button").last().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/upload-4-deleted.png` });
  console.log("[rows after delete]", await page.locator(".s-smodal__fontrow").allTextContents());
}

await browser.close();
console.log("[shoot-fontupload] done ->", out);
