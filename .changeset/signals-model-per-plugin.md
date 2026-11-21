---
'@evlog/signals': minor
---

`stampModel` writes `event.signalsModel` as an object keyed by plugin name (`signals` for the default instance) instead of a string. Two named `createSignals` instances that judge the same event, one per model under comparison, each keep their own model id. Read `event.signalsModel.signals` where you read `event.signalsModel` before.
