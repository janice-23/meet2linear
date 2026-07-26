import { Hono } from "hono";
import { Meeting, TranscriptPostSchema } from "@meet2linear/shared";
import { runExtraction } from "../extraction/run.js";
import { listMeetings, readMeeting, writeMeeting } from "../store.js";

export const transcripts = new Hono();

// Extension posts here: periodic snapshots (final=false) and the full
// transcript at meeting end (final=true), which triggers extraction.
transcripts.post("/api/transcripts", async (c) => {
  const parsed = TranscriptPostSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);
  const { meeting: meta, segments, final } = parsed.data;

  const existing = await readMeeting(meta.meetingId);
  const meeting: Meeting = {
    meta: { ...existing?.meta, ...meta },
    segments, // extension always sends the full segment list
    candidates: existing?.candidates ?? [],
    extractionState: existing?.extractionState ?? "none",
    extractionError: existing?.extractionError,
  };
  if (final && !meeting.meta.endedAt) meeting.meta.endedAt = new Date().toISOString();
  await writeMeeting(meeting);

  if (final && segments.length > 0) {
    runExtraction(meta.meetingId).catch((err) =>
      console.error(`[extract] ${meta.meetingId}: ${err instanceof Error ? err.message : err}`),
    );
  }
  return c.json({ ok: true, meetingId: meta.meetingId, extracting: final && segments.length > 0 });
});

transcripts.get("/api/meetings", async (c) => {
  const meetings = await listMeetings();
  return c.json(
    meetings.map((m) => ({
      meta: m.meta,
      segmentCount: m.segments.length,
      candidateCount: m.candidates.length,
      extractionState: m.extractionState,
    })),
  );
});

transcripts.get("/api/meetings/:id", async (c) => {
  const meeting = await readMeeting(c.req.param("id"));
  if (!meeting) return c.json({ error: "not found" }, 404);
  return c.json(meeting);
});

transcripts.post("/api/meetings/:id/extract", async (c) => {
  const id = c.req.param("id");
  const meeting = await readMeeting(id);
  if (!meeting) return c.json({ error: "not found" }, 404);
  if (meeting.segments.length === 0) return c.json({ error: "meeting has no transcript" }, 400);
  runExtraction(id).catch((err) =>
    console.error(`[extract] ${id}: ${err instanceof Error ? err.message : err}`),
  );
  return c.json({ ok: true, extracting: true });
});
