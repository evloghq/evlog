---
name: daily-digest
description: Build and deliver the daily activity digest, covering GitHub activity, AI Gateway spend, visitor counts, CLI usage, and a short news section. Load this when the morning digest schedule fires, or when someone asks for a digest, a daily recap, or "what happened" over a recent period, on any channel.
---

# Daily digest

A summary of the last 24 hours, most attention-worthy first. Gathering is read-only; the only write is the Linear document below.

**Delivery: a Linear document, not a chat wall.** Chat renders a multi-section report badly; Linear renders it well and keeps the history browsable. On the scheduled run (and whenever Hugo asks for "the digest"):

1. Write the full digest as a Linear document via `linear__save_document`, on the evlog team, titled `Daily digest — YYYY-MM-DD`, with real markdown headings per section.
2. Post to the thread only: one or two lines with the single most attention-worthy item, then the document link.

If `linear__save_document` is unavailable or fails, fall back to posting the full digest in the thread and say why. An ad-hoc question in conversation ("what happened this week?") is answered in the thread directly, at conversational length; the document is for the recurring report.

When the request names a different window ("this week", "since Monday"), keep the structure and widen the window; the 24-hour default is for the scheduled morning run.

## Sections, in order

1. **GitHub (last 24h).** New and updated issues, merged and open pull requests, CI state on `main` (`getCiFailureContext` when red). Lead with whatever needs attention: a red build, a stalled community PR, an issue with activity. Skip empty categories with one word, never with an apology.
2. **AI Gateway spend (last 24h).** `ai_gateway__report` totals, with a one-line callout only when spend is unusual against recent days.
3. **Visitors (last 24h).** `vercel__call_vercel_endpoint` on `GET /v1/query/web-analytics/visits/count`, one call per project (`projectId`, `since`, `until`), for the docs site and the other evlog projects.
4. **CLI usage (last 7d).** `telemetry-stats` and `telemetry-adoption`: runs, success rate, top command, and one interesting signal when there is one, such as a CLI version rolling out, a flag gaining traction, an error code creeping up, or a source-mix shift. One or two lines; one word when the numbers are flat.
5. **Worth reading.** 2 or 3 short items of AI or ecosystem news worth Hugo's time today, each with a link and a date.

## Form

- At most 10 lines for the GitHub section; the whole digest stays scannable in one screen.
- Plain sentences and short bullets. Links inline. No preamble, no sign-off.
- A section whose tools are unavailable is reported in one line naming the failing tool, and the rest of the digest still ships.
