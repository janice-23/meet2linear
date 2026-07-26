// Gemini extraction via raw REST — no SDK needed for one endpoint. Runs in
// the service worker (auto, at meeting end) and the review page (re-extract).
import {
  ExtractedCandidate,
  ExtractionResultSchema,
  MeetingMeta,
  TicketCandidate,
  TranscriptSegment,
  transcriptToText,
} from "@meet2linear/shared";
import { buildExtractionPrompt, extractionResponseSchema } from "./prompt.js";
import { getMeeting, getSettings, saveMeeting } from "./store.js";

const MODEL = "gemini-flash-latest";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export async function extractCandidates(
  meta: MeetingMeta,
  segments: TranscriptSegment[],
  apiKey: string,
): Promise<ExtractedCandidate[]> {
  const prompt = buildExtractionPrompt(meta, transcriptToText(segments));

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const text =
      attempt === 0
        ? prompt
        : `${prompt}\n\nYour previous output failed schema validation (${lastError}). Return JSON matching the schema exactly.`;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: extractionResponseSchema,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const jsonText: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = ExtractionResultSchema.safeParse(JSON.parse(jsonText ?? "{}"));
    if (parsed.success) return parsed.data.candidates;
    lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  throw new Error(`Gemini output failed validation after retry: ${lastError}`);
}

// Re-runs replace "proposed" candidates but keep anything already acted on.
export async function runExtraction(meetingId: string): Promise<void> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error(`Unknown meeting: ${meetingId}`);
  if (meeting.extractionState === "running") return;
  if (meeting.segments.length === 0) return;
  const { geminiApiKey } = await getSettings();
  if (!geminiApiKey) {
    meeting.extractionState = "error";
    meeting.extractionError = "No Gemini API key — add one in Settings";
    await saveMeeting(meeting);
    return;
  }

  meeting.extractionState = "running";
  meeting.extractionError = undefined;
  await saveMeeting(meeting);

  try {
    const extracted = await extractCandidates(meeting.meta, meeting.segments, geminiApiKey);
    const fresh: TicketCandidate[] = extracted.map((c) => ({
      ...c,
      id: crypto.randomUUID(),
      status: "proposed",
    }));
    const latest = (await getMeeting(meetingId)) ?? meeting;
    latest.candidates = [...latest.candidates.filter((c) => c.status !== "proposed"), ...fresh];
    latest.extractionState = "done";
    latest.extractionError = undefined;
    await saveMeeting(latest);
  } catch (err) {
    const latest = (await getMeeting(meetingId)) ?? meeting;
    latest.extractionState = "error";
    latest.extractionError = err instanceof Error ? err.message : String(err);
    await saveMeeting(latest);
  }
}
