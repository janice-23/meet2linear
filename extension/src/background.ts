// Service worker: single writer of meeting records. Receives transcript
// updates from the content script, persists them, and auto-runs extraction
// when a meeting ends. No server involved — chrome.storage is the store.
import type { MeetingMeta, TranscriptSegment } from "@meet2linear/shared";
import { runExtraction } from "./extraction.js";
import type { ExtensionMessage } from "./messages.js";
import { getMeeting, saveMeeting } from "./store.js";

async function mergeTranscript(meta: MeetingMeta, segments: TranscriptSegment[]): Promise<void> {
  const existing = await getMeeting(meta.meetingId);
  await saveMeeting({
    meta: { ...existing?.meta, ...meta },
    segments, // content script always sends the full segment list
    candidates: existing?.candidates ?? [],
    extractionState: existing?.extractionState ?? "none",
    extractionError: existing?.extractionError,
  });
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    if (message.type === "transcript_update") {
      await mergeTranscript(message.meta, message.segments);
    } else if (message.type === "meeting_ended") {
      await mergeTranscript({ ...message.meta, endedAt: message.meta.endedAt ?? new Date().toISOString() }, message.segments);
      if (message.segments.length > 0) {
        // Errors (e.g. missing key) are recorded on the meeting, shown in the UI
        await runExtraction(message.meta.meetingId);
      }
    }
    sendResponse({ ok: true });
  })();
  return true; // keep the message channel open for the async response
});

// Toolbar icon opens the review page
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
});
