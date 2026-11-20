---
"@evlog/cli": minor
---

`evlog logs` says what it read and how much of it. The report opens with the store and environments (`local files · development`, or the Vercel project), and `--json` adds `origin`, `window` and `coverage`. `coverage.complete` is `false` when the read was cut short, with the reasons, so an empty result is not taken for "nothing failed".

- `evlog logs sessions` sums each AI session: first and last activity, wall-clock time next to processing time, turns by outcome (completed, recovered after a failed tool call, failed, cancelled), failed tool calls, model and tool calls, tokens with cache reads and writes, cost, the slowest turn and the latest failure. A total the events do not carry is left out, not printed as 0.
- `--expect production` (or `files`, `vercel`, `preview`, `development`, comma-separated) refuses the read with `LOGS_SOURCE_MISMATCH` when the store or environment is another one.
- `logs.source` in `evlog.config.ts` picks the default store; `--source` overrides it.
- `evlog setup vercel --check` reports each stage without changing anything: link, OIDC, connector, attachment, token exchange, the log read itself, and traces. A token that exchanges but cannot read logs fails at the read stage.
- `evlog setup eve` writes `agent/instrumentation/evlog.ts` for an eve agent, never over an existing file; `--check` only reports.
- `evlog doctor` reports the CLI version and whether the project pins `@evlog/cli`.
