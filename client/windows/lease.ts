// Who may type into a note, when more than one window has it open.
//
// THE PROBLEM IT SOLVES, stated plainly: two windows on one vault is the
// two-writer case, and `PUT /api/note` was unconditional last-write-wins until
// this round. The write precondition (server/vault.ts) is the net underneath —
// it refuses a stale write rather than losing it — but a net you land in every
// few minutes is not a feature. The lease is the thing that stops both windows
// typing into one file in the first place.
//
// NO COORDINATOR, NOTHING ON DISK. Every window announces when it opened and
// which notes it holds; both sides then compute the SAME answer from the same
// rule (`winsAgainst`: oldest wins, ties to the smaller id). There is no
// server to ask, no lock file to leak, and a window that dies simply stops
// answering — its claims age out with its heartbeat rather than stranding a
// note nobody may edit.
//
// The loser is not locked out. It becomes a live READER of the note with one
// button — "Edit here" — which takes the lease back. That is the whole
// interaction: Obsidian's answer to the same situation is to write
// `note (conflicted copy).md` and tell you nothing.

import { windowBornAt, windowId, winsAgainst } from "./identity.ts";
import { onBus, postBus } from "./bus.ts";

interface Claim {
  id: string;
  at: number;
}

/** path → the peer claiming it. Our own claims are not in here; we know them. */
const peerClaims = new Map<string, Claim>();
/** Paths this window holds a buffer for. */
const mine = new Set<string>();

type Change = (path: string) => void;
let onChange: Change = () => {};
export function setLeaseListener(fn: Change): void {
  onChange = fn;
}

/** True when THIS window may write `path`.
 *
 *  Computed, never stored — so it cannot go stale, and so both windows reach
 *  the same conclusion from the same facts without either being told. */
export function holdsLease(path: string): boolean {
  const peer = peerClaims.get(path);
  if (peer === undefined) return true;
  return winsAgainst({ at: windowBornAt, id: windowId }, peer);
}

/** The peer typing into `path`, or null. Named so a tab can say WHICH window. */
export function peerOn(path: string): string | null {
  const peer = peerClaims.get(path);
  if (peer === undefined) return null;
  return holdsLease(path) ? null : peer.id;
}

export function claim(path: string): void {
  if (mine.has(path)) return;
  mine.add(path);
  postBus({ t: "claim", id: windowId, at: windowBornAt, path });
  onChange(path);
}

export function unclaim(path: string): void {
  if (!mine.delete(path)) return;
  postBus({ t: "release", id: windowId, path });
  onChange(path);
}

/** Take the note back — the "Edit here" button. The other window hears the
 *  claim and demotes itself; ours wins because a takeover is explicit and
 *  therefore outranks the age rule that produced the demotion.
 *
 *  Implemented by moving OUR clock back rather than by a "force" flag on the
 *  wire: the rule stays "oldest wins", one comparison, computed identically on
 *  both sides — and a flag would need its own tie-break the first time two
 *  readers pressed the button at once. */
export function takeOver(path: string): void {
  const peer = peerClaims.get(path);
  if (peer !== undefined) {
    peerClaims.delete(path);
    // Announce with a timestamp older than theirs, so their own comparison
    // reaches the same answer ours just did.
    postBus({ t: "claim", id: windowId, at: peer.at - 1, path });
  }
  mine.add(path);
  onChange(path);
}

export function installLease(): () => void {
  const off = onBus((msg) => {
    if (msg.t === "claim") {
      peerClaims.set(msg.path, { id: msg.id, at: msg.at });
      onChange(msg.path);
    } else if (msg.t === "release") {
      const held = peerClaims.get(msg.path);
      if (held?.id === msg.id) {
        peerClaims.delete(msg.path);
        onChange(msg.path);
      }
    } else if (msg.t === "bye") {
      for (const [path, held] of [...peerClaims]) {
        if (held.id !== msg.id) continue;
        peerClaims.delete(path);
        onChange(path);
      }
    } else if (msg.t === "hello") {
      // A new window is asking who is here. Re-announce every note we hold, or
      // it would believe every one of them was free.
      for (const path of mine) {
        postBus({ t: "claim", id: windowId, at: windowBornAt, path });
      }
    }
  });
  postBus({ t: "hello", id: windowId, at: windowBornAt });
  const bye = (): void => postBus({ t: "bye", id: windowId });
  window.addEventListener("pagehide", bye);
  return () => {
    bye();
    off();
    window.removeEventListener("pagehide", bye);
  };
}
