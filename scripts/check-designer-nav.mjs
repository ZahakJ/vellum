// THE DESIGNER'S NAVIGATION AND ALIGNMENT GATE — and it exists because of a
// bug that shipped, in the owner's own language, past every other check.
//
// TWO CLASSES OF FAILURE, and neither is reachable from a unit test or from a
// screenshot somebody remembered to take in English:
//
//  A. A PREVIEW THAT IS NOT WHERE ITS BOX IS. Every surface in the designer
//     that shows a design draws it at 1120px (or 1280/834/390) and scales the
//     pixels into a smaller box. `transform-origin` is PHYSICAL and has no
//     logical form; the box it scales is placed by FLOW, which is logical. In
//     `[dir="rtl"]` those two disagree by (layoutWidth − boxWidth), and the
//     measured result was that all fifty-nine gallery cards on an Arabic
//     instance were blank rectangles — the page was drawn at x −145…76 of a
//     card at 754…975, entirely outside its own `overflow: hidden` — while the
//     preset detail sheet drew a page clipped to its right-hand third. In
//     English the same code is pixel-perfect, which is exactly why this is a
//     GATE and not a screenshot: the shot everybody takes is the one that
//     passes. So: the drawn page's rect is compared to its container's, in
//     both directions and at both widths, on the two surfaces that scale a
//     canvas — the gallery card and the preset detail. (The designer's own
//     stage is the third, and it is a different mechanism: an absolutely
//     positioned iframe, which is direction-proof by construction and is
//     already driven by `check-preview.mjs`.)
//
//  B. A ROOM WITH NO DOOR. Opening a preset is a NAVIGATION — it takes over
//     the shelf — so it owes its reader a way back, a name for where they are,
//     and a way to leave with the keyboard. Esc in particular has to unwind ONE
//     step (out of the preset) rather than closing the whole panel over an
//     unsaved design, which is a precedence question no static check can see.
//
//   PORT=6801 VELLUM_PASSWORD=… node scripts/check-designer-nav.mjs
//   env: CHROMIUM=/usr/bin/chromium  SHOT_DIR=/tmp/shots  LANGS=en,ar
//
// It switches the instance LANGUAGE (it must — that is the whole point) and
// puts the original back on the way out, on failure too.

import { chromium } from "playwright";

