// chrome.storage.local is the app's entire persistence layer: meeting records
// (transcript + candidates) and user settings. No server, no filesystem.
import { Meeting, MeetingSchema } from "@meet2linear/shared";

const MEETING_PREFIX = "m2l:meeting:";
const SETTINGS_KEY = "m2l:settings";

export interface Settings {
  geminiApiKey?: string;
  linearApiKey?: string;
  linearTeamId?: string;
  linearTeamName?: string;
  linearLabelId?: string; // cached "from-meet" label
}

export async function getSettings(): Promise<Settings> {
  return ((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Settings) ?? {};
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

export async function getMeeting(meetingId: string): Promise<Meeting | null> {
  const key = MEETING_PREFIX + meetingId;
  const raw = (await chrome.storage.local.get(key))[key];
  if (!raw) return null;
  const parsed = MeetingSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function saveMeeting(meeting: Meeting): Promise<void> {
  await chrome.storage.local.set({ [MEETING_PREFIX + meeting.meta.meetingId]: meeting });
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  await chrome.storage.local.remove(MEETING_PREFIX + meetingId);
}

export async function listMeetings(): Promise<Meeting[]> {
  const all = await chrome.storage.local.get(null);
  const meetings: Meeting[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(MEETING_PREFIX)) continue;
    const parsed = MeetingSchema.safeParse(value);
    if (parsed.success) meetings.push(parsed.data);
  }
  meetings.sort((a, b) => b.meta.startedAt.localeCompare(a.meta.startedAt));
  return meetings;
}

export async function findMeetingByCandidateId(
  candidateId: string,
): Promise<Meeting | null> {
  for (const meeting of await listMeetings()) {
    if (meeting.candidates.some((c) => c.id === candidateId)) return meeting;
  }
  return null;
}
