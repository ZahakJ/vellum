// Live keyboard/ARIA probe against a running instance. Not a gate — an
// instrument: it drives the real app with real keystrokes and prints what a
// keyboard reader would actually get, plus a screenshot for the eye.
//
//   CHROMIUM=/usr/bin/chromium node scripts/a11y-probe.mjs http://127.0.0.1:7092 [password]
//
// Kept out of package.json on purpose: check-a11y.mjs is the gate that runs
// everywhere; this one needs a browser and a server.

import { mkdirSync } from "node:fs";

// playwright is not a dependency of the app (see shoot.mjs). Resolve it from
// node_modules, or from $PLAYWRIGHT_PATH when it lives somewhere else.
let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_PATH ?? "playwright"));
} catch {
  console.error(
    "[a11y-probe] playwright not found.\n" +
      "  npm i -D playwright   (or set PLAYWRIGHT_PATH=/abs/path/to/playwright)",
  );
  process.exit(1);
}

const base = process.argv[2] ?? "http://127.0.0.1:7092";
const password = process.argv[3] ?? null;
const outDir = process.env.OUT_DIR ?? "/tmp/vellum-a11y";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const log = (...a) => console.log(...a);

await page.goto(base, { waitUntil: "networkidle" });

if (password) {
  await page.evaluate(async (pw) => {
    await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
  }, password);
  await page.reload({ waitUntil: "networkidle" });
}

/** Name a focused element the way a screen reader roughly would. */
const describeFocus = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "(body — focus lost)";
    const role = el.getAttribute("role") ?? el.tagName.toLowerCase();
    const name =
      el.getAttribute("aria-label") ??
      (el.getAttribute("aria-labelledby")
        ? document.getElementById(el.getAttribute("aria-labelledby"))?.textContent?.trim()
        : null) ??
      el.textContent?.trim().slice(0, 48) ??
      "";
    const ad = el.getAttribute("aria-activedescendant");
    const cur = ad ? document.getElementById(ad)?.textContent?.trim().slice(0, 40) : null;
    return `${role}: "${name}"${cur ? `  → active: "${cur}"` : ""}`;
  });

// ── 1. Tab order from the top ──────────────────────────────────────────────
log("\n── Tab order (first 14 stops) ────────────────────────────────");
await page.evaluate(() => document.body.focus());
for (let i = 0; i < 14; i++) {
  await page.keyboard.press("Tab");
  log(`  ${String(i + 1).padStart(2)}. ${await describeFocus()}`);
}

// ── 2. The tree, by keyboard alone ─────────────────────────────────────────
log("\n── Tree keyboard walk ────────────────────────────────────────");
const tree = page.locator('[role="tree"]');
if ((await tree.count()) > 0) {
  await tree.first().focus();
  log(`  focus:      ${await describeFocus()}`);
  for (const key of ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowDown", "End", "Home"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
    log(`  ${key.padEnd(11)}${await describeFocus()}`);
  }
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  log(`  Enter →     open note: ${await page.evaluate(() => location.pathname)}`);
} else {
  log("  (no role=tree — visitor sidebar)");
}

