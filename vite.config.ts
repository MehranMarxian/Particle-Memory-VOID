import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Relative asset paths: the same build runs at a domain root or inside any
  // subfolder, so a dist can be handed to testers or dropped onto a website.
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
  },
});
