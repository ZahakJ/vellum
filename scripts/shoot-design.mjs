// THE ERROR-BOUNDARY GATE for `publicLayout: "designed"`.
//
// The promise this file exists to keep honest, from CONTRACTS' design section:
// an invalid config, a deleted note a section points at, or a render-time
// throw drops VISITORS to the stock blog automatically — never a blank page
// and never a stack trace — while the ADMIN gets a notice naming the failing
// section and one click back to stock.
//
// A promise like that cannot be reviewed by reading the code: three different
// failures, two different sessions, and the one outcome that must never appear
// (a blank page) looks exactly like a slow one. So this gate BREAKS the site
// three ways, on purpose, and measures what each session actually gets:
//
//   A. CORRUPT CONFIG      designs.json is overwritten with garbage.
//   B. DELETED NOTE        a `note` section is pointed at a note that is not
//                          there — the failure an author causes months later,
//                          by deleting a note, without touching the design.
//   C. RENDER-TIME THROW   a section renderer is patched to throw, and the
//                          client is rebuilt. Nothing in the shipped code has
//                          a "throw here" hook — a test seam in a renderer is
//                          a seam a visitor can eventually reach — so the gate
//                          edits the source, rebuilds, measures, and puts the
//                          file back byte-for-byte.
//
// For each: a VISITOR must land on the stock blog (`.s-blog` present,
// `.s-dsn` absent, document not empty, no uncaught page error), and the OWNER
// must see a notice that NAMES the failure and carries the revert control.
//
// Everything is restored on the way out, including on failure.
//
//   PORT=6801 VELLUM_PASSWORD=… node scripts/shoot-design.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || "6801";
// 127.0.0.1 rather than "localhost": Node's fetch resolves localhost to ::1
// first, and the server binds 0.0.0.0 by default — so a gate written with the
// friendlier hostname fails with ECONNREFUSED against a perfectly healthy
// instance. VELLUM_URL overrides for an instance behind a proxy.
const BASE = process.env.VELLUM_URL || `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.VELLUM_PASSWORD || "";
const SHOTS = process.env.SHOT_DIR || null;

/** The section renderer scenario C patches, and the exact anchor it patches. */
const RENDERER = path.join(ROOT, "client/design/Sections.tsx");
const ANCHOR = "function Topics({ section, posts }: { section: TopicsSection } & SectionProps) {";
const INJECT = `${ANCHOR}\n  throw new Error("shoot-design.mjs: deliberate render-time throw");`;

let failures = 0;
const ok = (label, condition, detail = "") => {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!condition) failures++;
};

// ── the instance ───────────────────────────────────────────────────────────

async function api(pathname, init) {
  const res = await fetch(`${BASE}${pathname}`, init);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

const me = await api("/api/me").catch(() => null);
if (!me) {
  console.error(`shoot-design: nothing is listening on ${BASE}. Start the server first.`);
  process.exit(1);
}

let cookie = "";
if (!me.body.admin) {
  if (!PASSWORD) {
    console.error(
      "shoot-design: this session is NOT an admin, and no VELLUM_PASSWORD was given.\n" +
        "  The gate has to read and rewrite the design store, and it has to compare what\n" +
        "  a VISITOR sees with what the OWNER sees — neither is possible from one\n" +
        "  anonymous session.\n" +
        `  Fix: VELLUM_PASSWORD=<the admin password> PORT=${PORT} node scripts/shoot-design.mjs`,
    );
    process.exit(1);
  }
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`shoot-design: login failed (${login.status}). Wrong VELLUM_PASSWORD?`);
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

const settings = await api("/api/settings", { headers: auth });
if (settings.status !== 200) {
  console.error(`shoot-design: GET /api/settings answered ${settings.status}; cannot continue.`);
  process.exit(1);
}
const dataPath = settings.body.about?.dataPath;
const designsFile = path.join(dataPath, "designs.json");
const layoutBefore = settings.body.publicLayout ?? null;
const designsBefore = existsSync(designsFile) ? readFileSync(designsFile) : null;
const rendererBefore = readFileSync(RENDERER, "utf8");

console.log(`shoot-design: ${BASE}  data=${dataPath}`);

// ── restore, always ────────────────────────────────────────────────────────

let rebuiltDirty = false;
function restore() {
  try {
    if (rendererBefore !== readFileSync(RENDERER, "utf8")) {
      writeFileSync(RENDERER, rendererBefore);
      rebuiltDirty = true;
    }
    if (designsBefore === null) {
      if (existsSync(designsFile)) unlinkSync(designsFile);
    } else {
      writeFileSync(designsFile, designsBefore);
    }
    if (rebuiltDirty) build();
  } catch (err) {
    console.error("shoot-design: RESTORE FAILED — check the working tree:", err);
  }
}
process.on("exit", restore);
process.on("SIGINT", () => process.exit(130));

function build() {
  execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "pipe" });
}

// ── the fixture design ─────────────────────────────────────────────────────

const FIXTURE = {
  name: "Boundary gate",
  site: { header: "bar", width: 820, density: "regular" },
  sections: [
    { id: "hero", kind: "hero", heading: "Boundary gate", sub: "A design under test." },
    { id: "topics", kind: "topics", heading: "Topics", limit: 8 },
    { id: "writings", kind: "postList", heading: "Writings", limit: 10 },
  ],
};

/** Put the instance into a KNOWN good designed state and answer the design id. */
async function installFixture() {
  const created = await api("/api/design/docs/import", json("POST", { design: FIXTURE }));
  if (created.status !== 200) {
    throw new Error(`could not create the fixture design: ${JSON.stringify(created.body)}`);
  }
  const id = created.body.id;
  await api("/api/design/active", json("PUT", { id }));
  await api("/api/settings", json("PATCH", { publicLayout: "designed" }));
  return id;
}

/** Replace the fixture's sections (scenario B edits it in place). */
async function putSections(id, sections) {
  const res = await api(`/api/design/docs/${id}`, json("PUT", { ...FIXTURE, sections }));
  if (res.status !== 200) throw new Error(`PUT design failed: ${JSON.stringify(res.body)}`);
}

// ── the browser ────────────────────────────────────────────────────────────

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
});

/** What a session actually got. One shape for both sessions, so the two are
 *  compared rather than described. */
async function inspect({ asAdmin, preview, label }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const page = await context.newPage();
  // BOTH channels: React reports a handled error through window.onerror AND
  // console.error, and a fault that escapes the boundary may only appear on
  // one of them.
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  if (asAdmin && cookie) {
    const [name, value] = cookie.split("=");
    await context.addCookies([{ name, value, url: BASE }]);
  }
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  if (preview) {
    await page.click(".s-statusbar__eye").catch(() => {});
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(600);
  const seen = await page.evaluate(() => ({
    designed: document.querySelector(".s-dsn-hero, .s-dsn-page") !== null,
    stock: document.querySelector(".s-blog") !== null,
    app: document.querySelector(".s-app") !== null,
    ownerNotice: document.querySelector(".s-dsn-notice") !== null,
    appNotice: document.querySelector(".s-dsn-status") !== null,
    failedCards: [...document.querySelectorAll(".s-dsn-failed")].map((el) =>
      (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    ),
    noticeText: (document.querySelector(".s-dsn-notice, .s-dsn-status")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    revertControl:
      document.querySelector(".s-dsn-notice__action, .s-dsn-status__action") !== null,
    // "Never a blank page" is the promise, so it is measured rather than
    // assumed: rendered text, not markup length.
    visibleChars: (document.body.innerText ?? "").trim().length,
  }));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${label}.png`), fullPage: false });
  await context.close();
  return { ...seen, errors };
}

