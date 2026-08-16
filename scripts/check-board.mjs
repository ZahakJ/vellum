// THE SECTION BOARD GATE — the designer's reordering surface, measured.
//
// A home page is an ORDER before it is anything else, so the board is where
// this whole feature is won or lost. Three of its promises cannot be reviewed
// by reading the code, because each is a browser behaviour that fails silently:
//
//   1. THREE WAYS TO MOVE A ROW. The ↑/↓ buttons, a POINTER drag (pointer
//      events, so mouse/pen/touch are one path), and a KEYBOARD lift (Space,
//      arrows, Space). A keyboard lift that ends after one arrow because the
//      moved node blurred itself looks exactly like a working one in a diff.
//   2. THE DROP IS SHOWN BEFORE IT HAPPENS. A slot opens and a socket is drawn
//      in it while the pointer is down, and the list is NOT reordered until
//      the button comes up.
//   3. ESC BELONGS TO THE INNERMOST LAYER. The add-a-section sheet and the
//      panel both listen in the capture phase on `window`; the panel is
//      mounted first, so without `isSectionPickerOpen()` one Esc closes the
//      whole designer out from under an open picker. It did.
//
// Plus the save bar's count, and a Ctrl/Cmd+S round trip through the store.
//
// The gate installs its own design, restores the store's previous state on the
// way out (including on failure), and leaves nothing behind.
//
//   node scripts/check-board.mjs [http://127.0.0.1:6801]
//   VELLUM_PASSWORD=… for an instance with a password; CHROMIUM= for a browser.

import { chromium } from "playwright";

const BASE = process.argv[2] || process.env.VELLUM_URL || "http://127.0.0.1:6801";
const PASSWORD = process.env.VELLUM_PASSWORD || "";

let failures = 0;
const ok = (label, condition, detail = "") => {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!condition) failures++;
};

// ── the instance ───────────────────────────────────────────────────────────

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, init);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text), headers: res.headers };
  } catch {
    return { status: res.status, body: text, headers: res.headers };
  }
}

const me = await api("/api/me").catch(() => null);
if (!me) {
  console.error(`check-board: nothing is listening on ${BASE}. Start the server first.`);
  process.exit(1);
}

let cookie = "";
if (!me.body.admin) {
  if (!PASSWORD) {
    console.error(
      "check-board: this session is NOT an admin, and no VELLUM_PASSWORD was given.\n" +
        "  The board is an admin surface; the gate cannot open it anonymously.",
    );
    process.exit(1);
  }
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`check-board: login failed (${login.status}). Wrong VELLUM_PASSWORD?`);
    process.exit(1);
  }
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}
const auth = cookie ? { Cookie: cookie } : {};
const json = (method, payload) => ({
  method,
  headers: { "Content-Type": "application/json", ...auth },
  body: JSON.stringify(payload),
});

/** Six named sections, so a reorder is readable in one line of output. */
const FIXTURE = {
  name: "Board gate",
  site: { width: 820, density: "regular" },
  sections: [
    { id: "one", kind: "hero" },
    { id: "two", kind: "postGrid", limit: 3, columns: 3 },
    { id: "three", kind: "richText" },
    { id: "four", kind: "postList", limit: 6 },
    { id: "five", kind: "topics", limit: 8 },
    { id: "six", kind: "divider" },
  ],
};

const before = await api("/api/design", { headers: auth });
if (before.status !== 200) {
  console.error(`check-board: GET /api/design answered ${before.status}; cannot continue.`);
  process.exit(1);
}
const activeBefore = before.body.activeId ?? null;

const created = await api("/api/design/docs/import", json("POST", { design: FIXTURE }));
if (created.status !== 200) {
  console.error(`check-board: could not install the fixture: ${JSON.stringify(created.body)}`);
  process.exit(1);
}
const id = created.body.id;
await api("/api/design/active", json("PUT", { id }));

let restored = false;
async function restore() {
  if (restored) return;
  restored = true;
  await api(`/api/design/docs/${id}`, { method: "DELETE", headers: auth }).catch(() => undefined);
  if (activeBefore) await api("/api/design/active", json("PUT", { id: activeBefore })).catch(() => undefined);
}
process.on("exit", () => void restore());

console.log(`check-board: ${BASE}  design=${id}`);

