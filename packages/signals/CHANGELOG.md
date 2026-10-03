# @evlog/signals

## 0.2.0

### Minor Changes

- [#764](https://github.com/evloghq/evlog/pull/764) [`24ffe06`](https://github.com/evloghq/evlog/commit/24ffe064e67a9ac46a86f4960ee9015226604457) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `@evlog/signals`: typed model judgments on wide events. `defineSignal` declares a question in English with a boolean, choice or score answer; `createSignals` runs every due signal for an event in one AI SDK `experimental_evaluate` call, attaches the verdicts as `event.signals` columns with a confidence when the model returns a distribution, and can promote events past sampling with `keep`. Fails open on timeout, budget exhaustion or model errors. Defaults to `typesafe-ai/jev` through AI Gateway.
