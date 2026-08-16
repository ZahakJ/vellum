// THE GATE FOR SECTION SURGERY.
//
// Dragging a heading in the outline rewrites the note: a block of lines leaves
// one place and arrives in another, and the moved subtree's own headings are
// re-levelled. That is the most destructive thing in the product that is not
// called "delete" — it runs on a keyless gesture, it is one 4px slip away by
// accident, and the reader is looking at a 40-row outline rather than at the
// 1,200 lines it is rearranging. A single dropped paragraph would be invisible
// until the day it was needed.
//
// So the reorder is asserted as a PERMUTATION, against thousands of generated
// documents built out of exactly the shapes that break naive implementations:
// YAML frontmatter, code fences whose bodies contain `### ` lines, headings
// that skip levels, sections with no body, sections at the end of the file,
// CRLF, and no trailing newline.
//
//   npm run check-sections   ·   node scripts/check-sections.mjs

import {
  levelRange,
  moveSection,
  replaceSection,
  sectionMarkdown,
  sectionsOf,
  withoutSection,
} from "../client/sections.ts";

const ROUNDS = Number(process.env.ROUNDS ?? 4000);

// ── A deterministic RNG, so a failure can be replayed from its seed ─────────
let seed = Number(process.env.SEED ?? 20260816);
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

const WORDS = ["alpha", "beta", "gamma", "دلتا", "epsilon", "زيتا", "eta", "theta"];

function makeDoc() {
  const lines = [];
  if (chance(0.4)) {
    lines.push("---", `title: ${pick(WORDS)}`, "tags: [x, y]", "---", "");
  }
  if (chance(0.5)) lines.push(`preamble ${pick(WORDS)} line`, "");
  const n = 1 + Math.floor(rnd() * 9);
  for (let i = 0; i < n; i++) {
    const level = 1 + Math.floor(rnd() * 4);
    lines.push(`${"#".repeat(level)} ${pick(WORDS)} ${i}`);
    if (chance(0.85)) lines.push("");
    const body = Math.floor(rnd() * 4);
    for (let b = 0; b < body; b++) lines.push(`body ${i}.${b} ${pick(WORDS)}`);
    // A fence whose body LOOKS like structure. The scan must read these as
    // code: treated as headings they would cut a section in half and the
    // splice would carry away someone else's lines.
    if (chance(0.35)) {
      lines.push("```js", `// ### fake heading ${i}`, `### also not a heading ${i}`, "```");
    }
    // THE SHAPE THIS CORPUS WAS ONE LINE SHORT OF. Every fence above opens and
    // closes with the SAME marker, so a scan that just toggles on "```-or-~~~"
    // passes all four thousand documents. Documentation is written with NESTED
    // fences — a ```markdown block showing a ~~~ block — and there the toggle
    // closes on the inner marker and reads the `###` under it as structure.
    // The assertions never changed; only the corpus did, and it went from 0
    // failures to 3,535.
    if (chance(0.3)) {
      lines.push(
        "```markdown",
        `writing a nested fence ${i}:`,
        "~~~",
        `### also not a heading ${i}`,
        "~~~",
        "```",
      );
    }
    // Same trap by LENGTH rather than character: a four-backtick block whose
    // body holds a three-backtick one. A closer must be at least as long as
    // the run that opened it.
    if (chance(0.2)) {
      lines.push("````", "```js", `### also not a heading ${i}`, "```", "````");
    }
    if (chance(0.7)) lines.push("");
  }
  // LINE ENDINGS, INCLUDING MIXED ONES. A vault that has been through Windows,
  // a git checkout with autocrlf, or a copy-paste out of a browser holds notes
  // with BOTH endings in them, and "the document's flavour" is not a thing
  // such a note has. The generator used to emit pure-LF or pure-CRLF documents
  // only, which is exactly the corpus a whole-file `join(nl)` passes.
  const flavour = rnd();
  const ending = () => (flavour < 0.15 ? "\r\n" : flavour < 0.3 ? (chance(0.3) ? "\r\n" : "\n") : "\n");
  let doc = lines.map((l, i) => (i === lines.length - 1 ? l : l + ending())).join("");
  // No trailing newline — the WHOLE terminator, not just its `\n`. Stripping
  // one half of a CRLF left a lone `\r` at EOF, a shape no editor writes.
  if (chance(0.3)) doc = doc.replace(/(?:\r?\n)+$/, "");
  return doc;
}

