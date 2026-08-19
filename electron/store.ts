// Where the desktop app's preferences live, and how they get written.
//
// One JSON document in `app.getPath("userData")`. It holds the recent vaults,
// the port each one owns and the last window geometry for each — nothing that
// belongs to a vault, and nothing a reader would miss if they deleted it except
// the port (see the long note in electron/prefs.ts about what losing THAT
// costs).
//
// Written atomically. It is rewritten on every window move, every resize and
// every vault open, which means it is being written at exactly the moments a
// laptop lid closes; a half-written preferences file is a first launch with no
// recent vaults and — worse — no remembered ports.

import { app } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EMPTY_PREFS, parsePrefs, seedFor, type Prefs } from "./prefs.ts";

let cache: Prefs | null = null;
let pending: NodeJS.Timeout | null = null;

function prefsPath(): string {
  return path.join(app.getPath("userData"), "desktop.json");
}

export function loadPrefs(): Prefs {
  if (cache) return cache;
  try {
    cache = parsePrefs(JSON.parse(readFileSync(prefsPath(), "utf8")));
  } catch {
    // Missing (first launch) or unreadable (a truncated write, a hand edit).
    // Both mean "we know nothing", and neither is worth a dialog.
    cache = { ...EMPTY_PREFS };
  }
  return cache;
}

/** Replace the whole document. Writes are coalesced — a window drag emits
 *  `move` continuously — and flushed on quit by `flushPrefs()`. */
export function savePrefs(next: Prefs): void {
  cache = next;
  if (pending) clearTimeout(pending);
  pending = setTimeout(flushPrefs, 400);
  pending.unref();
}

export function flushPrefs(): void {
  if (pending) clearTimeout(pending);
  pending = null;
  if (!cache) return;
  const target = prefsPath();
  const tmp = `${target}.tmp`;
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    // Same shape server/vault.ts uses for a note: write beside, then rename.
    // `rename` is the only step that is atomic, so it is the only step that
    // touches the real path.
    writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, target);
  } catch (err) {
    console.error("vellum: could not write desktop preferences:", err);
  }
}

/**
 * `VELLUM_DATA` for a vault — the session epoch, the marginalia database, the
 * design store, the font cache.
 *
 * NOT inside the vault. The server's default is `./data`, and a `.vellum/`
 * beside the notes would be the obvious desktop answer — except that
 * `isIgnoredSegment` (server/vault.ts) hides exactly three names, `.obsidian`,
 * `.git` and `.trash`, and `.vellum` is not one of them. It would appear in the
 * reader's own tree, in their own vault, in every sidebar, and it would travel
 * into their Dropbox and their git history. So it lives under the app's data
 * directory, keyed by the vault path.
 *
 * The key carries the vault's own name so the folder is legible to a human
 * looking for it, and the hash so two vaults called "notes" are two folders.
 */
export function dataDirFor(vault: string): string {
  const stamp = seedFor(path.resolve(vault)).toString(16).padStart(8, "0");
  const name = path.basename(path.resolve(vault)).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 40);
  return path.join(app.getPath("userData"), "vaults", `${name || "vault"}-${stamp}`, "data");
}

/** The Electron session partition for a vault.
 *
 *  One per vault, and not for isolation's sake: COOKIES IGNORE PORTS. Two
 *  vaults are two origins to `localStorage` (which keys on the port) and ONE
 *  origin to the cookie jar (which does not) — so a single shared jar means
 *  opening the second vault overwrites the first vault's session cookie with
 *  a token its server will reject, and the first window silently stops being
 *  admin. A partition per vault is the cheapest way for that never to be a
 *  question anyone has to think about again. */
export function partitionFor(vault: string): string {
  return `persist:vault-${seedFor(path.resolve(vault)).toString(16).padStart(8, "0")}`;
}
