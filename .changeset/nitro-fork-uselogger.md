---
"evlog": minor
---

Nitro v3, Nitro v2 and Nuxt: the request logger now has `log.fork(label, fn)`, and `useLogger()` works without the event.

`log.fork()` runs background work under a forked logger, passed to `fn`, that emits its own wide event with `operation` and `_parentRequestId`. The child goes through the `evlog:enrich` and `evlog:drain` hooks like the request event, and is registered with `waitUntil` where the runtime provides one:

```ts
export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  log.fork('send_receipt', async (child) => {
    child.set({ receipt: { sent: true } })
    await sendReceipt()
  })
  return { ok: true }
})
```

With Nitro's request context turned on (`experimental: { asyncContext: true }` in `nitro.config.ts`, or `nitro.experimental` in `nuxt.config.ts`), `useLogger()` with no argument returns the current request logger, so services can reach it without the event. Without the flag it throws an error that names it. `useLogger(event)` is unchanged and works on every runtime.
