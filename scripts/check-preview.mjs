// THE LIVE-PREVIEW GATE.
//
// The designer's right-hand pane claims to be the composed site — the real
// renderers, the real theme, the author's own posts and their pictures — in a
// viewport of its own, at three device widths, settling as the author types.
// Every clause in that sentence is a thing a screenshot cannot check and a
// unit test cannot reach, so this gate drives the real panel in a real browser
// and measures the frame from the inside.
//
// What it refuses to let regress, in order:
//
//   1. THE PANE IS A FRAME AT ALL. The shell's CSP is `frame-src 'none'`, and
//      it stays that way: a `srcdoc` frame or a framed route would be refused
//      by it and the pane would be empty. The initial `about:blank` is not a
//      navigation and is allowed — but that is a browser behaviour, not a law,
//      and the day it changes this is the line that says so.
//   2. THE APP'S STYLES AND THEME REACH IT, by cloned <link>/<style> and
//      mirrored root attributes — including a theme switch made while the
//      panel is open, which is how an author checks their design in two rooms.
//   3. IT LAYS OUT AT THE DEVICE WIDTH, so `@media (max-width: 700px)` answers
//      the PHONE at 390 and not the panel at 1440. That is the whole reason
//      the pane is a frame: measured, the phone gets one grid column and a
//      44px topic chip, and the document does not overflow horizontally.
//   4. IT SHOWS PICTURES — the operator's own banner files, resolved through
//      /api/file from a document whose URL is `about:blank`.
//   5. IT IS HOVERABLE, through the scale transform, exactly as a reader's
//      pointer will be.
//   6. AN EDIT REACHES IT, and fifty switches later it is the same iframe with
//      the same node count: the frame is built once and reconciled, which is
//      also what keeps the author's scroll position.
//
//   PORT=6801 VELLUM_PASSWORD=… node scripts/check-preview.mjs
//
// It creates ONE design, uses it, and deletes it, putting the previously
// active design back — on failure too.

import { chromium } from "playwright";

const PORT = process.env.PORT || "6801";
// 127.0.0.1, not localhost: Node resolves localhost to ::1 first and the
// server binds 0.0.0.0 — the friendlier hostname fails against a healthy
// instance. Same note check-design carries.
const BASE = process.env.VELLUM_URL || `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.VELLUM_PASSWORD || "";
const SHOTS = process.env.SHOT_DIR || null;

let failures = 0;
const ok = (label, cond, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
};

// ── the session ─────────────────────────────────────────────────────────────

const probe = await fetch(`${BASE}/api/me`).catch(() => null);
if (!probe) {
  console.error(`check-preview: nothing is listening on ${BASE}. Start the server first.`);
  process.exit(1);
}
let cookie = "";
if (!(await probe.clone().json()).admin) {
  if (!PASSWORD) {
    console.error(
      "check-preview: this session is NOT an admin, and the designer is an admin panel.\n" +
        `  Fix: VELLUM_PASSWORD=<the admin password> PORT=${PORT} node scripts/check-preview.mjs`,
    );
    process.exit(1);
  }
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`check-preview: login failed (${login.status}). Wrong VELLUM_PASSWORD?`);
    process.exit(1);
  }
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}
const auth = { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) };
const api = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, { headers: auth, ...init });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// ── the fixture, and putting the instance back ──────────────────────────────

// One of every section that draws CONTENT, because the point of the pane is
// that the six controls which shape a composed page change something on
// screen. A `note` section is deliberately absent: it names a note, and a gate
// cannot know what is in somebody's vault (the rule presets follow).
const FIXTURE = {
  name: "check-preview fixture",
  site: { width: 900, density: "regular" },
  sections: [
    { id: "hero", kind: "hero", heading: "", sub: "", align: "center", height: "tall" },
    {
      id: "grid",
      kind: "postGrid",
      heading: "",
      limit: 6,
      columns: 3,
      showExcerpt: true,
      showBanner: true,
      showDate: true,
    },
    { id: "topics", kind: "topics", heading: "", limit: 10 },
    { id: "list", kind: "postList", heading: "", limit: 8, showExcerpt: true, showDate: true },
    { id: "cta", kind: "cta", heading: "", body: "", label: "", url: "/" },
  ],
  chrome: { header: { sticky: "header" } },
};

const before = await api("/api/design");
if (before.status !== 200) {
  console.error(`check-preview: GET /api/design answered ${before.status}; cannot continue.`);
  process.exit(1);
}
const activeBefore = before.body.activeId ?? null;

const created = await api("/api/design/docs/import", {
  method: "POST",
  body: JSON.stringify({ design: FIXTURE }),
});
if (created.status !== 200) {
  console.error("check-preview: could not create the fixture design:", created.body);
  process.exit(1);
}
const fixtureId = created.body.id;

let restored = false;
async function restore() {
  if (restored) return;
  restored = true;
  try {
    await api("/api/design/active", {
      method: "PUT",
      body: JSON.stringify({ id: activeBefore }),
    });
    await api(`/api/design/docs/${encodeURIComponent(fixtureId)}`, { method: "DELETE" });
  } catch (err) {
    console.error("check-preview: RESTORE FAILED — a stray fixture design may be left:", err);
  }
}
process.on("exit", () => void restore());
process.on("SIGINT", () => process.exit(130));

await api("/api/design/active", { method: "PUT", body: JSON.stringify({ id: fixtureId }) });

// ── the browser ─────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
if (cookie) {
  await context.addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...rest] = pair.split("=");
      return { name, value: rest.join("="), domain: new URL(BASE).hostname, path: "/" };
    }),
  );
}
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview-${name}.png` });
};

