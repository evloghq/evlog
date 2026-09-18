---
name: cost-watchdog
description: Weekly review of evlog's model cost and performance. Load this when the cost-watchdog schedule fires, or when Hugo asks for a cost check, a model review, a per-surface model analysis, or a spend/drift report for the gateway.
---

# Cost and model watchdog

A recurring read of how evlog spends its model budget and whether the models in use are still the right ones. Run it weekly, on the last full week. Grounded in the AI Gateway report and the current model landscape, never in your memory of prices.

The core question: for every surface, is the model it runs still a sensible buy? The honest answer is often "yes, no change." A quiet week is a real result.

## What the report gives you

`ai_gateway__report` with `groupBy: 'tag'` returns one row per tag value scoped to the current environment: the `evi:env:*` row (the total) plus one `evi:surface:*` row per surface. Each row carries `total_cost`, `market_cost`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `reasoning_tokens` and `request_count`. `groupBy: 'model'` returns one row per model.

The surface list is whatever `evi:surface:*` rows the report actually returns. Do not assume the set; read it from the data.

## Resources

Open these directly instead of searching; they are the stable home for everything the model-landscape step needs.

- **AI Gateway model catalog, as JSON** (pricing and capabilities for every model in one fetch): `https://ai-gateway.vercel.sh/v1/models`
- **AI Gateway models browser** (human-readable, filter by provider, pricing, latency, throughput): `https://vercel.com/ai-gateway/models`
- **AI Gateway docs, models & providers**: `https://vercel.com/docs/ai-gateway/models-and-providers`
- **Model quality leaderboard** (ex-LMArena, blind A/B human preference Elo): `https://arena.ai/leaderboard`
- **Independent cost-efficiency and benchmarks** (Intelligence Index, Cost per Task, speed): `https://artificialanalysis.ai/`

Use `web_search`/`web_fetch` only for what these do not cover, such as a candidate model's fit for a specific surface. Every figure cited still needs a source and a recency.

## Steps

### 1. Define the window

Run Monday morning. Cover the last 7 full days ending yesterday, and pull the 7 days before that as the comparison window, so every drift figure is period-over-period.

### 2. Pull the numbers

- `ai_gateway__report` for both windows, `groupBy: 'tag'`. That is the spend and token picture per surface and the total.
- `ai_gateway__report` for both windows, `groupBy: 'model'`. The per-model mix (today this is usually one model everywhere).
- For any surface worth a closer look, `ai_gateway__report` scoped to that surface (`tags: ['evi:env:<env>', 'evi:surface:<name>'])` with `groupBy: 'model'` to see what it runs and at what cost.

Use the eval environment tag to keep benchmark and eval traffic out of the production read when the report lets you.

### 3. Research the model landscape

Open the Resources above and pull the current price and quality picture for the models the report shows, and plausible alternatives. Look for:

- Cost per 1M input and output tokens (`/v1/models` gives per-token prices), and whether caching or reasoning tokens change the effective price.
- A quality or benchmark signal for each model in use and each candidate, so a swap is judged on quality and price together, not price alone.
- Whether a cheaper model has reached parity on the kind of work that surface does, or a pricier one is worth it for that surface only. Artificial Analysis' Cost per Task pairs best with the leaderboard for this call.

### 4. Flag drift

Compare the two windows and call out what moved, with a reason where one is visible:

- Total or per-surface cost up or down, as a percent and a dollar figure.
- Model mix change: a model appearing, disappearing, or shifting share.
- Token shape change (input, output, cached, reasoning) that hints at a behavior or prompt drift, not just volume.
- A surface whose cost is out of proportion to its `request_count`.

### 5. Propose per-surface model adjustments

For each surface with nontrivial spend, judge the model it runs against what the report and the landscape research say. Recommend a swap only when there is a real, defensible win in cost, quality/task-fit, or both, with the projected effect. Otherwise state that the surface is fine as is.

One constraint the report does not show: today the agent runs a single model everywhere, set by `EVI_MODEL` in `agent/lib/model.ts` (see `agent/lib/gateway.ts` for tagging). If a per-surface recommendation implies different models per surface, say that routing is currently global and the swap is one of two things: changing the global model, or adding surface-scoped routing as a follow-up decision. Never present a per-surface swap as a one-line config change when routing does not exist yet.

## Deliver

**The full report is a Linear document** on the evlog team, titled `Cost/model watchdog: YYYY-MM-DD`, with markdown sections: spend and model mix per surface, drift, landscape notes with sources, and the per-surface recommendations (or the explicit "nothing to improve").

**The thread get two or three lines**: the single most attention-worthy number or finding, and the document link.

**A material, decision-worthy recommendation becomes a Linear issue** on the evlog team via `linear__save_issue`. Search first (`linear__list_issues`) for a covering issue, including your own from earlier runs; update rather than duplicate. File the strongest one or two, never a report's worth. A model change is Hugo's call, and the issue is where he makes it.

If `linear__save_document` is unavailable or fails, fall back to posting the full report in the thread and say why.

## When nothing is warranted

One line. Spend flat, no drift, and the models in use still the sane choice means the report says so and stops. Never invent a drift or a swap to make the week look busy.
