import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LinearClient } from "@linear/sdk";
import { Meeting, TicketCandidate } from "@meet2linear/shared";
import { env, requireEnv } from "../env.js";

// Note for anyone dropping to raw GraphQL: personal API keys go in the
// Authorization header WITHOUT a "Bearer " prefix. The SDK handles this.
let client: LinearClient | undefined;
function getClient(): LinearClient {
  client ??= new LinearClient({ apiKey: requireEnv("linearApiKey") });
  return client;
}

const FROM_MEET_LABEL = "from-meet";
const labelCacheFile = () => path.join(env.dataDir, "linear-config.json");

async function ensureFromMeetLabelId(teamId: string): Promise<string> {
  if (env.linearLabelId) return env.linearLabelId;
  try {
    const cache = JSON.parse(await readFile(labelCacheFile(), "utf8"));
    if (cache.teamId === teamId && cache.labelId) return cache.labelId;
  } catch {
    // no cache yet
  }
  const linear = getClient();
  const existing = await linear.issueLabels({ filter: { name: { eq: FROM_MEET_LABEL } } });
  let labelId = existing.nodes[0]?.id;
  if (!labelId) {
    const payload = await linear.createIssueLabel({ teamId, name: FROM_MEET_LABEL, color: "#5e6ad2" });
    labelId = (await payload.issueLabel)?.id;
  }
  if (!labelId) throw new Error(`Could not find or create the "${FROM_MEET_LABEL}" label in Linear`);
  await writeFile(labelCacheFile(), JSON.stringify({ teamId, labelId }, null, 2), "utf8");
  return labelId;
}

function buildDescription(candidate: TicketCandidate, meeting: Meeting): string {
  const evidence = candidate.evidence
    .map((e) => `> **${e.speaker}:** "${e.quote}"`)
    .join("\n>\n");
  const when = meeting.meta.startedAt.slice(0, 10);
  const title = meeting.meta.title ? ` "${meeting.meta.title}"` : "";
  return `${candidate.description}

### Evidence from call
${evidence}

---
*Extracted by meet2linear from the${title} Google Meet call on ${when}.*`;
}

export async function createIssueFromCandidate(
  candidate: TicketCandidate,
  meeting: Meeting,
): Promise<{ url: string; identifier: string }> {
  const linear = getClient();
  const teamId = requireEnv("linearTeamId");
  const labelId = await ensureFromMeetLabelId(teamId);
  const payload = await linear.createIssue({
    teamId,
    title: candidate.title,
    description: buildDescription(candidate, meeting),
    labelIds: [labelId],
  });
  const issue = await payload.issue;
  if (!payload.success || !issue) throw new Error("Linear createIssue failed");
  return { url: issue.url, identifier: issue.identifier };
}

export async function listTeamsAndLabels() {
  const linear = getClient();
  const [teams, labels] = await Promise.all([linear.teams(), linear.issueLabels()]);
  return {
    configuredTeamId: env.linearTeamId ?? null,
    teams: teams.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name })),
    labels: labels.nodes.map((l) => ({ id: l.id, name: l.name })),
  };
}
