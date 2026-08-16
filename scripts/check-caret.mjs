// GATE: click-to-caret accuracy in the live-preview editor.
//   node scripts/check-caret.mjs [http://localhost:6801] [outdir]
//   env: CHROMIUM=/usr/bin/chromium
// Exits 1 on any miss. Run it like check-i18n / check-contrast.
//
// WHAT IT PROVES. Live preview replaces source with rendered boxes that are a
// different WIDTH and a different LENGTH: `$7.7\ \text{km/s}$` is eighteen
// characters of markdown standing under seven glyphs of KaTeX, `[[Note|alias]]`
// hides eleven characters that still occupy document positions, `![dot](…)` is
// a whole image inside one offset. Any pointer→document mapping that reasons
// about geometry instead of about the DOM drifts by exactly that difference,
// and CodeMirror's `posAtCoords` — which places the caret unless something
// replaces it — drifts all the way to the end of the line. Measured on the
// live vault before the fix: every click on the wrapped row of "Eppur si
// muove" that carries one inline formula landed on doc position 606, the
// line's end, for x anywhere from 500 to 900. The owner reported it as "click
// near the start of a line, the caret lands about 25 words in".
//
// HOW. The script writes its own note — every inline feature the editor
// replaces or restyles, in English and in Arabic, on lines long enough to wrap
// several times — and then, for a matrix of document positions on those lines:
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
// math source under its widget) are not clickable glyphs and are skipped;
// so are positions straddling a soft wrap, where two rows share one offset.
//
// The fixture's own wikilinks point at the fixture: an UNRESOLVED wikilink is a
// create-on-click target in this editor, and a gate that can leave a note
// behind in the vault it is measuring is a gate nobody should run twice.
//
// The whole matrix runs twice: once with the instance in English and once in
// Arabic, which is a `dir="rtl"` shell — a different base direction for the
// editor, a different visual order for the bidi runs, and the case where an
// x-coordinate binary search is least defensible. The instance's language is
// restored, and the fixture note deleted, however the run ends.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const [url = "http://localhost:6801", out = "shots"] = process.argv.slice(2);
const GATE_PATH = "caret-gate.md";
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

mkdirSync(out, { recursive: true });

const fail = [];
const rows = [];
const check = (ok, label, detail = "") => {
  if (!ok) fail.push(`${label} ${detail}`);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const api = async (path, init) => {
  const res = await fetch(`${url}/api${path}`, init);
  const body = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
};
const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// SAY WHICH SESSION THIS IS BEFORE MEASURING IT. Without an admin session no
// editor mounts, and a run that finds no `.cm-content` has measured nothing —
// it must say so rather than pass.
const me = await api("/me");
if (!me.admin) {
  console.error(
    "check-caret: not an admin session. This gate drives the EDITOR; run it\n" +
      "against an instance in open local mode, or teach it to log in first.",
  );
  process.exit(1);
}
const settings = await api("/settings");
const originalLang = settings.language ?? null;

await api(`/note?path=${encodeURIComponent(GATE_PATH)}`, json("PUT", { content: FIXTURE }));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// The view handle: CodeMirror's own `EditorView.findFromDOM` reads the tile
// stamped on `.cm-content`. Nothing else in the app exposes the view, and a
// gate that reached for a test-only global would be testing a test hook.
const VIEW = `(() => { const c = document.querySelector(".cm-content"); const t = c && c.cmTile; return t && t.root && t.root.view; })()`;

const restore = async () => {
  await browser.close().catch(() => {});
  await api(`/note?path=${encodeURIComponent(GATE_PATH)}&permanent=true`, {
    method: "DELETE",
  }).catch(() => {});
  await api("/settings", json("PATCH", { language: originalLang })).catch(() => {});
};

try {
  for (const dir of ["ltr", "rtl"]) {
    const lang = dir === "rtl" ? "ar" : "en";
    await api("/settings", json("PATCH", { language: lang }));
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
    await page.goto(`${url}/${GATE_PATH.replace(/\.md$/, "")}`, { waitUntil: "load" });
    await page.waitForSelector(".cm-content", { timeout: 25000 });
    // KaTeX and the image both arrive late and both move the rows under them.
    await page.waitForTimeout(2500);

    const htmlDir = await page.evaluate(
      () => document.documentElement.getAttribute("dir") ?? "ltr",
    );
    check(
      htmlDir === dir,
      `${dir}: shell direction`,
      `<html dir> = ${htmlDir}`,
    );

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
          rows.push({
            dir,
            label: target.label,
            pos: box.pos,
            ch: box.ch,
            head,
            delta,
          });
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
    ? "\ncheck-caret: OK — every clicked glyph took the caret."
    : `\ncheck-caret: ${fail.length} FAILED`,
);
process.exit(fail.length === 0 ? 0 : 1);