/**
 * A visitor must be on the stock blog, with a real page, and no error beyond
 * the boundary's OWN report.
 *
 * That last clause is the precise version of "never a stack trace". React
 * re-reports an error it has already handled to `window.onerror` on purpose —
 * that is how error monitoring sees a caught fault at all, and suppressing it
 * would be worse than the fault. What must not happen is a SECOND, unhandled
 * error: one that got past the boundary and left the page broken. So the
 * boundary's own reports are recognised and everything else is a failure.
 */
const BOUNDARY_REPORT = /SectionError|vellum: design section|deliberate render-time throw/;
function assertVisitorRescued(seen, scenario) {
  const stray = seen.errors.filter((text) => !BOUNDARY_REPORT.test(text));
  ok(`${scenario}: visitor gets the STOCK blog`, seen.stock && !seen.designed);
  ok(`${scenario}: visitor page is not blank`, seen.visibleChars > 40, `${seen.visibleChars} chars`);
  ok(`${scenario}: nothing escaped the boundary`, stray.length === 0, stray[0] ?? "");
}

try {
  const id = await installFixture();

  console.log("\nHEALTHY — the designed site renders");
  {
    const seen = await inspect({ asAdmin: false, label: "00-healthy-visitor" });
    ok("visitor gets the DESIGNED site", seen.designed && !seen.stock);
    // A healthy design has nothing to report, so the bar here is absolute.
    ok("no error at all", seen.errors.length === 0, seen.errors[0] ?? "");
  }

  console.log("\nA. CORRUPT CONFIG — designs.json overwritten with garbage");
  {
    writeFileSync(designsFile, "{ this is not json at all ][");
    const visitor = await inspect({ asAdmin: false, label: "a1-corrupt-visitor" });
    assertVisitorRescued(visitor, "corrupt config");
    const admin = await inspect({ asAdmin: true, label: "a2-corrupt-admin" });
    ok("corrupt config: the ADMIN is told", admin.appNotice, admin.noticeText.slice(0, 120));
    ok("corrupt config: the admin's notice offers the revert", admin.revertControl);
    // The store must be READABLE again the moment the file is: corruption is
    // survivable, not terminal.
    writeFileSync(designsFile, designsBefore ?? "{}");
    await installFixture();
  }

  console.log("\nB. DELETED NOTE — a section points at a note that is not there");
  {
    const id2 = (await api("/api/design", { headers: auth })).body.activeId;
    await putSections(id2, [
      ...FIXTURE.sections,
      { id: "gone", kind: "note", note: "no-such-note-shoot-design.md", heading: "Missing" },
    ]);
    const visitor = await inspect({ asAdmin: false, label: "b1-missing-visitor" });
    assertVisitorRescued(visitor, "deleted note");
    const owner = await inspect({ asAdmin: true, preview: true, label: "b2-missing-owner" });
    ok("deleted note: the OWNER keeps the designed page", owner.designed);
    ok(
      "deleted note: the failing section is NAMED",
      owner.failedCards.some((text) => text.includes("gone")),
      owner.failedCards[0] ?? "(no card)",
    );
    ok("deleted note: the owner's notice offers the revert", owner.revertControl);
    await putSections(id2, FIXTURE.sections);
  }

  console.log("\nC. RENDER-TIME THROW — a section renderer patched to throw");
  {
    if (!rendererBefore.includes(ANCHOR)) {
      throw new Error(`the throw anchor is gone from ${RENDERER}; update ANCHOR in this gate`);
    }
    writeFileSync(RENDERER, rendererBefore.replace(ANCHOR, INJECT));
    rebuiltDirty = true;
    build();
    const visitor = await inspect({ asAdmin: false, label: "c1-throw-visitor" });
    assertVisitorRescued(visitor, "render throw");
    const owner = await inspect({ asAdmin: true, preview: true, label: "c2-throw-owner" });
    ok("render throw: the OWNER keeps the designed page", owner.designed);
    ok(
      "render throw: the failing section is NAMED",
      owner.failedCards.some((text) => text.includes("topics")),
      owner.failedCards[0] ?? "(no card)",
    );
    writeFileSync(RENDERER, rendererBefore);
    build();
    rebuiltDirty = false;
  }

  console.log("\nLOSSLESS — stock ⇄ designed keeps the design");
  {
    const before = (await api("/api/design", { headers: auth })).body;
    await api("/api/settings", json("PATCH", { publicLayout: "blog" }));
    const stockVisitor = await inspect({ asAdmin: false, label: "d1-stock" });
    ok("switched to stock: visitor gets the stock blog", stockVisitor.stock && !stockVisitor.designed);
    const during = (await api("/api/design", { headers: auth })).body;
    ok(
      "the design survives the switch untouched",
      JSON.stringify(during.designs) === JSON.stringify(before.designs),
    );
    await api("/api/settings", json("PATCH", { publicLayout: "designed" }));
    const backVisitor = await inspect({ asAdmin: false, label: "d2-designed-again" });
    ok("switched back: the designed site returns", backVisitor.designed && !backVisitor.stock);
  }
} catch (err) {
  console.error("\nshoot-design: the gate itself failed:", err);
  failures++;
} finally {
  await browser.close();
  // Put the instance's layout back where it was found.
  await api(
    "/api/settings",
    json("PATCH", { publicLayout: layoutBefore === null ? null : layoutBefore }),
  ).catch(() => {});
}

console.log("");
if (failures > 0) {
  console.error(`${failures} design-boundary check(s) failed.`);
  process.exit(1);
}
console.log("The error boundary holds: three failures, visitors rescued, the owner told.");
