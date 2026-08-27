// The cross-process sync lock (server/processLock.ts), and gitSync's use of it.
//
// The gap this closes is a deployment, not a hypothesis: the desktop app and a
// systemd service over ONE vault are two processes with two `busy` flags and
// one `.git`, so both could enter `git add -A` / `commit` at the same moment
// and collide on `.git/index.lock`. The properties that make the lockfile a
// real answer — and every one of them is a way it could go wrong instead:
//
//   * a held lock refuses a second acquisition (that is the whole product);
//   * a lock whose holder is DEAD is broken, or a crash wedges backup forever;
//   * a lock nobody has touched for the ceiling is broken too — the only
//     recovery available when the holder is on another machine, or when the
//     file is unreadable because the holder died mid-write;
//   * a lock whose holder is ALIVE and fresh is never broken, because breaking
//     it recreates exactly the collision this exists to prevent;
//   * a pid is only consulted on the machine that wrote it;
//   * release deletes OUR lock and never a successor's;
//   * a pass that throws still releases — a lock leaked by a failure would
//     make every later sync wait out the full 15-minute ceiling.

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { snapshotNow } from "../server/gitSync.ts";
import { acquireLock, inspectLock, readHolder, STALE_MS } from "../server/processLock.ts";
import { initSite } from "../server/site.ts";
import { initVault, VaultError } from "../server/vault.ts";
import { makeDir, makeVault, removeVault } from "./helpers/vault.ts";

const dir = makeDir();

/** Every acquisition in this file is heartbeat-free: the tests move mtimes by
 *  hand, and a background timer refreshing them would make the age cases race
 *  their own fixture. The heartbeat itself is proven in its own case below. */
const quiet: { heartbeatMs: number; onWarn: (m: string) => void } = {
  heartbeatMs: 0,
  onWarn: () => {},
};

/** A fresh lock path per case — one shared file would let a leaked lock from
 *  one test decide the next one's outcome. */
let n = 0;
function lockPath(): string {
  n += 1;
  return path.join(dir, `case-${n}`, "vellum-sync.lock");
}

/** Options that also collect the warnings, so "it was broken" can be asserted
 *  as a fact and not inferred from the outcome. */
function collecting(warnings: string[]): { heartbeatMs: number; onWarn: (m: string) => void } {
  return { heartbeatMs: 0, onWarn: (m) => warnings.push(m) };
}

/** A pid that is certainly gone: spawnSync waits for the child and reaps it,
 *  so by the time this returns the number addresses nothing. */
function deadPid(): number {
  const done = spawnSync(process.execPath, ["-e", ""]);
  assert.ok(typeof done.pid === "number" && done.pid > 0);
  return done.pid as number;
}

/** Write a lock file by hand — the only way to stand in for another process. */
function plant(file: string, holder: Record<string, unknown> | string): void {
  const body = typeof holder === "string" ? holder : `${JSON.stringify(holder)}\n`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function ageBy(file: string, ms: number): void {
  const when = new Date(Date.now() - ms);
  utimesSync(file, when, when);
}

after(() => removeVault(dir));

describe("the sync lock — taking and releasing", () => {
  it("creates the file, records this process, and hands back a handle", () => {
    const file = lockPath();
    const result = acquireLock(file, quiet);
    assert.equal(result.held, true);
    assert.ok(result.held && result.lock);
    if (!result.held) return;
    assert.ok(existsSync(file));
    const holder = readHolder(file);
    assert.equal(holder?.pid, process.pid);
    assert.equal(holder?.host, hostname());
    assert.equal(holder?.token, result.lock.holder.token);
    assert.ok(!Number.isNaN(Date.parse(holder?.at ?? "")));
    result.lock.release();
  });

  it("makes the directory it needs — a vault that is not a repository yet has no .git", () => {
    const file = path.join(dir, "no-git-here", ".git", "vellum-sync.lock");
    const result = acquireLock(file, quiet);
    assert.equal(result.held, true);
    if (result.held) result.lock.release();
  });

  it("removes the file on release, and releasing twice is not an error", () => {
    const file = lockPath();
    const result = acquireLock(file, quiet);
    assert.ok(result.held);
    if (!result.held) return;
    result.lock.release();
    assert.equal(existsSync(file), false);
    result.lock.release(); // idempotent
    assert.equal(existsSync(file), false);
    // ...and the lock is immediately available again.
    const next = acquireLock(file, quiet);
    assert.ok(next.held);
    if (next.held) next.lock.release();
  });

  it("reports a free path as free", () => {
    assert.equal(inspectLock(lockPath()), null);
  });
});

describe("the sync lock — contention", () => {
  it("refuses a second acquisition and names the holder", () => {
    const file = lockPath();
    const first = acquireLock(file, quiet);
    assert.ok(first.held);
    if (!first.held) return;

    const second = acquireLock(file, quiet);
    assert.equal(second.held, false);
    if (second.held) return;
    assert.equal(second.holder?.pid, process.pid);
    assert.equal(second.holder?.token, first.lock.holder.token);

    // The refusal changed nothing: the first holder still holds it.
    assert.equal(readHolder(file)?.token, first.lock.holder.token);
    first.lock.release();
  });

  it("does not break a lock held by a LIVE process on this machine", () => {
    const file = lockPath();
    // A real, live, foreign pid — the desktop app, as far as this process can
    // tell. Anything less than a live pid would prove nothing here.
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      detached: true,
      stdio: "ignore",
    });
    other.unref();
    try {
      plant(file, { pid: other.pid, host: hostname(), at: new Date().toISOString(), token: "theirs" });
      const warnings: string[] = [];
      const result = acquireLock(file, collecting(warnings));
      assert.equal(result.held, false);
      if (!result.held) assert.equal(result.holder?.pid, other.pid);
      assert.deepEqual(warnings, []);
      assert.equal(readHolder(file)?.token, "theirs");
    } finally {
      try {
        process.kill(other.pid as number);
      } catch {
        /* already gone */
      }
    }
  });
});

