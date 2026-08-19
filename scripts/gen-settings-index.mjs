// Regenerate client/components/settings/settingsIndex.ts from the panel source.
//
//   node scripts/gen-settings-index.mjs
//
// Run it after adding, moving or renaming a settings row. `npm run
// check-settings` fails the build when the checked-in file and the source
// disagree, so this is the only way the two stay in step — and the failure
// message names this command.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { settingsRows } from "./settings-index.mjs";

const out = fileURLToPath(new URL("../client/components/settings/settingsIndex.ts", import.meta.url));
const rows = settingsRows();

const body = rows
  .map(
    (r) =>
      `  { tab: "${r.tab}", label: "${r.label}"` +
      (r.hint ? `, hint: "${r.hint}"` : "") +
      (r.env ? `, env: "${r.env}"` : "") +
      " },",
  )
  .join("\n");

writeFileSync(
  out,
  `// THE SETTINGS INDEX — what a search across the panel matches against.
//
// GENERATED from the panel's own source by \`node scripts/gen-settings-index.mjs\`,
// and held there by \`npm run check-settings\`. It is generated rather than
// hand-kept for the obvious reason: eighty-eight rows spread over two files
// will drift from any list a human maintains, and a search that silently stops
// finding a row is worse than no search — the reader concludes the setting does
// not exist.
//
// It carries KEYS, not words. The search resolves them through \`t()\` at the
// moment it runs, so an Arabic instance searches Arabic labels and an English
// one searches English, from one index.

import type { I18nKey } from "../../i18n.ts";

export interface SettingEntry {
  /** The tab this row lives on — \`TABS[].id\` in SettingsModal.tsx. */
  tab: string;
  /** The row's label key. Also how a result finds its row in the DOM: \`Row\`
   *  stamps the RESOLVED label as \`data-setting\`, and the result resolves the
   *  same key to look it up. */
  label: I18nKey;
  hint?: I18nKey;
  /** The environment variable behind the row's ⓘ, when it has one. Searching
   *  \`SITE_LANG\` and landing on the row is the operator's half of this. */
  env?: string;
}

export const SETTINGS_INDEX: SettingEntry[] = [
${body}
];
`,
);
console.log(`settings index: ${rows.length} rows`);
