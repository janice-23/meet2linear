import { Hono } from "hono";
import { z } from "zod";
import { CandidateTypeSchema } from "@meet2linear/shared";
import { createIssueFromCandidate } from "../linear/client.js";
import { findMeetingByCandidateId, writeMeeting } from "../store.js";

export const candidates = new Hono();

const PatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  type: CandidateTypeSchema.optional(),
  status: z.enum(["proposed", "discarded"]).optional(), // "created" only via /approve
});

candidates.patch("/api/candidates/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = PatchSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

  const meeting = await findMeetingByCandidateId(id);
  const candidate = meeting?.candidates.find((x) => x.id === id);
  if (!meeting || !candidate) return c.json({ error: "not found" }, 404);
  if (candidate.status === "created") return c.json({ error: "already created in Linear" }, 409);

  Object.assign(candidate, parsed.data);
  await writeMeeting(meeting);
  return c.json(candidate);
});

candidates.post("/api/candidates/:id/approve", async (c) => {
  const id = c.req.param("id");
  const meeting = await findMeetingByCandidateId(id);
  const candidate = meeting?.candidates.find((x) => x.id === id);
  if (!meeting || !candidate) return c.json({ error: "not found" }, 404);
  if (candidate.status === "created")
    return c.json({ error: "already created in Linear", url: candidate.linearIssueUrl }, 409);

  try {
    const issue = await createIssueFromCandidate(candidate, meeting);
    candidate.status = "created";
    candidate.linearIssueUrl = issue.url;
    candidate.linearIssueIdentifier = issue.identifier;
    await writeMeeting(meeting);
    return c.json(candidate);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
