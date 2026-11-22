---
"evlog": patch
---

`log.set()`, `createLogger()` and `log.emit()` no longer copy-walk their fields when they hold no `Error`. A check that allocates nothing runs first and the full walk only starts when it finds an `Error` or nesting deeper than 16 levels. Building a request's wide event is about 4% faster at the same output.
