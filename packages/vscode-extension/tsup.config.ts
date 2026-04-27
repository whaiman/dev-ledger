import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  external: ["vscode"],
  noExternal: ["@devledger/core"],
  clean: true,
  minify: true,
  sourcemap: false,
  splitting: false,
  outDir: "dist",
  target: "es2022"
});
