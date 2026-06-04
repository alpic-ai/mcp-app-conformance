import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Bundles view/index.html (+ its TS/CSS) into a single self-contained HTML file
// at dist/view/index.html, which the test server serves as the ui:// resource.
export default defineConfig({
  root: resolve(import.meta.dirname, "view"),
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: resolve(import.meta.dirname, "dist/view"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(import.meta.dirname, "view/index.html"),
    },
  },
});
