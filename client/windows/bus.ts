// The channel between windows of one vault.
//
// SSE already carries facts about the VAULT — a file changed, a note was
// deleted — and it does that well, from the one process that knows. What it
// cannot carry is INTENT: which window is typing into a note, that a reader
// just changed the theme, that a window is closing. Those never touch the
// disk, so a server round trip is the wrong shape for them and the watcher
// would not see them anyway.
//
// So: two channels, one division. The bus carries intent between windows; SSE
// carries facts about the vault. Anything that can be derived from a file is
// SSE's, and nothing here is allowed to become a second way of learning it.
//
// THE ENVELOPE IS VERSIONED, and that is not ceremony. Two windows can be
// running different builds — one tab open since this morning, one opened after
// a deploy — and a message shape that changed underneath them would be parsed
// as something it is not. A mismatched version is DROPPED, and the receiving
// window degrades to "there are other windows and I cannot talk to them",
// which is a state it already has to handle.

import { windowId } from "./identity.ts";

const CHANNEL = "vellum";
const VERSION = 1;

export type BusMessage =
  /** I exist, and I have been open since `at`. Answered by every peer with
   *  their own `hello`, which is how a new window learns the room. */
  | { t: "hello"; id: string; at: number }
  /** I am going away. Best-effort — a killed tab sends nothing, which is why
   *  the lease also ages out. */
  | { t: "bye"; id: string }
  /** I am the writer for this note. */
  | { t: "claim"; id: string; at: number; path: string }
  /** I am no longer writing this note (its buffer closed, or I was demoted). */
  | { t: "release"; id: string; path: string }
  /** I saved this note; its mtime is now this. Lets a peer holding the same
   *  note re-base its own precondition without a round trip. */
  | { t: "wrote"; id: string; path: string; mtimeMs: number }
  /** A device preference changed and every window should follow. */
  | { t: "prefs"; id: string; theme?: string; language?: string }
  /** Somebody signed out, or a session expired. Every window is now a
   *  visitor and must stop pretending otherwise. */
  | { t: "auth"; id: string; admin: boolean };

interface Envelope {
  v: number;
  msg: BusMessage;
}

type Listener = (msg: BusMessage) => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
/** "none" means no BroadcastChannel in this browser: one window works exactly
 *  as it always did, and multi-window degrades to honest silence rather than
 *  to a half-working coordination nobody can see. */
export type BusMode = "live" | "none";
export let busMode: BusMode = "none";

export function openBus(): () => void {
  if (typeof BroadcastChannel !== "function") {
    busMode = "none";
    return () => {};
  }
  channel = new BroadcastChannel(CHANNEL);
  busMode = "live";
  channel.onmessage = (e: MessageEvent<unknown>) => {
    const env = e.data as Partial<Envelope> | null;
    if (env === null || typeof env !== "object") return;
    if (env.v !== VERSION || env.msg === undefined) return; // a different build
    const msg = env.msg as BusMessage;
    // Never hear yourself. BroadcastChannel does not echo to the sender, but a
    // fallback might, and a window that reacted to its own claim would demote
    // itself.
    if (msg.id === windowId) return;
    for (const fn of listeners) fn(msg);
  };
  return () => {
    channel?.close();
    channel = null;
    busMode = "none";
  };
}

export function postBus(msg: BusMessage): void {
  channel?.postMessage({ v: VERSION, msg } satisfies Envelope);
}

export function onBus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