describe("the sync lock — staleness recovery", () => {
  it("breaks a lock whose holder is dead, and says so", () => {
    const file = lockPath();
    const gone = deadPid();
    plant(file, { pid: gone, host: hostname(), at: new Date().toISOString(), token: "corpse" });

    const warnings: string[] = [];
    const result = acquireLock(file, collecting(warnings));
    assert.equal(result.held, true);
    if (!result.held) return;
    assert.equal(readHolder(file)?.pid, process.pid);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /stale sync lock/);
    assert.match(warnings[0], /dead-pid/);
    assert.match(warnings[0], new RegExp(`pid ${gone}`));
    result.lock.release();
  });

  it("breaks a lock nobody has touched for longer than the ceiling", () => {
    const file = lockPath();
    const held = acquireLock(file, quiet);
    assert.ok(held.held);
    if (!held.held) return;
    // Held by THIS process — a live pid — so age is the only test that can
    // free it, which is exactly the wedged-holder case.
    ageBy(file, STALE_MS + 60_000);
    assert.equal(inspectLock(file, quiet)?.stale, true);
    assert.equal(inspectLock(file, quiet)?.reason, "age");

    const warnings: string[] = [];
    const taken = acquireLock(file, collecting(warnings));
    assert.equal(taken.held, true);
    if (!taken.held) return;
    assert.notEqual(taken.lock.holder.token, held.lock.holder.token);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /age/);
    taken.lock.release();
  });

  it("does not consult a pid written by another machine — only age can free it", () => {
    const file = lockPath();
    const gone = deadPid(); // dead HERE, meaningless THERE
    plant(file, { pid: gone, host: `${hostname()}-elsewhere`, at: new Date().toISOString(), token: "remote" });

    const fresh = acquireLock(file, quiet);
    assert.equal(fresh.held, false, "a dead pid on another host is not evidence of anything");
    assert.equal(readHolder(file)?.token, "remote");

    ageBy(file, STALE_MS + 1000);
    const aged = acquireLock(file, quiet);
    assert.equal(aged.held, true);
    if (aged.held) aged.lock.release();
  });

  it("treats an unreadable lock as a lock, until it ages out", () => {
    const file = lockPath();
    plant(file, "{ half a json objec"); // a holder that died between create and write
    assert.equal(readHolder(file), null);

    const fresh = acquireLock(file, quiet);
    assert.equal(fresh.held, false);
    if (!fresh.held) assert.equal(fresh.holder, null);

    ageBy(file, STALE_MS + 1000);
    assert.equal(inspectLock(file, quiet)?.reason, "unreadable");
    const warnings: string[] = [];
    const aged = acquireLock(file, collecting(warnings));
    assert.equal(aged.held, true);
    assert.match(warnings[0] ?? "", /unreadable lock file/);
    if (aged.held) aged.lock.release();
  });

  it("a broken-out holder does not delete its successor's lock", () => {
    const file = lockPath();
    const first = acquireLock(file, quiet);
    assert.ok(first.held);
    if (!first.held) return;
    ageBy(file, STALE_MS + 1000);
    const second = acquireLock(file, quiet);
    assert.ok(second.held);
    if (!second.held) return;

    // The loser finally-releases, believing it still holds the vault.
    first.lock.release();
    assert.ok(existsSync(file), "the successor is mid-pass: its lock must survive");
    assert.equal(readHolder(file)?.token, second.lock.holder.token);

    second.lock.release();
    assert.equal(existsSync(file), false);
  });

  it("keeps its own mtime fresh while it is held", async () => {
    const file = lockPath();
    const result = acquireLock(file, { heartbeatMs: 20, onWarn: () => {} });
    assert.ok(result.held);
    if (!result.held) return;
    try {
      ageBy(file, STALE_MS * 2); // pretend the clock ran away
      const stalled = statSync(file).mtimeMs;
      await new Promise((r) => setTimeout(r, 250));
      assert.ok(
        statSync(file).mtimeMs > stalled,
        "a long but healthy pass must not be mistaken for a crashed one",
      );
      assert.equal(inspectLock(file, quiet)?.stale, false);
    } finally {
      result.lock.release();
    }
  });
});

