---
name: adapter-alignment
description: Twice-monthly check that evlog's drain adapters still send what each provider's own client sends, and that evlog users get the most out of each provider, using every feature its product offers that a wide event can feed. Rotates two adapters per run through the pins in .agents/skills/create-adapter/references/upstream-alignment.md, diffs endpoint, auth, payload shape, level mapping, batch limits, and retry behavior against the official client at its current version, lists every provider feature evlog does not use yet (Sentry issues, Datadog error tracking and metrics, PostHog person profiles, Axiom dashboards and monitors), opens ready pull requests for mechanical mismatches, files philosophy mismatches and capability gaps in Linear, and moves the pin forward. Load this when the adapter-alignment schedule fires, or when Hugo asks whether an adapter is still aligned with Sentry, Datadog, Axiom, PostHog, Loki, ClickHouse, Better Stack, HyperDX, or OTLP, or whether evlog uses everything one of them offers.
---

# Adapter alignment

evlog ships adapters for providers whose APIs and clients move on their own. The e2e suite proves a destination still accepts our payload; nothing proves the payload is what the provider's own client would have sent, or that evlog uses everything the provider offers. This run closes both gaps for two adapters at a time, so every third-party adapter is compared about every two months.

Each adapter gets two questions:

1. Given one wide event, would the official client and evlog produce the same request? Where they differ, is the difference a choice evlog made on purpose, or drift?
2. What does the provider offer that evlog could feed and does not? Not only log ingestion: issues, alerts, metrics, traces, dashboards, user or person profiles, release and deploy tracking, sampling and retention controls, structured search fields, anything in the provider's product that a wide event carries the input for.

The first question keeps what we send correct. The second makes sure an evlog user gets the most out of the provider they chose. An adapter can pass the first and still miss the feature users pick the provider for: the Sentry drain sent correct logs for months while no evlog error ever opened a Sentry issue.

## 1. Pick the two adapters

Read `.agents/skills/create-adapter/references/upstream-alignment.md` in `/workspace/repo`. Take the two rows with the oldest `Aligned to`, treating `unset` as oldest. Break a tie with the reference's "First in line" list, then table order. Skip a row only when a run in the last two weeks already covered it and record why.

## 2. Read both sides

For each adapter:

- **Ours**: `packages/evlog/src/adapters/<name>.ts`, its unit test under `packages/evlog/test/adapters/`, its e2e under `packages/evlog/test/e2e/` when one exists, and its docs page under `apps/docs/content/4.integrate/adapters/`.
- **Theirs**: the ingest documentation URL and the `Start here` files in the official client at its latest published version. Read the version with `npm view <package> version` from the sandbox. Read source with `github__getFileContent` at the matching tag; a `Start here` path that no longer exists is a limitation to record, and the run locates the replacement with `github__searchCode` before continuing. Do not reason from memory of the client; read the lines.
- **Their product**: the provider's product documentation, read for every feature it offers, not only the ingest page. List each feature and the input it needs. Then the `Feature entry points` files, where the official client sends that input. When the cell says the first run pins the files, find them with `github__searchCode` from the client's public API (`captureException`, `identify`, a metrics or span call), read them, and write the paths into the cell in the same PR that moves the pin. A feature the client does not reach still counts: the product docs are the authority for what exists, the client only shows how it is fed.

Record the client version and the files read. They are the evidence for everything below.

## 3. Compare

Walk the list under "What a comparison covers" in the reference file. For each property, write one line: ours, theirs, same or different. A difference becomes one of:

- **Mismatch**: the provider stores or indexes the event differently because of it (wrong default site, a renamed field, a level the provider does not recognise, a limit we exceed, an endpoint the provider deprecated). Evidence is the upstream line and ours.
- **Choice**: evlog differs on purpose and the adapter or docs say so (we batch where they stream, we flatten where they nest). Record it; do not file it. If nothing says so, it is a question, not a choice.
- **Note**: evlog is stricter than the client with no effect on what the provider stores.

Then walk "What a capability check covers". Each provider feature evlog does not use is a **Gap**. Evidence is the provider page that documents it, the client file that feeds it when there is one, and the evlog field that already carries the input (an `error` with a `stack`, a `userId`, a `release`, a `duration`, a `traceId`). A feature evlog has no input for is still a gap; say so instead of dropping it. A feature that does not fit evlog (the provider's own browser SDK, session replay) is recorded as a choice with one line on why, so the next run does not reopen it.

The e2e test is part of the comparison. An adapter with no e2e file (Datadog and HyperDX today) gets that gap recorded as a proposal unless one already exists in Linear.

## 4. Deliver

**Mechanical mismatch → ready PR.** A wrong default, a missing or renamed field, a stale endpoint, a limit to lower. Follow `contributing`: branch off `main` in `/workspace/repo`, write the failing regression test first, fix, run `pnpm run lint`, `pnpm run typecheck`, and `pnpm --filter evlog exec vitest run test/adapters/<name>.test.ts`, then the full suite. Add a changeset; an adapter change is user-facing. Update the adapter docs page when it states the old value. The PR body shows the upstream line and ours side by side, names the client version, and states what the provider will store differently after the change. Read CI, fix what fails, request `hugorcd` as reviewer. One mismatch per PR unless several are the same kind on one adapter; then one PR for that adapter. At most two PRs per run.

**Philosophy mismatch or question → Linear issue** via `linear__save_issue` on the evlog team. State what the client does, what evlog does, the upstream evidence, who would notice, and the decision to make. Search `linear__list_issues` first; a recurring mismatch updates its issue.

**Capability gap → Linear proposal, never a PR.** A new feature is Hugo's call, whatever its size. Search open pull requests with `github__searchIssues` and Linear with `linear__list_issues` first: a gap already covered by an open PR or issue gets the link in the thread and nothing new. Otherwise file one issue per gap, stating what the feature gives the user, the provider page, the client file that feeds it when there is one, the evlog fields that would feed it, whether it would be opt-in, and what a user of both the provider's SDK and evlog would see twice. Rank the gaps in the thread by what a user of that provider would miss most.

**Move the pin.** In a real run, once every mismatch and every gap on an adapter is in a PR, in an issue, or recorded as a choice, update that row's `Aligned to` to `<package> <version> @ <short SHA of main>` in the same PR as the fixes, or in its own `docs:` PR when nothing needed fixing. A pin never moves past a mismatch or a gap that has no destination.

Then post one line per adapter to the thread: aligned, or the PR and issue links inline.

## When nothing is warranted

Both adapters match their client and use every provider feature evlog can feed: move the two pins in one `docs:` PR and say so in one line. Never invent a mismatch or a gap, never file an issue to record that an adapter is aligned, and never open a PR that only touches the pin table alongside a code change.
