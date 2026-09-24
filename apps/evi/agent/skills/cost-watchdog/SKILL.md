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
- **Independent cost-efficiency and benchmarks** (Intelligence Index, cost per task, tokens per task, time per task, per-benchmark scores): `https://artificialanalysis.ai/`. Head-to-head pages live at `https://artificialanalysis.ai/models/comparisons/<a>-vs-<b>`, using AA slugs (`glm-5-3-flash`, `gpt-6-luna-medium`).

Use `web_search`/`web_fetch` only for what these do not cover, such as a candidate model's fit for a specific surface. Every figure cited still needs a source and a recency, and a benchmark figure comes from Artificial Analysis or the leaderboard directly, never from a blog or aggregator quoting them.

## Steps

### 1. Define the window

Run Monday morning. Cover the last 7 full days ending yesterday, and pull the 7 days before that as the comparison window, so every drift figure is period-over-period.

### 2. Pull the numbers

- `ai_gateway__report` for both windows, `groupBy: 'tag'`. That is the spend and token picture per surface and the total.
- `ai_gateway__report` for both windows, `groupBy: 'model'`. The per-model mix (today this is usually one model everywhere).
- For any surface worth a closer look, `ai_gateway__report` scoped to that surface (`tags: ['evi:env:<env>', 'evi:surface:<name>'])` with `groupBy: 'model'` to see what it runs and at what cost.

Use the eval environment tag to keep benchmark and eval traffic out of the production read when the report lets you.

### 3. Build the candidate set

Derive it from the catalog every run; do not pick alternatives from memory. From `/v1/models`, keep every model tagged both `tool-use` and `reasoning` that takes image input (the base model reads images natively, see `docs/vision.md`), and whose input and output prices are each within 3x of the current model's. Then add the top three of that set by Artificial Analysis cost per task. List the full candidate set in the report, with the reason each one was dropped.

### 4. Compare candidates

Score the current model and every surviving candidate on the same four axes, in one table:

- **Agentic quality.** Terminal-Bench, AutomationBench, tau-bench and the hallucination rate, the benchmarks closest to what Evi's surfaces do. The headline Intelligence Index is context, not the verdict.
- **Cost per task.** Artificial Analysis cost per task and output tokens per task. Two models at the same per-token price can differ tenfold per task, and a model that spends fewer tokens is cheaper even when it is less capable.
- **Speed.** Time per task and output tokens per second. This matters most on interactive surfaces (slack, photon), where a person is waiting.
- **Projected cost on Evi's real traffic.** Reprice last week's token mix from the report (uncached input, cached input, output, reasoning) at the candidate's catalog rates, including cache-write pricing when the candidate has one. The advertised price is a floor: `gatewayRouting` sends `zeroDataRetention`, which can drop the cheapest deployments, so the price Evi pays for the current model comes from a call's `provider_metadata.gateway`, not from the catalog.

Where quality and cost disagree, also compute cost per solved task (cost per task divided by score) on the benchmark closest to the surface.

Never discard a candidate for being less capable alone. A model that is materially cheaper or faster and trails on quality is a tradeoff to report, not a non-starter.

### 5. Flag drift

Compare the two windows and call out what moved, with a reason where one is visible:

- Total or per-surface cost up or down, as a percent and a dollar figure.
- Model mix change: a model appearing, disappearing, or shifting share.
- Token shape change (input, output, cached, reasoning) that hints at a behavior or prompt drift, not just volume.
- A surface whose cost is out of proportion to its `request_count`.

### 6. Propose per-surface model adjustments

For each surface with nontrivial spend, give each candidate one of three verdicts, with the projected weekly cost and speed effect:

- **Swap.** It wins on cost or speed and does not trail on agentic quality, or it wins on quality at a cost the spend justifies.
- **Run evals.** It wins clearly on cost or speed but trails on quality, or the published numbers disagree. Benchmarks cannot settle this; Evi's own suite can. Recommend a manual run of the `evi-evals` workflow with the `model` input set to the candidate's gateway id, then a comparison of cost, latency and pass rate in PostHog (`evi_eval_run`, broken down by `model`).
- **Keep.** It loses on the axes that matter for that surface. Say which ones.

A candidate listed under Settled decisions below gets its line in the table and the recorded reason, and is not recommended again unless its price or benchmarks have moved since the decision.

One constraint the report does not show: today the agent runs a single model everywhere, set by `EVI_MODEL` in `agent/lib/model.ts` (see `agent/lib/gateway.ts` for tagging). If a per-surface recommendation implies different models per surface, say that routing is currently global and the swap is one of two things: changing the global model, or adding surface-scoped routing as a follow-up decision. Never present a per-surface swap as a one-line config change when routing does not exist yet.

## Deliver

**The full report is a Linear document** on the evlog team, titled `Cost/model watchdog: YYYY-MM-DD`, with markdown sections: spend and model mix per surface, drift, the candidate set and comparison table with sources, and the per-surface recommendations (or the explicit "nothing to improve").

**The thread get two or three lines**: the single most attention-worthy number or finding, and the document link.

**A material, decision-worthy recommendation becomes a Linear issue** on the evlog team via `linear__save_issue`. Search first (`linear__list_issues`) for a covering issue, including your own from earlier runs; update rather than duplicate. File the strongest one or two, never a report's worth. A model change is Hugo's call, and the issue is where he makes it.

If `linear__save_document` is unavailable or fails, fall back to posting the full report in the thread and say why.

## When nothing is warranted

One line. Spend flat, no drift, and the models in use still the sane choice means the report says so and stops. Never invent a drift or a swap to make the week look busy.

## Settled decisions

- **`openai/gpt-6-luna` (medium), decided 2026-09-24: keep `zai/glm-5.3-flash`.** Luna is cheaper per task and much faster, but trails badly on agentic work (Terminal-Bench 4.0 at 2.5% against 32.8%) and hallucinates far more (85% against 28%). Revisit if a new Luna release closes the agentic gap.
