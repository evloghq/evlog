---
'@evlog/signals': minor
---

Add `clientFault`, a ready-made signal that triages errors logged in the browser and received through the ingest endpoint into `app`, `network`, `third-party` or `browser`. Errors sharing a name and message share one verdict. `createSignals` takes a `name` option, so client signals can run on their own instance with their own budget: `createSignals({ name: 'client-signals', signals: [clientFault], budget: { perMinute: 60 } })`.
