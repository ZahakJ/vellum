// Dev harness (not shipped): the Arabic pass. Shoots the frontmatter
// properties card in both surfaces (live-preview editor + reading view) and
// ASSERTS GLYPH ORDER inside every tag chip, so it exits 1.
//   node scripts/shoot-rtl.mjs http://localhost:7041 /outdir
// env: CHROMIUM=/usr/bin/chromium  PASSWORD=…  NOTE=path/to/note.md
// It switches the instance language to Arabic through the API — point it at a
// scratch instance, not at anything you care about.
//
// Why geometry and not text: check-i18n reads dictionaries, and the DOM reads
// correct in source order, so both are blind to this entire class of bug. A
// chip whose label is built as a bare `#${tag}` string renders `matrix#` under
// an RTL base direction — `#` is bidi-neutral, so the paragraph sweeps it to
// the display end — and only the rendered x of the two glyphs can tell you.
// The rule (CONTRACTS, "Localization & RTL"): the isolate takes the label's
// own direction, so a Latin tag reads `#matrix` and an Arabic one `#بحث`,
// each with the hash on ITS OWN leading edge, inside one RTL page.
import { chromium } from "playwright";

const [url = "http://localhost:7041", out = "shots"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

const fail = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail.push(`${label}${detail ? ` ${detail}` : ""}`);
};

await page.goto(url, { waitUntil: "load" });
if (process.env.PASSWORD) {
  await page.evaluate(async (pw) => {
    await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
  }, process.env.PASSWORD);
}
await page.evaluate(async () => {
  await fetch("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language: "ar" }),
  });
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);
check(
  (await page.evaluate(() => document.documentElement.dir)) === "rtl",
  "the shell is actually RTL (nothing below means anything otherwise)",
);

// A note with `tags:` frontmatter; prefer one carrying BOTH scripts, since
// the whole point is that two chips on one card face opposite ways.
const subject =
  process.env.NOTE ??
  (await page.evaluate(async () => {
    const tree = await (await fetch("/api/tree")).json();
    const paths = [];
    (function walk(node) {
      if (node.type === "file" && node.path.toLowerCase().endsWith(".md")) paths.push(node.path);
      for (const child of node.children ?? []) walk(child);
    })(tree);
    // Frontmatter `tags:` is rarer than it looks (in the 1,392-note test
    // vault, 1,387 notes carry frontmatter but only a handful carry TAGS in
    // it), so the scan has to cover the whole tree — in parallel batches, or
    // it takes a minute. Preference: a note with BOTH scripts, since two
    // chips facing opposite ways on one card is the real test.
    let fallback = null;
    for (let i = 0; i < paths.length; i += 16) {
      const batch = await Promise.all(
        paths.slice(i, i + 16).map(async (path) => {
          const note = await (await fetch(`/api/note?path=${encodeURIComponent(path)}`)).json();
          const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(note.content ?? "");
          if (!fm) return null;
          const line = /^tags[ \t]*:[ \t]*(.*(?:\r?\n[ \t]*-[ \t]*.*)*)/im.exec(fm[1]);
          return line ? { path, value: line[1] } : null;
        }),
      );
      for (const hit of batch) {
        if (!hit) continue;
        const hasAr = /[؀-ۿ]/.test(hit.value);
        const hasLat = /[A-Za-z]/.test(hit.value);
        if (hasAr && hasLat) return hit.path;
        if (!fallback && (hasAr || hasLat)) fallback = hit.path;
      }
    }
    return fallback;
  }));
if (!subject) {
  console.log("[shoot-rtl] no note with `tags:` frontmatter in this vault — nothing to measure");
  await browser.close();
  process.exit(0);
}
console.log(`[shoot-rtl] subject: ${subject}`);
await page.goto(`${url}/${subject.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/")}`, {
  waitUntil: "load",
});
await page.waitForTimeout(1400);

/** For every chip: the rendered x of its first character (the `#`) against
 *  the x of its second (the first letter of the tag). */
async function measure(selector) {
  return page.evaluate((sel) => {
    const charRect = (el, index) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const len = n.textContent.length;
        if (index < seen + len) {
          const r = document.createRange();
          r.setStart(n, index - seen);
          r.setEnd(n, index - seen + 1);
          const box = r.getBoundingClientRect();
          return { x: box.x, w: box.width, ch: n.textContent[index - seen] };
        }
        seen += len;
      }
      return null;
    };
    return [...document.querySelectorAll(sel)].map((el) => {
      const text = el.textContent ?? "";
      return {
        text,
        dir: el.getAttribute("dir"),
        hash: charRect(el, 0),
        first: charRect(el, 1),
        rtlTag: /[؀-ۿ]/.test((text.match(/[A-Za-z؀-ۿ]/) ?? [""])[0]),
      };
    });
  }, selector);
}

async function assertChips(selector, surface) {
  const chips = (await measure(selector)).filter((c) => c.hash && c.hash.w > 0);
  check(chips.length > 0, `${surface}: the properties card renders tag chips`, `${chips.length} visible`);
  for (const chip of chips) {
    if (!chip.hash || !chip.first) continue;
    // Arabic tag → the hash leads on the RIGHT; Latin tag → on the LEFT.
    const ok = chip.rtlTag ? chip.hash.x > chip.first.x : chip.hash.x < chip.first.x;
    check(
      ok,
      `${surface}: ${JSON.stringify(chip.text)} reads ${chip.rtlTag ? "#…  (hash right)" : "#… (hash left)"}`,
      `hash x=${chip.hash.x.toFixed(1)} first "${chip.first.ch}" x=${chip.first.x.toFixed(1)} dir=${chip.dir}`,
    );
  }
}

// The card is collapsed by default and the two chip sets (the inline ones on
// the head, the ones in the `tags` row) are never visible at the same time —
// so both states have to be walked or half the chips go unmeasured.
await assertChips(".cm-s-props__tag", "editor · collapsed");
await page.screenshot({ path: `${out}/rtl-props-editor.png` });
await page.locator(".cm-s-props__head").first().click();
await page.waitForTimeout(400);
await assertChips(".cm-s-props__tag", "editor · expanded");
await page.screenshot({ path: `${out}/rtl-props-editor-expanded.png` });

// Reading view (Ctrl+E): the same card, a different renderer, the same bug.
// (The expand/collapse preference is shared, so this opens expanded.)
await page.keyboard.press("Control+e");
await page.waitForTimeout(1200);
await assertChips(".s-rv-props .s-rv-tag", "reading · expanded");
await page.screenshot({ path: `${out}/rtl-props-reading.png` });
await page.locator(".s-rv-props__head").first().click();
await page.waitForTimeout(400);
await assertChips(".s-rv-props .s-rv-tag", "reading · collapsed");
await page.screenshot({ path: `${out}/rtl-props-reading-collapsed.png` });

await browser.close();
if (fail.length) {
  console.error(`\n[shoot-rtl] ${fail.length} check(s) failed:\n  - ${fail.join("\n  - ")}`);
  process.exit(1);
}
console.log("\n[shoot-rtl] all checks passed.");
