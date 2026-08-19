// Derive the settings index from the panel's own source.
//
// Shared by `scripts/check-settings.mjs` (which asserts the checked-in index
// still matches) and by the generator that writes it. It is a SOURCE parse, not
// an import: the panel is React with store closures in it, and a gate that
// needs a browser is a gate nobody runs — the same reason check-i18n reads the
// DICT block as text.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

/** `{ tab === "identity" && (` … opens a tab's block; the next one closes it. */
function tabRanges(src) {
  const lines = src.split("\n");
  const marks = [];
  lines.forEach((line, i) => {
    const m = /\{tab === "([a-z]+)" &&/.exec(line);
    if (m) marks.push({ tab: m[1], from: i });
  });
  return marks.map((m, i) => ({
    ...m,
    to: i + 1 < marks.length ? marks[i + 1].from : lines.length,
  }));
}

function rowsIn(lines, from, to, tab) {
  const out = [];
  let pending = null;
  for (let i = from; i < to; i++) {
    const line = lines[i];
    const label = /label=\{t\("([A-Za-z0-9_]+)"\)\}/.exec(line);
    if (label) {
      // A row's own label and the CONTROL inside it usually carry the same key
      // — `<Row label={t("rowVimKeys")}><Toggle label={t("rowVimKeys")} …>` —
      // because the control needs an accessible name and the row already has
      // the right words. Two matches, one row: a repeat of the key we are
      // already collecting is that control, not a new row.
      if (label[1] !== pending?.label) {
        if (pending) out.push(pending);
        pending = { tab, label: label[1], hint: null, env: null };
      }
    }
    if (!pending) continue;
    const hint = /hint=\{t\("([A-Za-z0-9_]+)"\)\}/.exec(line);
    if (hint && pending.hint === null) pending.hint = hint[1];
    const env = /name:\s*"([A-Z0-9_]+)"/.exec(line);
    if (env && pending.env === null) pending.env = env[1];
  }
  if (pending) out.push(pending);
  return out;
}

/** Every row the panel renders, in the order a reader meets it. */
export function settingsRows() {
  const modal = read("client/components/SettingsModal.tsx");
  const lines = modal.split("\n");
  const rows = [];
  // The device tab is a component of its own; everything else is a block.
  const device = read("client/components/settings/DeviceTab.tsx").split("\n");
  rows.push(...rowsIn(device, 0, device.length, "device"));
  for (const { tab, from, to } of tabRanges(modal)) {
    if (tab === "device") continue; // rendered by DeviceTab above
    rows.push(...rowsIn(lines, from, to, tab));
  }
  return rows;
}
