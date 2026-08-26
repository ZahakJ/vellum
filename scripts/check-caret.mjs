// GATE: pointer → document accuracy in the live-preview editor.
//   node scripts/check-caret.mjs [http://localhost:6801] [outdir]
//   env: CHROMIUM=/usr/bin/chromium
//        VELLUM_PASSWORD=<pw>  — only when the instance sets ADMIN_PASSWORD_HASH;
//                                without an admin session no editor mounts and
//                                the run refuses loudly instead of "passing".
// Exits 1 on any miss. Run it like check-i18n / check-contrast.
//
// WHERE THE POINTER LANDS has now broken five separate ways in this editor —
// caret placement, hover previews, mod-click navigation, text selection, and
// the double-click word — and every one was the same defect wearing a
// different hat: a pixel the editor's geometry could not see. So this gate has
// two phases, because the two failures are genuinely different and each one
// passed the other's test.
//
// PHASE A — CLICK ACCURACY (the matrix).
// Live preview replaces source with rendered boxes that are a different WIDTH
// and a different LENGTH: `$7.7\ \text{km/s}$` is eighteen characters of
// markdown standing under seven glyphs of KaTeX, `[[Note|alias]]` hides eleven
// characters that still occupy document positions, `![dot](…)` is a whole
// image inside one offset. Any pointer→document mapping that reasons about
// geometry instead of about the DOM drifts by exactly that difference, and
// CodeMirror's `posAtCoords` drifts all the way to the end of the line.
// Measured on the live vault before the fix: every click on the wrapped row of
// "Eppur si muove" that carries one inline formula landed on doc position 606,
// the line's end, for x anywhere from 500 to 900. The owner reported it as
// "click near the start of a line, the caret lands about 25 words in".
//
// It writes its own note — every inline feature the editor replaces or
// restyles, in English and in Arabic, on lines long enough to wrap several
// times — and then, for a matrix of document positions on those lines:
//
//   1. parks the selection on a neutral line (the reveal-on-cursor rule
//      rewrites the layout of whatever line the caret is on, so measuring and
//      clicking must both happen with the target line RENDERED);
//   2. asks the view for the glyph's own box, `coordsAtPos(pos, 1)` to
//      `coordsAtPos(pos + 1, -1)` — a DOM range measurement, independent of
//      the mapping under test;
//   3. clicks 35% into that box;
//   4. requires the caret to land within ONE character of it.
//
// Positions whose box is zero-width (hidden syntax: the `**`, the `[[`, the
// math source under its widget) are not clickable glyphs and are skipped; so
// are positions straddling a soft wrap, where two rows share one offset.
//
// PHASE B — GESTURES (double-click, triple-click, drag, shift-click).
// Phase A alone would have passed a completely broken selection: single-click
// position was patched by resolving the pointer from the DOM (pointer.ts)
// while double-click, triple-click and drag went on being computed against a
// document that live preview REFLOWS BETWEEN THE TWO CLICKS — click one moves
// the cursor, the cursor's line becomes "active", its hidden markdown comes
// back, and the paragraph the user is still pointing at has moved. So Phase B
// presses the gestures a reader actually presses and reads back what the
// reader would actually COPY — `window.getSelection()`, not an editor
// internal. Its subjects are written rather than found, because the failure is
// a function of what sits ABOVE a line (a properties card, a callout's border,
// a fence's hidden ``` markers): a note that happens to have none of them is
// not a test of anything.
//
// RTL is not a separate feature here, it is the same code path with the
// bidirectional case wired in: both phases run again with the instance's
// chrome language flipped to Arabic, which is a `dir="rtl"` shell — a
// different base direction for the editor and a different visual order for the
// bidi runs. The language is restored and both fixtures are deleted
// permanently, however the run ends.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const [url = "http://localhost:6801", out = "shots"] = process.argv.slice(2);
const GATE_PATH = "caret-gate.md";
const SEL_PATH = "caret-gate-selection.md";
const TOLERANCE = 1; // characters
const SAMPLES_PER_LINE = 9;

const DOT =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="8" fill="#c9a227"/></svg>',
  ).toString("base64");

