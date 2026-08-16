import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { chunkFor } from "./build/chunks.ts";

export default defineConfig({
  plugins: [react()],
  root: "client",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // The server reads dist/.vite/manifest.json to name the chunks the shell
    // a given request will mount, and preloads exactly those (server/preload.ts).
    manifest: true,
    // Deterministic chunk boundaries — see build/chunks.ts for the policy and
    // why each boundary exists. Without this, rollup's automatic splitting
    // put every component (both shells, the graph engine, the settings and
    // moderation modals) into the single entry chunk that an anonymous blog
    // reader downloads before the first paragraph renders.
    rollupOptions: { output: { manualChunks: chunkFor } },
  },
  server: {
    port: 5801,
    proxy: {
      "/api": { target: "http://localhost:6801", changeOrigin: true },
    },
  },
});
