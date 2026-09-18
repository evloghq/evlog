---
description: "Measure agent-facing traffic to the evlog docs site (Markdown, llms.txt, discovery paths) with Vercel Observability, and read it without inflating it."
---

Use this skill when asked about how much of evlog's docs readership is agents, which clients consume the docs as Markdown, or MCP and discovery traffic. Web Analytics sees browsers only; this skill measures the requests that never run a pageview script.

## Source of truth

Use `vercel-observability__queryObservability`, one operation: `POST /v2/observability/query`.

- Metric: `vercel.request.count`, aggregation `sum`.
- Scope: `type: 'project'`, `ownerId`: the evlog team id, `projectIds`: the docs site project id (both pre-scoped in the connection description).
- Always filter to `environment eq 'production'`.
- Use ISO UTC timestamps for `startTime` and `endTime`.
- Because the result is read against a comparison, always query the requested window and the immediately preceding equal-length window with the same scope and filter, ungrouped.
- Run independent queries in parallel. A per-call batch or concurrency limit is not a total-query budget: send further read-only batches until every requested metric is collected.

## Query recipes

For each recipe, query ungrouped first for the exact total, then grouped for the breakdown.

1. Agent-facing total:
   - Filter: `environment eq 'production'`
   - Group by `client_user_agent` (limit 25) and `bot_category` + `bot_name` (limit 20).
2. Explicit Markdown URLs:
   - Filter: `endswith(request_path, '.md') and environment eq 'production'`
   - Group by `request_path` (limit 10) and `client_user_agent` (limit 10).
3. Content-negotiated Markdown:
   - Filter: `contains(http_accept, 'text/markdown') and environment eq 'production'`
   - Group by `request_path` (limit 10) and `client_user_agent` (limit 10).
4. Agent discovery and intake:
   - Filter: `(request_path eq '/llms.txt' or request_path eq '/llms-full.txt' or request_path eq '/sitemap.md' or request_path eq '/.well-known/mcp/server-card.json') and environment eq 'production'`
   - Group by `request_path` (limit 10), `client_user_agent` (limit 10), or `bot_category` + `bot_name` (limit 10).
   - Keep this separate from content reads: fetching an index does not prove the client consumed a documentation page.
5. curl traffic, only when explicitly asked:
   - Filter: `contains(client_user_agent, 'curl/') and environment eq 'production'`
   - Group by `request_path` and `client_user_agent`; exclude asset paths from the interpretation.

## Interpretation rules

- Call the result **HTTP requests**, never tool calls, sessions, users, or unique agents. One agent session performs initialization, discovery, tool calls, retries, and notifications, each counted separately.
- Use the ungrouped `summary` as the authoritative total. Do not add grouped rows or timeseries buckets to reconstruct it.
- If a response says `truncated: true` or reports `truncation.omittedArrayItems`, only the returned timeseries was shortened; report the summary total and do not call it a data gap.
- Empty or generic user agents (`node`, `undici`, `Go-http-client`, `python-httpx`) identify a client stack, not an agent product. Never rename a generic or empty user agent into a specific product.
- Report at most five recognized product rows with exact counts, then at most three generic stack rows, then the empty-user-agent row when present. Never sum version variants in the model.
- A `.md` path or a curl user agent alone does not prove AI usage: humans use "View as Markdown", scripts use curl. Treat explicit `Accept: text/markdown`, known AI bot categories, and MCP transport paths as the stronger signals.
- Browser traffic stays with `vercel__get_web_analytics`; label it as browser pageviews and never present it as total readership when agent-facing traffic is in scope.
