import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "client",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5801,
    proxy: {
      "/api": { target: "http://localhost:6801", changeOrigin: true },
    },
  },
});
