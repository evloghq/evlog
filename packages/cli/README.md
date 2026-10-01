<p align="center">
  <img src="https://raw.githubusercontent.com/evloghq/evlog/main/assets/evlog-banner.gif" width="100%" alt="evlog — Digging through logs is not observability. It's hope" />
</p>

# @evlog/cli

[![npm version](https://img.shields.io/npm/v/@evlog/cli?color=black)](https://npmjs.com/package/@evlog/cli)
[![npm downloads](https://img.shields.io/npm/dm/@evlog/cli?color=black)](https://npm.chart.dev/@evlog/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/evloghq/evlog/ci.yml?branch=main&color=black)](https://github.com/evloghq/evlog/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-black?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Documentation](https://img.shields.io/badge/Documentation-black?logo=readme&logoColor=white)](https://evlog.dev)
[![license](https://img.shields.io/github/license/evloghq/evlog?color=black)](https://github.com/evloghq/evlog/blob/main/LICENSE)

**Digging through logs is not observability. It's hope.**

The command line behind the `evlog` executable. [`evlog`](https://npmjs.com/package/evlog) ships the binary without depending on this package: it runs `@evlog/cli` when installed and fetches it with your package manager otherwise, so the logger stays small and the commands are there as soon as evlog is.

Score what your app can tell you when something goes wrong. Diagnose your install when nothing shows up.

> **Early days.** Safe to run on any project, since it reads your source and writes a single `evlog.map.json` at the root (`--no-write` to skip), and it is covered by tests, but young. `evlog map` has adapters for five frameworks today, its rules are still being refined, and both will grow. Expect verdicts and scores to move between releases: install it as a dev dependency when you gate CI on the number.

## Usage

```bash
npx evlog init          # interactive setup — pick a destination, review the plan
npx evlog agents        # teach your AI agents the evlog conventions
npx evlog map           # score what is still dark
npx evlog map --json --no-write
```

Without `@evlog/cli` installed, each run fetches it (a few seconds cold, about a second cached). Install it for a pinned, instant run, which is what CI wants:

```bash
pnpm add -D @evlog/cli
pnpm evlog map
```

## Commands

| Command | What it does |
| --- | --- |
| `evlog init` | Interactive setup: install, register the framework integration, wire a drain |
| `evlog init --yes` | Non-interactive — defaults for everything (also implied by `--json`, no TTY, or `CI`) |
| `evlog init --drain <id>` | Development drain: `fs` (default) or `none` |
| `evlog init --prod-drain <a,b>` | `axiom`, `otlp`, `posthog`, `sentry`, `better-stack`, `datadog`, `hyperdx` — several fan out |
| `evlog init --extras <a,b>` | `enrichers`, `pipeline`, `sampling`, `error-catalog`, `audit-catalog`, `ai`, `better-auth`, `vite` |
| `evlog init --apps <a,b>` | Workspace packages to set up, from a monorepo root |
| `evlog init --dry-run` | Print the plan without touching a file |
| `evlog init --service <name>` | Service name on every wide event (default: package name, unscoped) |
| `evlog init --no-install` | Print the install command instead of running it |
| `evlog init --no-agents` | Skip all of it — no `AGENTS.md`, no `CLAUDE.md`, no skills |
| `evlog agents` | Write the evlog conventions into `AGENTS.md`, point `CLAUDE.md` at it, install the skills via `npx skills add` |
| `evlog agents --skills <a,b>` | Install only these skills (default: every published one) |
| `evlog agents --no-skills` | Still write `AGENTS.md` and `CLAUDE.md`; skip only the skills — nothing is spawned |
| `evlog agents --global` | Install the skills for every project instead of just this one |
| `evlog agents --source <url>` | Where the skills are published — a plain http(s) origin (default: `https://www.evlog.dev`) |
| `evlog agents --dry-run` | Print the plan without touching a file or spawning anything |
| `evlog agents --yes` | Apply without confirming (also implied by `--json`, no TTY, or `CI`) |
| `evlog map` | Static observability score for the current app — Lighthouse for wide events |
| `evlog map <route-or-file>` | Explain one entry point: why it was scanned, each verdict, the shape it could take |
| `evlog map --all` | Every entry point as a check matrix, grouped by directory |
| `evlog map --framework <name>` | Override framework detection (`nuxt`, `nitro`, `next`, `tanstack-start`, `hono`) |
| `evlog map --min-score <n>` | Exit 1 if the global score is below `n` |
| `evlog map --baseline [ref]` | Exit 1 on a regression against the committed `evlog.map.json` (path, or `git:<ref>`) |
| `evlog map --no-write` | Skip writing `evlog.map.json` to the project root |
| `evlog map --verbose` | Show per-file parse warnings |
| `evlog map --cwd <dir>` | Scan another app in the workspace |
| `evlog doctor` | Monorepo-aware diagnosis: Node, project/workspace, stack, evlog install, `.evlog/logs` |
| `evlog doctor --cwd <dir>` | Run against another directory |
| `evlog doctor --debug` | Same, plus a debug wide event (see Debug) |
| `evlog telemetry status` | Show telemetry status and disclosure |
| `evlog telemetry enable` / `disable` | Change telemetry preference (disable purges buffered data) |

### Disabling a check

A verdict you disagree with costs one comment, not your CI gate:

```ts
// evlog-map-disable-next-line wide-event, context -- liveness probe, deliberately silent
export default defineEventHandler(() => ({ ok: true }))
```

Also `evlog-map-disable-line` for a trailing comment, and `evlog-map-disable` on its own for the whole file. Name no rule id and it covers all of them. The check becomes `n/a` with your reason attached, so it costs no score, and the report counts how many checks the project disabled, so a green score never hides an app that logs nothing. Full syntax: [Rules](https://evlog.dev/cli/rules#disabling-a-check).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | All checks passed (warnings allowed) |
| `1` | At least one check failed |
| `2` | Usage error (unknown command or flags) |

## `--json` output

With `--json`, the payload is the **only** thing written to stdout, and everything human goes to stderr. The shape is a contract:

```jsonc
// evlog doctor --json
{
  "schemaVersion": 2,
  "checks": [{ "id": "node", "status": "ok", "message": "Node v22.1.0" }],
  "summary": { "ok": 4, "warn": 0, "fail": 0 }
}
```

```jsonc
// evlog map --json
{
  "schemaVersion": 2,
  "map": { "version": 1, "framework": "nuxt", "score": 76, "routes": [] },
  "summary": { "instrumented": 19, "partial": 2, "dark": 8, "exempt": 0 },
  "mapPath": "evlog.map.json" // null with --no-write
}
```

With `--baseline`, the payload gains a `baseline` key holding the comparison (`regressions`, `fixed`, `added`, `removed`, `delta`).

Breaking either shape requires a `schemaVersion` bump. In `routes[]`, `checks` holds the requirements that move the score and `suggestions` holds the opportunities that never do, in separate keys so a suggestion can't be mistaken for a failure.

## Telemetry

The CLI records **one anonymous wide event per command** via [`@evlog/telemetry`](https://npmjs.com/package/@evlog/telemetry) (tool name `evlog-cli`): command name, duration, outcome, sanitized flags. No arguments, paths, or file contents.

`evlog init` also records **which options you picked**: the framework, the destinations, the extras, the sampling preset, and counts (files written, manual steps left). Every value is an id from the CLI's own catalog, enforced by an allowlist, so a free-text answer can never be sent: your service name, your package name and anything read out of your source stay on your machine. Delivered to evlog's own dashboard (`apps/telemetry` in this repo); override with `EVLOG_TELEMETRY_ENDPOINT` to point at your own instance. Opt out anytime:

```bash
evlog telemetry disable   # or DO_NOT_TRACK=1 / EVLOG_TELEMETRY=0
```

Full policy: [evlog.dev telemetry policy](https://evlog.dev/use-cases/telemetry/overview)

## Quieter output

Commands print a short branded header by default. Skip it with `--no-header`, `EVLOG_CLI_NO_HEADER=1`, or `--json`.

## Debug

Emit one debug case file per command with `--debug` or `EVLOG_CLI_DEBUG=1` (dogfoods `evlog`). Human mode prints a compact summary on stderr (`steps`, `findings`, resolve probes). With `--json`, the raw wide event goes to stderr so stdout stays a clean JSON contract. Separate from product telemetry (`@evlog/telemetry`).

```bash
evlog doctor --debug
evlog doctor --json --debug   # JSON result on stdout, full debug event on stderr
```

Maintainer notes on frictions / wishlist: [`DEBUG-DX.md`](./DEBUG-DX.md).

## Adding a command

1. Create `src/commands/<name>.ts` with `defineEvlogCommand('name', { run({ args, cli, log, ui }) { … } })`: the header, `--json` / `--debug` / `--no-header`, and the debug file is automatic. Use `log.step` / `log.finding` for diagnostics; `ui.done` / `ui.human` / `ui.json` for output.
2. Add one lazy entry in [`src/commands/index.ts`](src/commands/index.ts), so the command only loads when it runs.

`src/index.ts` stays a thin shell (meta + `withTelemetry`). Do not embed command bodies there.

```
src/
  cli.ts              # bin entry (runMain)
  index.ts            # main command tree
  commands/           # one file per command + registry
  core/               # context, output, brand, usage
  lib/                # shared constants / helpers
```

## Docs

- [CLI overview](https://evlog.dev/cli/overview): commands, global flags, exit codes
- [`evlog map`](https://evlog.dev/cli/map): what it scans and how to read the report
- [Rules](https://evlog.dev/cli/rules): every check, what satisfies it, how to fix it
- [Scoring](https://evlog.dev/cli/scoring): weights, grades, sensitivity
- [CI](https://evlog.dev/cli/ci): gate a pull request on the score
