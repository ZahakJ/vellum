// Vite's `?url` import suffix, typed for this directory only.
//
// `import workerUrl from "…/pdf.worker.min.mjs?url"` asks the bundler to emit
// that file as an asset and hand back its URL — which is how the pdf.js worker
// becomes a REAL same-origin file instead of the `blob:` shim the CSP refuses
// (see server/index.ts). The repo does not reference `vite/client` globally,
// so the suffix has no type; declaring it here rather than in
// client/vite-env.d.ts keeps the declaration next to its one user.

declare module "*?url" {
  const src: string;
  export default src;
}

// `?worker&url` builds the file AS A WORKER ENTRY (its imports bundled into
// one self-contained script) and hands back the URL — what pdfWorkerEntry.ts
// needs so its polyfill rides inside the emitted worker asset.
declare module "*?worker&url" {
  const src: string;
  export default src;
}
