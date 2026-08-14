# meet2linear — demo script (short)

~220 words, ~90 seconds narration. The remaining time in your 3–5 min video is
the demo itself — clicks, page loads, the Meet call — which naturally runs
longer than the narration alone. Bracketed lines are visual cues, not spoken.

---

**[0:00–0:20 · Problem]**

Transcripts aren't the problem anymore — every call gets recorded and
summarized. The gap is everything after: someone still has to reread it, work
out what's actually a bug versus chatter, and write each ticket by hand. On a
long call that's tedious enough to get deferred — and then dropped.

**[0:20–0:35 · What I built]**

So I built **meet2linear** — a Chrome extension that listens to Google Meet's
live captions and turns what a customer says into Linear tickets, quotes
attached. No server, runs entirely on free tiers.

**[0:35–1:15 · Demo]**

[Chrome toolbar / settings, then open Meet]

Once the extension is loaded in Chrome and I've pasted in my Gemini and Linear
keys, that's the whole setup.

I open up Google Meet, and it turns on captions for me automatically — there's
the banner. From here it's transcribing the call as people talk, tagged by
speaker. No bot joins, nothing leaves my machine yet.

[say the scripted lines, then leave the call]

Then I just leave the call — that's the trigger, no button to press. Gemini
reads the transcript and proposes tickets: title, description, confidence, and
the exact quotes each one is based on.

[Review page]

And there are the tickets. It only pulled out what was actually actionable and
left the rest of the call alone. That judgment — deciding what's worth a ticket
— is the real value here, not the transcription.

[Click Approve → Linear tab]

I approve, and it creates the issue in Linear with the quotes in the body.

**[1:15–1:50 · How I built it with AI]**

I built this with Claude Code, starting with the outcome and the constraints,
not code: pull what's actionable out of a call, file it in Linear, no server,
nothing paid, I approve everything. That got me working fast.

The rest was steering it — telling it to go check instead of guess, pushing back
when it sounded sure and wasn't.

Getting it working was the quick part. Getting to where I'd actually let it file
tickets for me took a lot longer. Everything the model returns gets validated,
and every quote gets checked against the transcript before I see it.

The other thing I'd call out is testing. I had it write me a fake customer call
where I already knew the answers, so I could change the prompt and see the
result in seconds instead of booking a meeting each time.

[click the transcript toggle]

And I kept the whole transcript in here. A bad ticket I'll catch — it's right in
front of me. A ticket that never got created, I'd never know about. This is how
I check.

So that's the workflow end to end. The call ends, the tickets are already
drafted with the quotes behind them, and my job is to review and approve — about
a minute of work instead of twenty. The decision stays with me; what's gone is
the manual write-up.

I'm happy to go deeper on any part of it when we talk.

---

## Lines to say on the Meet call

> "The CSV export is broken. The header row is missing.
>
> Also, can we get reports emailed out automatically every Monday? Right now we
> send them by hand.
>
> Oh — can you raise our session timeout? … You'll just bump it after the call?
> Perfect.
>
> Nice. Did you guys move offices?
>
> One more on the CSV thing — it started after the last release."

## If you have extra time, add one of these

- **Reliability** (~15s): Meet's DOM is the fragile part — selectors live in one
  file, and a health monitor banners the page if captions stop being captured.
- **Cost** (~10s): one Gemini call per meeting, Linear calls only on approve —
  free tiers, no ongoing cost.
