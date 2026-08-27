// THE PRINT GATE — the one surface no screenshot ever shows.
//
//   PORT=6801 node scripts/check-print.mjs
//   VELLUM_PASSWORD=… PORT=6801 node scripts/check-print.mjs   (protected vault)
//
// WHY IT EXISTS. Print is the only surface in this product that nobody looks
// at while they work. The app is screenshotted at 1440×900 in every theme,
// the blog is measured at 390 and 834, and the reading view has a caret gate,
// a preview gate and a sections gate — and `@media print` rules are invisible
// to every one of them, because a browser only applies them when a human opens
// a dialog. A print stylesheet does not fail loudly; it quietly starts printing
// the sidebar again, or a black page, or one screenful of a nine-page note, and
// the first report comes from somebody holding paper.
//
// So this drives the real app in a real Chromium with `emulateMedia("print")`
// and asserts the things whose failure is silent:
//
//   1. WHAT IS ON THE PAPER. `.s-print` (the host client/print.ts builds) is
//      the only visible thing, `#root` is gone, and — the other half, which a
//      "does it print" check would miss — the host is `display: none` on
//      SCREEN, because a print host that flashes is worse than no print host.
//   2. THE INK IS PAPER INK. The print palette must win from a DARK theme, or
//      the reader gets a page of black toner or, with the printer's own
//      background suppression on, near-white type on white.
//   3. THE DOCUMENT IS WHOLE. A folded callout prints its body, the properties
//      card is gone, the footnote section is at the end, headings are real
//      h1–h6 with ids (Chrome builds the PDF's bookmark outline from those and
//      from nothing else), and internal anchors carry fragment hrefs (which is
//      what becomes a PDF link annotation).
//   4. THE PAGE MIRRORS. An Arabic note's host is `dir="rtl"` — checked from
//      an ENGLISH instance, because the failure mode is a note whose direction
//      is read from the chrome around it rather than from the note.
//
// Pure of the vault: it writes two fixture notes through the API and deletes
// them again on the way out, the way check-preview handles its design.

import { chromium } from "playwright";

const PORT = process.env.PORT || "6801";
// 127.0.0.1, not localhost — Node resolves localhost to ::1 first and the
// server binds 0.0.0.0. Same note check-preview and check-design carry.
const BASE = process.env.VELLUM_URL || `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.VELLUM_PASSWORD || "";

let failures = 0;
const ok = (label, cond, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
};

// ── the session ─────────────────────────────────────────────────────────────

const probe = await fetch(`${BASE}/api/me`).catch(() => null);
if (!probe) {
  console.error(`check-print: nothing is listening on ${BASE}. Start the server first.`);
  process.exit(1);
}
let cookie = "";
if (!(await probe.clone().json()).admin) {
  if (!PASSWORD) {
    console.error(
      "check-print: this session is NOT an admin, and the gate writes two fixture notes.\n" +
        `  Fix: VELLUM_PASSWORD=<the admin password> PORT=${PORT} node scripts/check-print.mjs`,
    );
    process.exit(1);
  }
  const login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`check-print: login failed (${login.status}). Wrong VELLUM_PASSWORD?`);
    process.exit(1);
  }
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}
const auth = { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) };

// ── the fixtures ────────────────────────────────────────────────────────────
// One of every element the print sheet has an opinion about, and a second note
// in Arabic — with FRONTMATTER, because the direction bug this gate was written
// after was caused by the English word "Properties" being the first text in the
// host. A fixture with no frontmatter would have passed it.

const LATIN = "check-print fixture.md";
const ARABIC = "check-print مقدمة.md";

const LATIN_BODY = `---
tags: [print]
---

# A printed page

