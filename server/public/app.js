const $meetings = document.getElementById("meetings");
const $detail = document.getElementById("detail");
const $toast = document.getElementById("toast");

let activeMeetingId = null;
let pollTimer = null;

const CONFIDENCE_CUTOFF = 0.5;

function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = isError ? "error" : "";
  $toast.style.display = "block";
  setTimeout(() => ($toast.style.display = "none"), isError ? 6000 : 2500);
}

async function api(path, opts) {
  const res = await fetch(path, opts && { headers: { "content-type": "application/json" }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ? JSON.stringify(body.error) : `${res.status}`);
  return body;
}

// ---------- meeting list ----------

async function loadMeetings() {
  const meetings = await api("/api/meetings");
  $meetings.replaceChildren(
    ...meetings.map((m) => {
      const el = document.createElement("div");
      el.className = "meeting" + (m.meta.meetingId === activeMeetingId ? " active" : "");
      const date = (m.meta.startedAt || "").slice(0, 10);
      el.innerHTML = `
        <div class="title"></div>
        <div class="info">${date} · ${m.segmentCount} segments · ${m.candidateCount} candidates</div>`;
      el.querySelector(".title").textContent = m.meta.title || m.meta.meetingId;
      el.onclick = () => selectMeeting(m.meta.meetingId);
      return el;
    }),
  );
  if (meetings.length === 0) $meetings.innerHTML = '<div class="empty">No meetings yet</div>';
}

async function selectMeeting(id) {
  activeMeetingId = id;
  await Promise.all([loadMeetings(), renderDetail()]);
}

// ---------- detail / candidates ----------

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function renderDetail() {
  clearTimeout(pollTimer);
  if (!activeMeetingId) return;
  const meeting = await api(`/api/meetings/${activeMeetingId}`);
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
    <span class="state ${meeting.extractionState === "error" ? "error" : ""}">${stateText ?? ""}</span>
    <button id="reextract">Re-extract</button>`;
  toolbar.querySelector("h2").textContent = meeting.meta.title || meeting.meta.meetingId;
  toolbar.querySelector("#reextract").onclick = async () => {
    try {
      await api(`/api/meetings/${activeMeetingId}/extract`, { method: "POST", body: "{}" });
      toast("Extraction started");
      pollTimer = setTimeout(renderDetail, 1500);
    } catch (e) {
      toast(e.message, true);
    }
  };
  container.append(toolbar);

  const high = meeting.candidates.filter((c) => c.confidence >= CONFIDENCE_CUTOFF);
  const low = meeting.candidates.filter((c) => c.confidence < CONFIDENCE_CUTOFF);

  if (meeting.candidates.length === 0 && meeting.extractionState === "done") {
    container.insertAdjacentHTML("beforeend", '<div class="empty">No ticket candidates found in this call</div>');
  }
  high.forEach((c) => container.append(candidateCard(c, transcriptNorm)));
  if (low.length > 0) {
    const details = document.createElement("details");
    details.className = "lowconf";
    details.innerHTML = `<summary>${low.length} low-confidence candidate${low.length > 1 ? "s" : ""} (&lt; ${CONFIDENCE_CUTOFF})</summary>`;
    low.forEach((c) => details.append(candidateCard(c, transcriptNorm)));
    container.append(details);
  }

  $detail.replaceChildren(container);
  if (meeting.extractionState === "running") pollTimer = setTimeout(renderDetail, 1500);
}

function candidateCard(c, transcriptNorm) {
  const card = document.createElement("div");
  card.className = "card" + (c.status === "discarded" ? " discarded" : "");

  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <span class="badge ${c.type}">${c.type.replace("_", " ")}</span>
    <input class="title" />
    <span class="conf">${Math.round(c.confidence * 100)}%</span>`;
  const titleInput = row.querySelector("input");
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
  const patch = (body) =>
    api(`/api/candidates/${c.id}`, { method: "PATCH", body: JSON.stringify(body) });

  if (c.status === "created") {
    const link = document.createElement("a");
    link.className = "link";
    link.href = c.linearIssueUrl;
    link.target = "_blank";
    link.textContent = `✓ Created ${c.linearIssueIdentifier} in Linear ↗`;
    actions.append(link);
  } else {
    const saveEdits = async () => {
      if (titleInput.value === c.title && desc.value === c.description) return;
      try {
        await patch({ title: titleInput.value, description: desc.value });
        c.title = titleInput.value;
        c.description = desc.value;
        toast("Saved");
      } catch (e) {
        toast(e.message, true);
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
        const updated = await api(`/api/candidates/${c.id}/approve`, { method: "POST", body: "{}" });
        toast(`Created ${updated.linearIssueIdentifier}`);
        await renderDetail();
      } catch (e) {
        toast(e.message, true);
        approve.disabled = false;
        approve.textContent = "Approve → Linear";
      }
    };

    const discard = document.createElement("button");
    discard.textContent = c.status === "discarded" ? "Restore" : "Discard";
    discard.onclick = async () => {
      try {
        await patch({ status: c.status === "discarded" ? "proposed" : "discarded" });
        await renderDetail();
      } catch (e) {
        toast(e.message, true);
      }
    };

    if (c.status !== "discarded") actions.append(approve);
    actions.append(discard);
  }
  card.append(actions);
  return card;
}

loadMeetings().then(async () => {
  const meetings = await api("/api/meetings");
  if (meetings.length > 0) selectMeeting(meetings[0].meta.meetingId);
});
setInterval(loadMeetings, 10_000);
