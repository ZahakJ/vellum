// A memoized `/api/graph`, plus the single-note slice of it.
//
// `graph()` walks every note and every wikilink in the vault on every call:
// 11.8 ms and 534 kB of JSON on the 1,388-note fixture, growing linearly.
// Two things made that a problem rather than a cost:
//
//   1. The client asked for the WHOLE graph in order to draw a ten-node
//      neighborhood in the backlinks panel — on every app open, for every
//      admin. That is 534 kB (≈4 MB on a 10k-note vault) parsed by the
//      browser to render about 3 kB of it.
//   2. Nothing memoized it, so identical calls a millisecond apart each paid
//      the full walk.
//
// `around` fixes (1): the caller names a note and gets that note, its direct
// wikilink neighbors (both directions) and the edges between them — the exact
// shape `LocalGraph` derives client-side, computed where the data already is.
// The memo fixes (2), and is invalidated exactly like the tree memo (see
// server/treeCache.ts for the full contract: vault events plus any write).
//
// The visitor and admin graphs are memoized SEPARATELY and never share an
// entry: they are different answers to the same question, and serving one for
// the other would leak unpublished (or language-filtered) notes to a visitor.
// That is also why `around` slices the already-filtered graph rather than the
// raw note map — a neighborhood may never contain a note the full graph would
// have hidden.

import type { GraphData } from "../shared/types.ts";
import { encodedBody, type EncodedBody } from "./compress.ts";
import { graph, whenIndexed } from "./indexer.ts";
import { onEvent } from "./vault.ts";

interface Memo {
  data: GraphData;
  /** The full graph's JSON plus its encodings, filled in on demand. */
  body: EncodedBody;
  /** Adjacency, built lazily on the first `around` query for this revision. */
  adjacency: Map<string, Set<string>> | null;
}

const memo = new Map<"admin" | "visitor", Memo>();
let wired = false;

/** Drop both memos. Cheap and idempotent. */
export function invalidateGraph(): void {
  memo.clear();
}

function wire(): void {
  if (wired) return;
  wired = true;
  onEvent(() => {
    // Unlike the tree, a `changed` event DOES matter here: editing a note's
    // body rewrites its wikilinks, which is exactly what the graph is made of.
    invalidateGraph();
    // …and dropping the memo NOW is not enough. The graph is derived from the
    // INDEX, and the index applies this event asynchronously (indexer.ts
    // chains it onto `whenIndexed`). A request arriving in that window would
    // rebuild from the pre-event index and memoize the stale answer, which —
    // unlike a one-off stale response — would then persist until the next
    // vault change. So drop it a second time once the index has caught up.
    // The microtask makes this independent of listener registration order:
    // by then every synchronous listener for this event (the indexer's
    // included) has chained its work onto `settled`.
    queueMicrotask(() => {
      void whenIndexed().then(invalidateGraph);
    });
  });
}

function current(publishedOnly: boolean): Memo {
  wire();
  const key = publishedOnly ? "visitor" : "admin";
  const hit = memo.get(key);
  if (hit) return hit;
  const data = graph(publishedOnly);
  const fresh: Memo = { data, body: encodedBody(JSON.stringify(data)), adjacency: null };
  memo.set(key, fresh);
  return fresh;
}

/** The full graph, ready to send (JSON + memoized encodings). */
export function graphBody(publishedOnly: boolean): EncodedBody {
  return current(publishedOnly).body;
}

function adjacencyOf(m: Memo): Map<string, Set<string>> {
  if (m.adjacency) return m.adjacency;
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string): void => {
    let set = adj.get(a);
    if (!set) adj.set(a, (set = new Set()));
    set.add(b);
  };
  for (const edge of m.data.edges) {
    add(edge.source, edge.target);
    add(edge.target, edge.source);
  }
  m.adjacency = adj;
  return adj;
}

/**
 * The neighborhood of one note: the note, its direct neighbors in either
 * direction, and every edge among that set.
 *
 * A path that is not in the (already filtered) graph yields an EMPTY graph
 * rather than an error — for a visitor that is the whole point, since "this
 * note has no neighborhood" and "this note is not yours to see" must be the
 * same answer.
 */
export function localGraphJson(notePath: string, publishedOnly: boolean): string {
  const m = current(publishedOnly);
  const adj = adjacencyOf(m);
  const neighbors = adj.get(notePath);
  const keep = new Set<string>([notePath]);
  if (neighbors) for (const id of neighbors) keep.add(id);

  const nodes = m.data.nodes.filter((n) => keep.has(n.id));
  // The centre itself may be absent (unknown path, or filtered away) — then
  // there is nothing to draw and no edges to report either.
  if (!nodes.some((n) => n.id === notePath)) return JSON.stringify({ nodes: [], edges: [] });
  const edges = m.data.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return JSON.stringify({ nodes, edges } satisfies GraphData);
}
