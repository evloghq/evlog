# Adapter E2E tests

Real-network tests against the platforms evlog ships an adapter for. They are
the safety net that catches "the destination quietly changed its API" before
your users do.

## What runs

| File | Adapter | Mode |
|---|---|---|
| `fs.e2e.ts` | File system | **Round-trip** through `initLogger()` into real files, read back with `readFsLogs()` / `tailFsLogs()`, rotation and `maxFiles` included. No credentials, runs on every PR |
| `otlp.e2e.ts` | OTLP | **Round-trip** via the sandbox OpenTelemetry Collector's file export: OTLP/JSON, gzip protobuf, compact records, semantic conventions, headers |
| `hyperdx.e2e.ts` | HyperDX | **Round-trip** via the sandbox collector (record and `authorization` header), plus a cloud smoke when `HYPERDX_API_KEY` is set. The cloud intake answers 200 even for an invalid key |
| `datadog.e2e.ts` | Datadog | Smoke (write-only intake), with the gzip body Datadog accepted decoded: `httpStatusCode`, `dd.trace_id`, the 1000-entry split. Local only, see below |
| `sazabi.e2e.ts` | Sazabi | Smoke (write-only intake). Local only, see below |
| `axiom.e2e.ts` | Axiom | Round-trip if token has `query:read`, smoke otherwise |
| `posthog.e2e.ts` | PostHog (OTLP + events API) | Smoke (write-only API) |
| `sentry.e2e.ts` | Sentry envelope | Smoke (DSN is write-only), including a failed `evlog/effect` unit whose issue and log carry the wide event's trace id |
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

Loki, ClickHouse and an OpenTelemetry Collector all run locally, so their
suites (and the OTLP and HyperDX round-trips) need no credentials. The same
stack doubles as a place to *look at* your wide events:

```bash
pnpm run sandbox:up      # loki + clickhouse + otel collector + grafana (waits for health)
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

The collector writes every request it accepts to `test/e2e/.otel/logs.jsonl`
(gitignored), and the OTLP and HyperDX suites read it back. The collector runs
as root so it can write to the bind mount, which leaves `.otel/` owned by root;
remove it with `sudo rm -rf packages/evlog/test/e2e/.otel` if you need to.

The fs suite needs nothing at all: `pnpm --filter evlog exec vitest run --config vitest.e2e.config.ts test/e2e/fs.e2e.ts`.

Tokens are read from the workspace `.env` (already gitignored). Suites whose
required env vars are missing are skipped with a visible "skipped: missing X"
label, never silently green.

Only `AXIOM_API_KEY` + `AXIOM_DATASET` are required for round-trip; the others
are smoke-only.

## Run in CI

`.github/workflows/e2e.yml` runs on:

- daily cron (`0 3 * * *` UTC)
- push to `main` (only when adapter source / e2e tests / workflow change)
- PR labelled `e2e` (only on same-repo PRs — never forks, for secret safety)
- manual dispatch

`fs.e2e.ts` also runs on every PR, in the `Test` job of `.github/workflows/ci.yml`.

## GitHub secrets

The workflow expects these repo secrets:

- `AXIOM_API_KEY` (PAT with `query:read` for round-trip, ingest token works for smoke)
- `AXIOM_DATASET`
- `AXIOM_ORG_ID` (required for PATs)
- `POSTHOG_API_KEY`
- `SENTRY_DSN`
- `BETTER_STACK_API_KEY`
- `HYPERDX_API_KEY` (ingestion API key)
- `LOKI_ENDPOINT` (+ `LOKI_USER` / `LOKI_API_KEY` for Grafana Cloud, or a service container for self-hosted)
- `CLICKHOUSE_ENDPOINT` (+ `CLICKHOUSE_PASSWORD` for ClickHouse Cloud, or a service container for self-hosted)

Set them with `gh secret set <NAME> --body '<value>'` or in the repo settings UI.

### Local only: Datadog and Sazabi

Both need a paid account, so CI passes them no secret and they report
themselves skipped there. To run them, put the keys in the workspace `.env`:

- `DATADOG_API_KEY` (an API key; no application key needed), plus `DATADOG_SITE` if you are not on `datadoghq.com`
- `SAZABI_INTAKE_URL` (the log stream's intake URL; its public key is part of the URL)

## Get round-trip on Axiom

The default Axiom ingest token (`xaat-...`) cannot read events back. To
enable full round-trip assertions, generate a Personal Access Token at
[app.axiom.co/profile](https://app.axiom.co/profile) with the `query:read`
scope and use it as `AXIOM_API_KEY`. Without it, the suite degrades to smoke
tests and prints a warning.