/** The frame's document, or null. Re-read every time: the element is stable,
 *  the handle is not. */
async function frame() {
  const handle = await page.locator("iframe.s-dsgs__frame").elementHandle();
  return handle ? await handle.contentFrame() : null;
}

await page.goto(BASE, { waitUntil: "networkidle" });
// The designer opens from the palette — the product's own door to it.
await page.keyboard.press("Control+p");
await page.waitForTimeout(300);
await page.keyboard.type("design");
await page.waitForTimeout(400);
await page.keyboard.press("Enter");
await page.waitForSelector(".s-dsgs", { timeout: 10_000 });
await page.waitForTimeout(1200);

ok("the preview pane is a frame", (await page.locator("iframe.s-dsgs__frame").count()) === 1,
  "CSP frame-src 'none' would leave 0");

const home = await frame();
ok("the frame has a document", home !== null);
if (home) {
  const seen = await home.evaluate(() => {
    const page = document.querySelector(".s-dsgv__page");
    const banners = [...document.querySelectorAll(".s-dsn-card__banner")].map(
      (el) => getComputedStyle(el).backgroundImage,
    );
    return {
      sheets: document.head.querySelectorAll("[data-vellum-clone]").length,
      theme: document.documentElement.getAttribute("data-theme"),
      sections: document.querySelectorAll(".s-dsn-page > *").length,
      pictures: banners.filter((b) => b !== "none").length,
      vaultPictures: banners.filter((b) => b.includes("/api/file")).length,
      pointer: page ? getComputedStyle(page).pointerEvents : "",
      width: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sticky: (() => {
        const top = document.querySelector(".s-dsg-top");
        return top ? getComputedStyle(top).position : "";
      })(),
      // The page is hidden until the cloned sheets answer, so a preview never
      // blinks raw HTML. If this attribute is missing the page is INVISIBLE,
      // which is worse than unstyled and must fail loudly.
      revealed:
        document.documentElement.hasAttribute("data-vellum-ready") &&
        getComputedStyle(document.body).visibility === "visible",
    };
  });
  ok("the app's stylesheets are cloned into it", seen.sheets > 0, `${seen.sheets}`);
  ok("the theme is mirrored", seen.theme !== null, String(seen.theme));
  ok("the page is revealed once its sheets have answered", seen.revealed === true);
  ok("the composed sections render", seen.sections >= 5, `${seen.sections} children`);
  ok("cards carry pictures", seen.pictures >= 3, `${seen.pictures}`);
  ok("the page is hoverable", seen.pointer === "auto", seen.pointer);
  ok("a sticky header is honoured in a frame", seen.sticky === "sticky", seen.sticky);
  ok("it lays out at the desktop width", seen.width === 1280, `${seen.width}px`);
  ok("no horizontal overflow", seen.overflowX <= 0, `${seen.overflowX}px`);
  if (seen.vaultPictures === 0) {
    console.log("  note: no vault banner in range — generated artwork only (a bare vault)");
  }
}
await shot("desktop");

// ── the devices ─────────────────────────────────────────────────────────────

