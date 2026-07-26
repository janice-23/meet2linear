import { randomUUID } from "node:crypto";
import { TicketCandidate } from "@meet2linear/shared";
import { readMeeting, writeMeeting } from "../store.js";
import { extractCandidates } from "./gemini.js";

// Re-runs replace "proposed" candidates but keep anything already acted on.
export async function runExtraction(meetingId: string): Promise<void> {
  const meeting = await readMeeting(meetingId);
  if (!meeting) throw new Error(`Unknown meeting: ${meetingId}`);
  if (meeting.extractionState === "running") return;
  if (meeting.segments.length === 0) return;

  meeting.extractionState = "running";
  meeting.extractionError = undefined;
  await writeMeeting(meeting);

  try {
    const extracted = await extractCandidates(meeting.meta, meeting.segments);
    const fresh: TicketCandidate[] = extracted.map((c) => ({
      ...c,
      id: randomUUID(),
      status: "proposed",
    }));
    const latest = (await readMeeting(meetingId)) ?? meeting;
    latest.candidates = [...latest.candidates.filter((c) => c.status !== "proposed"), ...fresh];
    latest.extractionState = "done";
    latest.extractionError = undefined;
    await writeMeeting(latest);
  } catch (err) {
    const latest = (await readMeeting(meetingId)) ?? meeting;
    latest.extractionState = "error";
    latest.extractionError = err instanceof Error ? err.message : String(err);
    await writeMeeting(latest);
    throw err;
  }
}
