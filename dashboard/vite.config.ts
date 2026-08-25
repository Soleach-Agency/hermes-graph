import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => ({
  plugins: command === "serve" ? [react()] : [],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("src/plugin.ts", import.meta.url)),
      name: "HermesGraphPlugin",
      formats: ["iife"],
      fileName: () => "index.js",
      cssFileName: "style",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
}));
