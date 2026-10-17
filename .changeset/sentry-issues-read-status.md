---
"evlog": patch
---

The Sentry drain's `issues` option now reads an error's `status` before its legacy `statusCode` when it decides whether an event is a 4xx. An `EvlogError` carries both, so an error whose two values disagree is classified by `status`. Logs and the drained wide event are unchanged.
