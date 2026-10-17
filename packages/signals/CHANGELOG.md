# @evlog/signals

## 0.2.1

### Patch Changes

- [#895](https://github.com/evloghq/evlog/pull/895) [`6203a07`](https://github.com/evloghq/evlog/commit/6203a076bf209118528ae2f562b75bbd73f5fa03) Thanks [@evlogai](https://github.com/apps/evlogai)! - The published packages no longer ship `.map` files. They pointed to `src/`, which is not part of the package, so they only added to the install size. `evlog` drops from 340 files (about 2.09 MB unpacked) to 183 files (about 905 KB). No runtime or API change.

## 0.2.0

### Minor Changes

- [#764](https://github.com/evloghq/evlog/pull/764) [`24ffe06`](https://github.com/evloghq/evlog/commit/24ffe064e67a9ac46a86f4960ee9015226604457) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `@evlog/signals`: typed model judgments on wide events. `defineSignal` declares a question in English with a boolean, choice or score answer; `createSignals` runs every due signal for an event in one AI SDK `experimental_evaluate` call, attaches the verdicts as `event.signals` columns with a confidence when the model returns a distribution, and can promote events past sampling with `keep`. Fails open on timeout, budget exhaustion or model errors. Defaults to `typesafe-ai/jev` through AI Gateway.
