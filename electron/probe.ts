// THE FOUR WAYS THE PACKAGED APP DIES AT BOOT, ASKED BEFORE IT BOOTS.
//
//   ELECTRON_RUN_AS_NODE=1 electron electron/probe.ts
//
// The desktop app does not bundle a server. It spawns `server/index.ts` as a
// child of the Electron binary running in pure-Node mode
// (`ELECTRON_RUN_AS_NODE=1`), which means the runtime that has to satisfy the
// repo's `engines: node >= 24` is ELECTRON'S bundled Node, not the reader's —
// and the reader may have no Node at all. Four things have to be true of it,
// every one of them is a property of the Electron build rather than of any code
// in this repo, and every one of them fails the same way: the app launches, a
// window opens, the server child exits before it prints a port, and the reader
// sees a blank window with no text on it anywhere.
//
//   1. Node ≥ 24. `server/index.ts` is run DIRECTLY, so type stripping has to
//      be on by default, and `initIndexer()` is awaited at the top level.
//   2. `node:sqlite`. Marginalia (server/comments.ts) opens a `DatabaseSync`.
//      It is opt-in, so the failure would surface the first time a reader
//      turned comments on — weeks after shipping.
//   3. `argon2` LOADS. It is a native addon, so it is compiled against an ABI,
//      and Electron's is not stock Node's. A build that forgot to rebuild it
//      has a perfectly valid-looking `node_modules/argon2` that throws
//      ERR_DLOPEN_FAILED the moment auth starts — which on the desktop is
//      every launch, because the desktop mints a credential (electron/auth.ts).
//   4. A real `server/*.ts` type-strips AND resolves its bare imports. Checks
//      1–3 can all pass in a build whose `node_modules` did not get packaged;
//      this one imports an actual server module that imports an actual
//      dependency, which is the whole boot path in miniature.
//
// Electron-free on purpose — it runs where `require("electron")` does not
// exist. It prints one line per check and exits non-zero on the first failure,
// so its output is something a reader can paste into a bug report.

const results: string[] = [];

function ok(label: string, detail: string): void {
  results.push(`  ok    ${label.padEnd(34)} ${detail}`);
}

function die(label: string, detail: string, fix: string): never {
  console.log(results.join("\n"));
  console.error(`  FAIL  ${label.padEnd(34)} ${detail}\n\n  ${fix}\n`);
  process.exit(1);
}

/** The floor the repo's own `engines` field states. Read from package.json
 *  rather than typed here, so the probe cannot drift below the thing it is
 *  asserting. */
async function requiredMajor(): Promise<number> {
  const { readFileSync } = await import("node:fs");
  const url = new URL("../package.json", import.meta.url);
  try {
    const pkg = JSON.parse(readFileSync(url, "utf8")) as { engines?: { node?: string } };
    const match = /(\d+)/.exec(pkg.engines?.node ?? "");
    if (match) return Number(match[1]);
  } catch {
    /* fall through to the constant below */
  }
  return 24;
}

async function main(): Promise<void> {
  // ── 1. the bundled Node ────────────────────────────────────────────────────
  const need = await requiredMajor();
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < need) {
    die(
      "bundled Node",
      `${process.versions.node} — this repo needs ${need} or newer`,
      `Raise the "electron" version in desktop/package.json until its bundled Node is ${need}+.\n` +
        `  server/index.ts is run directly (no build step): below ${need} it does not even parse.`,
    );
  }
  ok("bundled Node", `v${process.versions.node} (electron ${process.versions.electron ?? "—"})`);

  // ── 2. node:sqlite ────────────────────────────────────────────────────────
  try {
    const sqlite = (await import("node:sqlite")) as { DatabaseSync?: unknown };
    if (typeof sqlite.DatabaseSync !== "function") throw new Error("no DatabaseSync export");
    ok("node:sqlite", "DatabaseSync present");
  } catch (err) {
    die(
      "node:sqlite",
      String(err),
      "server/comments.ts opens a DatabaseSync. Marginalia is opt-in, so without this check the\n" +
        "  failure waits until a reader turns comments on.",
    );
  }

  // ── 3. argon2, the native one ─────────────────────────────────────────────
  try {
    const argon2 = (await import("argon2")) as { hash?: unknown };
    if (typeof argon2.hash !== "function") throw new Error("no hash export");
    ok("argon2", "native addon loaded");
  } catch (err) {
    die(
      "argon2",
      String(err),
      "A native addon compiled for stock Node will not load into Electron's ABI. electron-builder\n" +
        "  rebuilds `dependencies` automatically; it does NOT rebuild devDependencies, and it does not\n" +
        "  rebuild anything it was not told about — see desktop/package.json.",
    );
  }

  // ── 4. a real server module, type-stripped, with its bare import ──────────
  try {
    const mod = (await import("../server/publish.ts")) as { readFrontmatter?: unknown };
    if (typeof mod.readFrontmatter !== "function") throw new Error("no readFrontmatter export");
    ok("type stripping", "server/publish.ts imported (and gray-matter with it)");
  } catch (err) {
    die(
      "type stripping",
      String(err),
      "Either this Node cannot strip types, or node_modules did not make it into the package.\n" +
        "  Both look identical from the outside: the server child exits before printing a port and the\n" +
        "  window stays blank.",
    );
  }

  console.log(results.join("\n"));
  console.log("\nPROBE OK");
}

void main();
