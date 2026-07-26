// Caption capture for Google Meet. Core mechanics (selectors, in-place ASR
// revision handling, flush heuristics, end detection) adapted from
// transcriptonic (https://github.com/vivek-nexus/transcriptonic), MIT.
import type { MeetingMeta, TranscriptSegment } from "@meet2linear/shared";
import type { ExtensionMessage } from "./messages.js";
import { CAPTION_REGION, ICONS, OWN_NAME, captionRegion, findIcon, iconButton } from "./selectors.js";

const HEALTH_INTERVAL_MS = 2_000;
// Meet replaces a long caption block with a fresh short one when it rolls
// over; a sudden large text-length drop distinguishes that from a revision.
const ROLLOVER_DROP_CHARS = 250;

const log = (...args: unknown[]) => console.log("[meet2linear]", ...args);

// ---------- state ----------

let meta: MeetingMeta | null = null;
const segments: TranscriptSegment[] = [];
let ownName: string | null = null;
let ended = false;

interface CurrentBlock {
  speaker: string;
  text: string;
  el: Element;
  startedAt: string;
}
let current: CurrentBlock | null = null;

let observer: MutationObserver | null = null;
let healthTimer: number | undefined;
let updateTimer: number | undefined;

// ---------- helpers ----------

function waitFor<T>(probe: () => T | null, intervalMs = 500, timeoutMs = 60 * 60_000): Promise<T | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const value = probe();
      if (value) return resolve(value);
      if (Date.now() - startedAt > timeoutMs) return resolve(null);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function banner(message: string): void {
  const el = document.createElement("div");
  el.textContent = `meet2linear: ${message}`;
  el.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;" +
    "background:#1e2230;color:#e6e9f0;border:1px solid #5e6ad2;border-radius:8px;" +
    "padding:8px 16px;font:13px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)";
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
}

function normalizeSpeaker(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Unknown";
  if (trimmed === "You" && ownName) return ownName;
  return trimmed;
}

function send(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message).catch((err) => log("sendMessage failed", err));
}

// Trailing-edge throttle: push the transcript to the service worker shortly
// after a burst of flushes settles, so storage always has a near-live copy.
function scheduleUpdate(): void {
  if (!meta || ended) return;
  clearTimeout(updateTimer);
  updateTimer = window.setTimeout(() => {
    if (meta && !ended) send({ type: "transcript_update", meta, segments });
  }, 2000);
}

// ---------- transcript buffering ----------

function flush(): void {
  if (!current || !current.text.trim()) {
    current = null;
    return;
  }
  const last = segments[segments.length - 1];
  // Guard against duplicate flushes of the same block
  if (!(last && last.speaker === normalizeSpeaker(current.speaker) && last.text === current.text.trim())) {
    segments.push({
      speaker: normalizeSpeaker(current.speaker),
      text: current.text.trim(),
      timestamp: current.startedAt,
    });
    scheduleUpdate();
  }
  current = null;
}

function updateBuffer(speaker: string, el: Element, text: string): void {
  if (!text.trim()) return;
  if (current && (current.el !== el || (speaker.trim() && speaker.trim() !== current.speaker))) {
    flush(); // new caption block or new speaker turn
  } else if (current && current.text.length - text.length > ROLLOVER_DROP_CHARS) {
    flush(); // Meet rolled the block over; don't lose the long buffer
  }
  if (!current) {
    current = { speaker: speaker.trim(), text, el, startedAt: new Date().toISOString() };
  } else {
    current.text = text; // in-place ASR revision: latest text wins
    if (!current.speaker && speaker.trim()) current.speaker = speaker.trim();
  }
}

function handleMutations(mutations: MutationRecord[]): void {
  for (const m of mutations) {
    if (m.type !== "characterData") continue;
    const textEl = m.target.parentElement;
    if (!textEl) continue;
    const text = m.target.textContent ?? "";
    // Speaker name renders in the sibling preceding the caption text container
    // (transcriptonic's heuristic); try one level up as a fallback.
    const speaker =
      textEl.previousSibling?.textContent ??
      textEl.parentElement?.previousSibling?.textContent ??
      "";
    updateBuffer(speaker, textEl, text);
  }
}

// ---------- lifecycle ----------

async function enableCaptions(): Promise<void> {
  if (findIcon(ICONS.captionsOn)) return; // already on
  const button = iconButton(ICONS.captionsOff);
  if (button) {
    button.click();
    log("enabled captions");
  } else {
    banner("couldn't find the captions button — turn on captions (CC) manually");
  }
}

function endMeeting(reason: string): void {
  if (ended || !meta) return;
  ended = true;
  log("meeting ended:", reason);
  observer?.disconnect();
  clearInterval(healthTimer);
  clearTimeout(updateTimer);
  flush();
  meta.endedAt = new Date().toISOString();
  send({ type: "meeting_ended", meta, segments });
}

function startHealthMonitor(): void {
  let missing = 0;
  healthTimer = window.setInterval(() => {
    if (ended) return;
    if (!findIcon(ICONS.leaveCall)) {
      endMeeting("call controls disappeared (left call or removed)");
      return;
    }
    if (!captionRegion()) {
      missing++;
      if (missing === 5) {
        banner(`caption region (${CAPTION_REGION}) not found — captions off or Meet changed its DOM`);
        log("caption region missing for 10s");
      }
    } else {
      missing = 0;
    }
  }, HEALTH_INTERVAL_MS);
}

async function main(): Promise<void> {
  // Only run on actual meeting pages, e.g. https://meet.google.com/abc-defg-hij
  const code = location.pathname.slice(1);
  if (!/^[a-z]{3,}-[a-z]{3,}-[a-z]{3,}$/i.test(code)) return;

  log("waiting to join meeting", code);
  const joined = await waitFor(() => findIcon(ICONS.leaveCall));
  if (!joined || ended) return;

  meta = {
    meetingId: `${code}-${Date.now()}`,
    title: document.title.replace(/^Meet[-–—\s]*/, "").trim() || code,
    startedAt: new Date().toISOString(),
  };
  log("joined; capturing as", meta.meetingId);

  // Best-effort own-name capture, for normalizing the "You" speaker label
  const nameInterval = setInterval(() => {
    const el = document.querySelector(OWN_NAME);
    if (el?.textContent?.trim()) {
      ownName = el.textContent.trim();
      clearInterval(nameInterval);
    }
  }, 100);
  setTimeout(() => clearInterval(nameInterval), 30_000);

  await enableCaptions();
  const region = await waitFor(captionRegion, 500, 30_000);
  if (!region) {
    banner("captions never appeared — nothing will be captured");
    return;
  }

  observer = new MutationObserver(handleMutations);
  observer.observe(region, { childList: true, subtree: true, characterData: true });
  banner("capturing captions");

  // End detection: leave-button click + health monitor + page unload
  iconButton(ICONS.leaveCall)?.addEventListener("click", () =>
    setTimeout(() => endMeeting("leave button clicked"), 300),
  );
  startHealthMonitor();
  window.addEventListener("beforeunload", () => endMeeting("page unloaded"));
}

void main();
