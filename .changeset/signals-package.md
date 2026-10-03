---
"@evlog/signals": minor
---

Add `@evlog/signals`: typed model judgments on wide events. `defineSignal` declares a question in English with a boolean, choice or score answer; `createSignals` runs every due signal for an event in one AI SDK `experimental_evaluate` call, attaches the verdicts as `event.signals` columns with a confidence when the model returns a distribution, and can promote events past sampling with `keep`. Fails open on timeout, budget exhaustion or model errors. Defaults to `typesafe-ai/jev` through AI Gateway.
