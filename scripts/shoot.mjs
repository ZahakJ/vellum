// Dev screenshot harness (not shipped): boots nothing itself — point it at a running server.
// Usage: node scripts/shoot.mjs http://localhost:6801 /path/to/outdir
//
// Requires playwright (not a dependency of the app itself):
//   npm i -D playwright                 # the library
//   npx playwright install chromium     # its browser — OR skip and use a system browser:
//   CHROMIUM=/usr/bin/chromium node scripts/shoot.mjs ...
// Browser resolution order: $CHROMIUM (path to a chromium/chrome binary), else
// playwright's own managed chromium.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "[shoot] playwright is not installed.\n" +
      "  npm i -D playwright\n" +
      "  npx playwright install chromium   (or set CHROMIUM=/path/to/chromium)"
  );
  process.exit(1);
}

const [url = "http://localhost:6801", out = "shots"] = process.argv.slice(2);
const executablePath = process.env.CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
// Open a note by tree-row title; on vaults without it (any real vault),
// fall back to the first visible file row so shots still show an open note.
const openNote = async (title) => {
  let row = page.locator(`.s-tree :text("${title}")`).first();
  if (!(await row.count())) {
    row = page.locator(".s-tree__item--file").first();
    if (await row.count()) console.log(`[shoot] "${title}" not in vault — using first note`);
  }
  if (await row.count()) { await row.click(); await page.waitForTimeout(900); return true; }
  console.log(`[shoot] no note rows in tree`);
  return false;
};

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1000);
await shot("0-fresh");
await openNote("Welcome");
await shot("1-editor-dark");
await page.keyboard.press("Control+g");
await page.waitForTimeout(1800);
await shot("2-graph-dark");
await page.keyboard.press("Control+g");
await page.waitForTimeout(300);
await page.keyboard.press("Control+p");
await page.waitForTimeout(400);
await shot("3-palette-dark");
await page.keyboard.type("wiki");
await page.waitForTimeout(500);
await shot("4-palette-query");
await page.keyboard.press("Escape");
// Embeds/transclusion gate (seed vault only): skip silently when absent.
const embedsRow = page.locator('.s-tree :text("Embeds & Transclusion")').first();
if (await embedsRow.count()) {
  await embedsRow.click();
  await page.waitForTimeout(1400);
  await shot("7-embeds");
}
await page.evaluate(() => { localStorage.setItem("vellum.theme", "parchment"); location.reload(); });
await page.waitForLoadState("load");
await page.waitForTimeout(1000);
await openNote("Welcome");
await shot("5-editor-light");
await page.keyboard.press("Control+g");
await page.waitForTimeout(1500);
await shot("6-graph-light");
await page.evaluate(() => localStorage.setItem("vellum.theme", "iron-gall"));
await browser.close();
console.log("[shoot] done →", out);