// ── Invariants ─────────────────────────────────────────────────────────────

/** Every line that carries text, with heading depth erased — the reorder may
 *  change a moved subtree's `#` count and may add blank lines at the seams; it
 *  may not change a single character of anyone's prose. */
function contentBag(md) {
  const bag = new Map();
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/^\s{0,3}#{1,6}(\s)/, "$1");
    if (line.trim() === "") continue;
    bag.set(line, (bag.get(line) ?? 0) + 1);
  }
  return bag;
}

/** The document's line TERMINATORS, counted. A rewrite may ADD lines at the
 *  seams, so either count may grow; neither may ever shrink, because that can
 *  only mean an ending that was there was converted to the other flavour. A
 *  single outline drag used to convert every ending in a note that held one
 *  stray CRLF — no content lost, and the entire file in the next git diff. */
function endingCounts(md) {
  return {
    crlf: (md.match(/\r\n/g) ?? []).length,
    lf: (md.match(/(?<!\r)\n/g) ?? []).length,
  };
}

function endingsLost(before, after) {
  const a = endingCounts(before);
  const b = endingCounts(after);
  if (b.crlf < a.crlf) return `CRLF endings ${a.crlf} → ${b.crlf}`;
  if (b.lf < a.lf) return `LF endings ${a.lf} → ${b.lf}`;
  return null;
}

function bagDiff(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const x = a.get(k) ?? 0;
    const y = b.get(k) ?? 0;
    if (x !== y) return `line ${JSON.stringify(k)}: ${x} before, ${y} after`;
  }
  return null;
}

const failures = [];
function fail(what, doc, extra) {
  failures.push(
    `${what}\n  seed replay: SEED=${startSeed}\n  ${extra}\n--- document ---\n${doc}\n---`,
  );
}

const startSeed = seed;
let moves = 0;
let extractions = 0;

