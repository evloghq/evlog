---
"evlog": patch
---

A cycle in the context passed to `createLogger()` or `createRequestLogger()`, or in the fields passed to `emit()`, is logged as `'[Circular]'`, as it already was for `set()`. It used to overflow the stack when redaction was on, which it is by default in production. An `Error` in that context or in `emit()` fields is now serialized with its `name`, `message` and `stack` instead of being logged as `{}`.
