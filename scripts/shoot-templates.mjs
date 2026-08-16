// Dev harness (not shipped): the banner resolution ladder and the template
// commands. It ASSERTS and exits 1 — both of these fail SILENTLY when they
// fail (a banner that names nothing used to erase itself; a template that
// copies its `id:` produces notes that look right and collide later), which is
// exactly the class of bug a screenshot alone will not catch.
//
//   node scripts/shoot-templates.mjs http://localhost:7073 /outdir
// env: CHROMIUM=/usr/bin/chromium
//
// The vault must carry the BannerTest/ notes this script's sibling comment
// describes (four accepted forms + one typo) and a templates folder.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [url = "http://localhost:7073", out = "shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (err) => console.log(`  page error: ${err.message}`));

const fail = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

// Permalinks are "/Folder/Note" — no /note/ prefix, no extension (router.ts).
const open = async (path) => {
  const url_ = `${url}/${path.replace(/\.md$/, "").split("/").map(encodeURIComponent).join("/")}`;
  await page.goto(url_, { waitUntil: "networkidle" });
  await page.waitForTimeout(1100);
};

// ── Banners ────────────────────────────────────────────────────────────────
// One note per rung of the ladder. The image has to actually LOAD (naturalWidth
// > 0): a hero whose <img> is in the DOM with a 404 behind it is the failure
// this feature is about, and it is invisible to a "does the element exist" test.
console.log("\nBanner resolution (editor, live preview)");
for (const [note, label] of [
  ["BannerTest/Exact.md", "exact vault path"],
  ["BannerTest/Beside.md", "bare name beside the note"],
  ["BannerTest/Under.md", "path under the note's folder"],
  ["BannerTest/Bare.md", "bare name, vault-wide"],
]) {
  await open(note);
  const state = await page.evaluate(() => {
    const img = document.querySelector(".cm-s-banner__img");
    const missing = document.querySelector(".cm-s-banner__missing");
    return {
      img: !!img,
      loaded: img ? img.naturalWidth > 0 : false,
      missing: !!missing,
      src: img?.getAttribute("src") ?? null,
    };
  });
  check(state.img && state.loaded && !state.missing, `hero loads — ${label}`, state.src ?? "no <img>");
}

// The typo. An ADMIN must be told; the old behaviour was to delete the hero,
// which made "banner: nope-typo.png" and "no banner at all" identical.
await open("BannerTest/Missing.md");
const missing = await page.evaluate(() => {
  const box = document.querySelector(".cm-s-banner__missing");
  return {
    shown: !!box,
    names: box?.textContent?.includes("nope-typo.png") ?? false,
    action: !!box?.querySelector("[data-action='set-banner']"),
    noImg: !document.querySelector(".cm-s-banner__img"),
  };
});
check(missing.shown, "unresolvable banner shows the placeholder (admin)");
check(missing.names, "the placeholder names the value that failed");
check(missing.action, "the placeholder offers Set banner…");
check(missing.noImg, "no broken <img> beside it");
await page.screenshot({ path: `${out}/banner-missing.png` });

// The same note in reading view — the rule is per-audience, not per-surface.
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", ctrlKey: true, bubbles: true })));
await page.waitForTimeout(600);
check(
  await page.evaluate(() => !!document.querySelector(".s-rv-banner__missing")),
  "reading view shows it too (admin)",
);
await page.screenshot({ path: `${out}/banner-missing-reading.png` });
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", ctrlKey: true, bubbles: true })));
await page.waitForTimeout(400);

// ── Templates ──────────────────────────────────────────────────────────────
console.log("\nTemplate picker");
await open("BannerTest/Exact.md");
await page.keyboard.press("Control+Alt+T");
await page.waitForTimeout(1200);
const picker = await page.evaluate(() => {
  const box = document.querySelector(".s-tmpl");
  return {
    open: !!box,
    items: box ? box.querySelectorAll(".s-tmpl__item").length : 0,
    preview: box?.querySelector(".s-tmpl__pre")?.textContent ?? "",
    foot: box?.querySelector(".s-tmpl__foot")?.textContent ?? "",
  };
});
check(picker.open, "Ctrl+Alt+T opens the picker");
check(picker.items > 0, "the templates folder was found", `${picker.items} template(s)`);
check(picker.foot.includes("Templates"), "the picker names the folder in force", picker.foot);
// The preview shows what will LAND: {{date}} is already a date, {{Title}} is
// already the note's name. A preview of the raw file would be the file.
check(!picker.preview.includes("{{date}}"), "preview fills {{date}}", picker.preview.slice(0, 40));
check(!picker.preview.includes("{{Title}}"), "preview fills {{Title}}");
check(/\d{4}-\d{2}-\d{2}/.test(picker.preview), "…with an ISO date", picker.preview.slice(0, 40));
await page.screenshot({ path: `${out}/template-picker.png` });

// Insert it, then read the note back off the wire: the frontmatter must have
// MERGED (one --- block, the target's own keys kept) and the template's `id:`
// must have been re-minted.
await page.keyboard.press("Enter");
await page.waitForTimeout(1500);
const after = await page.evaluate(async () => {
  const res = await fetch("/api/note?path=" + encodeURIComponent("BannerTest/Exact.md"));
  return (await res.json()).content;
});
const blocks = (after.match(/^---$/gm) ?? []).length;
check(blocks === 2, "one frontmatter block, not two", `${blocks} --- fences`);
check(after.includes("banner: Media/"), "the note kept its own banner: key");
check(/^id: \d{16}$/m.test(after), "the template's id: came through re-minted", (after.match(/^id: .*/m) ?? [""])[0]);
check(!after.includes("1733593454224005"), "…and is NOT the template's own id");
check(!after.includes("{{date}}") && !after.includes("{{Title}}"), "placeholders are filled in the note");
await page.screenshot({ path: `${out}/template-inserted.png` });

// ── New note from template ─────────────────────────────────────────────────
console.log("\nNew note from template");
await page.keyboard.press("Control+Alt+Shift+T");
await page.waitForTimeout(700);
check(await page.evaluate(() => !!document.querySelector(".s-confirm, .s-prompt, [role='dialog']")), "asks for the name first");
await page.screenshot({ path: `${out}/template-new-prompt.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

console.log("");
if (fail.length > 0) {
  console.log(`FAILED (${fail.length}): ${fail.join(", ")}`);
  await browser.close();
  process.exit(1);
}
console.log("All checks passed.");
await browser.close();
