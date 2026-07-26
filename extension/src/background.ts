// Service worker: receives transcript payloads from the content script and
// posts them to the local meet2linear server. Extension-initiated fetches
// with host_permissions bypass CORS.
import type { MeetingMeta, TranscriptSegment } from "@meet2linear/shared";
import {
  dropOldSentMeetings,
  markFinalSent,
  persistMeeting,
  unsentMeetings,
  type ExtensionMessage,
} from "./shared-state.js";

const SERVER = "http://localhost:7337";

async function postTranscript(
  meta: MeetingMeta,
  segments: TranscriptSegment[],
  final: boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${SERVER}/api/transcripts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meeting: meta, segments, final }),
      });
      if (res.ok) {
        if (final) await markFinalSent(meta.meetingId);
        return true;
      }
      console.error(`[meet2linear] server returned ${res.status}`);
    } catch (err) {
      console.error(`[meet2linear] POST failed (attempt ${attempt + 1}/3)`, err);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  return false;
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    if (message.type === "snapshot") {
      await postTranscript(message.meta, message.segments, false);
    } else if (message.type === "meeting_ended") {
      const ok = await postTranscript(message.meta, message.segments, true);
      if (!ok) {
        // Keep it in chrome.storage; startup recovery will retry.
        await persistMeeting(message.meta, message.segments, false);
        console.error("[meet2linear] final transcript not delivered; will retry on next browser start");
      }
    }
    sendResponse({ ok: true });
  })();
  return true; // keep the message channel open for the async response
});

// Recovery: re-send any meeting whose final transcript never reached the server
// (e.g. the server was down or the tab crashed).
async function recover(): Promise<void> {
  await dropOldSentMeetings();
  for (const m of await unsentMeetings()) {
    // Only recover meetings that are plausibly over (started >15 min ago)
    if (Date.now() - new Date(m.meta.startedAt).getTime() < 15 * 60_000) continue;
    console.log(`[meet2linear] recovering unsent meeting ${m.meta.meetingId}`);
    await postTranscript({ ...m.meta, endedAt: m.meta.endedAt ?? new Date().toISOString() }, m.segments, true);
  }
}

chrome.runtime.onStartup.addListener(() => void recover());
chrome.runtime.onInstalled.addListener(() => void recover());
