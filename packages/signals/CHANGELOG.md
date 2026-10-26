# @evlog/signals

## 1.0.0-beta.0

### Major Changes

- [#861](https://github.com/evloghq/evlog/pull/861) [`32ded2c`](https://github.com/evloghq/evlog/commit/32ded2cb572f8184f24a938539eff30f24a1d455) Thanks [@evlogai](https://github.com/apps/evlogai)! - Require Node.js 22 or later. `engines.node` is now `>=22.0.0` (it was `>=18.0.0`, and `>=20.0.0` for `@evlog/signals`). The build target follows the floor, so the published output targets Node 22.

  Nuxt 4.6.1 declares `^22.22.3 || ^24.15.0 || >=26.0.0`, so Nuxt projects should run one of those ranges.

### Patch Changes

- [#860](https://github.com/evloghq/evlog/pull/860) [`0baa9e8`](https://github.com/evloghq/evlog/commit/0baa9e8d009e8216ea7d935eec7aca36983c8a21) Thanks [@evlogai](https://github.com/apps/evlogai)! - The published packages no longer ship `.map` files. They pointed to `src/`, which is not part of the package, so they only added to the install size. `evlog` drops from 330 files (about 2.0 MB unpacked) to 178 files (about 865 KB). No runtime or API change.

- Updated dependencies [[`24ca3e3`](https://github.com/evloghq/evlog/commit/24ca3e3c1fde0e16582abc125019f8995d0a48e4), [`32ded2c`](https://github.com/evloghq/evlog/commit/32ded2cb572f8184f24a938539eff30f24a1d455), [`a0187db`](https://github.com/evloghq/evlog/commit/a0187db7a500e5a51bcaa98e5f32ca1fe6df42e5), [`0baa9e8`](https://github.com/evloghq/evlog/commit/0baa9e8d009e8216ea7d935eec7aca36983c8a21)]:
  - evlog@3.0.0-beta.0

## 0.2.2

### Patch Changes

- [#955](https://github.com/evloghq/evlog/pull/955) [`d96a2ad`](https://github.com/evloghq/evlog/commit/d96a2adaca00b241b55ebeaa1218e77aca0eb3ec) Thanks [@renovate](https://github.com/apps/renovate)! - `EvaluationQuestion` and `EvaluationAnswer` cover only the `boolean`, `choice` and `score` types a signal asks. Recent `ai` 7 releases added a `box` question type, which made an exhaustive `switch` over `question.type` in a custom `AnswerFn` fail to type-check.

## 0.2.1

### Patch Changes

- [#895](https://github.com/evloghq/evlog/pull/895) [`6203a07`](https://github.com/evloghq/evlog/commit/6203a076bf209118528ae2f562b75bbd73f5fa03) Thanks [@evlogai](https://github.com/apps/evlogai)! - The published packages no longer ship `.map` files. They pointed to `src/`, which is not part of the package, so they only added to the install size. `evlog` drops from 340 files (about 2.09 MB unpacked) to 183 files (about 905 KB). No runtime or API change.

## 0.2.0

### Minor Changes

- [#764](https://github.com/evloghq/evlog/pull/764) [`24ffe06`](https://github.com/evloghq/evlog/commit/24ffe064e67a9ac46a86f4960ee9015226604457) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `@evlog/signals`: typed model judgments on wide events. `defineSignal` declares a question in English with a boolean, choice or score answer; `createSignals` runs every due signal for an event in one AI SDK `experimental_evaluate` call, attaches the verdicts as `event.signals` columns with a confidence when the model returns a distribution, and can promote events past sampling with `keep`. Fails open on timeout, budget exhaustion or model errors. Defaults to `typesafe-ai/jev` through AI Gateway.
