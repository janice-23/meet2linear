import { context, build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });
cpSync("manifest.json", "dist/manifest.json");
cpSync("src/review/review.html", "dist/review.html");
cpSync("fixtures/sample-transcript.json", "dist/sample-transcript.json");

const configs = [
  // Content scripts can't be ES modules
  { entryPoints: ["src/content.ts"], outfile: "dist/content.js", format: "iife" },
  // MV3 service worker is declared with type: module
  { entryPoints: ["src/background.ts"], outfile: "dist/background.js", format: "esm" },
  // Review page, loaded via <script type="module">
  { entryPoints: ["src/review/review.ts"], outfile: "dist/review.js", format: "esm" },
].map((c) => ({
  ...c,
  bundle: true,
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
