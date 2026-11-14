<p align="center">
  <img src="https://raw.githubusercontent.com/evloghq/evlog/main/assets/evlog-banner.gif" width="100%" alt="evlog — Digging through logs is not observability. It's hope" />
</p>

# @evlog/telemetry

[![npm version](https://img.shields.io/npm/v/@evlog/telemetry?color=black)](https://npmjs.com/package/@evlog/telemetry)
[![npm downloads](https://img.shields.io/npm/dm/@evlog/telemetry?color=black)](https://npm.chart.dev/@evlog/telemetry)
[![CI](https://img.shields.io/github/actions/workflow/status/evloghq/evlog/ci.yml?branch=main&color=black)](https://github.com/evloghq/evlog/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-black?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Documentation](https://img.shields.io/badge/Documentation-black?logo=readme&logoColor=white)](https://evlog.dev/use-cases/telemetry/overview)
[![license](https://img.shields.io/github/license/evloghq/evlog?color=black)](https://github.com/evloghq/evlog/blob/main/LICENSE)

**Digging through logs is not observability. It's hope.**

**Wide-event telemetry for CLIs and automation**, the same one-event-per-run model as [evlog](https://evlog.dev), built for tools that run on someone else's machine.

Ship usage insight without shipping an analytics SDK: wrap your [citty](https://github.com/unjs/citty) command tree (or call `createTelemetry()` in scripts) and get **one structured event per command**: command name, sanitized flags, duration, outcome, and optional counters via `telemetry.set()`.

## Why evlog telemetry

| Problem | How this package solves it |
| --- | --- |
| Per-command analytics boilerplate | `withTelemetry()` walks your citty tree — one event per `run` handler |
| Leaking paths, tokens, or raw `argv` | Privacy by shape: booleans/numbers captured, strings presence-only unless allowlisted |
| Short-lived CI runs losing data | Disk-buffered NDJSON outbox; `run()` POSTs after 15 minutes (60 in CI) or 20 queued events |
| Disclosure drift | `generateDisclosure()` derives markdown + JSON from your runtime config |
| Ingestion endpoint | `parseIngestBody()` validates POST bodies server-side — tool allowlist, envelope checks, custom key filter |
| Telemetry breaking the host tool | Never throws, never blocks exit; `flush()` hard-capped at 500ms |

Opt-out is first-class: `DO_NOT_TRACK=1` (or `true`, `yes`, `on`), `EVLOG_TELEMETRY=0` (or `false`, `no`, `off`), or a persisted `telemetry disable` that purges undelivered data.

**Size:** ~28 KB ESM (~8.6 KB gzip) · server ingest subpath `@evlog/telemetry/ingest` ~5 KB · `sideEffects: false` · no `evlog` core dependency.

## Install

```bash
pnpm add @evlog/telemetry
```

## Quick start (citty)

```ts
import { defineCommand, runMain } from 'citty'
import { withTelemetry, defineTelemetryCommands, telemetry } from '@evlog/telemetry'

const TOOL = 'my-tool'
const VERSION = '1.0.0'

const main = withTelemetry(
  defineCommand({
    meta: { name: TOOL, version: VERSION },
    subCommands: {
      doctor: {
        meta: { name: 'doctor' },
        run() {
          telemetry.set({ checksFailed: 0 })
        },
      },
      telemetry: defineTelemetryCommands({ name: TOOL }),
    },
  }),
  { name: TOOL, version: VERSION },
)

runMain(main)
```

Scripts and GitHub Actions: `createTelemetry()` / `createGitHubActionsTelemetry()`. See the [docs](https://evlog.dev/use-cases/telemetry/overview).

## Docs

Full guide: [evlog.dev telemetry guide](https://evlog.dev/use-cases/telemetry/overview)

Example playground: [`examples/telemetry-playground`](../../examples/telemetry-playground) in the evlog monorepo.