const PORT = process.env.PORT || "6801";
// 127.0.0.1, not localhost: Node resolves localhost to ::1 first and the
// server binds 0.0.0.0. Same note check-preview and check-design carry.
const BASE = process.env.VELLUM_URL || `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.VELLUM_PASSWORD || "";
const SHOTS = process.env.SHOT_DIR || null;
const LANGS = (process.env.LANGS || "en,ar").split(",").map((s) => s.trim()).filter(Boolean);
const WIDTHS = (process.env.WIDTHS || "1440,1280").split(",").map((s) => Number(s.trim()));
/** How far a drawn page may sit from its container's edge before it is a bug.
 *  Two pixels of sub-pixel rounding, and not one more. */
const SLOP = 2;

let failures = 0;
const ok = (label, cond, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
};

// ── the session ─────────────────────────────────────────────────────────────

const probe = await fetch(`${BASE}/api/me`).catch(() => null);
if (!probe) {
  console.error(`check-designer-nav: nothing is listening on ${BASE}. Start the server first.`);
  process.exit(1);
}
const me = await probe.clone().json();
let cookie = "";
if (!me.admin) {
  if (!PASSWORD) {
    console.error(
      "check-designer-nav: this session is NOT an admin, and the designer is an admin panel.\n" +
        `  Fix: VELLUM_PASSWORD=<the admin password> PORT=${PORT} node scripts/check-designer-nav.mjs`,
    );
    process.exit(1);
  }
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`check-designer-nav: login failed (${login.status}). Wrong VELLUM_PASSWORD?`);
    process.exit(1);
  }
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}
const auth = { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) };
const api = (path, init) => fetch(`${BASE}${path}`, { headers: auth, ...init });

// THE INSTANCE LANGUAGE IS THE FIXTURE, so it is also what has to be put back.
const languageBefore = me.language ?? "en";
let restored = false;
async function restore() {
  if (restored) return;
  restored = true;
  try {
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ language: languageBefore }),
    });
  } catch (err) {
    console.error(`check-designer-nav: RESTORE FAILED — instance may be left in a language it did not start in:`, err);
  }
}
process.on("exit", () => void restore());
process.on("SIGINT", () => process.exit(130));

// ── the browser ─────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

/** Open the designer on a fresh page at one language and one width. */
async function openDesigner(lang, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  if (cookie) {
    await context.addCookies(
      cookie.split("; ").map((pair) => {
        const [name, ...rest] = pair.split("=");
        return { name, value: rest.join("="), domain: new URL(BASE).hostname, path: "/" };
      }),
    );
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    console.log(`  [pageerror] ${String(e.message).slice(0, 200)}`);
    failures++;
  });
  await api("/api/settings", { method: "PATCH", body: JSON.stringify({ language: lang }) });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  // THE DOOR IS FOUND STRUCTURALLY, NOT BY ITS WORDS. The palette route
  // (`type "design"`) is the product's own and is what check-preview uses —
  // but it is a search over LOCALISED labels, so it opens nothing on the one
  // instance this gate exists for. The status bar's designer button is a
  // stable shape; every icon button there is tried in turn and the first one
  // that produces the panel is it.
  for (const button of await page.locator(".s-statusbar__icon").all()) {
    await button.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    if (await page.locator(".s-dsgr").count()) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
  await page.waitForSelector(".s-dsgr", { timeout: 10_000 });
  await page.waitForTimeout(1200);
  return { context, page };
}

/** How far a scaled page's rect sits from its container's, in px. */
const FIT = `(box) => {
  const page = box && box.querySelector(".s-dsgv__page");
  if (!page) return null;
  const b = box.getBoundingClientRect();
  const p = page.getBoundingClientRect();
  return { dx: Math.round(p.x - b.x), dw: Math.round(p.width - b.width) };
}`;

for (const lang of LANGS) {
  for (const width of WIDTHS) {
    console.log(`\n── ${lang} @ ${width} ──────────────────────────────────────`);
    const { context, page } = await openDesigner(lang, width);
    const shot = async (name) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/designer-${lang}-${width}-${name}.png` });
    };

    // ── where am I ──────────────────────────────────────────────────────────
    ok("the panel prints a crumb", (await page.locator(".s-dsgr__crumbs").count()) === 1,
      (await page.locator(".s-dsgr__crumbs").innerText().catch(() => "")).replace(/\n/g, " "));
    ok("the rail is ONE tab stop",
      (await page.locator('.s-dsgr__tab[tabindex="0"]').count()) === 1,
      "eight stops is eight presses to cross a menu");

    // Arrow keys walk the rail and carry the selection with them.
    await page.evaluate(() => document.querySelector('.s-dsgr__tab[tabindex="0"]')?.focus());
    const first = await page.evaluate(() => document.activeElement?.getAttribute("data-tab"));
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(350);
    const walked = await page.evaluate(() => ({
      focus: document.activeElement?.getAttribute("data-tab"),
      selected: document.querySelector('.s-dsgr__tab[aria-selected="true"]')?.getAttribute("data-tab"),
    }));
    ok("ArrowDown moves focus AND selection", walked.focus !== first && walked.focus === walked.selected,
      `${first} → ${walked.focus}`);
    await page.keyboard.press("End");
    await page.waitForTimeout(300);
    ok("End reaches the last room",
      (await page.evaluate(() => document.activeElement?.getAttribute("data-tab"))) === "file");
    await page.keyboard.press("Home");
    await page.waitForTimeout(300);
    ok("Home reaches the first",
      (await page.evaluate(() => document.activeElement?.getAttribute("data-tab"))) === "designs");

    // ── the shelf: every card's picture is INSIDE its card ──────────────────
    await page.evaluate(() => document.querySelector('[data-tab="presets"]')?.click());
    await page.waitForTimeout(3200);
    await shot("shelf");
    const cards = await page.evaluate(`([...document.querySelectorAll(".s-dsgp-card__stage .s-dsgv")]).map(${FIT})`);
    ok("cards drew real canvases", cards.length > 0, `n=${cards.length}`);
    const strayCards = cards.filter((c) => !c || Math.abs(c.dx) > SLOP || Math.abs(c.dw) > SLOP);
    ok("every card's page fills its card", strayCards.length === 0,
      strayCards.length ? JSON.stringify(strayCards.slice(0, 3)) : `${cards.length} measured`);

    // ── the drill-in ────────────────────────────────────────────────────────
    const entered = await page.evaluate(() => {
      const host = document.querySelector(".s-dsgr__controls");
      host.scrollTop = 600;
      const card = [...document.querySelectorAll(".s-dsgp-card")][6];
      card.focus();
      const top = host.scrollTop; // focus() scrolls; read AFTER it
      card.click();
      return { id: card.getAttribute("data-preset"), top };
    });
    await page.waitForTimeout(1600);
    await shot("detail");
    ok("the detail has a bar with a way out", (await page.locator(".s-dsgp-back").count()) === 1);
    ok("the shelf is really hidden, not merely marked",
      (await page.evaluate(() => getComputedStyle(document.querySelector(".s-dsgp__grid")).display)) === "none",
      "a class `display` beats the UA's [hidden]");
    ok("focus moved into the room",
      await page.evaluate(() => document.activeElement?.classList.contains("s-dsgp-back")),
      "a takeover that leaves focus on a hidden card strands the keyboard");
    const detailFit = await page.evaluate(`(${FIT})(document.querySelector(".s-dsgp-detail__stage .s-dsgv"))`);
    ok("the detail preview fills its stage",
      detailFit && Math.abs(detailFit.dx) <= SLOP && Math.abs(detailFit.dw) <= SLOP,
      JSON.stringify(detailFit));

    // ← and → follow the READING direction, not the keycap.
    const rtl = await page.evaluate(() => document.documentElement.getAttribute("dir") === "rtl");
    const nameNow = () => page.locator(".s-dsgp-detail__crumbleaf").innerText();
    const before = await nameNow();
    await page.locator(".s-dsgp-back").focus();
    await page.keyboard.press(rtl ? "ArrowLeft" : "ArrowRight");
    await page.waitForTimeout(600);
    const after = await nameNow();
    ok("the reading-forward arrow steps forward", after !== before, `${before} → ${after}`);
    await page.keyboard.press(rtl ? "ArrowRight" : "ArrowLeft");
    await page.waitForTimeout(600);
    ok("and the reading-back arrow steps back", (await nameNow()) === before);

    // Backspace leaves, and leaving puts the reader back where they stood.
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(700);
    const back = await page.evaluate(() => ({
      gone: !document.querySelector(".s-dsgp-detail"),
      panel: !!document.querySelector(".s-dsgr"),
      top: Math.round(document.querySelector(".s-dsgr__controls").scrollTop),
      focus: document.activeElement?.getAttribute("data-preset"),
    }));
    ok("Backspace returns to the shelf", back.gone && back.panel);
    ok("…at the offset it was left at", Math.abs(back.top - entered.top) <= SLOP,
      `${back.top} vs ${entered.top}`);
    ok("…with the same card under the finger", back.focus === entered.id, String(back.focus));

    // ESC UNWINDS ONE STEP. The whole precedence question, in two presses.
    await page.evaluate(() => [...document.querySelectorAll(".s-dsgp-card")][6].click());
    await page.waitForTimeout(900);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    ok("Esc leaves the preset and NOT the panel",
      await page.evaluate(() => !document.querySelector(".s-dsgp-detail") && !!document.querySelector(".s-dsgr")),
      "one keystroke from a catalog to no panel is a trapdoor");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    ok("a second Esc closes the panel",
      await page.evaluate(() => !document.querySelector(".s-dsgr")));

    await context.close();
  }
}

await browser.close();
await restore();
console.log(
  failures === 0
    ? "\ncheck-designer-nav: PASS"
    : `\ncheck-designer-nav: ${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