// ── 3. Command palette: roles + focus restoration ──────────────────────────
log("\n── Command palette ───────────────────────────────────────────");
const opener = await page.evaluate(() => {
  document.querySelector(".s-statusbar__btn")?.focus();
  return document.activeElement?.textContent?.trim().slice(0, 30) ?? "?";
});
log(`  opened from: "${opener}"`);
await page.keyboard.press("Control+p");
await page.waitForTimeout(250);
log(`  focus:       ${await describeFocus()}`);
log(
  `  roles:       ${await page.evaluate(() => {
    const input = document.querySelector(".s-palette-input");
    const list = document.querySelector(".s-palette-list");
    const opt = document.querySelector('.s-palette-item[role="option"]');
    return `input=${input?.getAttribute("role")} list=${list?.getAttribute("role")} row=${opt?.getAttribute("role")} selected=${opt?.getAttribute("aria-selected")}`;
  })}`,
);
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(80);
log(`  ArrowDown →  ${await describeFocus()}`);
await page.screenshot({ path: `${outDir}/palette.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
log(`  Escape →     focus restored to: ${await describeFocus()}`);

// ── 4. A dialog: trap + restore ────────────────────────────────────────────
log("\n── Settings dialog (trap + restore) ──────────────────────────");
const gear = page.locator(".s-statusbar__gear");
if ((await gear.count()) > 0) {
  await gear.first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  log(`  focus:       ${await describeFocus()}`);
  const ring = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () => document.querySelector(".s-smodal")?.contains(document.activeElement) ?? false,
    );
    if (!inside) {
      ring.push("ESCAPED THE DIALOG");
      break;
    }
  }
  log(`  40 tabs:     ${ring.length === 0 ? "stayed inside ✓" : ring[0]}`);
  const named = await page.evaluate(() => {
    const controls = [...document.querySelectorAll(".s-smodal__control input, .s-smodal__control select")];
    const nameless = controls.filter((c) => {
      const lab = c.id ? document.querySelector(`label[for="${CSS.escape(c.id)}"]`) : null;
      return !lab && !c.getAttribute("aria-label");
    });
    return `${controls.length} controls, ${nameless.length} without a name`;
  });
  log(`  labels:      ${named}`);
  await page.screenshot({ path: `${outDir}/settings.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  log(`  Escape →     focus restored to: ${await describeFocus()}`);
}

// ── 5. Reading view: are the wikilinks reachable? ──────────────────────────
log("\n── Reading view links ────────────────────────────────────────");
// Open something with prose in it first: the probe's own tree walk may have
// left a folder selected, and an empty pane proves nothing.
if (process.env.NOTE) {
  await page.evaluate((p) => history.pushState(null, "", p), process.env.NOTE);
  await page.evaluate(() => dispatchEvent(new PopStateEvent("popstate")));
  await page.waitForTimeout(700);
}
await page.keyboard.press("Control+e");
await page.waitForTimeout(900);
log(
  `  ${await page.evaluate(() => {
    const links = [...document.querySelectorAll(".s-rv-wikilink")];
    const reachable = links.filter((l) => l.tabIndex >= 0 || l.hasAttribute("href"));
    const imgs = [...document.querySelectorAll(".s-rv-img")];
    const noAlt = imgs.filter((i) => !i.hasAttribute("alt"));
    return `${links.length} wikilinks, ${reachable.length} keyboard-reachable · ${imgs.length} images, ${noAlt.length} without alt`;
  })}`,
);
await page.screenshot({ path: `${outDir}/reading.png` });

// ── 6. Landmarks and heading order ─────────────────────────────────────────
log("\n── Landmarks & headings ──────────────────────────────────────");
log(
  await page.evaluate(() => {
    const marks = [...document.querySelectorAll("main,nav,aside,header,footer,[role=region]")].map(
      (el) =>
        `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""}: ${el.getAttribute("aria-label") ?? "(unnamed)"}`,
    );
    const heads = [...document.querySelectorAll("h1,h2,h3,h4")].map(
      (h) => `${h.tagName} ${h.textContent.trim().slice(0, 34)}`,
    );
    return `  landmarks:\n    ${marks.join("\n    ")}\n  headings:\n    ${heads.join("\n    ") || "(none)"}`;
  }),
);

// ── 7. Nameless controls anywhere on the page ──────────────────────────────
log("\n── Nameless interactive elements ─────────────────────────────");
log(
  await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("button,a,input,select,textarea,[role=button],[role=link]")) {
      if (el.closest("[aria-hidden='true']")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const name =
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") &&
          document.getElementById(el.getAttribute("aria-labelledby"))?.textContent) ||
        el.textContent.trim() ||
        el.getAttribute("title") ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) ||
        "";
      if (name.trim() === "") bad.push(`${el.tagName.toLowerCase()}.${el.className || "(no class)"}`);
    }
    return bad.length === 0 ? "  none ✓" : `  ${bad.join("\n  ")}`;
  }),
);

await browser.close();
