// WCAG contrast gate for client/styles/tokens.css.
// Every theme (the :root default plus each [data-theme="…"] block) must hold:
//   --text        >= 4.5:1  against --bg, --bg-raised and --bg-hover  (body text)
//   --text-muted  >= 3:1    against --bg, --bg-raised and --bg-hover  (secondary text)
//   --accent      >= 4.5:1  against --bg                              (see below)
//   --text-faint  >= 3:1    against --bg and --bg-raised              (UI glyphs)
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
// WHY 3:1 AND NOT SOME OTHER NUMBER. WCAG offers three candidate answers for
// a token this faint, and only one of them is defensible here:
//   · 1.4.3 Contrast (Minimum) exempts "incidental" content — pure decoration,
//     inactive controls, invisible text — from any ratio at all. That is the
//     exemption the old floor of 0 was silently claiming, and it is false:
//     the heading fold chevron is an ACTIVE control, and the attachment glyph
//     and properties rows are content, not decoration. An exemption is not a
//     floor, and printing "(info)" under it read like coverage.
//   · 1.4.3 also sets 4.5:1 for body text and 3:1 for large text (>= 18.66px
//     bold / 24px). Nothing this token paints is large text, so 3:1 cannot be
//     claimed on the large-text clause — which is exactly why the token must
//     never carry a filename or a count.
//   · 1.4.11 Non-text Contrast sets 3:1 for the visual boundaries of user
//     interface components and for graphical objects required to understand
//     the content. That is what --text-faint actually paints — glyphs, a
//     disclosure chevron, machine bookkeeping nobody reads word by word — so
//     3:1 is the applicable normative minimum, not a compromise between 0 and
//     4.5. The floor and the token's job are the same statement.
// The bar therefore constrains the token's USE as much as its value: anything
// a reader has to read — a filename, a count, a label naming a thing —
// belongs at --text-muted (>= 4.5:1 in every theme here) or above.
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
  // --bg-hover is a THIRD ground, not a shade. Every hovered row, every
  // highlighted menu row and every tag pill in the product is painted with it,
  // so a token that clears its floor on --bg and --bg-raised and fails on
  // --bg-hover is failing the floor without failing the check — one substrate
  // over from where this script was looking. The selection menu shipped
  // exactly that: keycaps and group titles at --text-faint on a --bg-hover
  // active row measured 2.74:1 on iron-gall, 2.89 on sumi and tallow, 2.98 on
  // parchment. --text-faint is NOT checked here, and that is the point: it is
  // a two-ground token by construction (DESIGN.md), so a surface that paints
  // --bg-hover may not put --text-faint on it — it uses --text-muted, which
  // this gate now proves holds there in all fifteen.
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
    ...(t["--bg-hover"]
      ? [
          ["text / hover", t["--text"], t["--bg-hover"], 4.5],
          ["muted / hover", t["--text-muted"], t["--bg-hover"], 3],
        ]
      : []),
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

// ── The text-colour palettes (shared/textColors.ts) ────────────────────────
// A colour a reader puts INSIDE a note is the one token in the product that
// outlives the theme it was chosen under, so it has to be solved against every
// ground at once — and there are two lists because that problem has two
// answers, one of which is provably impossible in one form:
//
//   · SEMANTIC (`--vc-*`, client/styles/textcolor.css): one value per THEME
//     GROUP, held to 4.5:1 — AA body text — against every ground in its group.
//     This is the default tier and the reason it is the default.
//   · LITERAL (nine hexes): one value for all fifteen themes, held to 3:1,
//     WCAG 1.4.11's non-text floor. It cannot be held to 4.5: against `void`'s
//     #050508 a colour needs relative luminance >= 0.186 and against `solar`'s
//     #ffffff it needs <= 0.183, and no colour satisfies both. The gate prints
//     that as the reason rather than leaving the lower floor looking like
//     sloppiness.
//
// Both lists are DATA, imported from the same module the client uses, so a
// swatch cannot be added in the UI without being answerable here.

const { SEMANTIC_COLORS, LITERAL_COLORS } = await import("../shared/textColors.ts");

const LIGHT_THEMES = ["parchment", "sandstone", "linen", "solar"];
const isLight = (name) => LIGHT_THEMES.some((id) => name.startsWith(id));

/** Every ground a note's prose can sit on, per theme. `--bg-raised` counts:
 *  colored text shows up inside hover preview cards and callouts too. */
const grounds = [];
for (const [name, t] of Object.entries(themes)) {
  if (!t["--bg"]) continue;
  grounds.push([`${name} / bg`, t["--bg"], isLight(name)]);
  if (t["--bg-raised"]) grounds.push([`${name} / raised`, t["--bg-raised"], isLight(name)]);
}

console.log("\ntext colours — semantic (var(--vc-*), per theme group, AA)");
for (const c of SEMANTIC_COLORS) {
  for (const [group, hex, light] of [
    ["dark", c.swatchDark, false],
    ["light", c.swatchLight, true],
  ]) {
    let worst = Infinity;
    let where = "";
    for (const [label, bg, bgLight] of grounds) {
      if (bgLight !== light) continue;
      const r = ratio(hex, bg);
      if (r < worst) {
        worst = r;
        where = label;
      }
    }
    const ok = worst >= 4.5;
    if (!ok) failures++;
    console.log(
      `  ${`--vc-${c.id} (${group})`.padEnd(24)} ${worst.toFixed(2).padStart(5)}:1  ${
        ok ? "PASS" : "FAIL (needs 4.5:1)"
      }  worst on ${where}`,
    );
  }
}

console.log("\ntext colours — literal (one ink, every ground, non-text 3:1)");
for (const c of LITERAL_COLORS) {
  let worst = Infinity;
  let where = "";
  for (const [label, bg] of grounds) {
    const r = ratio(c.value, bg);
    if (r < worst) {
      worst = r;
      where = label;
    }
  }
  const ok = worst >= 3;
  if (!ok) failures++;
  console.log(
    `  ${`${c.id} ${c.value}`.padEnd(24)} ${worst.toFixed(2).padStart(5)}:1  ${
      ok ? "PASS" : "FAIL (needs 3:1)"
    }  worst on ${where}`,
  );
}

// The `--vc-*` values in the stylesheet must BE the ones the module publishes:
// they are written twice by necessity (CSS cannot import) and a drift would
// mean the gate is measuring one palette while the product paints another.
const tcss = readFileSync(new URL("../client/styles/textcolor.css", import.meta.url), "utf8");
const tblocks = [...tcss.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
for (const c of SEMANTIC_COLORS) {
  for (const [i, want] of [c.swatchDark, c.swatchLight].entries()) {
    const got = tblocks[i] && new RegExp(`--vc-${c.id}:\\s*(#[0-9a-fA-F]{6})`).exec(tblocks[i]);
    if (!got || got[1].toLowerCase() !== want.toLowerCase()) {
      console.error(
        `  textcolor.css block ${i === 0 ? "dark" : "light"}: --vc-${c.id} is ${
          got ? got[1] : "missing"
        }, shared/textColors.ts says ${want}`,
      );
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} contrast check(s) failed.`);
  process.exit(1);
}
console.log("\nAll themes pass.");
