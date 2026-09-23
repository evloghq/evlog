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
`git.{branch,pushed,sha,reason,exitCode}`, `git.checkout.{repository,done,sha,reason,exitCode}`, `git.install.{repository,done,reason,exitCode}`,
`capture.{published,viewport,target,beforeHost,afterHost,reason}`,
`blob.{uploaded,bytes,reason}`, `turbo.{remoteCache,reason}`,
`vercel.{env,key,project,target,reason,status}`,
`gateway.report.{mode,groupBy,matchedRows}`,
`content.{scanned,candidates,eligible,targets,group,surface,reason}`,
`image.{host,fetched,bytes,mediaType,reason}`, and
`memory.{saved,refused,searched,hits}`. A content pass that held everything or
a push that was refused is chartable from the turn event alone. Tool executes
are the one place `useLogger()` is contractually bound (see the caller gap
below); hooks and the subagents stay uninstrumented, and the two pieces of
work that run outside a turn emit their own events (below).

## Errors

Every failure Evi authors comes from the catalog in `agent/lib/errors.ts`
(`defineErrorCatalog('evi', …)`), so a `reason` field is always a catalog code
(`evi.GITHUB_NOT_INSTALLED`, `evi.GIT_COMMAND_FAILED`, …) and never an ad-hoc
string. A tool refuses through `refusal(eviErrors.X(...))`, which returns
`{ success: false, code, error }`: the model reads `error` (message plus the
entry's `fix`), the turn event records `code` under the tool's namespace.
Messages are Evi's own words; a third-party response body goes to `internal`,
which `EvlogError` keeps out of `toJSON` and so out of every tool result.
`log.error(error)` is a different path: it serializes the error's getters,
`internal` included, so an out-of-turn handler records the message and code,
never the error object. One more rule the types do not enforce: a templated
param must not be named like an override (`status`, `message`, `fix`, ...),
because the factory strips those before templating.

What the catalog does not do today: reach eve's failure events. `turn.failed`
carries the code of the harness failure that ended the turn
(`MODEL_CALL_FAILED`, `EVENT_HANDLER_FAILED`, …), and a tool that throws is
reduced to `error.message` on its way to the model and to `ai.tools[].error`
(`createRuntimeToolResultFromToolError` in eve's harness). So a thrown catalog
error is visible as text, not as a code, which is why the tools return
refusals instead of throwing wherever the failure is theirs to report. The
`_Error code:` line in `lib/failure.ts` prints eve's code, not Evi's. Proposal
for eve below.

## Out-of-turn events

Two pieces of work run with no turn to attach to: the silent escalation of a
failed autonomous triage (`lib/github/escalate.ts`) and the cron handoff into
Slack (`lib/schedule.ts`). Both emit one wide event through `jobLogger()`
(`agent/lib/job.ts`), which is evlog's global logger with a `job` field
(`github.escalate`, `schedule.send`). `agent/hooks/evlog.ts` gives that global
logger its own drain, the same fs and PostHog destinations as the turns but
under the `evi_job` event name, so a chart of turns never counts a cron
handoff. Turn events bypass the global drain (`_deferDrain`), so nothing is
delivered twice.

`environment` comes from `agent/lib/environment.ts`, the same function that
builds the gateway spend tags. That is deliberate: a run that bills as `eval`
also logs as `eval`, so the two views line up. Before, wide events reported
`development` for both eval and local traffic while the spend report separated
them: the kind of drift that makes a dashboard quietly lie.

The fs drain only attaches where there is a durable disk. On Vercel everything
outside `/tmp` is read-only and `createFsDrain` guards neither its `mkdir` nor
its `appendFile`, so shipping it there would throw once per turn and write events
nobody could read. Hosted, stdout is the transport and the platform captures it.

`agent/instrumentation/` enables eve's OpenTelemetry surface: `otel.ts` holds
the process-wide, metadata-only trace policy and `posthog.ts` is the PostHog
destination. Without those files there is no span tree at all. The Agent Runs
tab is fed by Workflow run tags, which are a separate system. With them, a turn
produces `invoke_agent` → `agent.step` per step → `chat` for the model call and
`agent.action` → `execute_tool` per tool. That is the only place per-tool timing
and per-step model input are visible; the wide event says a turn called six
tools, the span tree says which step each ran in and what the model saw first.
`evlogRuntimeContext`, spread into the destination's `runtimeContext`, stamps
`evlog.request_id` and `evlog.session_id` on every span, so a slow span resolves
to its wide event and back. Without `POSTHOG_API_KEY` the destination disables
itself and eve keeps traces local.

## Not yet verified

`sessionEvent: true` is set but has never been observed firing. It emits on
`session.completed` / `session.failed`, and the eval runner leaves sessions open
by design, so 17 turn events across a full suite produced zero rollups. It is
configured, not confirmed. Check it against a real GitHub thread that ends.

## The gap: nothing identifies the caller

A turn event says what happened and what it cost. It does not say **who asked**.
On a repository bot that is the dimension you most want to group by: cost per
user, volume per user, refusals per user, and after the tier work in
[authorization.md](./authorization.md), which tier a turn ran at.

This is not an oversight in the configuration; there is no supported path.
`evlog/eve` builds the event from the eve stream, and the enrich hook it exposes
is HTTP-shaped, `{ event, request, headers, response }`, with no reference to
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

`evlog/eve` now records `eve.caller` itself, and `agent/instrumentation/posthog.ts`
puts the same principal on the spans. Two things follow from that. The principal is a
stable per-person identifier duplicated across logs and traces, so it inherits
whatever retention the drain has. Decide that before adding a drain that keeps
events longer than the platform does. And an unauthenticated caller is omitted
rather than written blank: an empty attribute reads as a caller whose id happens
to be empty.

## Proposals

### evlog/eve: let `defineEvlogInstrumentation` take `events`

Superseded before anyone took it up: the supported composition path shipped
instead. `evlogRuntimeContext(input)` is exported from `evlog/eve`, and a
caller whose instrumentation is not evlog's alone drops the wrapper and spreads
it into their own `defineInstrumentation`, the merge the proposal wanted, done
by the caller (documented on `defineEvlogInstrumentation` in
`packages/evlog/src/eve/index.ts`).

### evlog/eve: reach the eve session from enrichment

Landed: `defineEvlogHook()` takes `enrichTurn`, a turn-scoped callback that runs
where the turn logger is created, with the eve session in scope:

```ts
defineEvlogHook({
  enrichTurn: (ctx) => ({ caller: ctx.session.auth.current?.principalId }),
})
```

Returned fields merge onto the turn event, over the built-ins, and are not
carried across turns of the same session. The shape decision: `enrich` stays
HTTP-shaped because it is part of `BaseEvlogOptions`, shared by every framework
integration, and widening it would put the eve session into every HTTP
integration's contract. A turn-scoped option on the eve hook keeps it local and
removes the hook-ordering guesswork.

### evlog/eve: attribute input tokens to the tool that caused them

Landed (#622, EVL-289): `ai.tools[]` entries now carry `inputTokens`, a step
delta split across the tools that fed the model.

### evlog/eve: record the resolved provider

Landed (#622): the deployment that served the call is on the event as
`ai.provider`.

### eve: preserve a thrown error's `code` on tool results and `turn.failed`

A tool that throws an error carrying `code` (evlog's `EvlogError`, any
`Error` subclass with the field) loses it at the harness boundary:
`createRuntimeToolResultFromToolError` keeps `message` only, and
`turn.failed` carries the harness's own code. Keeping `code` on the runtime
tool result (and `details.code` on the failure events) would let `evlog/eve`
record it on `ai.tools[]`, and let a channel's failure comment print the
application's code rather than `EVENT_HANDLER_FAILED`. Until then, Evi's
catalog is visible through refusal results and `reason` fields only.

### github-tools: surface GitHub rate-limit state on tool results

Landed upstream in the github-tools extension (EVL-343, 2026-08-27): the
tool's result surface now exposes the rate-limit state and the eve extension
records it.

### github-tools: per-session tool scoping

Described in [authorization.md](./authorization.md) as a security fix. It is also
an observability one: with a caller-dependent surface, the log records which
tools a given tier actually had, so "Evi refused" and "Evi never had the tool"
stop looking identical.

### eve: eval runs leak sessions into the local world

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
sampling. The shape to reach for is retain-everything-interesting: tool
failures, step failures, approvals, authorizations, and turns above a cost
threshold, sampling the rest. Adding it before there is volume to shed would just
throw away data.
