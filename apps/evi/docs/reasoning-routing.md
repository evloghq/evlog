# Reasoning routing

Evi runs one model everywhere, `zai/glm-5.3-flash` unless `EVI_MODEL` says
otherwise, and until eve 0.63 it ran it at `reasoning: 'high'` on every turn: a
Slack "thanks" thought as hard as a code review. Since eve 0.60 a dynamic model
selection may carry a `reasoning` override, so the effort is now chosen per
turn (EVL-429).

## How a turn is routed

`agent/agent.ts` adds a `step.started` handler to the existing dynamic model.
On the first step of a turn it hands the last eight user and assistant messages
(16k characters at most, the latest message truncated rather than refused) to
`evaluate` from `eve/ai`, which defaults to `typesafe-ai/jev` through the
gateway, and asks one `choice` question: `low`, `medium` or `high`, each
described in `agent/lib/reasoning-routing.ts`. The answer is remembered for the
rest of the turn, so a five-tool turn asks once and does not change its mind
between steps. The selection returned is `{ model: MODEL, reasoning, modelOptions }`,
with the same `gatewayRouting` and tags as before plus one more tag,
`evi:reasoning:<decision>`.

It is not eve's `auto()`. `auto` returns only a model and an optional
reasoning, and eve rejects sibling `modelOptions` next to a dynamic model, so
using it would silently drop prompt caching, the TTFT/cost sort, zero data
retention and the spend tags. It also throws on a latest message over 16k
characters and has no fallback. The handler here keeps the pattern and fixes
those three things.

## Fail open

Routing is an optimisation and is never the reason a turn failed. If there is
no user text to judge, the evaluator errors, or it answers outside the three
tiers, the turn runs at the authored `high` and is tagged
`evi:reasoning:fallback`, and that fallback is remembered for the turn. The one
exception is a cancelled turn, whose abort is propagated. `EVI_MODEL` set
disables routing entirely: an eval run comparing candidate models should not
carry a second moving variable.

## Reading the effect

The spend report groups by one tag dimension at a time. `evi:reasoning` gives
the split the cost baseline on EVL-429 could not see: how much of Slack is
routine. A rising `fallback` share means Jev is failing or timing out, not that
the model changed. The latency effect is visible directly in Slack: a `low`
turn skips most of the thinking.

## Tuning

The tier descriptions are the whole policy. Move work between tiers by editing
the criteria, not by adding rules in the handler; the evaluator reads messages
as evidence and the instructions say so. Subagents (`content_review` at
`xhigh`, `content_rewrite` at `high`) are static and untouched: their effort is
a property of the task they exist for, not of the message that started it.
