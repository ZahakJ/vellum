// A cross-process advisory lock: one exclusive lockfile, taken with O_EXCL.
//
// WHY THIS EXISTS. Backup & sync guarded every mutating pass with a
// module-level `busy` boolean. That flag is per-PROCESS, and the shape it does
// not cover is a real deployment, not a hypothetical: the owner runs the
// desktop app AND a systemd `vellum` service over the SAME vault directory.
// Two Vellums, one `.git`. `busy` is true in each of them independently, so
// both walk into `git add -A` / `git commit` / `git merge` at once and fight
// over `.git/index.lock` — git's own lock, which is not a queue: the loser
// dies with "Another git process seems to be running in this repository", and
// the pass that lost may already have staged half a vault. Today that was
// worked around by configuring sync MANUAL-ONLY, which is a backup that only
// runs when somebody remembers it. With a lock underneath, an unattended
// interval is safe again.
//
// Node has no `flock` in core, and there is no portable one. The portable
// idiom — the one git, npm and every mail spool on the planet use — is an
// exclusive CREATE: `open(path, O_CREAT|O_EXCL)` either creates the file or
// fails, atomically, in one syscall, decided by the kernel. That is the whole
// mutual exclusion. Everything else in this file is recovery.
//
// FAILURE MODES, each considered:
//
//   Two processes racing the create. Safe BY DEFINITION — O_EXCL is atomic, so
//   exactly one open() returns a descriptor and the other gets EEXIST. There
//   is no window to lose; this is the property being bought.
//
//   The holder dies without releasing (SIGKILL, power cut, a crash). A lock
//   file is not a file descriptor: nothing in the kernel cleans it up, so a
//   crash would wedge sync FOREVER — the worst possible outcome for a backup.
//   Hence two independent staleness tests, either of which frees it:
//     · DEAD PID. The holder records its pid; `kill(pid, 0)` asks the kernel
//       whether that process still exists. Only meaningful on the machine that
//       took the lock, so the holder records its hostname too and the pid test
//       is skipped when it does not match ours.
//     · AGE. The lock's mtime older than `staleMs` (15 minutes by default,
//       against a sync pass whose two network calls time out at 180s each).
//       This is the ONLY test that can free a lock taken by another host, and
//       the only one that can free a half-written lock file (a crash between
//       the create and the write leaves valid-but-unparseable contents; the
//       age test still reaches it).
//   A live holder refreshes its own mtime on a heartbeat, so a genuinely slow
//   pass — a first push of a 2GB vault over a hotel connection — is never
//   mistaken for a corpse.
//
//   Breaking a stale lock races another breaker. Both unlink (the second gets
//   ENOENT, ignored), both re-create with O_EXCL, and exactly one wins. Safe.
//
//   Breaking a lock the holder re-took in the same instant. A read-then-unlink
//   is a TOCTOU: there is no atomic "delete only if it still says X" on POSIX.
//   The window is the microseconds between our stat and our unlink, and to be
//   inside it a process must have taken the lock in the same instant we judged
//   the PREVIOUS holder 15 minutes dead. It is bounded, not eliminated: the
//   holder that gets broken discovers it at release (the token no longer
//   matches, so it does not delete a lock that is now somebody else's) and the
//   worst case is the one thing a lock was buying — two passes overlapping —
//   for one pass, logged.
//
//   NFS. `O_EXCL` over NFSv2 was famously not atomic; NFSv3+ implements it
//   through an EXCLUSIVE create and modern Linux clients are correct. We do
//   NOT solve this — a vault on a network filesystem shared by two machines is
//   outside what this buys, and the age test is the only recovery there. Noted
//   so the next reader does not assume it was handled.
//
// The lock is ADVISORY: it only stops processes that ask. Somebody's own
// `git commit` in a terminal is unaffected — that has always been true and is
// git's `index.lock` to arbitrate, not ours.

import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, utimesSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** How long a lock may go untouched before any process may break it. Generous
 *  on purpose: breaking a lock that is merely SLOW re-creates the collision
 *  this file exists to prevent, so the ceiling sits far above the longest
 *  legitimate pass (two 180s network timeouts plus local work). A live holder
 *  keeps its mtime fresh anyway, so this ceiling is only ever reached by a
 *  process that is gone. */
