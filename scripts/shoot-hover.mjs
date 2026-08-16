// Dev harness (not shipped): regression for the editor's wikilink hover
// preview. It ASSERTS and exits 1 — this feature died silently once already.
//   node scripts/shoot-hover.mjs http://localhost:7041 /outdir
// env: CHROMIUM=/usr/bin/chromium
//
// The case that matters is a note WITH FRONTMATTER. Previews shipped broken
// on notes carrying a block widget (the frontmatter card, $$ math, an image)
// because CodeMirror's `hoverTooltip` resolves the pointer with
// `posAtCoords`, which maps through the vertical line layout and drifts by
// whole lines once a widget is in the document; the drifted position landed
// on a line with no link, so no card opened. A bare note — no frontmatter, no
// math — is the one shape that kept working, so testing "a note" is not
// testing this, and testing ONE link is not either: the drift is a function
// of what sits above the line, so the first link on a page could work while
// the third was dead. The script therefore picks its subjects through the API
// (first line `---`, plus a non-embed [[wikilink]]) and requires EVERY
// visible link it hovers to open a card.
import { chromium } from "playwright";

const [url = "http://localhost:7041", out = "shots"] = process.argv.slice(2);
const SUBJECTS = 4;
const LINKS_PER_SUBJECT = 3;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });

const fail = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

// One page per subject, closed after it: a 1,158-image vault plus a loaded
// machine will OOM a single long-lived renderer ("Target crashed") halfway
// through, and a harness that dies mid-run reports nothing at all.
let page;
const newPage = async () => {
  if (page) await page.close().catch(() => {});
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  return page;
};
const card = () => page.locator(".cm-s-hovercard");
const open = async (path) => {
  await page.goto(`${url}/${path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/")}`, {
    waitUntil: "load",
  });
  await page.waitForTimeout(1400);
  // A rebuild during the run renames the lazy Editor chunk, and a cached
  // index.html then imports a URL that is 404 — the editor never mounts and
  // every check below fails for a reason that has nothing to do with hovering.
  if ((await page.locator(".cm-editor").count()) === 0) {
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1600);
  }
};
const away = async () => {
  await page.mouse.move(8, 870);
  await page.waitForTimeout(250);
};
await newPage();

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(800);

const subjects = await page.evaluate(async (want) => {
  const tree = await (await fetch("/api/tree")).json();
  const paths = [];
  (function walk(node) {
    if (node.type === "file" && node.path.toLowerCase().endsWith(".md")) paths.push(node.path);
    for (const child of node.children ?? []) walk(child);
  })(tree);
  const found = [];
  for (const path of paths.slice(0, 400)) {
    if (found.length >= want) break;
    const note = await (await fetch(`/api/note?path=${encodeURIComponent(path)}`)).json();
    const body = note.content ?? "";
    if (!/^---\r?\n/.test(body)) continue;
    const body2 = body.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
    if (/(^|[^!])\[\[[^\]]+\]\]/.test(body2)) found.push(path);
  }
  return found;
}, SUBJECTS);

if (subjects.length === 0) {
  console.log("[shoot-hover] no note with frontmatter + a wikilink in this vault — nothing to test");
  await browser.close();
  process.exit(0);
}

let hovered = 0;
let opened = 0;
let shot = false;
let crashed = 0;
for (const path of subjects) {
  try {
    await newPage();
    await open(path);
    const props = await page.locator(".cm-s-props").count();
    console.log(`[subject] ${path}${props ? "" : "  (no frontmatter card rendered!)"}`);
    if (!props) check(false, "the subject renders a frontmatter card (else this proves nothing)", path);
    const links = page.locator(".cm-s-wikilink");
    const n = Math.min(await links.count(), LINKS_PER_SUBJECT);
    for (let i = 0; i < n; i++) {
      const link = links.nth(i);
      await link.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await link.hover();
      await page.waitForTimeout(700);
      const ok = (await card().count()) > 0;
      hovered++;
      if (ok) opened++;
      else console.log(`    dead link #${i + 1}: ${JSON.stringify((await link.innerText()).slice(0, 40))}`);
      if (ok && !shot) {
        await page.screenshot({ path: `${out}/hover-frontmatter.png` });
        shot = true;
        check(
          (await page.locator(".cm-s-hovercard__title").first().innerText()).trim().length > 0,
          "the card names the target note",
        );
        check(
          (await page.locator(".cm-s-hovercard__body").first().innerText()).trim().length > 0,
          "the card carries an excerpt",
        );
      }
      await away();
    }
  } catch (err) {
    // A dead renderer is inconclusive, not a pass: counted and reported.
    crashed++;
    console.log(`  SKIP  ${path} — browser died (${String(err).split("\n")[0].slice(0, 80)})`);
  }
}
if (crashed) console.log(`[shoot-hover] ${crashed} subject(s) skipped: the browser crashed (memory?)`);

check(hovered >= 3, "enough links to be worth calling a test", `${hovered} hovered`);
check(opened === hovered, "every hovered wikilink opened a card", `${opened}/${hovered}`);

// Dismissal and the false-positive guard, on the last surviving page.
const link = page.locator(".cm-s-wikilink").first();
if ((await link.count()) > 0) {
  await link.scrollIntoViewIfNeeded();
  await link.hover();
  await page.waitForTimeout(700);
  const was = (await card().count()) > 0;
  const box = await link.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height * 4, { steps: 6 });
  await page.waitForTimeout(600);
  check(was && (await card().count()) === 0, "moving off the link dismisses the card");
  // Prose two lines below the link is not a link.
  await page.mouse.move(box.x + 30, box.y + box.height * 2 + 4, { steps: 4 });
  await page.waitForTimeout(700);
  check((await card().count()) === 0, "resting on plain prose opens nothing");
}

await browser.close();
if (fail.length) {
  console.error(`\n[shoot-hover] ${fail.length} check(s) failed:\n  - ${fail.join("\n  - ")}`);
  process.exit(1);
}
console.log("\n[shoot-hover] all checks passed.");
