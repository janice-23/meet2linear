import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Meeting, MeetingSchema } from "@meet2linear/shared";
import { env } from "./env.js";

// Filenames are derived from meeting IDs sent by the extension — sanitize them.
function fileFor(meetingId: string): string {
  const safe = meetingId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(env.dataDir, `${safe}.json`);
}

export async function readMeeting(meetingId: string): Promise<Meeting | null> {
  try {
    const raw = await readFile(fileFor(meetingId), "utf8");
    return MeetingSchema.parse(JSON.parse(raw));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeMeeting(meeting: Meeting): Promise<void> {
  await mkdir(env.dataDir, { recursive: true });
  const file = fileFor(meeting.meta.meetingId);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(meeting, null, 2), "utf8");
  await rename(tmp, file);
}

export async function listMeetings(): Promise<Meeting[]> {
  await mkdir(env.dataDir, { recursive: true });
  const files = (await readdir(env.dataDir)).filter((f) => f.endsWith(".json") && f !== "linear-config.json");
  const meetings: Meeting[] = [];
  for (const f of files) {
    try {
      meetings.push(MeetingSchema.parse(JSON.parse(await readFile(path.join(env.dataDir, f), "utf8"))));
    } catch {
      // Skip corrupt/foreign files rather than breaking the whole listing
    }
  }
  meetings.sort((a, b) => b.meta.startedAt.localeCompare(a.meta.startedAt));
  return meetings;
}

export async function findMeetingByCandidateId(candidateId: string): Promise<Meeting | null> {
  for (const meeting of await listMeetings()) {
    if (meeting.candidates.some((c) => c.id === candidateId)) return meeting;
  }
  return null;
}