async function device(label) {
  await page.locator(`.s-dsgs__bar [role="radio"]:has-text("${label}")`).click();
  await page.waitForTimeout(700);
  const f = await frame();
  return f
    ? await f.evaluate(() => {
        const grid = document.querySelector(".s-dsn-grid");
        const chip = document.querySelector(".s-dsn-topic");
        return {
          width: document.documentElement.clientWidth,
          columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
          chip: chip ? Math.round(chip.getBoundingClientRect().height) : 0,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })
    : null;
}

const tablet = await device("Tablet");
ok("tablet lays out at 834", tablet?.width === 834, `${tablet?.width}`);
await shot("tablet");
const phone = await device("Phone");
ok("phone lays out at 390", phone?.width === 390, `${phone?.width}`);
ok("the PHONE rules apply (one grid column)", phone?.columns === 1, `${phone?.columns} columns`);
ok("phone targets are ≥44px", (phone?.chip ?? 0) >= 44, `${phone?.chip}px`);
ok("no horizontal overflow at 390", (phone?.overflowX ?? 1) <= 0, `${phone?.overflowX}px`);
await shot("phone");

// ── hover, through the scale ────────────────────────────────────────────────

await page.locator('.s-dsgs__bar [role="radio"]:has-text("Desktop")').click();
await page.waitForTimeout(600);
{
  const handle = await page.locator("iframe.s-dsgs__frame").elementHandle();
  const box = handle ? await handle.boundingBox() : null;
  const f = await frame();
  const spot =
    f &&
    (await f.evaluate(() => {
      const el = document.querySelector(".s-dsn-topic");
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        rest: getComputedStyle(el).backgroundColor,
        vw: document.documentElement.clientWidth,
      };
    }));
  if (box && spot) {
    // The frame is laid out at `vw` and painted `box.width` wide, so the
    // pointer is mapped through the same scale the eye is.
    const k = box.width / spot.vw;
    await page.mouse.move(box.x + spot.x * k - 4, box.y + spot.y * k - 4);
    await page.mouse.move(box.x + spot.x * k, box.y + spot.y * k);
    await page.waitForTimeout(300);
    const hovered = await f.evaluate(
      () => getComputedStyle(document.querySelector(".s-dsn-topic")).backgroundColor,
    );
    ok("hover states are live inside the preview", spot.rest !== hovered, `${spot.rest} → ${hovered}`);
  } else {
    ok("hover states are live inside the preview", false, "no topic chip to hover");
  }
}

// ── the article page ────────────────────────────────────────────────────────

await page.locator('.s-dsgr__previewhead [role="radio"]:has-text("Article")').click();
await page.waitForTimeout(600);
{
  const f = await frame();
  const article = f ? await f.evaluate(() => document.querySelectorAll(".s-dsn-article").length) : 0;
  ok("the article page is one click away", article === 1, `${article}`);
  await shot("article");
}
await page.locator('.s-dsgr__previewhead [role="radio"]:has-text("Front")').click();
await page.waitForTimeout(500);

// ── a theme switch behind the panel repaints it ─────────────────────────────

const themeBefore = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "parchment"));
await page.waitForTimeout(500);
{
  const f = await frame();
  const seen = f
    ? await f.evaluate(() => ({
        theme: document.documentElement.getAttribute("data-theme"),
        bg: getComputedStyle(document.body).backgroundColor,
      }))
    : null;
  ok("a theme switch repaints the preview", seen?.theme === "parchment", JSON.stringify(seen));
}
await page.evaluate(
  (theme) => document.documentElement.setAttribute("data-theme", theme ?? "iron-gall"),
  themeBefore,
);
await page.waitForTimeout(300);

// ── an edit reaches it, and fifty switches do not rebuild it ────────────────

await page.locator('.s-dsgr__tab:has-text("Typography"), .s-dsgr__tab:has-text("Type")').first().click();
await page.waitForTimeout(400);
const readBase = async () => {
  const f = await frame();
  return f
    ? await f.evaluate(() =>
        getComputedStyle(document.querySelector(".s-dsgv__page")).getPropertyValue("--dsg-base"),
      )
    : "";
};
const baseBefore = await readBase();
const slider = page.locator('.s-dsgr__controls input[type="range"]').first();
const t0 = Date.now();
for (let i = 0; i < 24; i++) await slider.press("ArrowRight");
const dragMs = Date.now() - t0;
await page.waitForTimeout(500);
const baseAfter = await readBase();
ok("an edit reaches the preview", baseBefore !== baseAfter, `${baseBefore} → ${baseAfter}`);
ok("24 edits in a row stay responsive", dragMs < 6000, `${dragMs}ms`);
await shot("edited");

await page.evaluate(() => {
  document.querySelector("iframe.s-dsgs__frame").dataset.probe = "1";
});
const nodesBefore = await (await frame()).evaluate(() => document.querySelectorAll("*").length);
const t1 = Date.now();
for (let i = 0; i < 50; i++) {
  await page.locator(`.s-dsgs__bar [role="radio"]:has-text("${["Desktop", "Tablet", "Phone"][i % 3]}")`).click();
}
const switchMs = Date.now() - t1;
await page.waitForTimeout(600);
const probeAfter = await page.evaluate(
  () => document.querySelector("iframe.s-dsgs__frame")?.dataset.probe ?? "gone",
);
const nodesAfter = await (await frame()).evaluate(() => document.querySelectorAll("*").length);
ok("the frame survives 50 switches", probeAfter === "1", probeAfter);
ok("50 switches stay fast", switchMs < 15_000, `${switchMs}ms`);
ok("no node growth across 50 switches", Math.abs(nodesAfter - nodesBefore) <= 2,
  `${nodesBefore} → ${nodesAfter}`);

ok("no console errors anywhere", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
await restore();
console.log(failures === 0 ? "\ncheck-preview: OK" : `\ncheck-preview: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
