---
'evlog': patch
---

`log.fork(label, fn)` now runs `fn` on a request that evlog does not log. Before, on an Elysia route that `exclude` or `include` filters out, or with `enabled: false`, `log` had no `fork`, so `log.fork!(...)` threw `log.fork is not a function` and the route answered 500. The work runs and emits no event. If the work throws, evlog reports the error with `console.error` and `log.fork()` still resolves.
