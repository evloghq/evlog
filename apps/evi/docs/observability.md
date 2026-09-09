# Observability

What Evi records today, what it cannot, and the gaps worth closing upstream.

## What works

`agent/hooks/evlog.ts` emits one evlog wide event per turn. A turn event carries
`eve.{sessionId,turnId,turnSequence,sessionTurns,runtime,reasoning}`,
`ai.{calls,steps,inputTokens,outputTokens,cacheReadTokens,costUsd,model,tools[],finishReason}`,
`channel.kind`, `status`, `durationMs`, plus `service` and `environment`.

That is enough to answer, from the log alone: what a turn cost, which tools it
called and whether each succeeded, how much of the context was cache-served, and
which surface it came from. Every cost claim in this project was measured from
these events rather than estimated.

Tool executes enrich the same event with their outcome, in the pattern
`tools/memory.ts` set: one namespace per domain, holding counts, reason codes,
and identifiers Evi authored. Never raw error strings, tool payloads, or
untrusted URLs, so the metadata-only PostHog policy holds. The namespaces:
`git.{branch,pushed,sha,reason}`,
`capture.{published,viewport,target,beforeHost,afterHost,reason}`,
`blob.{uploaded,bytes}`, `turbo.{remoteCache,reason}`,
`gateway.report.{mode,groupBy,matchedRows}`,
`content.{scanned,candidates,eligible,targets,group,surface}`,
`image.{host,fetched,bytes,mediaType}`, and
`memory.{saved,refused,searched,hits}`. A content pass that held everything or
a push that was refused is chartable from the turn event alone. Tool executes
are the one place `useLogger()` is contractually bound (see the caller gap
below), which is why hooks, schedules, and the subagents stay uninstrumented.

`environment` comes from `agent/lib/environment.ts`, the same function that
builds the gateway spend tags. That is deliberate: a run that bills as `eval`
also logs as `eval`, so the two views line up. Before, wide events reported
`development` for both eval and local traffic while the spend report separated
them — the kind of drift that makes a dashboard quietly lie.

The fs drain only attaches where there is a durable disk. On Vercel everything
outside `/tmp` is read-only and `createFsDrain` guards neither its `mkdir` nor
its `appendFile`, so shipping it there would throw once per turn and write events
nobody could read. Hosted, stdout is the transport and the platform captures it.

`agent/instrumentation.ts` enables eve's OpenTelemetry surface. Without that file
there is no span tree at all — the Agent Runs tab is fed by Workflow run tags,
which are a separate system. With it, a turn produces `ai.eve.turn` →
`ai.streamText` per step → `ai.streamText.doStream` and `ai.toolCall` per tool.
That is the only place per-tool timing and per-step model input are visible; the
wide event says a turn called six tools, the span tree says which step each ran
in and what the model saw first. `defineEvlogInstrumentation` stamps
`evlog.request_id` and `evlog.session_id` on every span, so a slow span resolves
to its wide event and back. No `setup` is registered, so eve keeps traces local
until a backend is chosen.

## Not yet verified

`sessionEvent: true` is set but has never been observed firing. It emits on
`session.completed` / `session.failed`, and the eval runner leaves sessions open
by design, so 17 turn events across a full suite produced zero rollups. It is
configured, not confirmed. Check it against a real GitHub thread that ends.

## The gap: nothing identifies the caller

A turn event says what happened and what it cost. It does not say **who asked**.
On a repository bot that is the dimension you most want to group by — cost per
user, volume per user, refusals per user, and after the tier work in
[authorization.md](./authorization.md), which tier a turn ran at.

This is not an oversight in the configuration; there is no supported path.
`evlog/eve` builds the event from the eve stream, and the enrich hook it exposes
is HTTP-shaped — `{ event, request, headers, response }` — with no reference to
the eve session, so `session.auth` is unreachable from it. Three attempts, all
from an authored eve hook calling `useLogger().set({ caller })`:

