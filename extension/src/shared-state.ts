import type { MeetingMeta, TranscriptSegment } from "@meet2linear/shared";

export interface StoredMeeting {
  meta: MeetingMeta;
  segments: TranscriptSegment[];
  finalSent: boolean;
}

export type ExtensionMessage =
  | { type: "snapshot"; meta: MeetingMeta; segments: TranscriptSegment[] }
  | { type: "meeting_ended"; meta: MeetingMeta; segments: TranscriptSegment[] };

const KEY_PREFIX = "meeting:";

export async function persistMeeting(meta: MeetingMeta, segments: TranscriptSegment[], finalSent = false): Promise<void> {
  await chrome.storage.local.set({ [KEY_PREFIX + meta.meetingId]: { meta, segments, finalSent } satisfies StoredMeeting });
}

export async function markFinalSent(meetingId: string): Promise<void> {
  const key = KEY_PREFIX + meetingId;
  const stored = (await chrome.storage.local.get(key))[key] as StoredMeeting | undefined;
  if (stored) await chrome.storage.local.set({ [key]: { ...stored, finalSent: true } });
}

export async function unsentMeetings(): Promise<StoredMeeting[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(KEY_PREFIX))
    .map(([, v]) => v as StoredMeeting)
    .filter((m) => !m.finalSent && m.segments.length > 0);
}

export async function dropOldSentMeetings(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const cutoff = Date.now() - 7 * 24 * 3600_000;
  const stale = Object.entries(all)
    .filter(([k, v]) => {
      if (!k.startsWith(KEY_PREFIX)) return false;
      const m = v as StoredMeeting;
      return m.finalSent && new Date(m.meta.startedAt).getTime() < cutoff;
    })
    .map(([k]) => k);
  if (stale.length > 0) await chrome.storage.local.remove(stale);
}
