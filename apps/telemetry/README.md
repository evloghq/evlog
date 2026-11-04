# evlog telemetry

A tiny, self-hostable analytics dashboard for [`@evlog/telemetry`](https://npmjs.com/package/@evlog/telemetry) run events — built to receive run events from anything that reports to it — a CLI someone typed, a GitHub Actions job, a Vercel build, an AI coding agent, a cron script — store them in Postgres via [NuxtHub](https://hub.nuxt.com) + Drizzle ORM, and show what's happening: totals and their trend, where the runs came from, latency, version adoption, and a raw events browser.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/evloghq/evlog/tree/main/apps/telemetry&project-name=evlog-telemetry&repository-name=evlog-telemetry&products=%5B%7B%22type%22%3A%22integration%22%2C%22group%22%3A%22postgres%22%2C%22protocol%22%3A%22storage%22%7D%5D&env=ANALYTICS_PASSWORD,NUXT_APP_SECRET&envDescription=Dashboard+password+and+a+32%2B+char+session+secret)

## What you get

- `POST /api/telemetry/ingest` — public endpoint your tools post to. Validated with `parseIngestBody()` from `@evlog/telemetry/ingest`, deduped on `idempotencyKey`, rate-limited per IP.
- A password-gated dashboard (`nuxt-auth-utils` session), split into four tabs:
  - **Overview** — KPI cards (total runs, success rate, error rate, unique machines, avg and p95 duration), each carrying a sparkline of the range and its change against the *preceding window of equal length*; activity as a stacked bar chart (hourly on the 24h range, daily otherwise); a live feed; a **Sources** panel that classifies every run as CI, AI agent, terminal or automation and filters the whole dashboard when you click one; and the environment split
  - **Performance** — average and p95 latency over time, error rate over time, the duration histogram, top commands (with p95), and top error codes
  - **Adoption** — tool version rollout as a stacked area chart (how fast a release takes over), active machines split into new vs returning, a weekday × hour punchcard of when runs happen, Node/OS/version breakdowns, and the `flags` / `custom` field usage with the error share per value
  - **Explorer** — a sortable, paginated raw events browser; click any column header to sort, click a row to open its full detail (flags, custom fields, environment info, idempotency key)
  - Charts use [`nuxt-charts`](https://nuxtcharts.com) (the same lib + tooltip/legend styling as [nuxt-ui-templates/chat](https://github.com/nuxt-ui-templates/chat)); the sparklines and the punchcard are hand-rolled SVG/CSS, since axes, legends and tooltips are all features they'd have to turn back off
  - The active tab, all filters, sort, page, and the open run detail are reflected in the URL, so any view is a shareable/bookmarkable link — a "Reset filters" button appears whenever any of them differ from the defaults, to get back to a clean view in one click
  - The Explorer and Adoption queries are the most expensive reads in the app, so they're only fetched while their tab is on screen (a deep link to `?tab=adoption` still server-renders with its data)
- An MCP server at `/mcp` (built with [`@nuxtjs/mcp-toolkit`](https://mcp-toolkit.nuxt.dev)) that exposes the same stats/runs data to AI assistants — see [MCP endpoint](#mcp-endpoint) below

See the architecture writeup in the docs: [evlog.dev — telemetry ingest](https://evlog.dev/use-cases/telemetry/ingest).

## Deploy

Click the button above. During setup:

1. Pick a Postgres provider from the Vercel Marketplace (Neon, Supabase, ...) — this auto-injects the connection string. NuxtHub picks up `DATABASE_URL`, `POSTGRES_URL`, or `POSTGRESQL_URL` automatically, so whichever name the integration creates just works.
2. Set `ANALYTICS_PASSWORD` (the dashboard login — whatever you want to type in) and `NUXT_APP_SECRET` (32+ *random* chars from `openssl rand -base64 32` — this is a cookie-encryption secret, not a password you type in, and must not be the same value as `ANALYTICS_PASSWORD`).
3. Point each tool's telemetry `endpoint` at `https://<your-deployment>/api/telemetry/ingest`. Anything using `@evlog/telemetry` reports the same event shape, so CLIs, CI jobs and scripts all land in the same dashboard.

Table migrations (`server/db/migrations/postgresql/`) apply automatically during `nuxi build`/deploy — nothing to run by hand.

## MCP endpoint

`/mcp` (see `server/mcp/`) exposes the dashboard's data to AI assistants like Cursor or Claude Desktop over the [Model Context Protocol](https://modelcontextprotocol.io), read-only:

- `telemetry-stats` — aggregate totals (plus the same totals one window back, for period-over-period comparison), environment/tool breakdown, top commands, and the activity timeline for a time range
- `telemetry-adoption` — version rollout over time, new vs returning machines, the weekday/hour punchcard, and the flag/custom field breakdown
- `telemetry-runs` — the raw events list, with the same filter/sort/pagination options as the dashboard's browser

All three aggregate tools accept a `source` filter (`ci:github_actions`, `agent:claude-code`, `terminal`, `automation`), matching the dashboard's Sources panel.
- `telemetry-run` — full detail (flags, custom fields, environment info) for one run by id

Click **Connect MCP** in the dashboard header for the endpoint URL and a ready-to-paste client config. Auth mirrors the dashboard's own password gate: with no `ANALYTICS_PASSWORD` set, the endpoint is open; once it's set, clients must send `Authorization: Bearer <ANALYTICS_PASSWORD>` or the request gets a `403` (never a `401` — that would trigger unwanted OAuth discovery in MCP clients).

## Local development

```bash
pnpm install
pnpm run telemetry   # or: pnpm playground telemetry
```

No `.env` needed to get started — with zero configuration:

- **No `DATABASE_URL`** → [NuxtHub](https://hub.nuxt.com) gives you a real local Postgres database for free, backed by [PGlite](https://pglite.dev) and stored in `.data/`. No Docker, no connection string, nothing to run by hand — schema migrations from `server/db/schema.ts` apply automatically on first request.
- **Empty `runs` table** (fresh clone, nothing ingested yet) → the dashboard serves generated sample data (see `server/utils/mock-data.ts`) instead, so every chart, table, and filter is explorable and interactive from the first run. A banner on the dashboard makes this obvious. It switches to real data automatically the moment a real event lands — `POST /api/telemetry/ingest` always persists for real, mock mode only affects what the dashboard *reads*.
- **No `ANALYTICS_PASSWORD`** → the login screen is skipped entirely.

### Feeding it real events

Mock data covers every chart, but it is generated — it will not show you what a
field you just added actually looks like on the wire. `pnpm telemetry:cli` runs
this repo's own CLI with its endpoint pointed at `localhost:3000`, so a command
you run lands in the dashboard you have open:

```bash [Terminal]
pnpm run telemetry                                  # in one terminal
pnpm telemetry:cli map --cwd apps/playground        # in another
pnpm telemetry:cli doctor --cwd apps/playground
```

It runs from the repo root like `pnpm cli` does, so pass `--cwd` to point it at
a real app. The first real event switches the dashboard off mock data
automatically. For a spread of runs worth looking at rather than a handful,
aim it at the throwaway apps `pnpm cli:sandbox` builds under `.sandbox/` — four
frameworks with deliberately uneven instrumentation, so `map` reports four
different scores.

Once you're ready to point this at production data, copy `.env.example` to `.env` and fill in `DATABASE_URL` (and `ANALYTICS_PASSWORD` / `NUXT_APP_SECRET` if you want the dashboard locked down).

Changed `server/db/schema.ts`? Run `pnpm --filter evlog-telemetry exec nuxt db generate` to generate the matching migration and commit the result.

## Known limitations (it's a template, not a platform)

- **No CI integration test against a real Postgres instance.** `server/utils/*.ts` pure helpers (allowlist parsing, password check, rate limiter, query filters, mock data) have unit tests, run in CI. The Drizzle queries in `server/api/telemetry/*` and `server/utils/{store,filters}.ts` run against local PGlite in dev but aren't exercised in CI beyond that — CI does build the app on every change (a dedicated `telemetry` job runs `turbo run test build --filter=evlog-telemetry`) to catch compile-time regressions.
- **Rate limiting is best-effort and per-instance.** It resets on cold start and doesn't share state across concurrent function instances — treat it as a floor, not your only defense. Put a real WAF/rate limit in front for high-traffic tools.
- **Single shared password**, not per-user auth. Good enough for "don't leave usage stats fully public"; not meant for multi-tenant access control.