// Every line the matrix walks is tagged with the feature it exists for; the
// tag is also how the script finds the line again after a reload.
const FIXTURE = `---
title: Caret gate
tags: [caretgate]
---

# Caret gate

parking line, nothing to reveal

MATH-EN — inline math: the kinetic term $E = \\tfrac{1}{2}mv^2$ and the circular speed $v = \\sqrt{GM/r} \\approx 7.7\\ \\text{km/s}$ sit inside ordinary prose that keeps running well past the second formula, so the rows before, between and after the rendered boxes are all sampled rather than only the ones that happen to be easy.

CODE-EN — inline code: call \`posAtCoords(coords, precise)\`, compare it against \`caretPositionFromPoint(x, y)\` and then \`view.posAtDOM(node, offset)\`, and go on writing plain sentences afterwards so the tail of the line is long enough to wrap and be measured on its own row.

LINK-EN — wikilinks: see [[caret-gate]] and [[caret-gate|an alias for it]] and [[caret-gate#Caret gate]], each of which hides brackets that still hold document positions, and then more plain prose so the line wraps at least twice past the last of them.

TAG-EN — tags: #alpha and #beta/gamma and #delta are pills with their own padding, and the sentence carries on afterwards for long enough to wrap, because the interesting positions are the ones AFTER a styled span rather than inside it.

MARK-EN — highlights: ==a highlighted run of words== and ==a second one== hide their equals signs on either side, and the prose after them continues far enough that the mapping is checked on a row that begins after a hidden mark.

IMG-EN — image: ![dot](${DOT}) is one document offset wearing an eighteen-pixel box, and the prose that follows it runs on long enough to wrap so the rows after the widget are sampled as well as the row it sits on.

MATH-AR — رياضيات داخل السطر: الطاقة الحركية $E = \\tfrac{1}{2}mv^2$ والسرعة المدارية $v = \\sqrt{GM/r}$ تقعان داخل نص عربي عادي يستمر بعدهما مسافة كافية حتى يلتف السطر أكثر من مرة، فتُختبر الأسطر البصرية قبل الصندوق المرسوم وبعده.

CODE-AR — شفرة داخل السطر: نادِ \`posAtDOM(node, offset)\` ثم \`coordsAtPos(pos)\` واستمر في الكتابة بعدهما بجُمل عادية طويلة بما يكفي ليلتف السطر ويُقاس ذيله على سطر بصري مستقل عن أوله.

LINK-AR — روابط ووسوم وتظليل: انظر [[caret-gate|اسم بديل]] مع الوسم #وسم_عربي والتظليل ==نص مظلَّل== ثم نص عادي يمتد بعدها مسافة كافية حتى يلتف السطر مرتين على الأقل.
`;

// Phase B's subjects. Each paragraph exists for one gesture assertion, and the
// order matters: the callout, the fence and the trailing paragraph are here so
// that the cases below them are measured with real reflow hazards above them.
const SEL_NOTE = `---
title: Selection gate
tags: [caretgate]
---

# Caret gate heading

The quick brown fox jumps over the lazy dog while nobody is watching here.

الفلسفة الإسلامية في القرن الحادي عشر كانت مزدهرة جدا في بغداد والأندلس.

این یک مقاله درباره‌ی فلسفه است که با فاصله مجازی نوشته شده است.

She doesn't mind the noise at all when the afternoon is quiet enough here.

A paragraph that mentions [[Selection target]] as a wikilink among plain words.

Inline math $E = mc^2$ sits in this sentence about relativity and energy.

Some \`inline code chip\` inside a plain paragraph of ordinary running words.

> [!note] A callout title
> Inside the callout there is a paragraph with several ordinary words here.

\`\`\`js
const alpha = someObject.methodName(argumentOne, argumentTwo);
let snake_case_name = $jquery + 42;
\`\`\`

A trailing paragraph that has to stay reachable below everything above it.
`;

mkdirSync(out, { recursive: true });

const fail = [];
const rows = [];
const check = (ok, label, detail = "") => {
  if (!ok) fail.push(`${label} ${detail}`);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
// ONE context for the whole run: browser.newPage() makes a fresh context every
// time, which would drop the session cookie the login below sets.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const apiPage = await context.newPage();
await apiPage.goto(url, { waitUntil: "load" });

// Requests go through the PAGE, not through node's fetch: the session is a
// cookie, and an instance with ADMIN_PASSWORD_HASH set only answers a caller
// that logged in. Returns { status, body } and never throws.
const api = (path, init) =>
  apiPage.evaluate(
    async ([p, i]) => {
      const r = await fetch(p, i ?? undefined);
      const text = await r.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* leave as text */
      }
      return { status: r.status, body };
    },
    [path, init ?? null],
  );