for (let round = 0; round < ROUNDS; round++) {
  const doc = makeDoc();
  const sections = sectionsOf(doc);
  if (sections.length === 0) continue;

  // Headings inside fences must never have become sections.
  for (const s of sections) {
    if (/fake heading|also not a heading/.test(s.text)) {
      fail("A fenced `###` line was read as a heading", doc, `section: ${s.text}`);
    }
  }

  // ── Reorder ──────────────────────────────────────────────────────────────
  const moving = pick(sections);
  const targets = [
    null,
    ...sections
      .filter((s) => s.headingLine <= moving.headingLine || s.headingLine >= moving.endLine)
      .map((s) => s.headingLine),
  ];
  const beforeLine = pick(targets);
  const { lo, hi } = levelRange(sections, beforeLine, moving);
  const level = lo + Math.floor(rnd() * (hi - lo + 1));
  const next = moveSection(doc, moving.headingLine, { beforeLine, level });
  if (next !== null) {
    moves++;
    const diff = bagDiff(contentBag(doc), contentBag(next));
    if (diff) fail("REORDER LOST OR DUPLICATED CONTENT", doc, `${diff}\n  moved: ${moving.text}`);
    const nlLost = endingsLost(doc, next);
    if (nlLost) fail("REORDER REWROTE LINE ENDINGS", doc, `${nlLost}\n  moved: ${moving.text}`);
    const after = sectionsOf(next);
    if (after.length !== sections.length) {
      fail(
        "REORDER CHANGED THE HEADING COUNT",
        doc,
        `${sections.length} before, ${after.length} after; moved ${moving.text}`,
      );
    }
    const titlesBefore = sections.map((s) => s.text).sort().join("|");
    const titlesAfter = after.map((s) => s.text).sort().join("|");
    if (titlesBefore !== titlesAfter) {
      fail("REORDER CHANGED WHICH HEADINGS EXIST", doc, `${titlesBefore}\n  → ${titlesAfter}`);
    }
    // The block travels WHOLE: every line it carried is still under it when it
    // lands. Not equality — a section shallower than what now follows it
    // legitimately ADOPTS those headings, which is the same rule that decided
    // its span in the first place, so containment is the honest assertion.
    const landed = after.find((s) => s.text === moving.text);
    if (landed) {
      const was = contentBag(sectionMarkdown(doc, moving));
      const is = contentBag(sectionMarkdown(next, landed));
      for (const [k, v] of was) {
        if ((is.get(k) ?? 0) < v) {
          fail(
            "THE MOVED SUBTREE ARRIVED INCOMPLETE",
            doc,
            `line ${JSON.stringify(k)}: ${v} carried, ${is.get(k) ?? 0} landed\n  moved: ${moving.text}`,
          );
          break;
        }
      }
      // Idempotence: putting a section back exactly where it is changes nothing.
      if (
        moveSection(next, landed.headingLine, {
          beforeLine: landed.headingLine,
          level: landed.level,
        }) !== null
      ) {
        fail("A ZERO-DISTANCE MOVE WAS NOT A NO-OP", next, `section: ${moving.text}`);
      }
    }
  }

  // Dropping a section inside itself must be refused, never applied.
  const inner = sectionsOf(doc).find(
    (s) => s.headingLine > moving.headingLine && s.headingLine < moving.endLine,
  );
  if (inner && moveSection(doc, moving.headingLine, { beforeLine: inner.headingLine, level: 1 }) !== null) {
    fail("A SECTION WAS DROPPED INSIDE ITSELF", doc, `${moving.text} → ${inner.text}`);
  }

  // ── Extraction ───────────────────────────────────────────────────────────
  const cut = pick(sections);
  const carried = sectionMarkdown(doc, cut);
  const left = replaceSection(doc, cut, [`[[Extracted]]`, ""]);
  extractions++;
  const whole = new Map(contentBag(left));
  for (const [k, v] of contentBag(carried)) whole.set(k, (whole.get(k) ?? 0) + v);
  whole.set("[[Extracted]]", (whole.get("[[Extracted]]") ?? 0) - 1);
  if (whole.get("[[Extracted]]") === 0) whole.delete("[[Extracted]]");
  const d = bagDiff(contentBag(doc), whole);
  if (d) fail("EXTRACTION LOST OR DUPLICATED CONTENT", doc, `${d}\n  section: ${cut.text}`);

  // A cut removes lines, so its ending COUNTS legitimately fall — but neither
  // half may grow an ending the document never had. A pure-CRLF note that
  // comes back with LF in it (or the reverse) has been rewritten end to end.
  const src = endingCounts(doc);
  for (const [what, text] of [["the remainder", left], ["the extracted note", carried]]) {
    const got = endingCounts(text);
    if (src.crlf === 0 && got.crlf > 0) {
      fail("EXTRACTION INTRODUCED CRLF", doc, `${what}: ${got.crlf} CRLF\n  section: ${cut.text}`);
    }
    if (src.lf === 0 && got.lf > 0) {
      fail("EXTRACTION INTRODUCED LF", doc, `${what}: ${got.lf} LF\n  section: ${cut.text}`);
    }
  }

  // withoutSection is the same cut without the link left behind.
  const removedBag = contentBag(withoutSection(doc, cut));
  for (const [k, v] of contentBag(carried)) removedBag.set(k, (removedBag.get(k) ?? 0) + v);
  const d2 = bagDiff(contentBag(doc), removedBag);
  if (d2) fail("withoutSection LOST OR DUPLICATED CONTENT", doc, `${d2}\n  section: ${cut.text}`);
}

console.log(
  `sections: ${ROUNDS} documents · ${moves} reorders · ${extractions} extractions (SEED=${startSeed})`,
);
if (failures.length) {
  console.log(`FAIL: ${failures.length}\n\n${failures.slice(0, 5).join("\n\n")}`);
  process.exit(1);
}
console.log("SECTIONS OK");
