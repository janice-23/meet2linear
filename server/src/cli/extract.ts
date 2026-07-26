// Run Gemini extraction on a transcript fixture, no browser or server needed:
//   npm run extract -- fixtures/sample-transcript.json
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TranscriptPostSchema } from "@meet2linear/shared";
import { serverRoot } from "../env.js";
import { extractCandidates } from "../extraction/gemini.js";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npm run extract -- <transcript.json>");
  process.exit(1);
}

const file = path.isAbsolute(arg) ? arg : path.resolve(serverRoot, arg);
const { meeting, segments } = TranscriptPostSchema.parse(JSON.parse(await readFile(file, "utf8")));

console.log(`Extracting from ${segments.length} segments (${meeting.title ?? meeting.meetingId})...\n`);
const candidates = await extractCandidates(meeting, segments);

console.table(
  candidates.map((c) => ({
    type: c.type,
    confidence: c.confidence,
    title: c.title,
    quotes: c.evidence.length,
  })),
);
console.log(JSON.stringify(candidates, null, 2));
