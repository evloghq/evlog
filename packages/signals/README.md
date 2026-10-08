# @evlog/signals

Typed model judgments on evlog wide events.

A signal is a question about an event, written in English, answered by a decision model as a typed value with a confidence. The answer lands on the event as a column: `signals.fault.value = 'upstream'`, `signals.fault.confidence = 0.93`. You can `GROUP BY` it, alert on it, and use it to keep events that sampling would have dropped.

It is built on the AI SDK evaluate contract and defaults to Jev from TypeSafe AI, a model that returns decisions instead of text. Inference runs in your process with your key. evlog never holds a key and never bills you.

Experimental. The AI SDK API it wraps is `experimental_evaluate`, and this package is `0.x`.

## Install

```bash
pnpm add @evlog/signals ai
```

`ai` 7.0.105 or later. The default model is `typesafe-ai/jev` through Vercel AI Gateway, which reads `AI_GATEWAY_API_KEY` or OIDC on Vercel. For a direct TypeSafe key, pass a model from `@ai-sdk/typesafe-ai`.

## Quick start

One file per signal:

```ts
// signals/fault.ts
import { defineSignal } from '@evlog/signals'

export const fault = defineSignal({
  name: 'fault',
  when: e => (e.status ?? 0) >= 400,
  ask: 'Who is responsible for this failure?',
  choice: {
    client: 'Bad input, expired session, client mistake',
    app: 'A bug or misconfiguration in our own code',
    upstream: 'A third-party dependency failed',
  },
})
```

```ts
// signals/silent-failure.ts
export const silentFailure = defineSignal({
  name: 'silent-failure',
  when: e => e.status === 200 && e.path === '/api/checkout',
  ask: 'Returned 200, but the customer did not get what they came for',
  keep: v => v.value && v.confidence > 0.8,
})
```

One line to register them:

```ts
// evlog.config.ts
import { defineEvlog } from 'evlog'
import { createSignals } from '@evlog/signals'
import { fault } from './signals/fault'
import { silentFailure } from './signals/silent-failure'

export default defineEvlog({
  sampling: { rates: { info: 5 } },
  plugins: [
    createSignals({
      budget: { perMinute: 600 },
      signals: [fault, silentFailure],
    }),
  ],
})
```

`defineEvlog` only authors the config. Nothing registers until the object reaches evlog: pass it to `initLogger` or the framework integration you already use.

Every event that passes a signal's `when` gets judged. All due signals for one event go into a single model call.

## What lands on the event

```json
{
  "path": "/api/checkout",
  "status": 200,
  "payment": { "provider": "stripe", "fallback": true },
  "signals": {
    "silent-failure": { "value": true, "confidence": 0.94, "kept": true }
  }
}
```

Every column has `value`, the answer. `confidence` is its probability: always on a yes/no, on choice and score when the model returns a distribution. Score signals add `score`, the weighted position between levels. `kept: true` marks the signal that promoted the event past sampling.

| Signal shape | `value` | Extra |
| --- | --- | --- |
| `ask` | `boolean` | |
| `ask` + `choice` | one of the option names | |
| `ask` + `score` | one of the level names | `score: number` |

Columns are written before the console line, so they show in the dev terminal, in stdout JSON, in platform logs such as Vercel, and in every drain.

## API

### `defineSignal(options)`

| Option | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Column name under `event.signals`. Letters, digits, dashes. |
| `ask` | `string` | The question. |
| `when` | `(event) => boolean` | Predicate. No model call when it returns `false`. Required with `keep`. |
| `choice` | `Record<option, description>` | At least two. Makes a choice signal. |
| `score` | `[level, level, ...]` | Ordered, lowest first, at least two. Makes a score signal. |
| `criteria` | `{ true?, false? }` | Boolean signals only: what makes each answer true. |
| `keep` | `(verdict) => boolean` | Promote the event past sampling when `true`. Never drops. |
| `cacheKey` | `(event) => string \| undefined` | Reuse the verdict for events sharing a key. |

`keep` is typed on the verdict the shape produces: `v.value === 'app'` autocompletes to the options of a choice signal.

The event a signal sees is the wide event in `enrich`, or the request context plus `status`, `path`, `method` and `durationMs` in `keep`. Fields evlog sets are typed; the rest is `unknown`.

### `createSignals(options)`

Returns an evlog plugin.

