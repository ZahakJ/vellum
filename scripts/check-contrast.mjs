// WCAG contrast gate for client/styles/tokens.css.
// Every theme (the :root default plus each [data-theme="…"] block) must hold:
//   --text        >= 4.5:1  against --bg and --bg-raised   (body text)
//   --text-muted  >= 3:1    against --bg and --bg-raised   (secondary text)
//   --accent      >= 4.5:1  against --bg                   (see below)
//   --text-faint  >= 3:1    against --bg and --bg-raised   (UI glyphs)
// Exits 1 on any failure.
//
// --text-faint used to print "(info)" against a minimum of 0 — a number the
// gate could never enforce, which is worse than not printing it: it reads
// like coverage. Under that cover parchment sat at 2.50:1 while the token
// went on collecting load-bearing work — the heading fold chevron, which
// CONTRACTS itself holds to the 3:1 non-text bar, plus attachment glyphs and
// the de-emphasized machine rows of the properties card. A gate prints a
// floor or it prints nothing. Both grounds are checked, because the sidebar
// and every panel are --bg-raised, and on the light themes that is the
// harder ground, not the easier one.
//
// 3:1 is the NON-TEXT bar, and it is the bar because --text-faint is not for
// text: anything a reader has to read — a filename, a count, a label naming
// a thing — belongs at --text-muted (>= 4.5:1 in every theme here) or above.
// See DESIGN.md, "Contrast".
//
// The accent check is not decoration. That one pair is read as TEXT twice over:
//   · wikilinks and tag pills render in --accent on --bg inside the prose, and
//   · the lit mode pill is an --accent fill carrying --bg letters — the same
//     two colors, swapped — which is the loudest thing in the product now that
//     "you are in reading mode" depends on it.
// It used to print as "(info)", and under that cover parchment (4.13:1),
// sandstone (4.17:1) and solar (4.24:1) all shipped below AA.
//
// The accent is also checked against --text, and that one is NOT a WCAG
// ratio: two colors of equal luminance and opposite hue pass every contrast
// formula ever written while being perfectly distinguishable, and a theme
// whose accent is a shade of its own type is the failure mode we are actually
// guarding against. `sumi` shipped --text #e4e4e6 beside --accent #f5efe3 —
// 1.11:1 and 8.5 ΔE — so the whole accent channel (tag pills, the `#` glyph,
// the active-row bar, wikilinks, the publish star, graph nodes) rendered as
// body text and the lit mode pill read as a text selection rather than an
// alarm. CIE76 ΔE over CIELAB answers the right question: the next-closest
// theme sits at 23.9, so the floor is 18.
//
//   node scripts/check-contrast.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tokensPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "client/styles/tokens.css",
);
const css = readFileSync(tokensPath, "utf8");

/** Pull `--var: #hex;` declarations out of one selector block's body. */
function parseBlock(body) {
  const vars = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*[;\n]/g)) {
    vars[m[1]] = m[2];
  }
  return vars;
}

const themes = {};
for (const m of css.matchAll(/(:root|\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g)) {
  const name = m[2] ?? "iron-gall (default)";
  themes[name] = parseBlock(m[3]);
}

function lum(hex) {
  const c = hex.slice(1);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB hex → CIELAB (D65). Used only for the accent-vs-text delta below. */
function lab(hex) {
  const c = hex.slice(1);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, z] = [f(x), f(z)];
  const fy = f(y);
  return [116 * fy - 16, 500 * (x - fy), 200 * (fy - z)];
}

/** CIE76 colour difference — perceptual distance, not a contrast ratio. */
function deltaE(a, b) {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const ACCENT_TEXT_MIN_DE = 18;

let failures = 0;
for (const [name, t] of Object.entries(themes)) {
  const need = ["--bg", "--bg-raised", "--text", "--text-muted", "--accent", "--text-faint"];
  const missing = need.filter((k) => !t[k]);
  if (missing.length > 0) {
    console.error(`${name}: missing ${missing.join(", ")}`);
    failures++;
    continue;
  }
  const checks = [
    ["text / bg", t["--text"], t["--bg"], 4.5],
    ["text / raised", t["--text"], t["--bg-raised"], 4.5],
    ["muted / bg", t["--text-muted"], t["--bg"], 3],
    ["muted / raised", t["--text-muted"], t["--bg-raised"], 3],
    ["accent / bg", t["--accent"], t["--bg"], 4.5],
    ["faint / bg", t["--text-faint"], t["--bg"], 3],
    ["faint / raised", t["--text-faint"], t["--bg-raised"], 3],
  ];
  console.log(`\n${name}`);
  // Not a ratio: see the header. An accent that is a shade of the theme's own
  // body text has no accent channel at all.
  const dE = deltaE(t["--accent"], t["--text"]);
  const dEok = dE >= ACCENT_TEXT_MIN_DE;
  if (!dEok) failures++;
  console.log(
    `  ${"accent / text".padEnd(15)} ${dE.toFixed(1).padStart(5)} ΔE  ${
      dEok ? "PASS" : `FAIL (needs ${ACCENT_TEXT_MIN_DE} ΔE)`
    }`,
  );
  for (const [label, fg, bg, min] of checks) {
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(
      `  ${label.padEnd(15)} ${r.toFixed(2).padStart(5)}:1  ${
        min === 0 ? "(info)" : ok ? "PASS" : `FAIL (needs ${min}:1)`
      }`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} contrast check(s) failed.`);
  process.exit(1);
}
console.log("\nAll themes pass.");
