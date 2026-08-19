// Run electron/probe.ts under Electron's bundled Node, from any shell.
//
//   npm --prefix desktop run probe
//
// `ELECTRON_RUN_AS_NODE=1 electron …` is the whole of it, and it is here as a
// script rather than inline in package.json because `VAR=value cmd` is not a
// thing on Windows. The app runs this same probe itself at launch
// (electron/main.ts); this is the door for running it by hand, which is what a
// bug report needs.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electron = require("electron");
const probe = fileURLToPath(new URL("../electron/probe.ts", import.meta.url));

const result = spawnSync(electron, [probe], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
process.exit(result.status ?? 1);
