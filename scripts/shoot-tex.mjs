// Dev harness (not shipped): the LaTeX-notes gate. It ASSERTS and exits 1.
//
//   node scripts/shoot-tex.mjs http://localhost:7065 /outdir
//   env: CHROMIUM=/usr/bin/chromium
//        VELLUM_PASSWORD=<pw>  — only if the instance sets ADMIN_PASSWORD_HASH
//
// The vault it points at must contain the two notes this script names (the
// shipped `vault-seed` has them): a `.tex` note and a markdown note that
// transcludes an anchor inside it.
//
// Six things are checked, and each of them is a way the feature has a
// specific, silent failure mode:
//
//  1. A `.tex` note OPENS at all. Every `.md`-suffix test in the tree is a
//     place this could 404 instead — the router, the tree, /api/note.
//  2. Its prose is PROSE. If `\section` and `\textbf` reach the page, the
//     renderer fell back to treating LaTeX as markdown, which looks like
//     "some formatting is off" rather than like a broken feature.
//  3. Its maths is SET. KaTeX either ran or it didn't; a page of `\frac`
//     source is the difference.
//  4. Equations are numbered ONCE. KaTeX's own counter restarts per block, so
//     "(1) (1)" on one line is the signature of the tag-injection breaking.
//  5. A cross-format anchor transclusion pulls in ONE equation. This is the
//     invention; nothing else in the product exercises it.
//  6. The EDITOR mounts with a live preview, not a wall of source.
//
// It also fails on any console error, because a renderer that throws halfway
// leaves a page that looks merely short.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:7065", out = "shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const TEX_NOTE = "LaTeX Notes";
const MD_NOTE = "Transclusion Probe";

const fail = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

if (process.env.VELLUM_PASSWORD) {
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const res = await page.request.post(`${base}/api/login`, {
    data: { password: process.env.VELLUM_PASSWORD },
  });
  if (!res.ok()) {
    console.log("  FAIL  sign in");
    process.exit(1);
  }
  await page.close();
}

const errors = [];
const open = async (path, { reading }) => {
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${path}: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.addInitScript((r) => {
    localStorage.setItem("vellum.reading", r ? "true" : "false");
    localStorage.setItem("vellum.theme", "iron-gall");
  }, reading);
  await page.goto(`${base}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2500);
  return page;
};

// ── 1–4: the reading view ───────────────────────────────────────────────────
{
  const page = await open(TEX_NOTE, { reading: true });
  const root = page.locator(".s-rv--tex");
  check(await root.count() > 0, "tex note opens in reading view");

  const text = (await root.first().innerText().catch(() => "")) || "";
  check(text.length > 200, "tex note renders prose", `${text.length} chars`);
  // `\input` and friends appear in the seed note as TYPESET text
  // (`\texttt{\textbackslash input}`), which is content, not a leak — so the
  // test names the four that could only arrive by the renderer giving up.
  const leaked = /\\section|\\textbf|\\emph|\\begin\{/.exec(text);
  check(leaked === null, "no raw control sequences reach the page", leaked?.[0] ?? "");

  const katex = await page.locator(".s-rv--tex .katex").count();
  check(katex > 0, "maths is set by KaTeX", `${katex} formulas`);

  const headings = await page.locator(".s-rv--tex .s-rv-h .s-rv-tex-num").count();
  check(headings > 0, "sections are numbered", `${headings} numbered`);

  // One tag per numbered equation, never two. KaTeX's own counter would add a
  // second, and both would read "(1)".
  const tags = await page.locator(".s-rv--tex .s-rv-mathblock .katex-tag").count();
  const numbered = await page.locator(".s-rv--tex .s-rv-mathblock").count();
  check(
    tags > 0 && tags <= numbered,
    "one equation number per numbered block",
    `${tags} tags / ${numbered} blocks`,
  );

  await page.screenshot({ path: `${out}/tex-reading.png` });
  await page.close();
}

// ── 5: the cross-format anchor transclusion ─────────────────────────────────
{
  const page = await open(MD_NOTE, { reading: true });
  const card = page.locator(".s-rv-transclude").first();
  check(await card.count() > 0, "anchor transclusion renders a card");
  const inner = await card.innerText().catch(() => "");
  check(
    (await card.locator(".katex").count()) > 0,
    "the transcluded fragment is rendered maths",
  );
  check(
    inner.length < 400,
    "the transclusion is the ANCHOR, not the whole note",
    `${inner.length} chars`,
  );
  await page.screenshot({ path: `${out}/tex-transclusion.png` });
  await page.close();
}

// ── 6: the editor ───────────────────────────────────────────────────────────
{
  const page = await open(TEX_NOTE, { reading: false });
  check((await page.locator(".cm-content").count()) > 0, "tex note opens an editor");
  const live = await page.locator(".cm-content .cm-s-h2, .cm-content .cm-s-h1").count();
  check(live > 0, "editor live-previews sectioning", `${live} headings`);
  const math = await page.locator(".cm-content .katex").count();
  check(math > 0, "editor live-previews maths", `${math} formulas`);
  const props = await page.locator(".cm-content .cm-s-props").count();
  check(props > 0, "comment frontmatter draws the properties card");
  await page.screenshot({ path: `${out}/tex-editor.png` });
  await page.close();
}

check(errors.length === 0, "no console errors", errors.slice(0, 3).join(" | "));

await browser.close();
if (fail.length) {
  console.log(`\nFAILED: ${fail.join(", ")}`);
  process.exit(1);
}
console.log("\nLaTeX notes OK");
