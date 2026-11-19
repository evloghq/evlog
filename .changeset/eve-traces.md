---
"@evlog/eve": minor
---

`evlogTraces()`, from the new `@evlog/eve/instrumentation` entry, puts each turn's `traceId` and `invoke_agent` `spanId` on its wide event, so the OTLP drain links the event to the trace eve records and `vercel traces inspect` opens it. eve runs no span while tools and hooks run, so `createOtelPlugin()` cannot read one there. Export it from a file of the agent's own, since extensions cannot declare instrumentation:

```ts
// agent/instrumentation/evlog.ts
import { evlogTraces } from '@evlog/eve/instrumentation'

export default evlogTraces()
```
