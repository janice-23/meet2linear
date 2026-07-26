// Linear via raw GraphQL — the SDK isn't worth bundling for two queries and
// two mutations. Personal API keys go in the Authorization header WITHOUT a
// "Bearer " prefix.
import type { Meeting, TicketCandidate } from "@meet2linear/shared";
import { getSettings, saveSettings, type Settings } from "./store.js";

const ENDPOINT = "https://api.linear.app/graphql";
const FROM_MEET_LABEL = "from-meet";

async function gql<T>(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Linear API ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  if (body.errors?.length) throw new Error(`Linear: ${body.errors.map((e: { message: string }) => e.message).join("; ")}`);
  return body.data as T;
}

export async function listTeams(apiKey: string): Promise<{ id: string; key: string; name: string }[]> {
  const data = await gql<{ teams: { nodes: { id: string; key: string; name: string }[] } }>(
    apiKey,
    `query { teams { nodes { id key name } } }`,
  );
  return data.teams.nodes;
}

async function ensureFromMeetLabelId(settings: Settings): Promise<string> {
  if (settings.linearLabelId) return settings.linearLabelId;
  const apiKey = settings.linearApiKey!;
  const existing = await gql<{ issueLabels: { nodes: { id: string }[] } }>(
    apiKey,
    `query($name: String!) { issueLabels(filter: { name: { eq: $name } }) { nodes { id } } }`,
    { name: FROM_MEET_LABEL },
  );
  let labelId = existing.issueLabels.nodes[0]?.id;
  if (!labelId) {
    const created = await gql<{ issueLabelCreate: { issueLabel: { id: string } } }>(
      apiKey,
      `mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id } } }`,
      { input: { teamId: settings.linearTeamId, name: FROM_MEET_LABEL, color: "#5e6ad2" } },
    );
    labelId = created.issueLabelCreate.issueLabel.id;
  }
  await saveSettings({ linearLabelId: labelId });
  return labelId;
}

function buildDescription(candidate: TicketCandidate, meeting: Meeting): string {
  const evidence = candidate.evidence.map((e) => `> **${e.speaker}:** "${e.quote}"`).join("\n>\n");
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
  const settings = await getSettings();
  if (!settings.linearApiKey) throw new Error("No Linear API key — add one in Settings");
  if (!settings.linearTeamId) throw new Error("No Linear team selected — pick one in Settings");
  const labelId = await ensureFromMeetLabelId(settings);

  const data = await gql<{ issueCreate: { success: boolean; issue: { url: string; identifier: string } | null } }>(
    settings.linearApiKey,
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { url identifier } }
    }`,
    {
      input: {
        teamId: settings.linearTeamId,
        title: candidate.title,
        description: buildDescription(candidate, meeting),
        labelIds: [labelId],
      },
    },
  );
  if (!data.issueCreate.success || !data.issueCreate.issue) throw new Error("Linear issueCreate failed");
  return data.issueCreate.issue;
}
