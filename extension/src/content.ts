// Caption capture for Google Meet.
//
// Strategy: mutations on the caption region are treated only as a SIGNAL that
// something changed — we never interpret individual mutation records. On every
// batch we re-read the rendered state of each caption block from the DOM and
// diff it against what we last saw. This survives all of Meet's update modes
// (in-place characterData edits, node replacement, block trimming), which a
// per-mutation approach does not. Selector strategy adapted from
// transcriptonic (https://github.com/vivek-nexus/transcriptonic).
import type { MeetingMeta, TranscriptSegment } from "@meet2linear/shared";
import type { ExtensionMessage } from "./messages.js";
import { CAPTION_REGION, ICONS, OWN_NAME, captionRegion, findIcon, iconButton } from "./selectors.js";

const HEALTH_INTERVAL_MS = 2_000;
// Meet trims the front of a very long caption block; a sudden large length
// drop distinguishes that from an ordinary recognition revision.
const ROLLOVER_DROP_CHARS = 250;

const log = (...args: unknown[]) => console.log("[meet2linear]", ...args);

// ---------- state ----------

let meta: MeetingMeta | null = null;
const segments: TranscriptSegment[] = [];
let ownName: string | null = null;
let ended = false;

// One entry per on-screen caption block, keyed by its DOM element. Entries are
// updated in place while visible and finalized into `segments` when the block
// leaves the DOM (or the meeting ends).
interface BlockEntry {
  speaker: string;
  text: string;
  startedAt: string;
}
const blocks = new Map<Element, BlockEntry>();

let observer: MutationObserver | null = null;
let observedRegion: HTMLElement | null = null;
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

/** Finalized segments plus a snapshot of still-visible blocks, so the stored
 *  transcript is complete even if the tab dies before blocks finalize. */
function liveSegments(): TranscriptSegment[] {
  const open: TranscriptSegment[] = [];
  for (const entry of blocks.values()) {
    const text = entry.text.trim();
    if (!text || text === entry.speaker.trim()) continue;
    open.push({ speaker: normalizeSpeaker(entry.speaker), text, timestamp: entry.startedAt });
  }
  return [...segments, ...open];
}

// Trailing-edge throttle: push the transcript to the service worker shortly
// after a burst of caption activity settles.
function scheduleUpdate(): void {
  if (!meta || ended) return;
  clearTimeout(updateTimer);
  updateTimer = window.setTimeout(() => {
    if (meta && !ended) send({ type: "transcript_update", meta, segments: liveSegments() });
  }, 2000);
}

// ---------- caption block discovery & reading ----------

/** First element in document order with no element children and some text —
 *  within a caption block this is the speaker-name leaf. */
function firstLeafWithText(root: Element): Element | null {
  if (root.childElementCount === 0) return root.textContent?.trim() ? root : null;
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (el.childElementCount === 0 && el.textContent?.trim()) return el;
  }
  return null;
}

/** Caption blocks, structurally: each block is anchored by the speaker's
 *  avatar <img>; the block root is the smallest ancestor that carries text
 *  (name + speech). Falls back to unwrapping single-child wrappers if Meet
 *  ever drops the avatars. */
function findBlocks(region: HTMLElement): Element[] {
  const found: Element[] = [];
  for (const img of region.querySelectorAll("img")) {
    let el: Element | null = img.parentElement;
    while (el && el !== region && !el.textContent?.trim()) el = el.parentElement;
    if (el && el !== region && !found.includes(el)) found.push(el);
  }
  if (found.length > 0) return found;
  let root: Element = region;
  while (root.childElementCount === 1) root = root.children[0]!;
  return Array.from(root.children).filter((c) => c.textContent?.trim());
}

/** Split a block's rendered text into speaker name and spoken text. Returns
 *  null while the block only shows a name (nothing spoken yet). */
function readBlock(block: Element): { speaker: string; text: string } | null {
  const full = block.textContent?.trim() ?? "";
  if (!full) return null;
  const name = firstLeafWithText(block)?.textContent?.trim() ?? "";
  let text = full;
  if (name && full.startsWith(name)) text = full.slice(name.length).trim();
  if (!text) return null;
  return { speaker: name, text };
}

// ---------- transcript assembly ----------

function finalize(entry: BlockEntry): void {
  const text = entry.text.trim();
  const speaker = normalizeSpeaker(entry.speaker);
  if (!text || text === entry.speaker.trim()) return; // name-only artifact
  const last = segments[segments.length - 1];
  if (last && last.speaker === speaker && text.startsWith(last.text)) {
    last.text = text; // extended version of what we already recorded
  } else if (last && last.speaker === speaker && last.text.includes(text)) {
    // shrunken duplicate of something already recorded; drop
  } else {
    segments.push({ speaker, text, timestamp: entry.startedAt });
    log(`segment #${segments.length} ${speaker}: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`);
  }
  scheduleUpdate();
}

function finalizeAll(): void {
  for (const [el, entry] of blocks) {
    finalize(entry);
    blocks.delete(el);
  }
}

function processRegion(region: HTMLElement): void {
  for (const block of findBlocks(region)) {
    const read = readBlock(block);
    if (!read) continue;
    const entry = blocks.get(block);
    if (!entry) {
      blocks.set(block, { ...read, startedAt: new Date().toISOString() });
    } else {
      if (entry.text.length - read.text.length > ROLLOVER_DROP_CHARS) {
        // Meet trimmed the block; bank the long version before overwriting
        finalize(entry);
        entry.startedAt = new Date().toISOString();
      }
      entry.text = read.text;
      if (read.speaker) entry.speaker = read.speaker;
    }
  }
  // Blocks Meet removed from the DOM are done — bank them in order
  for (const [el, entry] of blocks) {
    if (!el.isConnected) {
      finalize(entry);
      blocks.delete(el);
    }
  }
  scheduleUpdate();
}

/** (Re)attach the observer; Meet sometimes replaces the caption region element
 *  (e.g. CC toggled off/on), which silently kills an old observer. */
function ensureObserver(): void {
  const region = captionRegion();
  if (!region || region === observedRegion || ended) return;
  observer?.disconnect();
  observer = new MutationObserver(() => processRegion(region));
  observer.observe(region, { childList: true, subtree: true, characterData: true });
  observedRegion = region;
  processRegion(region);
  log("observing caption region");
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
  log("meeting ended:", reason);
  observer?.disconnect();
  clearInterval(healthTimer);
  clearTimeout(updateTimer);
  finalizeAll();
  ended = true;
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
    ensureObserver();
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

  // Console debugging aid: __meet2linear.segments() shows the live transcript
  (window as unknown as Record<string, unknown>).__meet2linear = { segments: liveSegments };

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

  ensureObserver();
  banner("capturing captions");

  // End detection: leave-button click + health monitor + page unload
  iconButton(ICONS.leaveCall)?.addEventListener("click", () =>
    setTimeout(() => endMeeting("leave button clicked"), 300),
  );
  startHealthMonitor();
  window.addEventListener("beforeunload", () => endMeeting("page unloaded"));
}

void main();
