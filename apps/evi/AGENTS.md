# eve Agent App

This project uses the eve framework. Before writing code, read the relevant guide
from the installed eve package docs. In most installs, those docs are at
`node_modules/eve/docs/`. In workspaces or local package installs, resolve the
installed `eve` package location first and read its `docs/` directory. If
package docs are unavailable, use https://eve.dev/docs as a fallback.

Before implementing an integration yourself, use
`eve registry search <query>` or `eve registry list` to discover available
integrations. Inspect one with `eve registry view <item>`, then install it with
`eve add <item>`.

Before adding a capability (tool, connection, skill, schedule, subagent), read
`docs/capability-placement.md`: it decides where the capability lives and holds
the two-layer rule (files under `agent/` are wiring; logic goes in `agent/lib/`
with a colocated test).

## What reaches PostHog

Metadata only: tokens, cost, latency, model, tool names, and per-tool outcome
fields (counts, reason codes, and identifiers Evi authored; the namespaces are
listed in `docs/observability.md`). Prompts, responses, and tool payloads stay
in the agent: turns carry third-party GitHub and Linear content. A new outcome
field follows the same rule: never a raw error string or an untrusted URL. Turning that off rules out LLM-judge evaluations in PostHog, which is
a deliberate trade.

## Evals cost real money

`pnpm eval` runs the agent against a live model. Twenty evals is a real bill, so
nothing runs automatically: the GitHub Actions workflow
(`.github/workflows/evi-evals.yml`) is dispatch-only, and everything else runs
from a checkout with `pnpm --filter evi exec eve eval`.

Evals tagged `needs-connect` assert on GitHub calls that must *succeed*, and
GitHub is reached through Vercel Connect, which authenticates with a Vercel
OIDC token. CI pulls one with the Vercel CLI when `VERCEL_TOKEN`,
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are set, and skips those evals
otherwise, because an unauthenticated run reports a regression that is not one. They
always run locally, where `vc link` supplies the token. Anything asserting
`notCalledTool` on a GitHub tool needs no credentials and always runs.

Content evals check out the candidate commit, which must be fetchable by the
sandbox, and verify fixture digests before review.

Swapping the model goes through `EVI_MODEL`, not an edit to `agent.ts`: run the
workflow manually against the candidate, compare cost, latency and pass rate in
PostHog (`evi_eval_run`, broken down by `model`), then commit the swap. The
base model takes image parts natively (`docs/vision.md`), so a candidate that
cannot read an image is not a drop-in.

Routing to a deployment is the gateway's job, not the app's: `gatewayRouting`
sends a sort and `zeroDataRetention`, and names no provider. A candidate's
advertised price is not what Evi pays, because ZDR drops the deployments that
keep data and those are routinely the cheap ones. Read the real floor from a
call's `provider_metadata.gateway`, not from the model's page.
