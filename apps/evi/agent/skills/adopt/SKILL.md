---
name: adopt
description: Work on a repository's use of evlog with the evlog CLI. Load this when asked to instrument an app or server, add or improve observability, review logging in code or a pull request, verify an evlog setup or a coverage score, analyze what an app logged, or add an audit trail. It routes to the CLI command that grounds the task and the published skill that carries the procedure.
---

# Adopt evlog in a repository

Five verbs, one loop. Every task here starts by measuring the repository, does its work, and ends by measuring again. The number is what makes the result reviewable.

## Before anything: where you are

- On the home repository the checkout is `/workspace/repo`, dependencies installed. On any other repository, `git__checkout` then `git__install`, and work in `/workspace/<owner>/<repo>`; that checkout is cold, so say so when you report its checks.
- `evlog` is on PATH: the CLI built from the current `main`. Run it from the target repository's root, never `npx @evlog/cli`.
- Two commands ground every verb. Run both first, together:
  - `evlog doctor --json`: the stack, whether evlog is installed, which drains exist.
  - `evlog map --json --no-write`: the global score and every entry point with its rule findings. It covers Nuxt, Nitro, Next.js, TanStack Start and Hono. On another framework it refuses; then there is no score, and the framework section of `review-logging-patterns` is the procedure.
- Load `review-logging-patterns` before touching code. Its framework sections, drain and enricher tables, and `references/code-review.md` are the rules. Do not instrument from memory.

## Instrument

The request: add evlog, or make an app observable.

1. `evlog init --dry-run --yes` to see what the CLI would change, then `evlog init --yes` (add `--drain fs` for a dev-only file drain). Skip when doctor says evlog is already wired.
2. Take the entry points from `map`, worst score first. Fix by rule weight: `wide-event` (40), then `audit` (25), `structured-errors` (20), `page-error-handling` (20), `context` (15), `error-handling` (15). `evlog map <file> --no-write` prints the suggested shape for one entry point.
3. `evlog agents --yes --no-skills` writes the evlog block into the repository's own `AGENTS.md`, so the next agent in that repo follows the same conventions. Skip `--no-skills` only when the person asked for the skills installed there.
4. Run the repository's own checks, then `evlog map --json --no-write` again.
5. One pull request. The body carries the score before and after, the entry points changed, the commands run, and the revision. A drain that needs credentials is wired with the env var name and nothing else; never invent a token.

## Review

The request: look at logging in a diff, a file, or a pull request.

- `evlog map <file> --no-write` for each entry point the diff touches; the findings are the comments, in the words of `references/code-review.md`.
- With an `evlog.map.json` in the repository, `evlog map --baseline evlog.map.json --no-write` says whether the diff regressed coverage.
- Comment on what the diff does to observability, not on style. Requirements are defects; opportunities (`error-catalog`, `audit-coverage`) are suggestions.

## Verify

The request: does this setup work, is the score real, is this claim true.

- `evlog doctor --json` for configuration claims. A green doctor is a claim about wiring, not about events.
- For a claim about emitted events, run the code: start the app or call the handler in the sandbox with the fs drain, then read `.evlog/logs/` as `analyze-logs` describes. Report the event you saw, or that nothing was written.
- To lock a score, propose `evlog map --min-score <n>` or `--baseline` in the repository's CI, with the number the current tree earns.

## Monitor

The request: what happened, what is slow, what failed.

- Load `analyze-logs`. It reads `.evlog/logs/*.jsonl` (NDJSON or pretty) and the memory drain endpoint, with `readFsLogs()` from `evlog/fs` for anything beyond a grep.
- The sandbox sees local drains only. A production drain (Axiom, Datadog, PostHog, and the others) is not reachable from here; say so and point at the drain's own UI. The `telemetry` skill is about the CLI's own usage data, not the person's application.

## Audit

The request: track who did what, denials, retention, a compliance review.

- Load `build-audit-logs`. It carries the call sites, `withAudit`, denials, catalogs, and the review checklist. `map`'s `audit` rule (25) and `audit-coverage` opportunity tell you which handlers are missing one.

## Report

Lead with the number: the score before and after, or the count of entry points fixed, or the events read. Then the commands, their observed results, and the revision. A check you could not run is stated as not run. Nothing here is verified by reading source alone; the CLI and the logs are the evidence.
