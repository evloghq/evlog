---
"evlog": patch
---

`withEvlog` and `defineWorkerFetch` (`evlog/workers`) keep the type of an annotated `ctx`, so a handler typed with Cloudflare's `ExecutionContext` reaches `ctx.exports`, `ctx.props` and `ctx.passThroughOnException()` without a cast. An unannotated `ctx` is still `WorkerExecutionContext`.
