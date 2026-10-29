---
"evlog": patch
---

Nitro v3: a request that throws keeps its exception and HTTP status in the wide event when an earlier async `error` hook delays evlog's own. Before, the response hook could emit first, so the event had `level: "info"` and no `error`, and the `log.error()`, `log.set()` and `log.emit()` calls that ran afterwards logged "called after the wide event was emitted" warnings. The response hook now leaves the emit to the error hook whenever Nitro has recorded an error for the request.
