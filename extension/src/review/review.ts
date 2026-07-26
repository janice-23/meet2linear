import {
  Meeting,
  TicketCandidate,
  TranscriptPostSchema,
} from "@meet2linear/shared";
import { runExtraction } from "../extraction.js";
import { createIssueFromCandidate, listTeams } from "../linear.js";
import {
  deleteMeeting,
  getMeeting,
  getSettings,
  listMeetings,
  saveMeeting,
  saveSettings,
} from "../store.js";

const $meetings = document.getElementById("meetings")!;
const $detail = document.getElementById("detail")!;
const $toast = document.getElementById("toast")!;

let activeMeetingId: string | null = null;

const CONFIDENCE_CUTOFF = 0.5;

function toast(msg: string, isError = false): void {
  $toast.textContent = msg;
  $toast.className = isError ? "error" : "";
  $toast.style.display = "block";
  setTimeout(() => ($toast.style.display = "none"), isError ? 6000 : 2500);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- meeting list ----------

async function renderMeetingList(): Promise<void> {
  const meetings = await listMeetings();
  if (meetings.length === 0) {
    $meetings.innerHTML = '<div class="empty">No meetings yet.<br/>Join a Meet call, or load the sample.</div>';
    return;
  }
  $meetings.replaceChildren(
    ...meetings.map((m) => {
      const el = document.createElement("div");
      el.className = "meeting" + (m.meta.meetingId === activeMeetingId ? " active" : "");
      el.innerHTML = `
        <div class="title"></div>
        <div class="info">${(m.meta.startedAt || "").slice(0, 10)} · ${m.segments.length} segments · ${m.candidates.length} candidates</div>
        <button class="del" title="Delete meeting">✕</button>`;
      el.querySelector(".title")!.textContent = m.meta.title || m.meta.meetingId;
      el.onclick = () => selectMeeting(m.meta.meetingId);
      (el.querySelector(".del") as HTMLElement).onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${m.meta.title || m.meta.meetingId}" and its candidates?`)) return;
        await deleteMeeting(m.meta.meetingId);
        if (activeMeetingId === m.meta.meetingId) {
          activeMeetingId = null;
          $detail.innerHTML = '<div class="empty">Select a meeting</div>';
        }
      };
      return el;
    }),
  );
}

async function selectMeeting(id: string): Promise<void> {
  activeMeetingId = id;
  await Promise.all([renderMeetingList(), renderDetail()]);
}

// ---------- detail / candidates ----------

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function renderDetail(): Promise<void> {
  if (!activeMeetingId) return;
  const meeting = await getMeeting(activeMeetingId);
  if (!meeting) return;
  const transcriptNorm = normalize(meeting.segments.map((s) => s.text).join(" "));

  const container = document.createElement("div");
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const stateText = {
    none: "not extracted yet",
    running: "extracting…",
    done: "",
    error: `extraction failed: ${meeting.extractionError || "unknown error"}`,
  }[meeting.extractionState];
  toolbar.innerHTML = `
    <h2></h2>
    <span class="state ${meeting.extractionState === "error" ? "error" : ""}"></span>
    <button id="reextract">Re-extract</button>`;
  toolbar.querySelector("h2")!.textContent = meeting.meta.title || meeting.meta.meetingId;
  toolbar.querySelector(".state")!.textContent = stateText ?? "";
  (toolbar.querySelector("#reextract") as HTMLButtonElement).onclick = () => {
    toast("Extraction started");
    void runExtraction(meeting.meta.meetingId); // storage.onChanged re-renders
  };
  container.append(toolbar);

  const high = meeting.candidates.filter((c) => c.confidence >= CONFIDENCE_CUTOFF);
  const low = meeting.candidates.filter((c) => c.confidence < CONFIDENCE_CUTOFF);

  if (meeting.candidates.length === 0 && meeting.extractionState === "done") {
    container.insertAdjacentHTML("beforeend", '<div class="empty">No ticket candidates found in this call</div>');
  }
  high.forEach((c) => container.append(candidateCard(meeting, c, transcriptNorm)));
  if (low.length > 0) {
    const details = document.createElement("details");
    details.className = "lowconf";
    details.innerHTML = `<summary>${low.length} low-confidence candidate${low.length > 1 ? "s" : ""} (&lt; ${CONFIDENCE_CUTOFF})</summary>`;
    low.forEach((c) => details.append(candidateCard(meeting, c, transcriptNorm)));
    container.append(details);
  }

  $detail.replaceChildren(container);
}

