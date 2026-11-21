# @evlog/signals

## 0.3.0

### Minor Changes

- [#1171](https://github.com/evloghq/evlog/pull/1171) [`62919df`](https://github.com/evloghq/evlog/commit/62919df86224b7c339be07ebe4b3106b13285f10) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Typed verdicts in code, a `keep` threshold shorthand, cache expiry, and one model call for kept events. Requires `ai` 7.0.130 or later.

  - `signal.read(event)` returns the signal's column from a judged event, typed on its options or levels: `retryable.read(event)?.value`.
  - On yes/no signals, `keep: 0.8` is short for `keep: v => v.value && v.confidence > 0.8`.
  - `createSignals({ cacheTtlMs })` sets how long a `cacheKey` verdict is reused. Default 5 minutes; verdicts used to be kept until 1,000 newer ones pushed them out.
  - When a keep signal is due, the other due signals are asked in the same call, so a kept event costs one call instead of two.
  - `budget.perMinute` is a token bucket refilled evenly over the minute, instead of a fixed window that allowed up to twice the limit across a window boundary.
  - The breaker opens after three failed calls in a row instead of after one.
  - Keep signals see `path` and `method` from the sampling context when the request context does not carry them.
  - Calls go through the AI SDK's `experimental_decide`, which replaced the deprecated `experimental_evaluate`. The peer dependency on `ai` moves from 7.0.105 to 7.0.130.

- [#1173](https://github.com/evloghq/evlog/pull/1173) [`1fb6b37`](https://github.com/evloghq/evlog/commit/1fb6b3747d2300166b04ff61d97e7b8e6aed4938) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `clientFault`, a ready-made signal that triages errors logged in the browser and received through the ingest endpoint into `app`, `network`, `third-party` or `browser`. Errors sharing a name and message share one verdict. `createSignals` takes a `name` option, so client signals can run on their own instance with their own budget: `createSignals({ name: 'client-signals', signals: [clientFault], budget: { perMinute: 60 } })`.

- [#1174](https://github.com/evloghq/evlog/pull/1174) [`2ca48f0`](https://github.com/evloghq/evlog/commit/2ca48f0006407ac7130439a5b76d8c53ddc4fabc) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `knownError`, a ready-made signal that matches errors thrown without a catalog `code` (a raw Stripe exception, a library's `jwt expired`) to the entry of your error catalog that describes them, or to `new` when none does. Pass it your catalogs and factories: `createSignals({ signals: [knownError([billingErrors, authErrors])] })`. Each entry's string `message` and its `why` describe the option; errors already carrying a catalog `code` are skipped, and errors sharing a name and message share one verdict.

- [#1173](https://github.com/evloghq/evlog/pull/1173) [`1fb6b37`](https://github.com/evloghq/evlog/commit/1fb6b3747d2300166b04ff61d97e7b8e6aed4938) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `stampModel` writes `event.signalsModel` as an object keyed by plugin name (`signals` for the default instance) instead of a string. Two named `createSignals` instances that judge the same event, one per model under comparison, each keep their own model id. Read `event.signalsModel.signals` where you read `event.signalsModel` before.

- [#1177](https://github.com/evloghq/evlog/pull/1177) [`f04e9cd`](https://github.com/evloghq/evlog/commit/f04e9cdc993dfce9bc2152e0e372bb1db8d3cbda) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Traffic spikes no longer starve keep signals or flood the model.

  - `budget.keepShare` (default `0.25`) holds part of `perMinute` for keep signals, so an error storm judged in `enrich` cannot spend it.
  - `budget.maxConcurrent` (default `16`) caps calls in flight. Events past it pass through unjudged and count as `skipped`.
  - The budget bucket holds 10 seconds of `perMinute` instead of the whole minute, so a spike after a quiet period spends at most a sixth of it at once.
  - Under a spike, events are judged with the probability the budget can afford instead of first come, first served. A verdict judged after skipped events carries `rate` on its column: `sum(1 / rate)` estimates the count.
  - A skipped event no longer serializes its state.
  - `errorFingerprint` is a ready-made `cacheKey` that keys on the error with ids, timestamps and numbers stripped: `cacheKey: errorFingerprint`.

### Patch Changes

- [#1170](https://github.com/evloghq/evlog/pull/1170) [`dcd3390`](https://github.com/evloghq/evlog/commit/dcd339056eff175ef14d047fb5d531de51488e7a) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix two cases where `@evlog/signals` judged fewer or more events than documented.

  - Concurrent events sharing a `cacheKey` now share one model call. The verdict used to be cached only after the first call returned, so an error storm of identical events made one call per event. Events that wait on a running call count in `stats().cached`.
  - A refusal from the model (`Experimental_DecisionRefusalError`, `ai` 7.0.130 and later) no longer opens the breaker. It used to count as a failed call and skip every event for `budget.cooldownMs`. A refused call records no verdict and counts in the new `stats().refused`.

## 0.2.2

### Patch Changes

- [#955](https://github.com/evloghq/evlog/pull/955) [`d96a2ad`](https://github.com/evloghq/evlog/commit/d96a2adaca00b241b55ebeaa1218e77aca0eb3ec) Thanks [@renovate](https://github.com/apps/renovate)! - `EvaluationQuestion` and `EvaluationAnswer` cover only the `boolean`, `choice` and `score` types a signal asks. Recent `ai` 7 releases added a `box` question type, which made an exhaustive `switch` over `question.type` in a custom `AnswerFn` fail to type-check.

## 0.2.1

### Patch Changes

- [#895](https://github.com/evloghq/evlog/pull/895) [`6203a07`](https://github.com/evloghq/evlog/commit/6203a076bf209118528ae2f562b75bbd73f5fa03) Thanks [@evlogai](https://github.com/apps/evlogai)! - The published packages no longer ship `.map` files. They pointed to `src/`, which is not part of the package, so they only added to the install size. `evlog` drops from 340 files (about 2.09 MB unpacked) to 183 files (about 905 KB). No runtime or API change.

## 0.2.0

### Minor Changes

- [#764](https://github.com/evloghq/evlog/pull/764) [`24ffe06`](https://github.com/evloghq/evlog/commit/24ffe064e67a9ac46a86f4960ee9015226604457) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `@evlog/signals`: typed model judgments on wide events. `defineSignal` declares a question in English with a boolean, choice or score answer; `createSignals` runs every due signal for an event in one AI SDK `experimental_evaluate` call, attaches the verdicts as `event.signals` columns with a confidence when the model returns a distribution, and can promote events past sampling with `keep`. Fails open on timeout, budget exhaustion or model errors. Defaults to `typesafe-ai/jev` through AI Gateway.
