---
'@evlog/cli': minor
---

`evlog logs --ask "<question>"` ranks the selected events by a yes/no question a decision model answers, for what no `--where` can express: `evlog logs --path /api/checkout --ask 'The customer tried to pay but did not end up with a confirmed order'`. Filters run first, so the model sees at most `--limit` events, one call each. It needs `@evlog/signals` and `ai` 7.0.130 or later in the project, now optional peer dependencies of `@evlog/cli`, and a model key such as `AI_GATEWAY_API_KEY`. A failed call stops the run with the reason; `--json` carries `answers` as `{ probability, event }`.
