---
"evlog": minor
---

Nuxt and Nitro now run the request hooks of evlog plugins. A plugin listed in `plugins` of `evlog.config.ts` gets `extendLogger` and `onRequestStart` when the request logger is created, and `onRequestFinish` after the wide event is emitted, with the status, duration and error. Before, those apps ran only a plugin's `enrich`, `drain` and `keep`, so a plugin such as `createOtelPlugin()` from `evlog/otel` did nothing there.

```ts
// evlog.config.ts
import { defineEvlog } from 'evlog'
import { createOtelPlugin } from 'evlog/otel'

export default defineEvlog({ plugins: [createOtelPlugin()] })
```
