/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and fails if it is taken.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // The native side is built by Cargo; watching its output only causes needless reloads.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Pre-bundle libraries that are loaded on demand, so the first use doesn't reload the page.
  optimizeDeps: {
    include: [
      "@tauri-apps/api/core",
      "@tauri-apps/api/window",
      "@tauri-apps/api/event",
      "@tauri-apps/api/app",
      "@tauri-apps/plugin-opener",
      "modern-screenshot",
    ],
  },
  // The app loads its code from disk, not the network, so the usual 500 kB web warning doesn't apply.
  build: { target: "safari16", outDir: "dist", chunkSizeWarningLimit: 900 },
  test: { environment: "node" },
});
