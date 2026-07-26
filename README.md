# meet2linear

Turns Google Meet calls into Linear tickets, with zero paid services:

1. A Chrome extension scrapes Meet's **free live captions** (speaker-attributed) during the call.
2. When the call ends, the transcript is posted to a **local server**.
3. **Gemini Flash** (free tier) extracts candidate tickets — bugs, feature requests — with verbatim evidence quotes.
4. You review, edit, approve or discard them in a **local web UI**; approved ones are created in **Linear** (free plan API) with a `from-meet` label.

Caption-capture mechanics (selectors, ASR-revision handling, end detection) are adapted from [transcriptonic](https://github.com/vivek-nexus/transcriptonic).

## Layout

- `shared/` — types + Zod schemas used by everything
- `server/` — Hono server: transcript intake, Gemini extraction, Linear creation, review UI (`server/public/`)
- `extension/` — Chrome MV3 extension: caption capture (`content.ts`), delivery + retry (`background.ts`), all Meet DOM selectors in `selectors.ts`

Storage is flat JSON, one file per meeting, in `server/data/` (gitignored).

## Setup

Requires Node ≥ 22 (uses `loadEnvFile`).

```sh
npm install
cp .env.example .env   # then fill in the keys — see comments in the file
npm run dev            # server + review UI at http://localhost:7337
```

To find your `LINEAR_TEAM_ID`: set the two API keys in `.env`, start the server, then
`curl http://localhost:7337/api/config/linear`.

Build and load the extension:

```sh
npm run build:ext
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `extension/dist/`.

## Try it without a meeting

```sh
# Gemini extraction on the bundled fake customer call (needs GEMINI_API_KEY):
npm run extract -- fixtures/sample-transcript.json

# Or drive the whole server path (extraction runs async; watch the UI):
curl -X POST http://localhost:7337/api/transcripts \
  -H 'content-type: application/json' \
  -d @server/fixtures/sample-transcript.json
```

The fixture contains three bugs (one mentioned twice — tests dedup), one feature request, and two red herrings (an issue resolved live on the call, and small talk).

## End-to-end checklist

1. `npm run dev` — startup line shows ✓ for gemini key, linear key, and team.
2. Extension built and loaded unpacked; server running.
3. Start a Meet with yourself (meet.google.com → New meeting), **allow the "capturing captions" banner to appear** (the extension auto-enables CC; if it can't find the button it tells you to enable CC manually).
4. Say a few scripted sentences aloud, e.g. "The CSV export is broken, the header row is missing" — watch caption text appear.
5. Leave the call. The extension posts the transcript; extraction starts automatically.
6. Open http://localhost:7337 — the meeting appears; candidates show up when extraction finishes (a few seconds).
7. Edit a title if you like, click **Approve → Linear**, follow the issue link.

## Notes & limitations

- **Captions must be on** — the extension auto-clicks CC, and warns on-page if it can't.
- **Meet DOM churn** is the main fragility. Everything selector-ish is in `extension/src/selectors.ts`, favoring ARIA attributes and icon-ligature names over class names. If capture silently stops, start there (the health monitor shows an on-page banner when the caption region disappears).
- Evidence quotes the model didn't copy verbatim from the transcript are flagged ⚠ in the UI (hallucination guard).
- Re-extraction (button in the UI) replaces only `proposed` candidates; approved/discarded ones are kept.
- If the server is down at call end, the transcript is kept in `chrome.storage.local` and re-sent on next browser start.
- Free-tier limits are a non-issue at this volume: one Gemini call per meeting; Linear calls only on approve.
