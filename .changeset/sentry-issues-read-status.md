---
"evlog": patch
---

The Sentry drain's `issues` option reads an error's `status`, then the event's `status`, when it decides whether an event is a 4xx. It no longer reads the legacy `statusCode`, so an error that only carries `statusCode` is classified by the event's `status`. Logs and the drained wide event are unchanged.