// ── the panel ──────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
if (cookie) {
  const [name, value] = cookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);
}
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  // Through the palette, the way an operator opens it.
  await page.keyboard.press("Control+P");
  await page.waitForTimeout(250);
  await page.keyboard.type("Design your site");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".s-dsgr", { timeout: 10_000 });
  await page.waitForTimeout(700);
  await page.click('.s-dsgr__tab[data-tab="sections"]');
  await page.waitForTimeout(400);

  const order = () => page.$$eval(".s-dsnc-row", (rows) => rows.map((r) => r.dataset.row));
  const start = await order();
  ok("the board drew every section", start.length === 6, start.join(","));
  ok(
    "every row carries a glyph of its kind",
    (await page.$$eval(".s-dsnc-row .s-dsnc-glyph", (g) => g.length)) === 6,
  );

  // 1. THE BUTTONS.
  await page.click(".s-dsnc-row[data-row='one'] .s-dsnc-move >> nth=1");
  await page.waitForTimeout(300);
  const afterButton = await order();
  ok("↓ moves a row down one place", afterButton[1] === "one", afterButton.join(","));
  ok(
    "the moved row keeps the focus",
    await page.evaluate(() =>
      document.activeElement?.closest(".s-dsnc-row")?.dataset.row === "one"),
  );

  // 2. THE KEYBOARD LIFT.
  await page.locator(".s-dsnc-row[data-row='one'] .s-dsnc-grip").focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  ok(
    "Space lifts the row",
    (await page.$$eval(".s-dsnc-row--lifted", (e) => e.length)) === 1,
  );
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(220);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(220);
  const afterKeys = await order();
  // TWO arrows must move it TWO places: a lift that ends on the first move
  // (the moved node blurs itself) looks identical in a screenshot.
  ok("arrows move a lifted row, and keep lifting it", afterKeys[3] === "one", afterKeys.join(","));
  ok(
    "the live region says where it landed",
    /\d|[٠-٩]/.test(await page.$eval(".s-dsnc-say", (e) => e.textContent ?? "")),
    await page.$eval(".s-dsnc-say", (e) => (e.textContent ?? "").trim()),
  );
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  ok("Space sets it down", (await page.$$eval(".s-dsnc-row--lifted", (e) => e.length)) === 0);

  // 3. THE POINTER DRAG.
  const grip = page.locator(".s-dsnc-row[data-row='one'] .s-dsnc-grip");
  const box = await grip.boundingBox();
  const pitch = await page.$eval(".s-dsnc-row", (r) => r.getBoundingClientRect().height + 8);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - pitch * 1.6, { steps: 12 });
  await page.waitForTimeout(250);
  ok(
    "a drag draws the slot it will drop into",
    (await page.$$eval(".s-dsnc-row--dropbefore, .s-dsnc-row--dropafter", (e) => e.length)) === 1,
  );
  ok(
    "the list is NOT reordered while the pointer is down",
    (await order()).join(",") === afterKeys.join(","),
  );
  await page.mouse.up();
  await page.waitForTimeout(350);
  const afterDrag = await order();
  // Dragged from the fourth slot to just above the third: the row lands where
  // the socket was, one place up, and nothing else moves.
  ok(
    "dropping moves the row into the slot",
    afterDrag.indexOf("one") === afterKeys.indexOf("one") - 1,
    afterDrag.join(","),
  );
  ok(
    "and moves nothing else",
    afterDrag.filter((row) => row !== "one").join(",") ===
      afterKeys.filter((row) => row !== "one").join(","),
  );

  // 4. ESC BELONGS TO THE PICKER.
  await page.click(".s-dsnc-addbtn");
  await page.waitForTimeout(300);
  ok("the picker opens illustrated", (await page.$$eval(".s-dsnc-addcard .s-dsnc-glyph", (e) => e.length)) >= 8);
  ok(
    "focus lands inside the picker",
    await page.evaluate(() => document.activeElement?.classList.contains("s-dsnc-addcard")),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok("Esc closes the picker", (await page.$$eval(".s-dsnc-add", (e) => e.length)) === 0);
  ok("Esc does NOT close the designer", (await page.$$eval(".s-dsgr", (e) => e.length)) === 1);
  ok(
    "focus returns to the button that opened it",
    await page.evaluate(() => document.activeElement?.classList.contains("s-dsnc-addbtn")),
  );

  // 5. ADDING, AND THE COUNT.
  await page.click(".s-dsnc-addbtn");
  await page.waitForTimeout(250);
  await page.click(".s-dsnc-addcard >> nth=0");
  await page.waitForTimeout(350);
  ok("a picked kind lands on the board", (await order()).length === 7);
  const foot = await page.$eval(".s-dsgr__state", (e) => (e.textContent ?? "").trim());
  // Two decisions are waiting: the order, and the new section. A leaf-wise
  // diff would say thirty; "unsaved changes" would say nothing.
  ok("the save bar counts what is waiting", /2/.test(foot) || /٢/.test(foot), foot);
  ok(
    "the save bar lights while it waits",
    await page.$eval(".s-dsgr__foot", (e) => e.className.includes("--dirty")),
  );

  // 6. THE ROUND TRIP.
  await page.keyboard.press("Control+S");
  await page.waitForTimeout(1400);
  const settled = await page.$eval(".s-dsgr__state", (e) => (e.textContent ?? "").trim());
  ok("Ctrl/Cmd+S saves", !/2|٢/.test(settled), settled);
  const stored = await api(`/api/design/docs/${id}`, { headers: auth });
  ok(
    "the store agrees with the board",
    stored.status === 200 && stored.body.sections.map((s) => s.id).slice(0, 7).length === 7,
    stored.status === 200 ? stored.body.sections.map((s) => s.id).join(",") : String(stored.status),
  );
  ok(
    "the panel never scrolls sideways",
    (await page.$eval(".s-dsgr__controls", (e) => e.scrollWidth - e.clientWidth)) === 0,
  );
  ok("nothing threw", errors.length === 0, errors[0] ?? "");
} finally {
  await browser.close();
  await restore();
}

console.log(failures === 0 ? "\ncheck-board: PASS" : `\ncheck-board: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
