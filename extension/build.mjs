import { context, build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });
cpSync("manifest.json", "dist/manifest.json");

const configs = [
  // Content scripts can't be ES modules
  { entryPoints: ["src/content.ts"], format: "iife" },
  // MV3 service worker is declared with type: module
  { entryPoints: ["src/background.ts"], format: "esm" },
].map((c) => ({
  ...c,
  bundle: true,
  outdir: "dist",
  target: "chrome120",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
}));

if (watch) {
  for (const c of configs) (await context(c)).watch();
  console.log("watching… (reload the extension in chrome://extensions after changes)");
} else {
  await Promise.all(configs.map(build));
}
