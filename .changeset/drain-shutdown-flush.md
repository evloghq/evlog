---
'evlog': minor
---

`createDrainPipeline` delivers buffered events when the process stops, without a shutdown hook of your own.

- On Node and Bun, every pipeline that holds events is flushed on `SIGTERM` and `SIGINT`, for up to 400 ms. Then the signal's default exit runs, so the process stops exactly as it would without evlog. When your app has its own listener for that signal, evlog flushes and leaves the exit to it. Buffered events used to be lost on a signal unless you flushed them yourself.
- On `beforeExit`, when the event loop runs out of work, pending pipelines flush to completion. A script that ends without calling `drain.flush()` no longer loses its last batch.
- The Nitro `close` hook flushes every pending pipeline, not only the `evlog.config.ts` drain. The Fastify plugin flushes on `onClose` and `EvlogModule` on `onApplicationShutdown`.
- A `flush()` call that starts while another is still sending now resolves once that delivery is done. It used to resolve at once, because the first call had already taken the events out of the buffer, so `await drain.flush()` before exiting could still lose them.
- A pipeline with nothing buffered is not tracked, and evlog adds no listener before the first pipeline receives an event.

`process.exit()` still ends the process without a flush, so keep `await drain.flush()` before it. A `process.on('SIGTERM', () => drain.flush())` listener is no longer needed; it also cancels Node's default exit, so remove it unless your app exits from it.
