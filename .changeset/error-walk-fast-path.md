---
"evlog": patch
---

`log.set()`, `createLogger()` and `log.emit()` no longer copy-walk their fields when they hold no `Error`. A cheaper check that copies nothing runs first and the full walk only starts when it finds an `Error` or nesting deeper than 16 levels. The output is unchanged.
