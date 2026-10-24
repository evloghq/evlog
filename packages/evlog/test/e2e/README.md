# Adapter E2E tests

Real-network tests against the platforms evlog ships an adapter for. They are
the safety net that catches "the destination quietly changed its API" before
your users do.

## What runs

| File | Adapter | Mode |
|---|---|---|
| `axiom.e2e.ts` | Axiom | Round-trip if token has `query:read`, smoke otherwise |
| `posthog.e2e.ts` | PostHog (OTLP + events API) | Smoke (write-only API) |
| `sentry.e2e.ts` | Sentry envelope | Smoke (DSN is write-only) |
| `better-stack.e2e.ts` | Better Stack | Smoke (source token is write-only) |
| `loki.e2e.ts` | Grafana Loki | **Round-trip** via the query API — local container or Grafana Cloud |
| `clickhouse.e2e.ts` | ClickHouse | **Round-trip** via `SELECT` — local container or ClickHouse Cloud |
| `grafana.e2e.ts` | Sandbox Grafana | Datasources healthy, drained events readable through Grafana, every dashboard query valid against the ClickHouse schema |

Every event is tagged with `e2e: true`, `e2e_run_id`, `e2e_branch`, `e2e_sha`,
`e2e_test`, `e2e_correlation_id` so you can grep / clean it from the
destination at any time.

## Run locally

```bash
pnpm run test:e2e
```

### Without a cloud account — the local sandbox

Loki and ClickHouse both run locally, so their suites need no credentials. The
same stack doubles as a place to *look at* your wide events:

```bash
pnpm run sandbox:up      # loki + clickhouse + grafana (waits for health)
pnpm run sandbox:seed    # 40 realistic wide events into both backends
pnpm run sandbox:e2e     # run the suites against them
pnpm run sandbox:down    # stop and wipe volumes
```

Then browse:

| | URL | What |
|---|---|---|
| **Dashboard** | http://localhost:3001/d/evlog-wide-events | Counts, events by level, top routes, and a table of recent wide events |
| **Explore** | http://localhost:3001/explore | Ad-hoc queries against either datasource |

No login — Grafana runs anonymous-admin. **Both** datasources are provisioned:
Loki (`{service="evlog-sandbox"}`) and ClickHouse (`SELECT … FROM evlog_events`),
so you never need ClickHouse's bare `/play` page.

`sandbox:seed` drives the real public API — `createRequestLogger()` through the
actual drains — so what lands is exactly what an instrumented app produces:
weighted routes, ~12% errors with structured `error.name` / `error.message`,
user / plan / region context, cache hits.

Suites whose endpoint is unset skip themselves, so a partial stack is fine.

Tokens are read from the workspace `.env` (already gitignored). Suites whose
required env vars are missing are skipped with a visible "skipped: missing X"
label, never silently green.

Only `AXIOM_TOKEN` + `AXIOM_DATASET` are required for round-trip; the others
are smoke-only.

## Run in CI

`.github/workflows/e2e.yml` runs on:

- daily cron (`0 3 * * *` UTC)
- push to `main` (only when adapter source / e2e tests / workflow change)
- PR labelled `e2e` (only on same-repo PRs — never forks, for secret safety)
- manual dispatch

## GitHub secrets

The workflow expects these repo secrets:

- `AXIOM_TOKEN` (PAT with `query:read` for round-trip, ingest token works for smoke)
- `AXIOM_DATASET`
- `AXIOM_ORG_ID` (required for PATs)
- `POSTHOG_API_KEY`
- `SENTRY_DSN`
- `BETTER_STACK_SOURCE_TOKEN`
- `LOKI_ENDPOINT` (+ `LOKI_USER` / `LOKI_API_KEY` for Grafana Cloud, or a service container for self-hosted)
- `CLICKHOUSE_ENDPOINT` (+ `CLICKHOUSE_PASSWORD` for ClickHouse Cloud, or a service container for self-hosted)

Set them with `gh secret set <NAME> --body '<value>'` or in the repo settings UI.

## Get round-trip on Axiom

The default Axiom ingest token (`xaat-...`) cannot read events back. To
enable full round-trip assertions, generate a Personal Access Token at
[app.axiom.co/profile](https://app.axiom.co/profile) with the `query:read`
scope and use it as `AXIOM_TOKEN`. Without it, the suite degrades to smoke
tests and prints a warning.
