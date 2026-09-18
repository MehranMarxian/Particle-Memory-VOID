import { defineConfig, type Plugin } from "vite";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

/**
 * The eager-JS budget, with teeth (v0.9.0 slice 6): every chunk statically
 * reachable from the entry is gzipped right here, and the build FAILS if
 * their gzip total exceeds the budget (docs/PLAN-0.9.0.md, part 2). The
 * lazily-loaded example loaders are dynamic entries and do not count.
 */
const EAGER_GZIP_BUDGET_BYTES = 220 * 1024;

function eagerGzipBudget(): Plugin {
  return {
    name: "void:eager-gzip-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        (f): f is Extract<(typeof f), { type: "chunk" }> => f.type === "chunk"
      );
      // Eager = everything statically reachable from the entry. Flagging
      // dynamic entries is not enough here: the STL loader's dynamic
      // import("three") marks the whole three chunk as a dynamic entry even
      // though the entry chunk pulls it in statically.
      const entry = chunks.find((c) => c.isEntry);
      if (!entry) return;
      const eager = new Set<string>([entry.fileName]);
      const queue = [entry];
      while (queue.length) {
        const c = queue.pop()!;
        for (const imp of c.imports) {
          if (!eager.has(imp)) {
            const target = chunks.find((x) => x.fileName === imp);
            if (target) {
              eager.add(imp);
              queue.push(target);
            }
          }
        }
      }
      let total = 0;
      const lines: string[] = [];
      for (const c of chunks) {
        if (!eager.has(c.fileName)) continue;
        const gz = gzipSync(c.code).length;
        total += gz;
        lines.push(
          `  ${c.fileName}  ${(c.code.length / 1024).toFixed(1)} kB raw / ${(gz / 1024).toFixed(1)} kB gzip`
        );
      }
      const kb = (total / 1024).toFixed(1);
      const budgetKb = (EAGER_GZIP_BUDGET_BYTES / 1024).toFixed(0);
      if (total > EAGER_GZIP_BUDGET_BYTES) {
        this.error(
          `eager JS exceeds the gzip budget: ${kb} kB > ${budgetKb} kB\n${lines.join("\n")}`
        );
      }
      console.log(`eager js (gzip): ${kb} kB / ${budgetKb} kB budget\n${lines.join("\n")}`);
    },
  };
}

export default defineConfig({
  // Relative asset paths: the same build runs at a domain root or inside any
  // subfolder, so a dist can be handed to testers or dropped onto a website.
  base: "./",
  plugins: [eagerGzipBudget()],
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