function candidateCard(meeting: Meeting, c: TicketCandidate, transcriptNorm: string): HTMLElement {
  const card = document.createElement("div");
  card.className = "card" + (c.status === "discarded" ? " discarded" : "");

  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <span class="badge ${c.type}">${c.type.replace("_", " ")}</span>
    <input class="title" />
    <span class="conf">${Math.round(c.confidence * 100)}%</span>`;
  const titleInput = row.querySelector("input")!;
  titleInput.value = c.title;
  card.append(row);

  const desc = document.createElement("textarea");
  desc.className = "desc";
  desc.value = c.description;
  card.append(desc);

  if (c.evidence.length > 0) {
    const ev = document.createElement("div");
    ev.className = "evidence";
    c.evidence.forEach((e) => {
      const q = document.createElement("div");
      q.className = "quote";
      const b = document.createElement("b");
      b.textContent = `${e.speaker}: `;
      q.append(b, `“${e.quote}”`);
      // Hallucination guard: flag quotes that don't appear in the transcript
      if (!transcriptNorm.includes(normalize(e.quote))) {
        q.insertAdjacentHTML("beforeend", '<span class="unverified">⚠ not found verbatim in transcript</span>');
      }
      ev.append(q);
    });
    card.append(ev);
  }

  const actions = document.createElement("div");
  actions.className = "actions";

  const save = async (patch: Partial<TicketCandidate>) => {
    const fresh = await getMeeting(meeting.meta.meetingId);
    const target = fresh?.candidates.find((x) => x.id === c.id);
    if (!fresh || !target) throw new Error("candidate disappeared");
    Object.assign(target, patch);
    await saveMeeting(fresh);
    Object.assign(c, patch);
  };

  if (c.status === "created") {
    const link = document.createElement("a");
    link.className = "link";
    link.href = c.linearIssueUrl ?? "#";
    link.target = "_blank";
    link.textContent = `✓ Created ${c.linearIssueIdentifier} in Linear ↗`;
    actions.append(link);
  } else {
    const saveEdits = async () => {
      if (titleInput.value === c.title && desc.value === c.description) return;
      try {
        await save({ title: titleInput.value, description: desc.value });
        toast("Saved");
      } catch (e) {
        toast(errMsg(e), true);
      }
    };
    titleInput.addEventListener("blur", saveEdits);
    desc.addEventListener("blur", saveEdits);

    const approve = document.createElement("button");
    approve.className = "primary";
    approve.textContent = "Approve → Linear";
    approve.onclick = async () => {
      approve.disabled = true;
      approve.textContent = "Creating…";
      try {
        await saveEdits();
        const fresh = await getMeeting(meeting.meta.meetingId);
        const target = fresh?.candidates.find((x) => x.id === c.id);
        if (!fresh || !target) throw new Error("candidate disappeared");
        const issue = await createIssueFromCandidate(target, fresh);
        await save({ status: "created", linearIssueUrl: issue.url, linearIssueIdentifier: issue.identifier });
        toast(`Created ${issue.identifier}`);
      } catch (e) {
        toast(errMsg(e), true);
        approve.disabled = false;
        approve.textContent = "Approve → Linear";
      }
    };

    const discard = document.createElement("button");
    discard.textContent = c.status === "discarded" ? "Restore" : "Discard";
    discard.onclick = async () => {
      try {
        await save({ status: c.status === "discarded" ? "proposed" : "discarded" });
      } catch (e) {
        toast(errMsg(e), true);
      }
    };

    if (c.status !== "discarded") actions.append(approve);
    actions.append(discard);
  }
  card.append(actions);
  return card;
}

// ---------- settings ----------

const $settings = document.getElementById("settings") as HTMLDialogElement;
const $geminiKey = document.getElementById("gemini-key") as HTMLInputElement;
const $linearKey = document.getElementById("linear-key") as HTMLInputElement;
const $teamSelect = document.getElementById("team-select") as HTMLSelectElement;

document.getElementById("open-settings")!.onclick = async () => {
  const s = await getSettings();
  $geminiKey.value = s.geminiApiKey ?? "";
  $linearKey.value = s.linearApiKey ?? "";
  if (s.linearTeamId) {
    $teamSelect.innerHTML = "";
    $teamSelect.append(new Option(s.linearTeamName ?? s.linearTeamId, s.linearTeamId, true, true));
  }
  $settings.showModal();
};

document.getElementById("load-teams")!.onclick = async () => {
  try {
    const key = $linearKey.value.trim();
    if (!key) return toast("Enter the Linear API key first", true);
    const teams = await listTeams(key);
    const selected = $teamSelect.value;
    $teamSelect.innerHTML = "";
    teams.forEach((t) =>
      $teamSelect.append(new Option(`${t.name} (${t.key})`, t.id, false, t.id === selected)),
    );
    toast(`Loaded ${teams.length} team${teams.length === 1 ? "" : "s"}`);
  } catch (e) {
    toast(errMsg(e), true);
  }
};

document.getElementById("save-settings")!.onclick = async () => {
  const previous = await getSettings();
  const linearTeamId = $teamSelect.value || undefined;
  await saveSettings({
    geminiApiKey: $geminiKey.value.trim() || undefined,
    linearApiKey: $linearKey.value.trim() || undefined,
    linearTeamId,
    linearTeamName: $teamSelect.selectedOptions[0]?.textContent ?? undefined,
    // Changing teams invalidates the cached label id
    linearLabelId: linearTeamId === previous.linearTeamId ? previous.linearLabelId : undefined,
  });
  $settings.close();
  toast("Settings saved");
};

document.getElementById("close-settings")!.onclick = () => $settings.close();

// ---------- sample loader ----------

document.getElementById("load-sample")!.onclick = async () => {
  try {
    const res = await fetch(chrome.runtime.getURL("sample-transcript.json"));
    const { meeting: meta, segments } = TranscriptPostSchema.parse(await res.json());
    const record: Meeting = {
      meta: { ...meta, meetingId: `${meta.meetingId}-${Date.now()}` },
      segments,
      candidates: [],
      extractionState: "none",
    };
    await saveMeeting(record);
    await selectMeeting(record.meta.meetingId);
    void runExtraction(record.meta.meetingId);
    toast("Sample loaded — extracting…");
  } catch (e) {
    toast(errMsg(e), true);
  }
};

// ---------- live refresh ----------

let refreshTimer: number | undefined;
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== "local") return;
  // Don't clobber an in-progress edit; blur will trigger a save + re-render.
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void renderMeetingList();
    void renderDetail();
  }, 200);
});

void (async () => {
  await renderMeetingList();
  const meetings = await listMeetings();
  const first = meetings[0];
  if (first) await selectMeeting(first.meta.meetingId);
})();
