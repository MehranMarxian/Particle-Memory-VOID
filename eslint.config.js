// Lint (v0.10.0 slice 6): the F1 lesson at the TS layer. Strict types
// already guard declared-but-unused at compile time; this catches the
// rest of the rot — equality slips, unreachable code, suspicious
// assignments — without fighting the house style.
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "landing/**", "packaging/**", "config/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,js}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        // _-prefixed names are deliberate placeholders (see SpatialGrid).
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The engines use `x != null` idioms and index signs deliberately.
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "smart"],
      "no-fallthrough": "error",
    },
  }
);
