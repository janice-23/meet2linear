import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env, serverRoot } from "./env.js";
import { candidates } from "./routes/candidates.js";
import { config } from "./routes/config.js";
import { transcripts } from "./routes/transcripts.js";

const app = new Hono();

// The extension's service worker bypasses CORS via host_permissions; this is
// for content-script-initiated fetches while debugging.
app.use("/api/*", cors({ origin: (origin) => origin }));

app.route("/", transcripts);
app.route("/", candidates);
app.route("/", config);

// Review UI (serveStatic roots are cwd-relative)
app.use("/*", serveStatic({ root: path.relative(process.cwd(), path.join(serverRoot, "public")) }));

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`meet2linear server: http://localhost:${info.port}`);
  console.log(`  review UI  →  http://localhost:${info.port}/`);
  console.log(`  gemini key ${env.geminiApiKey ? "✓" : "✗ missing"} | linear key ${env.linearApiKey ? "✓" : "✗ missing"} | team ${env.linearTeamId ? "✓" : "✗ missing"}`);
});
