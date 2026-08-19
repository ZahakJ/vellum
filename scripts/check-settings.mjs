// The settings index still describes the settings panel.
//
//   node scripts/check-settings.mjs
//
// A search that silently stops finding a row is worse than no search: the
// reader searches "arabic", finds nothing, and concludes the instance cannot do
// it. The index is generated from the panel's source, so the only way it goes
// wrong is by not being regenerated — which is exactly what this catches.
//
// It also closes a hole in check-i18n that has been open the whole time. That
// gate's usage scan counts any quoted dict-key token OUTSIDE i18n.ts, including
// one sitting in a comment — so a key whose last real call site was deleted can
// stay "used" forever because its name survives in a note about it. Every key
// in the index here is one this file has just seen in a `label={t("…")}` or
// `hint={t("…")}` position in real JSX, so a settings key that has stopped
// being rendered shows up as a REMOVED row rather than as nothing at all.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { settingsRows } from "./settings-index.mjs";

const file = fileURLToPath(new URL("../client/components/settings/settingsIndex.ts", import.meta.url));
const checked = readFileSync(file, "utf8");

const parsed = [...checked.matchAll(/\{ tab: "([a-z]+)", label: "([A-Za-z0-9_]+)"(?:, hint: "([A-Za-z0-9_]+)")?(?:, env: "([A-Z0-9_]+)")? \}/g)]
  .map((m) => ({ tab: m[1], label: m[2], hint: m[3] ?? null, env: m[4] ?? null }));

const fromSource = settingsRows();
const key = (r) => `${r.tab}/${r.label}/${r.hint ?? ""}/${r.env ?? ""}`;

const inFile = new Set(parsed.map(key));
const inSource = new Set(fromSource.map(key));
const errs = [];

for (const r of fromSource) {
  if (!inFile.has(key(r))) errs.push(`  ADDED or CHANGED in the panel, missing from the index: ${r.tab} / ${r.label}`);
}
for (const r of parsed) {
  if (!inSource.has(key(r))) errs.push(`  REMOVED or CHANGED in the panel, still in the index: ${r.tab} / ${r.label}`);
}
// The panel is the thing being described, so an empty parse is a broken parser
// rather than an empty panel — and would otherwise pass silently.
if (fromSource.length < 40) errs.push(`  only ${fromSource.length} rows parsed out of the panel — the parser is broken, not the panel`);

if (errs.length > 0) {
  console.error(`check-settings: the index and the panel disagree\n${errs.join("\n")}\n\n  run: node scripts/gen-settings-index.mjs`);
  process.exit(1);
}
console.log(`check-settings: ${fromSource.length} rows · ${fromSource.filter((r) => r.env).length} with an env var · index matches the panel`);
console.log("SETTINGS OK");
