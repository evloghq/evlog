---
"evlog": minor
---

`evlog/toolkit` exports `redactEvent` and `resolveRedactConfig`, so an integration can redact a value with the same rules as the logger before it shortens or transforms it. Pass the result of `resolveRedactConfig(redact)` to `redactEvent`, which returns a redacted copy:

```ts
import { redactEvent, resolveRedactConfig } from 'evlog/toolkit'

const config = resolveRedactConfig(true)
const safe = config ? redactEvent({ output }, config) : { output }
```
