import { GoogleGenAI } from "@google/genai";
import {
  ExtractedCandidate,
  ExtractionResultSchema,
  MeetingMeta,
  TranscriptSegment,
  transcriptToText,
} from "@meet2linear/shared";
import { requireEnv } from "../env.js";
import { buildExtractionPrompt, extractionResponseSchema } from "./prompt.js";

const MODEL = "gemini-2.5-flash";

export async function extractCandidates(
  meta: MeetingMeta,
  segments: TranscriptSegment[],
): Promise<ExtractedCandidate[]> {
  const ai = new GoogleGenAI({ apiKey: requireEnv("geminiApiKey") });
  const prompt = buildExtractionPrompt(meta, transcriptToText(segments));

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const contents =
      attempt === 0
        ? prompt
        : `${prompt}\n\nYour previous output failed schema validation (${lastError}). Return JSON matching the schema exactly.`;
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: extractionResponseSchema,
      },
    });
    const parsed = ExtractionResultSchema.safeParse(JSON.parse(response.text ?? "{}"));
    if (parsed.success) return parsed.data.candidates;
    lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  throw new Error(`Gemini output failed validation after retry: ${lastError}`);
}
