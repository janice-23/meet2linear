import type { MeetingMeta, TranscriptSegment } from "@meet2linear/shared";

// Content script -> service worker. The SW is the single writer of meeting
// records in chrome.storage; the content script only observes the DOM.
export type ExtensionMessage = {
  type: "transcript_update" | "meeting_ended";
  meta: MeetingMeta;
  segments: TranscriptSegment[];
};
