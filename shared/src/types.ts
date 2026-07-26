import { z } from "zod";

// ---------- Transcript (extension -> server) ----------

export const TranscriptSegmentSchema = z.object({
  speaker: z.string(),
  text: z.string(),
  timestamp: z.string(), // ISO 8601
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const MeetingMetaSchema = z.object({
  meetingId: z.string().min(1),
  title: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});
export type MeetingMeta = z.infer<typeof MeetingMetaSchema>;

export const TranscriptPostSchema = z.object({
  meeting: MeetingMetaSchema,
  segments: z.array(TranscriptSegmentSchema),
  // false = periodic snapshot; true = meeting ended, run extraction
  final: z.boolean().default(false),
});
export type TranscriptPost = z.infer<typeof TranscriptPostSchema>;

// ---------- Ticket candidates (server <-> UI, Gemini output) ----------

export const CandidateTypeSchema = z.enum(["bug", "feature_request", "other"]);
export type CandidateType = z.infer<typeof CandidateTypeSchema>;

export const CandidateStatusSchema = z.enum(["proposed", "discarded", "created"]);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const EvidenceSchema = z.object({
  speaker: z.string(),
  quote: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// Shape Gemini must return (validated before we accept it)
export const ExtractedCandidateSchema = z.object({
  type: CandidateTypeSchema,
  title: z.string().min(1),
  description: z.string(),
  evidence: z.array(EvidenceSchema),
  confidence: z.number().min(0).max(1),
});
export type ExtractedCandidate = z.infer<typeof ExtractedCandidateSchema>;

export const ExtractionResultSchema = z.object({
  candidates: z.array(ExtractedCandidateSchema),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export const TicketCandidateSchema = ExtractedCandidateSchema.extend({
  id: z.string(),
  status: CandidateStatusSchema,
  linearIssueUrl: z.string().optional(),
  linearIssueIdentifier: z.string().optional(), // e.g. "ENG-123"
});
export type TicketCandidate = z.infer<typeof TicketCandidateSchema>;

// ---------- Persisted meeting record ----------

export const ExtractionStateSchema = z.enum(["none", "running", "done", "error"]);
export type ExtractionState = z.infer<typeof ExtractionStateSchema>;

export const MeetingSchema = z.object({
  meta: MeetingMetaSchema,
  segments: z.array(TranscriptSegmentSchema),
  candidates: z.array(TicketCandidateSchema),
  extractionState: ExtractionStateSchema,
  extractionError: z.string().optional(),
});
export type Meeting = z.infer<typeof MeetingSchema>;

// Render a transcript as "Speaker: text" lines for the LLM and for quote checks
export function transcriptToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `${s.speaker}: ${s.text}`).join("\n");
}