A paragraph with an [external link](https://example.org/deep/path) and a
footnote[^a], plus a same-note pointer to [[#Second section]].

> [!note]- A folded callout
> Its body is the author's text and has to print.

| Column | Count |
| --- | ---: |
| alpha | 1 |

Inline math $e^{i\\pi}+1=0$ and a [[Nowhere At All]] wikilink.

\`\`\`js
export const aLineLongEnoughThatItWouldRunOffTheRightEdgeOfAnA4Sheet = (x) => x;
\`\`\`

## Second section

Prose.

[^a]: The footnote text.
`;

// `banner:` names a file that is not there ON PURPOSE. The renderer answers an
// admin with a localized "this banner names nothing" repair card, at the TOP of
// the document — so with the properties card it is the second piece of chrome
// that would otherwise be the first text in the host and would decide the
// page's direction. Both regressions were measured; this is the fixture that
// catches them coming back.
const ARABIC_BODY = `---
tags: [print]
banner: check-print-no-such-file.png
---

# المقدمة

فقرة عربية كاملة، مكتوبة لاختبار انعكاس الصفحة عند الطباعة.

- البند الأول
- البند الثاني
`;

async function put(path, content) {
  const res = await fetch(`${BASE}/api/note?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    console.error(`check-print: could not write ${path} (${res.status}).`);
    process.exit(1);
  }
}

await put(LATIN, LATIN_BODY);
await put(ARABIC, ARABIC_BODY);

let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const path of [LATIN, ARABIC]) {
    try {
      await fetch(`${BASE}/api/note?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
        headers: auth,
      });
    } catch (err) {
      console.error(`check-print: CLEANUP FAILED for ${path} — it is in the trash or the vault:`, err);
    }
  }
}
process.on("exit", () => void cleanup());
process.on("SIGINT", () => process.exit(130));

// ── the browser ─────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
if (cookie) {
  await context.addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...rest] = pair.split("=");
      return { name, value: rest.join("="), domain: new URL(BASE).hostname, path: "/" };
    }),
  );
}
const page = await context.newPage();
const noteUrl = (path) =>
  `${BASE}/` + path.replace(/\.md$/, "").split("/").map(encodeURIComponent).join("/");

/** Open a note in READING view and build the print host the way the browser's
 *  own print dialog does — `beforeprint`, synchronously, with nothing awaited.
 *  That is the path a reader takes when they use their browser's menu, and it
 *  is the one a gate can drive without opening a native dialog. */
