import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import ErrorBoundary from "./ErrorBoundary.tsx";
import { installSafetyNet } from "./safety.ts";

// FIRST, before a single component mounts. Half of what this catches happens
// during bootstrap — a settings fetch that never answers, a rejected promise
// inside an effect on the first paint — and a net installed after the render
// is a net installed after the fall (v1.8 client-solidity audit, B2).
installSafetyNet();

const root = document.getElementById("root");
if (!root) throw new Error("vellum: #root element missing");

createRoot(root).render(
  <React.StrictMode>
    {/* OUTSIDE StrictMode's child, INSIDE the root: a boundary the whole app
        renders under, so a throw anywhere in the tree becomes a card with a
        reload button instead of an empty <div id="root">. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// ── The desktop app ─────────────────────────────────────────────────────────
// Electron stamps `Electron/<version>` into the user-agent and nothing else
// does — the same test client/components/ShortcutsHelp.tsx already uses to
// decide whether a desktop-only shortcut row exists. Behind `import()` on
// purpose: `npm run check-bundle` holds the entry chunk to a budget with a
// couple of kilobytes of headroom, and a browser must not download the native
// menu's dispatch table, the find bar and the spelling menu to not use them.
if (/\bElectron\//.test(navigator.userAgent)) {
  void import("./desktop/index.ts").then((mod) => mod.mountDesktop());
}
