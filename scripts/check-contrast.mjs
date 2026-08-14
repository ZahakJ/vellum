// WCAG contrast gate for client/styles/tokens.css.
// Every theme (the :root default plus each [data-theme="…"] block) must hold:
//   --text        >= 4.5:1  against --bg and --bg-raised   (body text)
//   --text-muted  >= 3:1    against --bg and --bg-raised   (secondary text)
// Accent and faint ratios are printed for information. Exits 1 on any failure.
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
    ["accent / bg", t["--accent"], t["--bg"], 0],
    ["faint / bg", t["--text-faint"], t["--bg"], 0],
  ];
  console.log(`\n${name}`);
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
