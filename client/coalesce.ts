// Trailing-edge coalescer for "refresh everything" work driven by a firehose.
//
// The vault's SSE stream is one event per changed file. That is the right
// granularity for the things that MUST be per-event (retarget a renamed tab,
// close a deleted one) and exactly the wrong granularity for the whole-vault
// refetches that follow — `/api/tree`, `/api/backlinks`, `/api/tags`,
// `/api/graph`. Measured on the 1,388-note fixture with the app open, sixty
// files touched at once (a git pull, an Obsidian sync, a bulk rename):
//
//     122 × /api/tree    10.8 MB
//      61 × /api/graph   33.0 MB
//      61 × /api/backlinks, 61 × /api/tags, 61 × /api/me
//
// …44 MB and 366 requests to end up in a state one refresh of each would have
// produced. The last event's refresh is the only one whose result is kept;
// every earlier one is work the browser did in order to throw it away.
//
// `coalesce(fn, ms)` returns a function that runs `fn` once, `ms` after the
// last call. There is no leading edge on purpose: the first event of a burst
// is not more informative than the last, and firing on it just adds one
// guaranteed-stale round trip to the front.
//
// The `maxWaitMs` ceiling exists because a *continuous* stream (a sync that
// touches files for a minute) would otherwise never let the trailing edge
// land, and the reader would watch a stale tree the whole time.

export interface CoalesceOptions {
  /** Never let more than this long pass with pending work. */
  maxWaitMs?: number;
}

export function coalesce(
  fn: () => void,
  waitMs: number,
  options: CoalesceOptions = {},
): () => void {
  const maxWaitMs = options.maxWaitMs ?? waitMs * 8;
  let timer = 0;
  let firstPendingAt = 0;

  const run = (): void => {
    timer = 0;
    firstPendingAt = 0;
    fn();
  };

  return () => {
    const now = Date.now();
    if (firstPendingAt === 0) firstPendingAt = now;
    if (timer) window.clearTimeout(timer);
    // Past the ceiling, run now rather than extending the wait again.
    if (now - firstPendingAt >= maxWaitMs) {
      run();
      return;
    }
    timer = window.setTimeout(run, waitMs);
  };
}
