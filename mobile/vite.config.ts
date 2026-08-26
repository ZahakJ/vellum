import { defineConfig } from "vite";

/**
 * The shell's build. It produces `www/`, which `cap sync` copies into the APK's
 * assets — the only web content this app ships. Everything else it renders is
 * the owner's own server, fetched at run time.
 *
 * `base: ""` because those assets are loaded from `https://localhost/` inside a
 * WebView: an absolute `/assets/...` would resolve, but a relative one survives
 * being loaded from anywhere, and this bundle has no router to disagree with.
 *
 * No code splitting and no hashed chunk graph: it is four modules and one
 * stylesheet, and a single file is one fewer thing the WebView asks the local
 * server for before the first paint.
 */
export default defineConfig({
  root: "src",
  base: "",
  build: {
    outDir: "../www",
    emptyOutDir: true,
    // A WebView shipped in the APK — its floor is whatever Capacitor's own
    // minSdk (24) can run, and every Chrome that reaches is well past es2020.
    target: "es2020",
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // Capacitor's `registerPlugin` reaches for its web fallbacks through
        // dynamic imports. On a phone those branches are never taken — the
        // native implementations answer — so splitting them into chunks buys a
        // round trip and saves nothing. Inlined, the whole shell is one file.
        inlineDynamicImports: true,
        entryFileNames: "assets/shell.js",
        assetFileNames: "assets/shell.[ext]",
      },
    },
  },
});
