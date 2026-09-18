import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  // Relative asset paths: the same build runs at a domain root or inside any
  // subfolder, so a dist can be handed to testers or dropped onto a website.
  base: "./",
  // The app shows its own version in the panel footer.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        // three is needed at boot and cannot be lazy-loaded, so it stays in the
        // eager graph either way. Giving it a chunk of its own keeps the app
        // chunk small and lets a returning visitor re-use three from cache.
        // The example loaders are excluded on purpose: they are imported on
        // demand when a model is dropped, and must stay their own chunks.
        manualChunks: (id: string) => {
          if (!id.includes("node_modules/three")) return undefined;
          return id.includes("examples/jsm") ? undefined : "three";
        },
      },
    },
  },
});
