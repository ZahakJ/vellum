// A memoized `/api/tree`.
//
// `buildTree()` is a full recursive `readdir` of the vault. On the 1,388-note
// / 1,158-image fixture that is ~29 ms and ~171 kB of JSON per call, and the
// client asks for it on EVERY vault event — so a burst of 60 file changes cost
// 122 walks. On a 10k-note vault the same walk is measured in hundreds of
// milliseconds, and it is single-threaded with every other request.
//
// The tree is a pure function of the vault's directory listing, so it is
// cacheable — the only hard part is invalidation, and this file is deliberately
// paranoid about it. Two independent triggers clear the cache, and either one
// alone would be enough for the common case:
//
//   1. **Vault events.** `onEvent` fires for creates, deletes, renames and
//      directory changes — from the chokidar watcher (external edits, an
//      Obsidian client, git) and from the synthetic events routes emit for
//      their own writes. `changed` is ignored: editing a note's CONTENT
//      cannot change the tree's shape.
//   2. **Any write request.** `invalidate()` is also called before every
//      non-GET `/api/*` handler runs. The watcher is debounced 100 ms, so a
//      client that creates a note and immediately refetches the tree could
//      otherwise be answered from a cache the watcher has not yet dirtied —
//      a stale tree missing the note the user just made. This trigger closes
//      that window without depending on event timing at all.
//
// The serialized JSON is cached alongside the object because that is the
// expensive half at this size — and its COMPRESSED forms alongside that (see
// `EncodedBody` in server/compress.ts), because once the JSON is memoized,
// re-compressing the same 171 kB on every request is what is left costing
// milliseconds. All three are invalidated together, so they cannot disagree.

import type { TreeNode } from "../shared/types.ts";
import { encodedBody, type EncodedBody } from "./compress.ts";
import { buildTree, onEvent } from "./vault.ts";

interface Cached {
  tree: TreeNode;
  body: EncodedBody;
}

let cached: Cached | null = null;
let inflight: Promise<Cached> | null = null;
let hits = 0;
let misses = 0;

/** Drop the memo. Cheap and idempotent — call it whenever in doubt. */
export function invalidateTree(): void {
  cached = null;
  // An in-flight walk started BEFORE this call may already be reading a stale
  // directory state, so it must not be allowed to populate the cache. Letting
  // go of the promise makes the next caller start a fresh walk.
  inflight = null;
}

let wired = false;

/** Subscribe to vault events once (idempotent, so tests may call it freely). */
function wire(): void {
  if (wired) return;
  wired = true;
  onEvent((event) => {
    if (event.kind !== "changed") invalidateTree();
  });
}

/** The vault tree as JSON, memoized until something could have changed it.
 *
 *  Concurrent callers share one walk: on a big vault the client, a second tab
 *  and a crawler can easily ask at the same moment, and three simultaneous
 *  full-vault walks is how a server stops answering anything else. */
export async function treeBody(): Promise<EncodedBody> {
  wire();
  if (cached) {
    hits++;
    return cached.body;
  }
  if (inflight) return (await inflight).body;
  misses++;
  const started = (inflight = (async () => {
    const tree = await buildTree();
    return { tree, body: encodedBody(JSON.stringify(tree)) };
  })());
  const result = await started;
  // Only publish the result if nothing invalidated us while we walked
  // (`invalidate()` clears `inflight`, so this identity check is the test).
  if (inflight === started) {
    cached = result;
    inflight = null;
  }
  return result.body;
}

/** Diagnostics for the perf harness. */
export function treeCacheStats(): { hits: number; misses: number; warm: boolean } {
  return { hits, misses, warm: cached !== null };
}