export const STALE_MS = 15 * 60_000;

/** How often a held lock touches its own mtime. Well under STALE_MS, unref'd,
 *  and it stops at release. */
const HEARTBEAT_MS = 60_000;

/** What a lock file says. Written once, at create; only the mtime moves after
 *  that. */
export interface LockHolder {
  /** Process id of the holder — checkable with `kill(pid, 0)`, but only on
   *  `host`. */
  pid: number;
  /** The holder's hostname, so a pid is never tested against the wrong
   *  machine's process table. */
  host: string;
  /** ISO timestamp of acquisition, for the log line and for humans reading a
   *  stuck lock by hand. */
  at: string;
  /** Random per-acquisition. Release deletes the file ONLY when this still
   *  matches, so a holder that was broken as stale can never delete the lock
   *  its successor is holding. */
  token: string;
}

/** A held lock. `release()` is idempotent and must run in a `finally`. */
export interface LockHandle {
  file: string;
  holder: LockHolder;
  release(): void;
}

export type LockResult =
  /** The lock is ours until `release()`. */
  | { held: true; lock: LockHandle }
  /** Somebody else holds it. `holder` is null when the file is unreadable or
   *  unparseable — contested either way. */
  | { held: false; holder: LockHolder | null };

export interface LockOptions {
  /** Override the staleness ceiling (tests, mostly). */
  staleMs?: number;
  /** 0 disables the mtime heartbeat — what tests want, so nothing keeps a
   *  timer alive and mtimes stay exactly where they were put. */
  heartbeatMs?: number;
  /** Where the "I broke a stale lock" warning goes. It is a WARNING and not a
   *  silence because breaking a lock is the one moment this file relaxes the
   *  guarantee it sells; an operator should be able to find that in a log. */
  onWarn?: (message: string) => void;
}

/** Why a lock may be broken, for the log line. */
export type StaleReason = "dead-pid" | "age" | "unreadable";

export interface LockState {
  holder: LockHolder | null;
  mtimeMs: number;
  ageMs: number;
  stale: boolean;
  reason: StaleReason | null;
}

/** Does this process id still exist ON THIS MACHINE? Signal 0 performs the
 *  permission and existence checks and delivers nothing. EPERM means the
 *  process is there and owned by somebody else — alive. ESRCH means gone. */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Parse a lock file's contents. Anything that is not the shape we write is
 *  `null` — a lock we cannot read is still a lock, it just has to age out
 *  rather than be pid-tested. */
function parseHolder(text: string): LockHolder | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) return null;
  if (typeof o.host !== "string" || typeof o.at !== "string" || typeof o.token !== "string") return null;
  return { pid: o.pid, host: o.host, at: o.at, token: o.token };
}

/** Who holds this lock right now, or null when there is no lock file (or it
 *  cannot be read). */
