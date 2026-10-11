---
'evlog': patch
---

Add `debug()` to the request logger. `useLogger(event).debug('...')` threw `log.debug is not a function`, though the generated `AGENTS.md` tells agents to use `log.debug()` for step detail. It now records a `debug` entry in `requestLogs` and merges its context, without raising the event level, and the `evlog/vite` plugin strips it from production builds like the global `log.debug()`.
