// Map/WeakMap upsert — the TC39 proposal pdf.js 5 already writes against.
//
// `Map.prototype.getOrInsertComputed` reached V8 behind a flag and ships in
// system Chromium builds before it ships in Electron's, so the SAME book that
// opens in the browser died in the desktop window with
// "this._requestsByChunk.getOrInsertComputed is not a function" — and only for
// books LARGE enough to enter pdf.js's range transport, which is why every
// small test PDF sailed through. Installed on both prototypes because pdf.js
// uses both, and imported by BOTH sides of the engine boundary: the main
// chunk (client/books/pdfjs.ts) and the worker (pdfWorkerEntry.ts) each have
// their own global scope. Deleted the day Electron's V8 carries the builtin —
// the guards make it a no-op there already.

/* eslint-disable @typescript-eslint/no-explicit-any */
for (const proto of [Map.prototype, WeakMap.prototype] as any[]) {
  if (typeof proto.getOrInsert !== "function") {
    proto.getOrInsert = function (key: unknown, value: unknown) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    };
  }
  if (typeof proto.getOrInsertComputed !== "function") {
    proto.getOrInsertComputed = function (key: unknown, compute: (k: unknown) => unknown) {
      if (!this.has(key)) this.set(key, compute(key));
      return this.get(key);
    };
  }
}

export {};
