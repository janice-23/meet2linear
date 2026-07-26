# meet2linear

Turns Google Meet calls into Linear tickets — **entirely inside a Chrome extension**, no server, no paid services:

1. A content script scrapes Meet's **free live captions** (speaker-attributed) during the call.
2. When the call ends, the transcript lands in `chrome.storage` and **Gemini Flash** (free-tier API key) extracts candidate tickets — bugs, feature requests — with verbatim evidence quotes.
3. Click the toolbar icon to open the **review page**: edit, approve or discard candidates; approved ones are created in **Linear** (free-plan GraphQL API) with a `from-meet` label.

Node is needed only to *build* the extension; nothing runs outside the browser. Gemini and Linear are called directly from extension contexts (raw REST/GraphQL — no SDKs bundled).

Caption-capture mechanics (selectors, ASR-revision handling, end detection) are adapted from [transcriptonic](https://github.com/vivek-nexus/transcriptonic).

## Layout

- `shared/` — types + Zod schemas
- `extension/src/`
  - `content.ts` — caption capture on meet.google.com; `selectors.ts` holds every Meet DOM selector (the churn blast-radius)
  - `background.ts` — service worker: single writer of meeting records, auto-runs extraction at meeting end
  - `store.ts` — chrome.storage-backed meetings + settings
  - `extraction.ts` / `prompt.ts` — Gemini structured-output extraction (`gemini-flash-latest`)
  - `linear.ts` — raw GraphQL: teams, label bootstrap, issue creation
  - `review/` — the review page (toolbar icon opens it)

## Setup

```sh
npm install
npm run build          # or: npm run watch
```

Chrome → `chrome://extensions` → enable Developer mode → **Load unpacked** → select `extension/dist/`.

Then click the extension's toolbar icon → **⚙ Settings**:

1. Paste a Gemini API key ([free from Google AI Studio](https://aistudio.google.com/apikey)).
2. Paste a Linear personal API key (Linear → Settings → Security & Access; free plan works).
3. Click **Load teams** and pick the team issues should go to.

Keys live in `chrome.storage.local` on your machine.

## Try it without a meeting

On the review page, click **Load sample call** — it imports a bundled fake customer call and runs extraction. The fixture contains three bugs (one mentioned twice — tests dedup), one feature request, and two red herrings (an issue resolved live on the call, and small talk). Approve one to verify Linear creation end-to-end.

## End-to-end checklist

1. Extension built, loaded unpacked, keys + team set in Settings.
2. Start a Meet with yourself (meet.google.com → New meeting); wait for the "capturing captions" banner (the extension auto-enables CC; if it can't find the button it tells you to enable CC manually).
3. Say a few scripted sentences aloud, e.g. "The CSV export is broken, the header row is missing" — captions should appear as you speak.
4. Leave the call — extraction runs automatically.
5. Click the toolbar icon: the meeting is listed, candidates appear within seconds.
6. Edit a title if you like, **Approve → Linear**, follow the issue link.

## Notes & limitations

- **Captions must be on** — the extension auto-clicks CC and warns on-page if it can't.
- **Meet DOM churn** is the main fragility. All selectors are in `extension/src/selectors.ts`, favoring ARIA attributes and icon-ligature names over class names. If capture silently stops, start there (a health monitor shows an on-page banner when the caption region disappears).
- Evidence quotes the model didn't copy verbatim are flagged ⚠ in the review UI (hallucination guard).
- Re-extraction replaces only `proposed` candidates; approved/discarded ones are kept.
- The service worker is the sole writer of meeting records; the review page updates live via `storage.onChanged`.
- Free-tier limits are a non-issue at this volume: one Gemini call per meeting; Linear calls only on approve.
- History: `git log` has an earlier iteration where extraction/Linear ran on a local Node server instead of in the extension.