| Approach | Turns annotated |
| --- | --- |
| `useLogger()` on `turn.started` | 1 of 2 |
| `useLogger({ session: { id, turn } })` on `turn.started` | 0 of 16 |
| `useLogger()` on `step.started` | 1 of 16 |

The documented contract for `useLogger()` is a tool `execute()` handler, where
AsyncLocalStorage is guaranteed bound. Hooks sit outside it, and the evlog hook
registers the turn logger on `turn.started` itself, so two hooks race on the same
event. The attempt was removed rather than shipped: an annotation present on 6%
of turns is worse than none, because it looks like data and is a biased sample.

`evlog/eve` now records `eve.caller` itself, and `agent/instrumentation.ts` puts
the same principal on the spans. Two things follow from that. The principal is a
stable per-person identifier duplicated across logs and traces, so it inherits
whatever retention the drain has — decide that before adding a drain that keeps
events longer than the platform does. And an unauthenticated caller is omitted
rather than written blank: an empty attribute reads as a caller whose id happens
to be empty.

## Proposals

### evlog/eve — let `defineEvlogInstrumentation` take `events`

Superseded before anyone took it up: the supported composition path shipped
instead. `evlogRuntimeContext(input)` is exported from `evlog/eve`, and a
caller whose instrumentation is not evlog's alone drops the wrapper and spreads
it into their own `defineInstrumentation` — the merge the proposal wanted, done
by the caller (documented on `defineEvlogInstrumentation` in
`packages/evlog/src/eve/index.ts`).

### evlog/eve — reach the eve session from enrichment

Largely addressed for the common case: `evlog/eve` records `eve.caller` on the
event itself (see the gap section above), so grouping cost per user no longer
requires a hook. What remains here is the general ask, for consumers who want
more than the principal on the turn. Spans are still not the wide event, and
`enrich` stays HTTP-shaped. Either widen it for the eve integration to carry the
eve session, or expose a turn-scoped callback that runs where the logger is
known to exist:

```ts
defineEvlogHook({
  enrichTurn: (ctx) => ({ caller: ctx.session.auth.current?.principalId }),
})
```

Anything that avoids making consumers guess at hook ordering. Every agent on a
multi-user channel wants this, not just this one.

### evlog/eve — attribute input tokens to the tool that caused them

Landed (#622, EVL-289): `ai.tools[]` entries now carry `inputTokens`, a step
delta split across the tools that fed the model.

### evlog/eve — record the resolved provider

Landed (#622): the deployment that served the call is on the event as
`ai.provider`.

### github-tools — surface GitHub rate-limit state on tool results

Landed upstream in the github-tools extension (EVL-343, 2026-08-27): the
tool's result surface now exposes the rate-limit state and the eve extension
records it.

### github-tools — per-session tool scoping

Described in [authorization.md](./authorization.md) as a security fix. It is also
an observability one: with a caller-dependent surface, the log records which
tools a given tier actually had, so "Evi refused" and "Evi never had the tool"
stop looking identical.

### eve — eval runs leak sessions into the local world

`pnpm eval` leaves every session it opened alive: `t.succeeded()` accepts a
healthy open session by design. Each one keeps a `sessionTimeoutWorkflow` queued
against a dev server that no longer exists, so subsequent runs print a growing
wall of `[world-local] Queue delivery failed ... TypeError: fetch failed`. It
reached 409 lines on a 16-eval run here, and it grows with every run.

The queued work grows with every run and obscures real failures in the output, so
it obscures real failures rather than causing them. Either the eval runner should close the
sessions it opened, or the local world should discard messages whose target run
is gone. A related one-off also appears: `Cannot set attributes on run in
terminal state "completed"`.

## When volume justifies it

Nothing here samples: every turn is kept. That is correct at current volume and
would not be at 100x. `defineEvlogHook` takes a `keep` predicate for tail
sampling — the shape to reach for is retain-everything-interesting: tool
failures, step failures, approvals, authorizations, and turns above a cost
threshold, sampling the rest. Adding it before there is volume to shed would just
throw away data.