describe("the sync lock — a pass that fails still releases", () => {
  it("releases in `finally` when the body throws", async () => {
    const file = lockPath();
    const pass = async (): Promise<void> => {
      const claim = acquireLock(file, quiet);
      assert.ok(claim.held);
      if (!claim.held) return;
      try {
        await Promise.resolve();
        throw new Error("git exploded");
      } finally {
        claim.lock.release();
      }
    };
    await assert.rejects(pass(), /git exploded/);
    assert.equal(existsSync(file), false, "a failed pass must not leave the vault locked");
    const next = acquireLock(file, quiet);
    assert.equal(next.held, true);
    if (next.held) next.lock.release();
  });
});

// ---------------------------------------------------------------- the wiring
//
// The unit cases above prove the lock. These prove that the mutating git paths
// actually TAKE it — the part a refactor could quietly drop.

const data = makeDir();
const vault = makeVault({ "Home.md": "# Home\n" });
const lockFile = path.join(vault, ".git", "vellum-sync.lock");

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: vault,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
}

before(() => {
  initSite({ VELLUM_DATA: data });
  initVault(vault);
  git(["init", "-q", "-b", "main", "."]);
  git(["add", "-A"]);
  git(["commit", "-qm", "first"]);
});

after(() => {
  removeVault(vault);
  removeVault(data);
});

describe("gitSync takes the vault lock", () => {
  it("refuses a snapshot while another process holds the lock", async () => {
    const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      detached: true,
      stdio: "ignore",
    });
    other.unref();
    plant(lockFile, { pid: other.pid, host: hostname(), at: new Date().toISOString(), token: "other-vellum" });
    try {
      await assert.rejects(
        snapshotNow(),
        (err: unknown) =>
          err instanceof VaultError &&
          err.status === 409 &&
          /Another Vellum is syncing this vault/.test(err.message) &&
          err.message.includes(String(other.pid)),
      );
      // Refused, and it left the other process's lock exactly as it found it.
      assert.equal(readHolder(lockFile)?.token, "other-vellum");
    } finally {
      try {
        process.kill(other.pid as number);
      } catch {
        /* already gone */
      }
    }
  });

  it("breaks a dead holder's lock and syncs, leaving no lock behind", async () => {
    plant(lockFile, { pid: deadPid(), host: hostname(), at: new Date().toISOString(), token: "crashed" });
    writeFileSync(path.join(vault, "Home.md"), "# Home\n\nan edit\n");
    const made = await snapshotNow();
    assert.equal(made.committed, true);
    assert.ok(made.sha);
    assert.equal(existsSync(lockFile), false, "the pass must release what it took");
    assert.match(git(["log", "-1", "--pretty=%s"]), /^vellum snapshot: /);
  });

  it("releases the lock even when the pass fails", async () => {
    const plain = makeVault({ "Home.md": "# Home\n" }); // no repository at all
    initVault(plain);
    try {
      await assert.rejects(snapshotNow(), /not a git repository/);
      assert.equal(existsSync(path.join(plain, ".git", "vellum-sync.lock")), false);
    } finally {
      initVault(vault);
      removeVault(plain);
    }
  });
});
