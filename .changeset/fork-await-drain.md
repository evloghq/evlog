---
"evlog": minor
---

`log.fork()` returns a promise that resolves once the child event has drained, and never rejects. Await it when a write in the child, such as an audit routed to `auditOnly(sink, { await: true })`, must land before the response. With `waitUntil` set, `log.fork()` registers the child with it when called, so an unawaited fork drains before the runtime stops and `ForkLifecycle.onChildExit` fires after the child's drain. A failure after the child event is emitted, such as a throwing console write, is now logged with `console.error` instead of being dropped. Forks you leave unawaited need `void log.fork(...)` under a `no-floating-promises` lint rule.
