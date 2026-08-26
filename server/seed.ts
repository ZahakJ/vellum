// The starter vault — `vault-seed/` — and the one rule about when it may be
// written.
//
// THE RULE: a directory that did not exist gets seeded at boot, silently,
// because there was nothing there to intrude on. A directory that DOES exist
// is the reader's, whatever is or is not inside it, and Vellum asks before
// putting five files in it. Booting used to seed any vault dir holding no
// markdown, which caught exactly the cases the reader would have minded most:
// an empty `~/Notes` they had just made, a private vault cloned but not yet
// pulled, an external disk whose mount had not come up. "Empty" and "new" are
// not the same fact, and only one of them is an invitation.
//
// This module is where both halves ask, so they cannot drift: `server/index.ts`
// seeds at boot when the directory was absent, and `POST /api/seed` (the
// client's empty state offering "Start with the guide") seeds on a click.

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isNotePath } from "../shared/noteFormat.ts";
import { SEED_GUIDE } from "../shared/seed.ts";
import { isIgnoredSegment } from "./vault.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

/** Where the shipped starter notes live. */
export function seedDir(): string {
  return path.join(projectRoot, "vault-seed");
}

/** The guide the seed ships, if it ships one — what the client opens after
 *  seeding, and the note `settings.homeNote` falls back to on a first run.
 *  Declared in `shared/seed.ts` because the client's first-run open (F1) reads
 *  the same name and a second copy of it would eventually name another file. */
export { SEED_GUIDE };

/** Any markdown at all under `dir`? Early-exit walk that skips ignored
 *  directories (.obsidian/.git/.trash), because a big real vault must not be
 *  fully enumerated to answer a yes/no question. */
export function hasMarkdown(dir: string): boolean {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (isIgnoredSegment(entry.name)) continue;
      if (entry.isFile() && isNotePath(entry.name)) return true;
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
  return false;
}

/** Boot: create the vault directory, seeding it only when it was ABSENT. */
export function seedIfNew(vaultDir: string): void {
  if (existsSync(vaultDir)) return;
  const seed = seedDir();
  if (existsSync(seed)) cpSync(seed, vaultDir, { recursive: true });
  else mkdirSync(vaultDir, { recursive: true });
}

/** May the empty state offer the guide? Only with a seed to copy and nothing
 *  of the reader's to copy it over. */
export function seedAvailable(vaultDir: string): boolean {
  return existsSync(seedDir()) && !hasMarkdown(vaultDir);
}

/** Copy the seed in. Refuses on a vault that already holds markdown — the
 *  route is admin-only, but "asked for" is not "safe to do twice", and this is
 *  the check that keeps a double-click from writing over a vault that filled
 *  up between the offer and the answer. Returns the guide's path when the seed
 *  ships one, so the caller can open it. */
export function seedVault(vaultDir: string): string | null {
  if (!seedAvailable(vaultDir)) return null;
  cpSync(seedDir(), vaultDir, { recursive: true });
  return existsSync(path.join(vaultDir, SEED_GUIDE)) ? SEED_GUIDE : null;
}
