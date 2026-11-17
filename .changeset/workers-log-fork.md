---
"evlog": minor
---

`evlog/workers`: the logger `withEvlog` passes to the handler now has `log.fork(label, fn)`. Workers has no `useLogger()`, so `fn` receives the forked logger as its argument. The child emits its own wide event with `operation` and `_parentRequestId`, and the fork is registered with `ctx.waitUntil`:

```ts
export default withEvlog(async (request, env, ctx, log) => {
  log.fork('send_receipt', async (child) => {
    child.set({ receipt: { orderId } })
    await sendReceipt(orderId)
  })
  return Response.json({ ok: true })
})
```

The toolkit's `forkBackgroundLogger` now runs without `storage`, for an integration without `AsyncLocalStorage`, and passes the forked logger to `fn` in every case.
