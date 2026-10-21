/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and fails if it is taken.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // The app loads its code from disk, not the network, so the usual 500 kB web warning doesn't apply.
  build: { target: "safari16", outDir: "dist", chunkSizeWarningLimit: 900 },
  test: { environment: "node" },
});
