import { Hono } from "hono";
import { listTeamsAndLabels } from "../linear/client.js";

export const config = new Hono();

let cache: { at: number; data: Awaited<ReturnType<typeof listTeamsAndLabels>> } | undefined;

config.get("/api/config/linear", async (c) => {
  try {
    if (!cache || Date.now() - cache.at > 5 * 60_000) {
      cache = { at: Date.now(), data: await listTeamsAndLabels() };
    }
    return c.json(cache.data);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