export function readHolder(file: string): LockHolder | null {
  try {
    return parseHolder(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Look at a lock without touching it: who holds it, how old it is, and
 *  whether it may be broken. `null` when there is no lock file at all — i.e.
 *  the lock is free.
 *
 *  Callers that only need "is somebody else working right now?" (the sync
 *  timer, the status panel) use this rather than acquiring: a probe must never
 *  create a lock it is not going to hold. */
export function inspectLock(file: string, opts: LockOptions = {}): LockState | null {
  const staleMs = opts.staleMs ?? STALE_MS;
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null; // no lock file: free
  }
  const holder = readHolder(file);
  const ageMs = Math.max(0, Date.now() - mtimeMs);
  // AGE FIRST, and it applies to every lock including one whose holder is
  // demonstrably alive: a process that is alive but wedged (a `git push`
  // hanging on a dead TCP connection past every timeout) must not hold the
  // vault's backup hostage forever either.
  if (ageMs > staleMs) {
    return { holder, mtimeMs, ageMs, stale: true, reason: holder === null ? "unreadable" : "age" };
  }
  // A pid is only a fact on the machine that wrote it. On any other host the
  // number addresses a stranger's process table, so it is not consulted at all
  // and only the age test above can free the lock.
  if (holder !== null && holder.host === hostname() && !pidAlive(holder.pid)) {
    return { holder, mtimeMs, ageMs, stale: true, reason: "dead-pid" };
  }
  return { holder, mtimeMs, ageMs, stale: false, reason: null };
}

/** The atomic step. Returns a handle, or null when the file already exists. */
function create(file: string, opts: LockOptions): LockHandle | null {
  const holder: LockHolder = {
    pid: process.pid,
    host: hostname(),
    at: new Date().toISOString(),
    token: randomUUID(),
  };
  let fd: number;
  try {
    // "wx" is O_CREAT|O_EXCL|O_WRONLY. THIS is the mutual exclusion; every
    // other line in this file is bookkeeping around it.
    fd = openSync(file, "wx", 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw err; // ENOSPC, EACCES, EROFS: a real problem, and not ours to swallow
  }
  try {
    writeSync(fd, `${JSON.stringify(holder)}\n`);
  } finally {
    closeSync(fd);
  }
  return handleFor(file, holder, opts);
}

function handleFor(file: string, holder: LockHolder, opts: LockOptions): LockHandle {
  const beat = opts.heartbeatMs ?? HEARTBEAT_MS;
  let timer: NodeJS.Timeout | null = null;
  let released = false;

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  if (beat > 0) {
    timer = setInterval(() => {
      // Keep the mtime fresh so a legitimately long pass is never mistaken for
      // a crashed one. If the file is gone, or has become somebody else's, the
      // heartbeat stops rather than resurrecting a lock or touching a
      // stranger's.
      if (readHolder(file)?.token !== holder.token) {
        stop();
        return;
      }
      try {
        const now = new Date();
        utimesSync(file, now, now);
      } catch {
        stop();
      }
    }, beat);
    // A backup lock must never be the reason the process refuses to exit.
    timer.unref?.();
  }

  return {
    file,
    holder,
    release(): void {
      if (released) return;
      released = true;
      stop();
      // Delete only OUR lock. If this handle was broken as stale while it ran,
      // the file now belongs to whoever took it next and deleting it would
      // hand the vault to a third process mid-pass.
      const current = readHolder(file);
      if (current !== null && current.token !== holder.token) {
        (opts.onWarn ?? console.warn)(
          `vellum: this process's sync lock at ${file} was taken over by pid ${current.pid} (${current.host}) while it ran — leaving it alone`,
        );
        return;
      }
      try {
        unlinkSync(file);
      } catch {
        /* already gone: nothing to release */
      }
    },
  };
}

/** Take the lock, or report who has it.
 *
 *  NEVER BLOCKS and never retries in a loop: the callers are "sync now" and a
 *  once-a-minute timer, and the honest answer to "somebody else is syncing" is
 *  to say so and do nothing, not to queue a second pass behind a first that is
 *  about to commit the same working tree. */
export function acquireLock(file: string, opts: LockOptions = {}): LockResult {
  mkdirSync(path.dirname(file), { recursive: true });

  const first = create(file, opts);
  if (first !== null) return { held: true, lock: first };

  const state = inspectLock(file, opts);
  // Vanished between our EEXIST and our stat — the holder released in that
  // sliver. One more honest attempt, then give up rather than spin.
  if (state === null) {
    const again = create(file, opts);
    return again !== null ? { held: true, lock: again } : { held: false, holder: readHolder(file) };
  }
  if (!state.stale) return { held: false, holder: state.holder };

  const who =
    state.holder === null
      ? "an unreadable lock file"
      : `pid ${state.holder.pid} on ${state.holder.host}, taken ${state.holder.at}`;
  (opts.onWarn ?? console.warn)(
    `vellum: breaking a stale sync lock at ${file} — ${who}, ${state.reason} (idle ${Math.round(state.ageMs / 1000)}s). ` +
      "A previous sync process almost certainly died without releasing it.",
  );
  try {
    unlinkSync(file);
  } catch {
    /* a concurrent breaker got there first; the create below decides */
  }
  const second = create(file, opts);
  if (second !== null) return { held: true, lock: second };
  // Another process broke the same stale lock and won the re-create. That is
  // the system working: exactly one of us is now syncing.
  return { held: false, holder: readHolder(file) };
}
