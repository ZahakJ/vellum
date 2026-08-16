// A bounded least-recently-used map.
//
// Every cache in a long-lived single-page app is a memory leak with a
// flattering name unless something evicts from it. The ones this replaces
// were all "read-through Map, keyed by note path", which on a 1,388-note
// vault means the ceiling is the vault: rest the pointer on enough wikilinks
// over an evening and the tab is holding the full text of every note you
// looked at, forever. On a 10k-note vault that is the whole vault in RAM,
// bought one hover at a time.
//
// A TTL is NOT eviction. Several of these caches had one — `if (Date.now() -
// entry.at < 15_000) return entry.content` — which correctly stops them
// serving stale text and does nothing whatever about the entry, which stays
// in the Map until the tab closes. Expiry and eviction are separate jobs and
// this class does both: `ttlMs` decides what may be SERVED, `max` decides
// what is KEPT.
//
// Recency comes free from `Map`'s insertion order: delete-then-set on a hit
// moves the key to the end, so the first key the iterator yields is always
// the least recently used one.

export interface LruOptions {
  /** Hard ceiling on retained entries. Reached, the least recently used one
   *  is dropped before the new one is stored. */
  max: number;
  /** Optional freshness window for `get`. An entry older than this is treated
   *  as a miss AND removed — a stale entry has no claim on the budget. */
  ttlMs?: number;
  /** Called with each evicted value (release DOM nodes, abort work, …). */
  onEvict?: (value: unknown, key: string) => void;
}

export class Lru<V> {
  private readonly map = new Map<string, { value: V; at: number }>();
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly onEvict: ((value: V, key: string) => void) | null;

  constructor(options: LruOptions) {
    if (!Number.isFinite(options.max) || options.max < 1) {
      throw new Error("Lru: max must be a positive number");
    }
    this.max = Math.floor(options.max);
    this.ttlMs = options.ttlMs ?? Infinity;
    this.onEvict = (options.onEvict as ((value: V, key: string) => void) | undefined) ?? null;
  }

  /** The value for `key` if it is present and fresh, else undefined. */
  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() - entry.at >= this.ttlMs) {
      this.map.delete(key);
      this.onEvict?.(entry.value, key);
      return undefined;
    }
    // Freshen: this key is the most recently used one again.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Is `key` present and fresh? (Does not count as a use.) */
  has(key: string): boolean {
    const entry = this.map.get(key);
    if (entry === undefined) return false;
    if (Date.now() - entry.at >= this.ttlMs) {
      this.map.delete(key);
      this.onEvict?.(entry.value, key);
      return false;
    }
    return true;
  }

  set(key: string, value: V): void {
    // Replacing an existing key must not count toward the budget twice.
    if (this.map.has(key)) this.map.delete(key);
    else this.evictWhileOver(this.max - 1);
    this.map.set(key, { value, at: Date.now() });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    if (this.onEvict) for (const [key, entry] of this.map) this.onEvict(entry.value, key);
    this.map.clear();
  }

  /** Retained entries — the number the bound is a bound ON. */
  get size(): number {
    return this.map.size;
  }

  private evictWhileOver(limit: number): void {
    while (this.map.size > limit) {
      const oldest = this.map.keys().next();
      if (oldest.done) return;
      const entry = this.map.get(oldest.value);
      this.map.delete(oldest.value);
      if (entry !== undefined) this.onEvict?.(entry.value, oldest.value);
    }
  }
}
