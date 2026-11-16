---
'evlog': patch
---

`evlog/nitro/v3` now emits a streamed response's wide event (`text/event-stream`, NDJSON, chunked, AI SDK UI streams) once its body ends or the client leaves, instead of when the headers are sent. Fields set with `log.set()` and errors recorded while the body streams now land on the event instead of being dropped with a `log.set() called after the wide event was emitted` warning, and the event keeps the status the response was sent with. This uses h3's `onDispose`, so it needs h3 2.0.1 or later; older Nitro v3 prereleases keep the header-time emit.
