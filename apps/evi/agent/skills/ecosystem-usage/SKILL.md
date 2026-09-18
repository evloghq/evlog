---
description: "Measure agent-facing traffic to the evlog docs site (MCP transport, raw Markdown, discovery paths) with Vercel Observability, and read it without inflating it."
---

Use this skill when asked about MCP adoption, AI-agent traffic, raw Markdown consumption, curl usage, or which clients consume the evlog docs. Web Analytics sees browsers only; this skill measures the requests that never run a pageview script.

## Source of truth

Use `vercel__search_vercel_endpoints` to discover `POST /v2/observability/query`, then call it through `vercel__call_vercel_endpoint` (both from the vercel connection; if the endpoint pair does not surface, agent-facing metrics are unavailable, and that is one line in the answer, not a re-derivation from browser data).

- Metric: `vercel.request.count`, aggregation `sum`.
- Scope: `type: 'project'`, `ownerId`: the evlog team id, `projectIds`: the docs site project id (both pre-scoped in the connection description).
- Always filter to `environment eq 'production'`.
- Use ISO UTC timestamps for `startTime` and `endTime`.
- Because the result is read against a comparison, always query the requested window and the immediately preceding equal-length window with the same scope and filter, ungrouped.
- A per-call batch or concurrency limit is not a total-query budget: send further read-only batches until every requested metric is collected.

## Query recipes

Run independent queries in parallel, ungrouped first for the exact total, then grouped for the breakdown.

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
   - Keep these separate from content reads: fetching an index does not prove the client consumed a documentation page.
5. curl traffic, only when explicitly asked:
   - Filter: `contains(client_user_agent, 'curl/') and environment eq 'production'`
   - Group by `request_path` and `client_user_agent`; exclude asset paths from the interpretation.

## Interpretation rules

- Call the result **HTTP requests**, never tool calls, sessions, users, or unique agents. Initialization, discovery, tool calls, retries, and notifications each count separately.
- Use the ungrouped `summary` as the authoritative total. Do not add grouped rows or timeseries buckets to reconstruct it.
- Empty or generic user agents (`node`, `undici`, `Go-http-client`, `python-httpx`) identify a client stack, not an agent product. Never rename a generic or empty user agent into a specific product.
- Report at most five recognized product rows with exact counts, then at most three generic stack rows, then the empty-user-agent row when present. Never sum version variants.
- A `.md` path or a curl user agent alone does not prove AI usage: humans use "View as Markdown", scripts use curl. Treat explicit `Accept: text/markdown`, known AI bot categories, and MCP transport paths as the stronger signals.
- Top-N grouped rows are partial: describe them as top returned rows, never as all traffic.
- If a response says `truncated: true` or reports `truncation.omittedArrayItems`, only the returned timeseries was shortened; report the summary total and do not call it a data gap. Only label a real data gap when the API explicitly reports one after truncation is ruled out.
- If a query times out, shorten the window or drop a high-cardinality grouping; the ungrouped total stays authoritative.
- Browser traffic stays with `get_web_analytics`; label it as browser pageviews and never present it as total readership when agent-facing traffic is in scope.

## Output

- Include the exact requested time window and every requested metric with its HTTP request count.
- When a number is shown against a comparison, take the change from the queried preceding window; if that query was not performed or failed, write "change unavailable: <reason>" instead of implying a delta.
- If a required query failed, show that metric as unavailable beside the successful totals, with the concrete error in one line.
- End with one short caveat that HTTP request volume is not logical tool-call volume.