// The view handle: CodeMirror's own `EditorView.findFromDOM` reads the tile
// stamped on `.cm-content`. Nothing else in the app exposes the view, and a
// gate that reached for a test-only global would be testing a test hook.
const VIEW = `(() => { const c = document.querySelector(".cm-content"); const t = c && c.cmTile; return t && t.root && t.root.view; })()`;

// UNSET IS A VALUE HERE, and reading it as "nothing to put back" is how this
// gate left the next one in Arabic. A fresh instance stores no `language` at
// all, so `/api/settings` answers `null`; the RTL phase then PATCHes "ar" and
// the old guard (`restoreLang !== null`) skipped the restore entirely. The
// instance kept the fixture's language after the run, and the very next gate
// in the v1.8 order — check-board, which types an English command name into
// the palette — matched nothing against an Arabic command table and timed out
// looking for a designer that never opened. So the sentinel is a separate
// flag, and `null` is PATCHed back deliberately: it clears the key to unset,
// which is the state the run found.
let restoreLang = null;
let langRead = false;
let wrote = false;

const restore = async () => {
  if (langRead) {
    await api("/api/settings", json("PATCH", { language: restoreLang })).catch(() => {});
  }
  if (wrote) {
    for (const p of [GATE_PATH, SEL_PATH]) {
      await api(`/api/note?path=${encodeURIComponent(p)}&permanent=true`, {
        method: "DELETE",
      }).catch(() => {});
    }
  }
  await browser.close().catch(() => {});
};

