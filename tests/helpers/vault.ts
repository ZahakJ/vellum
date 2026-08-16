// Test fixtures: a throwaway vault on disk.
//
// The suite is over PURE LOGIC, but three of the modules under test (vault,
// indexer, settings) read the filesystem by design, so they get a real
// directory built from a literal map. Vaults are tiny (a dozen files), so the
// whole suite still runs in seconds.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Create a temp directory tree from `{ "rel/path.md": "contents" }`.
 *  Returns its absolute root. Directories are created as needed. */
export function makeVault(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "vellum-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

/** Remove a temp tree built by makeVault (never throws). */
export function removeVault(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** An empty temp directory (VELLUM_DATA, symlink targets, …). */
export function makeDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "vellum-test-"));
}

/** A note with frontmatter, written the way Obsidian writes it. */
export function note(frontmatter: Record<string, string>, body: string): string {
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

// ------------------------------------------------------------------- random

/** Deterministic PRNG (mulberry32) — property tests must reproduce exactly
 *  from their seed, so a failure is debuggable from the test name alone. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one element of `items` with the generator `next`. */
export function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length) % items.length];
}