async function preparePrint(path) {
  await page.goto(noteUrl(path), { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  if ((await page.$(".s-reading__body .s-reading__content")) === null) {
    await page.keyboard.press("Control+e");
  }
  await page.waitForSelector(".s-reading__body .s-reading__content", { timeout: 10_000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.waitForTimeout(200);
}

async function teardownPrint() {
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
}

console.log(`check-print: ${BASE}\n`);

// ── 1. what is on the paper ────────────────────────────────────────────────

await preparePrint(LATIN);

// SCREEN first, and this ordering is the assertion: the host exists right now
// and the reader must not be able to see it.
const onScreen = await page.evaluate(() => ({
  host: document.querySelector(".s-print") !== null,
  display: document.querySelector(".s-print")
    ? getComputedStyle(document.querySelector(".s-print")).display
    : null,
  root: getComputedStyle(document.getElementById("root")).display,
}));
ok("a print host was built", onScreen.host);
ok("the host is invisible on screen", onScreen.display === "none", `display: ${onScreen.display}`);
ok("the app is untouched on screen", onScreen.root !== "none", `#root display: ${onScreen.root}`);

await page.emulateMedia({ media: "print" });

const paper = await page.evaluate(() => {
  const host = document.querySelector(".s-print");
  const cs = (sel) => {
    const el = host?.querySelector(sel);
    return el ? getComputedStyle(el) : null;
  };
  const root = getComputedStyle(document.documentElement);
  const content = cs(".s-reading__content");
  const ext = host?.querySelector(".s-rv-ext");
  return {
    hostDisplay: host ? getComputedStyle(host).display : null,
    rootDisplay: getComputedStyle(document.getElementById("root")).display,
    text: root.getPropertyValue("--text").trim(),
    bg: root.getPropertyValue("--bg").trim(),
    accent: root.getPropertyValue("--accent").trim(),
    theme: document.documentElement.getAttribute("data-theme"),
    measure: content ? content.maxWidth : null,
    fontFamily: content ? content.fontFamily : "",
    headings: [1, 2, 3, 4, 5, 6].map((n) => host?.querySelectorAll(`h${n}`).length ?? 0),
    headingIds: host?.querySelectorAll(".s-rv-h[id]").length ?? 0,
    headingBreak: cs(".s-rv-h1")?.breakAfter ?? null,
    calloutBreak: cs(".s-rv-callout")?.breakInside ?? null,
    rowBreak: cs(".s-rv-table tr")?.breakInside ?? null,
    foldedBody: cs(".s-rv-callout--folded .s-rv-callout__body")?.display ?? null,
    props: host?.querySelectorAll(".s-rv-props").length ?? 0,
    wikilinkDecoration: cs(".s-rv-wikilink")?.textDecorationLine ?? null,
    wikilinkColor: cs(".s-rv-wikilink")?.color ?? null,
    textColor: content ? content.color : null,
    fragmentHrefs: [...(host?.querySelectorAll('a[href^="#"]') ?? [])].map((a) =>
      a.getAttribute("href"),
    ),
    extAfter: ext
      ? getComputedStyle(ext, "::after").content
      : null,
    footnotesLast: (() => {
      const fn = host?.querySelector(".s-rv-footnotes");
      const doc = host?.querySelector(".s-reading__content");
      return fn !== null && doc !== null && fn === doc.lastElementChild;
    })(),
    tableOverflow: cs(".s-rv-tablewrap")?.overflowX ?? null,
    preWrap: cs(".s-rv-pre")?.whiteSpace ?? null,
  };
});

ok("only the host prints", paper.hostDisplay === "block" && paper.rootDisplay === "none",
  `.s-print ${paper.hostDisplay} · #root ${paper.rootDisplay}`);
ok("the ink is paper ink, not the theme's", paper.bg === "#fff" && paper.text === "#33291a",
  `theme "${paper.theme ?? "default"}" → --bg ${paper.bg} / --text ${paper.text}`);
ok("the accent survives on paper", paper.accent === "#7a5f14", paper.accent);
ok("the page box is the measure", paper.measure === "none", `max-width: ${paper.measure}`);
ok("the body is the serif", /Georgia|serif/.test(paper.fontFamily));
ok("headings are real h1–h6", paper.headings[0] === 1 && paper.headings[1] >= 1,
  `h1..h6 = ${paper.headings.join(",")}`);
ok("headings carry ids (the PDF outline reads them)", paper.headingIds >= 2,
  `${paper.headingIds} with ids`);
ok("a heading holds on to what follows it", paper.headingBreak === "avoid", paper.headingBreak);
ok("a callout does not split", paper.calloutBreak === "avoid", paper.calloutBreak);
ok("a table row does not split", paper.rowBreak === "avoid", paper.rowBreak);
ok("a FOLDED callout prints its body", paper.foldedBody === "block", `display: ${paper.foldedBody}`);
ok("the properties card is not on the paper", paper.props === 0, `${paper.props} cards`);
ok("a wikilink is plain text", paper.wikilinkDecoration === "none" && paper.wikilinkColor === paper.textColor,
  `${paper.wikilinkColor} vs body ${paper.textColor}`);
ok("internal anchors carry fragment hrefs", paper.fragmentHrefs.length >= 3,
  paper.fragmentHrefs.join(" "));
ok("an external link prints its destination", /https:\/\//.test(paper.extAfter ?? ""),
  paper.extAfter ?? "no ::after");
ok("footnotes are last", paper.footnotesLast === true);
ok("a table is not clipped by its scrollport", paper.tableOverflow === "visible", paper.tableOverflow);
ok("long code lines wrap", (paper.preWrap ?? "").startsWith("pre-wrap"), paper.preWrap);

await page.emulateMedia({ media: null });
await teardownPrint();
const gone = await page.evaluate(
  () => document.querySelector(".s-print") === null && !document.body.dataset.print,
);
ok("the host is torn down after printing", gone);

// ── 2. the page mirrors ────────────────────────────────────────────────────

await preparePrint(ARABIC);
const rtl = await page.evaluate(() => {
  const host = document.querySelector(".s-print");
  return {
    dir: host?.getAttribute("dir") ?? null,
    chrome: document.documentElement.getAttribute("dir") ?? "ltr",
    bannerCards: host?.querySelectorAll(".s-rv-banner__missing").length ?? 0,
    props: host?.querySelectorAll(".s-rv-props").length ?? 0,
  };
});
ok("an Arabic note prints as an RTL page", rtl.dir === "rtl",
  `host dir="${rtl.dir}" with chrome dir="${rtl.chrome}"`);
ok("no chrome decides the page's direction", rtl.bannerCards === 0 && rtl.props === 0,
  `${rtl.props} properties card(s), ${rtl.bannerCards} banner repair card(s)`);
await teardownPrint();

// ── 3. nothing to print says so ────────────────────────────────────────────

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.keyboard.press("Control+g");
await page.waitForTimeout(600);
await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
const empty = await page.evaluate(() => ({
  attr: document.body.dataset.print,
  hint: document.querySelector(".s-print__hint")?.textContent ?? null,
}));
ok("a surface with no document says so instead of spending a sheet",
  empty.attr === "none" && (empty.hint ?? "").length > 0, empty.hint ?? "no hint");

await browser.close();
await cleanup();

console.log(failures === 0 ? "\nPRINT OK" : `\nFAIL: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
