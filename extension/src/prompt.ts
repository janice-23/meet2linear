import type { MeetingMeta } from "@meet2linear/shared";

// Gemini REST responseSchema (OpenAPI subset), mirrored by the Zod
// ExtractionResultSchema in shared/ which validates what comes back.
export const extractionResponseSchema = {
  type: "OBJECT",
  properties: {
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ["bug", "feature_request", "other"] },
          title: { type: "STRING" },
          description: { type: "STRING" },
          evidence: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                speaker: { type: "STRING" },
                quote: { type: "STRING" },
              },
              required: ["speaker", "quote"],
            },
          },
          confidence: { type: "NUMBER" },
        },
        required: ["type", "title", "description", "evidence", "confidence"],
        propertyOrdering: ["type", "title", "description", "evidence", "confidence"],
      },
    },
  },
  required: ["candidates"],
} as const;

export function buildExtractionPrompt(meta: MeetingMeta, transcriptText: string): string {
  return `You triage customer calls for a software team. Below is the transcript of a call${
    meta.title ? ` titled "${meta.title}"` : ""
  }, one line per caption block in the form "Speaker: text". The transcription comes from live captions, so expect minor recognition errors.

Extract every actionable item a customer raised, as ticket candidates:
- "bug": something is broken, wrong, or not behaving as the customer expects.
- "feature_request": an explicit ask for new functionality, or a strong recurring pain point that implies one.
- "other": an actionable follow-up that is neither (e.g. a billing question needing engineering input).

Do NOT create candidates for small talk, scheduling/logistics, internal team chatter, or vague sentiment with nothing actionable.

Rules:
1. Merge multiple mentions of the same underlying issue into ONE candidate; attach all supporting quotes.
2. "evidence" quotes must be VERBATIM substrings of the transcript text (copy them exactly, including errors), each attributed to its speaker.
3. "title": short, imperative, Linear-ready (e.g. "Fix CSV export dropping header row").
4. "description": 2-6 sentences of Linear-ready markdown — what the customer reported, expected vs actual behavior for bugs, and any context (plan, browser, frequency) mentioned on the call. Do not repeat the quotes; they are attached separately.
5. "confidence": 0-1 — how confident you are this is a real, actionable item the team should track (1.0 = customer explicitly reported it; ~0.4 = implied or ambiguous).
6. The transcript may be in any language; always write titles and descriptions in English.
7. If there are no actionable items, return an empty candidates array.

TRANSCRIPT:
${transcriptText}`;
}