try {
  // SAY WHICH SESSION THIS IS BEFORE MEASURING IT. Without an admin session no
  // editor mounts, and a run that finds no `.cm-content` has measured nothing
  // — it must say so rather than pass.
  let me = (await api("/api/me")).body;
  if (!me.admin) {
    const password = process.env.VELLUM_PASSWORD ?? "";
    if (!password) {
      console.error(
        "check-caret: not an admin session. This gate drives the EDITOR; run it\n" +
          "against an instance in open local mode, or set VELLUM_PASSWORD.",
      );
      await restore();
      process.exit(2);
    }
    const res = await api("/api/login", json("POST", { password }));
    if (res.status !== 200) {
      console.error(`check-caret: login failed (${res.status}). Refusing.`);
      await restore();
      process.exit(2);
    }
    me = (await api("/api/me")).body;
  }

  const settings = (await api("/api/settings")).body;
  restoreLang = settings?.language ?? null;
  langRead = true;

  for (const [path, content] of [
    [GATE_PATH, FIXTURE],
    [SEL_PATH, SEL_NOTE],
  ]) {
    const w = await api(`/api/note?path=${encodeURIComponent(path)}`, json("PUT", { content }));
    if (w.status !== 200) {
      console.error(`check-caret: could not write ${path} (${w.status}).`);
      await restore();
      process.exit(2);
    }
  }
  wrote = true;

  for (const dir of ["ltr", "rtl"]) {
    const lang = dir === "rtl" ? "ar" : "en";
    await api("/api/settings", json("PATCH", { language: lang }));

    // ── Phase A: click accuracy ──────────────────────────────────────────
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
    await page.goto(`${url}/${GATE_PATH.replace(/\.md$/, "")}`, { waitUntil: "load" });
    await page.waitForSelector(".cm-content", { timeout: 25000 });
    // KaTeX and the image both arrive late and both move the rows under them.
    await page.waitForTimeout(2500);

    const htmlDir = await page.evaluate(
      () => document.documentElement.getAttribute("dir") ?? "ltr",
    );
    check(htmlDir === dir, `${dir}: shell direction`, `<html dir> = ${htmlDir}`);

    const targets = await page.evaluate(`(() => {
      const v = ${VIEW};
      const out = { park: null, lines: [] };
      for (let n = 1; n <= v.state.doc.lines; n++) {
        const line = v.state.doc.line(n);
        if (line.text.startsWith("parking")) out.park = line.from;
        const m = /^([A-Z]+-[A-Z]+) /.exec(line.text);
        if (m) out.lines.push({ n, label: m[1], length: line.length });
      }
      return out;
    })()`);
    check(
      targets.park != null && targets.lines.length >= 9,
      `${dir}: fixture loaded`,
      `${targets.lines.length} feature lines`,
    );

    for (const target of targets.lines) {
      let worst = 0;
      let sampled = 0;
      let misses = 0;
      const step = Math.max(4, Math.floor(target.length / SAMPLES_PER_LINE));
      for (let off = 2; off < target.length; off += step) {
        // 1. Park the caret elsewhere: the target line must be RENDERED both
        //    when it is measured and when it is clicked, and the cursor's own
        //    line is the one line live preview un-renders.
        await page.evaluate(`(() => {
          const v = ${VIEW};
          v.dispatch({ selection: { anchor: ${targets.park} } });
        })()`);
        // 2. Measure the glyph itself, and bring it on screen first.
        const box = await page.evaluate(`(() => {
          const v = ${VIEW};
          const line = v.state.doc.line(${target.n});
          const pos = Math.min(line.from + ${off}, line.to - 1);
          // A rendered wikilink, tag pill or image is a BUTTON off the cursor
          // line: clicking one navigates, searches or opens the viewer instead
          // of placing a caret, which is the documented behaviour and not what
          // this gate measures. The glyphs that matter are the ones AFTER them,
          // where the source/rendered length disagreement has accumulated.
          const off = pos - line.from, txt = line.text;
          for (const re of [/\\[\\[[^\\]]*\\]\\]/g, /!\\[[^\\]]*\\]\\([^)]*\\)/g, /(^|\\s)#[^\\s#]+/g]) {
            re.lastIndex = 0;
            for (let m = re.exec(txt); m; m = re.exec(txt)) {
              if (off >= m.index && off < m.index + m[0].length) {
                return { skip: "actionable", pos };
              }
            }
          }
          // The fixture is taller than the window: bring the glyph to the
          // middle of the scroller and measure it where it will be clicked.
          // (Scrolling by hand rather than through scrollIntoView, which wants
          // a transaction and would move the caret this step just parked.)
          let a = v.coordsAtPos(pos, 1), b = v.coordsAtPos(pos + 1, -1);
          if (a && (a.top < 120 || a.bottom > 820)) {
            v.scrollDOM.scrollTop += (a.top + a.bottom) / 2 - 450;
            v.measure();
            a = v.coordsAtPos(pos, 1); b = v.coordsAtPos(pos + 1, -1);
          }
          if (!a || !b) return null;
          // Hidden syntax and replaced source have no box of their own.
          if (Math.abs(b.left - a.left) < 2) return { skip: "zero-width", pos };
          // A soft wrap puts one offset on two rows; the click is ambiguous.
          if (Math.abs(b.top - a.top) > 2) return { skip: "wrap", pos };
          const x = a.left + (b.left - a.left) * 0.35;
          const y = (a.top + a.bottom) / 2;
          if (y < 70 || y > 860 || x < 4 || x > 1436) return { skip: "offscreen", pos };
          return { pos, x, y, ch: v.state.doc.sliceString(pos, pos + 1) };
        })()`);
        if (!box || box.skip) continue;
        await page.mouse.click(box.x, box.y);
        const head = await page.evaluate(
          `(() => { const v = ${VIEW}; return v.state.selection.main.head; })()`,
        );
        const delta = head - box.pos;
        sampled++;
        worst = Math.max(worst, Math.abs(delta));
        if (Math.abs(delta) > TOLERANCE) {
          misses++;
          rows.push({ dir, label: target.label, pos: box.pos, ch: box.ch, head, delta });
        }
      }
      check(
        misses === 0 && sampled >= 3,
        `${dir}: ${target.label}`,
        `${sampled} glyphs clicked, ${misses} missed, worst |Δ| = ${worst}`,
      );
    }

    await page.screenshot({ path: `${out}/caret-${dir}.png` });
    await page.close();

    // ── Phase B: gestures ────────────────────────────────────────────────
    const gp = await context.newPage();
    gp.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

    // EVERY CASE STARTS FROM A FRESHLY OPENED NOTE. Live preview reveals the
    // cursor's line, so a case that leaves the cursor inside the code fence
    // un-hides its ``` markers and moves every line below by two rows — the
    // next case would then be measuring a different document, and an earlier
    // version of this script "passed" and "failed" cases depending only on
    // which case ran before them.
    const openFixture = async () => {
      await gp.goto(`${url}/${SEL_PATH.replace(/\.md$/i, "")}`, { waitUntil: "load" });
      await gp.waitForTimeout(1200);
      // A rebuild during the run renames the lazy Editor chunk and a cached
      // index.html then imports a 404 — reload once rather than blame selection.
      if ((await gp.locator(".cm-editor").count()) === 0) {
        await gp.reload({ waitUntil: "load" });
        await gp.waitForTimeout(1400);
      }
      if ((await gp.locator(".cm-content").count()) === 0) {
        check(false, `${dir}: selection fixture mounts an editor`, "no .cm-content");
        return false;
      }
      return true;
    };

    /** Viewport point at the middle of the first RENDERED occurrence of `text`.
     *  Rendered, not source: what the reader aims at is the KaTeX box or the
     *  bracket-less link, and aiming at source offsets would test a document
     *  nobody is looking at.
     *
     *  IT SCROLLS FIRST AND MEASURES AFTER, and it treats "off screen" and
     *  "not in the DOM" as the same problem, because CodeMirror renders only
     *  the visible range: in the Arabic shell — taller chrome, less room for
     *  the note — the code fence and the last paragraph were not in the
     *  document at all, and a helper that only knew how to `scrollIntoView` an
     *  element it could already see reported "not rendered" for three cases
     *  that were simply below the fold. */
    const SAFE = 60; // keep clicks clear of the sticky top bar and the fold
    const locate = (text, nth = 0) =>
      gp.evaluate(
        ([needle, index, safe]) => {
          const content = document.querySelector(".cm-content");
          if (!content) return null;
          const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
          let seen = 0;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (
              let at = node.data.indexOf(needle);
              at !== -1;
              at = node.data.indexOf(needle, at + 1)
            ) {
              if (seen++ < index) continue;
              const range = document.createRange();
              range.setStart(node, at);
              range.setEnd(node, at + needle.length);
              const box = range.getBoundingClientRect();
              if (!box.width || !box.height) continue;
              if (box.top < safe || box.bottom > window.innerHeight - safe) {
                const line = node.parentElement && node.parentElement.closest(".cm-line");
                if (line) line.scrollIntoView({ block: "center" });
                return { moved: true };
              }
              return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            }
          }
          // Not in the rendered range at all: page down and look again.
          const scroller = document.querySelector(".cm-scroller");
          if (!scroller) return null;
          const before = scroller.scrollTop;
          scroller.scrollTop = Math.min(
            scroller.scrollHeight - scroller.clientHeight,
            before + scroller.clientHeight * 0.6,
          );
          return scroller.scrollTop > before ? { moved: true } : null;
        },
        [text, nth, SAFE],
      );

    const point = async (text, nth = 0) => {
      for (let i = 0; i < 10; i++) {
        const found = await locate(text, nth);
        if (!found) return null;
        if (found.x !== undefined) return found;
        // A CodeMirror scroll re-renders the visible range; measure after it.
        await gp.waitForTimeout(380);
      }
      return null;
    };

    /** What the reader would copy. Deliberately the browser's own selection
     *  and not an editor internal: CodeMirror keeps the DOM selection in step
     *  with its state, so this is both the user-visible truth and a check that
     *  the two have not drifted apart. */
    const selected = () => gp.evaluate(() => (window.getSelection() ?? "").toString());

    /** Middle of the first element matching a CSS selector — for the things
     *  that have no text node of their own to aim at. KaTeX shatters
     *  `E = mc^2` into a span per glyph, so "mc" exists on screen and in no
     *  text node. */
    const pointOf = (selector) =>
      gp.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) return null;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }, selector);

    const gesture = async (aim, clicks) => {
      if (!(await openFixture())) return { missing: true, got: "" };
      const p = typeof aim === "function" ? await aim() : await point(aim);
      if (!p) return { missing: true, got: "" };
      await gp.mouse.click(p.x, p.y, { clickCount: clicks });
      await gp.waitForTimeout(220);
      return { missing: false, got: await selected(), p };
    };

    const expect = async (label, aim, clicks, want) => {
      const { missing, got } = await gesture(aim, clicks);
      if (missing) return check(false, `${dir}: ${label}`, "subject is not rendered in the note");
      check(
        got === want,
        `${dir}: ${label}`,
        got === want ? "" : `want ${JSON.stringify(want)} got ${JSON.stringify(got)}`,
      );
    };

    const LINE = "The quick brown fox jumps over the lazy dog while nobody is watching here.";

    // 1. THE REPORTED BUG. A plain paragraph, below the frontmatter card:
    //    double-click takes the word under the pointer, not the block, not the
    //    blank line beneath it, not nothing.
    await expect("double-click selects the word", "nobody", 2, "nobody");
    await expect("double-click selects the word (mid-line)", "brown", 2, "brown");

    // 2. Triple-click takes the paragraph, with the newline that ends it, so
    //    that triple-click-then-type replaces the paragraph cleanly.
    await expect("triple-click selects the paragraph", "nobody", 3, `${LINE}\n`);

    // 3. Arabic. The word boundary must be the word, not the whole run and not
    //    one letter: the categorizer steps by grapheme cluster, so a letter
    //    and its harakat stay together.
    await expect("double-click selects an Arabic word", "الحادي", 2, "الحادي");
    await expect(
      "triple-click selects an RTL paragraph",
      "الحادي",
      3,
      "الفلسفة الإسلامية في القرن الحادي عشر كانت مزدهرة جدا في بغداد والأندلس.\n",
    );

    // 4. Persian. U+200C ZERO WIDTH NON-JOINER is a letter's business, not a
    //    word break: "درباره‌ی" is one word wearing an invisible seam. It
    //    survives because the scan steps by grapheme cluster and the ZWNJ has
    //    Grapheme_Cluster_Break=Extend — the same property that keeps Arabic
    //    harakat and Devanagari matras attached. Assert it, because "Arabic
    //    works" was assumed once and Persian is where the assumption breaks.
    await expect("double-click keeps a Persian ZWNJ word whole", "درباره", 2, "درباره‌ی");

    // 5. An apostrophe inside a word is part of the word.
    await expect("double-click keeps a word's apostrophe", "doesn", 2, "doesn't");

    // 6. A wikilink ON THE LINE BEING EDITED is one object: its brackets are
    //    on screen, so double-clicking it selects the link, not one word of
    //    its target. (On a line the cursor is NOT on, the brackets are hidden
    //    and a plain click FOLLOWS the link — that is the editor's navigation
    //    contract, and it means click 1 has already opened the note before a
    //    second could arrive. Nothing to select there, by design.)
    if (await openFixture()) {
      const onLine = await point("wikilink");
      let link = null;
      if (onLine) {
        await gp.mouse.click(onLine.x, onLine.y);
        await gp.waitForTimeout(280);
        link = await point("Selection target");
      }
      if (link) {
        await gp.mouse.click(link.x, link.y, { clickCount: 2 });
        await gp.waitForTimeout(220);
        const got = await selected();
        check(
          got === "[[Selection target]]",
          `${dir}: double-click selects a whole wikilink`,
          `got ${JSON.stringify(got)}`,
        );
      } else {
        check(false, `${dir}: double-click selects a whole wikilink`, "wikilink not rendered");
      }
    }

    // 7. Rendered units. Inline math is ONE object on screen, so it is one
    //    object to select; the same for an inline-code chip.
    await expect(
      "double-click selects a whole math span",
      () => pointOf(".cm-s-math"),
      2,
      "$E = mc^2$",
    );
    await expect("double-click selects a whole inline-code chip", "chip", 2, "`inline code chip`");

    // 8. Inside a callout, and on the line BELOW everything. Both used to
    //    drift: the callout by its 0.3em of air, the fence below it by its
    //    hidden ``` markers, and the drift accumulated down the note.
    await expect("double-click inside a callout", () => point("ordinary", 1), 2, "ordinary");
    await expect("double-click below a fence", "reachable", 2, "reachable");

    // 9. Code-appropriate boundaries inside a fence: an identifier is a unit,
    //    a `$name` is a unit, and `$x$` is NOT math in here.
    await expect("double-click takes a code identifier", "methodName", 2, "methodName");
    await expect("double-click keeps snake_case whole", "snake_case_name", 2, "snake_case_name");
    await expect("double-click keeps a $-prefixed name whole", "jquery", 2, "$jquery");

    // 10. Drag extends by CHARACTER, from wherever inside the word the press
    //     landed — aiming at the middle of "quick" and releasing in the middle
    //     of "lazy" must select from inside the one to inside the other, not
    //     snap out to whole words and not start a line away. `midWordDrag`
    //     states the shape rather than a pixel-exact string: which character
    //     the middle of a glyph run falls on is a font metric, and a gate that
    //     pins that is testing the font.
    const midWordDrag = (got, first, last) => {
      const at = LINE.indexOf(got);
      if (at === -1 || got.length < 10) return false;
      const startsIn = LINE.indexOf(first);
      const endsIn = LINE.indexOf(last);
      return (
        at > startsIn &&
        at < startsIn + first.length &&
        at + got.length > endsIn &&
        at + got.length < endsIn + last.length
      );
    };

    if (await openFixture()) {
      const a = await point("quick");
      const b = await point("lazy");
      if (a && b) {
        await gp.mouse.move(a.x, a.y);
        await gp.mouse.down();
        await gp.mouse.move(b.x, b.y, { steps: 12 });
        await gp.mouse.up();
        await gp.waitForTimeout(220);
        const got = await selected();
        check(
          midWordDrag(got, "quick", "lazy"),
          `${dir}: drag extends by character`,
          `got ${JSON.stringify(got)}`,
        );
      } else {
        check(false, `${dir}: drag extends by character`, "subjects not rendered");
      }
    }

    // 11. Shift-click extends from the existing anchor rather than starting a
    //     new selection at the click.
    if (await openFixture()) {
      const c = await point("quick");
      const d = await point("lazy");
      if (c && d) {
        await gp.mouse.click(c.x, c.y);
        await gp.waitForTimeout(180);
        await gp.keyboard.down("Shift");
        await gp.mouse.click(d.x, d.y);
        await gp.keyboard.up("Shift");
        await gp.waitForTimeout(220);
        const got = await selected();
        check(
          midWordDrag(got, "quick", "lazy"),
          `${dir}: shift-click extends from the anchor`,
          `got ${JSON.stringify(got)}`,
        );
      } else {
        check(false, `${dir}: shift-click extends from the anchor`, "subjects not rendered");
      }
    }

    // 12. Select-all is the DOCUMENT, from anywhere — including from inside a
    //     callout, whose title bar is widget DOM the browser would otherwise
    //     be happy to treat as its own little editable world.
    if (await openFixture()) {
      const inCallout = await point("ordinary", 1);
      if (inCallout) {
        await gp.mouse.click(inCallout.x, inCallout.y);
        await gp.waitForTimeout(180);
        await gp.keyboard.press("Control+a");
        await gp.waitForTimeout(220);
        const got = await selected();
        check(
          got.includes("# Caret gate heading") && got.includes("A trailing paragraph"),
          `${dir}: select-all inside a callout takes the document`,
          `got ${got.length} chars`,
        );
      } else {
        check(false, `${dir}: select-all inside a callout takes the document`, "callout not rendered");
      }
    }

    await gp.screenshot({ path: `${out}/caret-selection-${dir}.png` });
    await gp.close();
  }
} finally {
  await restore();
}

if (rows.length > 0) {
  console.log("\n  misses (clicked glyph → caret):");
  for (const r of rows.slice(0, 40)) {
    console.log(
      `    ${r.dir} ${r.label}  pos ${r.pos} ${JSON.stringify(r.ch)} → ${r.head}  Δ${r.delta > 0 ? "+" : ""}${r.delta}`,
    );
  }
  writeFileSync(`${out}/caret-misses.json`, JSON.stringify(rows, null, 2));
}

console.log(
  fail.length === 0
    ? "\ncheck-caret: OK — every clicked glyph took the caret, and every gesture took its unit."
    : `\ncheck-caret: ${fail.length} FAILED`,
);
for (const f of fail) console.log(`  · ${f}`);
process.exit(fail.length === 0 ? 0 : 1);