| Option | Default | Notes |
| --- | --- | --- |
| `signals` | | The signals to run. Names must be unique. |
| `model` | `'typesafe-ai/jev'` | AI SDK evaluation model. A gateway id (`'liquid/d1'`), or a provider instance such as `typeSafeAi.evaluationModel('jev-latest')` or `openai.evaluationModel('gpt-6-luna')`. |
| `budget.perMinute` | `600` | Model calls per minute, shared by all signals. |
| `budget.cooldownMs` | `30000` | Pause after a failed call. |
| `timeoutMs` | `2000` | Per call. |
| `state` | whole event minus signal columns | What the model reads. Pick fields to bound tokens and egress. |
| `maxStateChars` | `100000` | Larger events are skipped. |
| `providerOptions` | | Forwarded to the call, e.g. `{ gateway: { zeroDataRetention: true } }`. |
| `evaluate` | AI SDK `experimental_evaluate` | Replace the model call. Tests, record and replay. |
| `stampModel` | `false` | Also write the answering model's id on `event.signalsModel`. For comparing models. |

`plugin.stats()` returns `{ calls, skipped, errors, cached, inputTokens }`.

### Verdict types

```ts
interface BooleanVerdict { value: boolean; confidence: number }
interface ChoiceVerdict<Option> { value: Option; confidence?: number }
interface ScoreVerdict<Level> { value: Level; score: number; confidence?: number }
```

## Guarantees

- Runs after the response. `keep` and `enrich` are evlog plugin hooks that run once the request is finished.
- Promote only. A keep signal can force an event past sampling. It cannot drop one, and baseline sampling stays deterministic. Promoted events carry `kept`, so rate-weighted counts stay valid.
- Fails open. A timeout, a failed call, an exhausted budget or an oversized state leaves the event as it was, and counts in `stats()`.
- One call per event. Signals are batched, so the state is billed once and takes one slot of the rate limit.
- Typed output only. No prose on events, and no column you did not ask for: the model id is written only with `stampModel`.
- Your key, your process. Nothing is proxied.
- No call for what a predicate can answer. `when` runs first, always.

## Cost and limits

Jev bills input tokens at $0.042 per million and output tokens are free. A 1.5k-token event costs about $0.00006, so judging 100k events costs about $6. Prices may change; check the model page.

The binding limit is rate: 1,200 requests per minute per TypeSafe account, about 20 a second. `budget.perMinute` is per process. Many instances share one account, so set it accordingly and let the breaker absorb a 429.

The default `state` is the whole event. A keep signal runs before redaction, so use `state` to pick fields if the request context holds anything you would not send to a model.

A keep signal waits for the model before the sampling decision, up to `timeoutMs`. The response is already sent, so the client never waits, and `durationMs` is measured before keep hooks run, so the event carries the request's duration, not the judgment's.

## Use cases

The demo catalog in `scripts/catalog.ts` runs all of these.

| Signal | Hook | Question | Why a rule cannot |
| --- | --- | --- | --- |
| `fault` | enrich, cached | Who is responsible: user, us, upstream | A Stripe timeout and a null deref are both a 500 |
| `severity` | enrich | noise, watch or page | Urgency depends on what failed and for whom |
| `retryable` | enrich, cached | Would a retry succeed | Transient and permanent errors share status codes |
| `silent-failure` | keep | 200, but the customer left empty-handed | Sampling only keeps what a predicate can name |
| `webhook-ignored` | keep | Acknowledged but not acted on | The provider only sees the 200 |
| `slow-cause` | enrich | database, upstream, compute | Reading the timings takes a human |
| `validation-bug` | keep | The rejected input was valid | Looks identical to bad input |
| `turn-resolved` | enrich | The agent did what was asked | LLM-as-judge at a few percent sampling misses the rest |
| `turn-looping` | keep | Repeated a tool call without progress | Loops hide in successful turns |
| `turn-off-script` | keep | Did something nobody asked for | Same |
| `audit-review` | keep | This action deserves a reviewer | Risk is in the combination, not one field |
| `job-flaky` | enrich | Succeeded only because it retried | The retry hides the cause |

Others that fit the same shape: `first-seen` (is this error new for this route), `user-impact` (none, degraded, blocked), `owner` (which team should look), `known-error` (which catalog entry is this, from your own `why` and `fix`), `frustration` on support conversations, `did-succeed` on session events.

Not a fit: secret or PII detection (sending secrets to an API to ask if they are secrets), paging decisions (never page on a probability), anything adversarial as a single verdict, anything numeric.

## Demo

```bash
pnpm --filter @evlog/signals demo -- --mock        # scripted answers, no key
AI_GATEWAY_API_KEY=... pnpm --filter @evlog/signals demo
pnpm --filter @evlog/signals demo -- --all         # sample 100% so every column shows
pnpm --filter @evlog/signals demo -- --events ./logs/events.ndjson
```

The default run samples info at 0% and shows which requests the signals promoted. `--events` replays wide events from an fs drain file through the catalog with the real model.
