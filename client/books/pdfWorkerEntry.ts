// The pdf.js worker, wrapped in one import: the upsert polyfill has to run in
// the WORKER's global scope before the worker body evaluates (it calls
// Map.prototype.getOrInsertComputed at class-init time on engines that predate
// the builtin — Electron's V8, today). client/books/pdfjs.ts imports this file
// with vite's `?worker&url`, so the build emits it as a self-contained worker
// asset exactly as it emitted the bare worker before.
import "./mapUpsert.ts";
import "pdfjs-dist/build/pdf.worker.min.mjs";
