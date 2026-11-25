# Framework Wiring

The audit pipeline is the same shape in every framework: a main drain, plus the audit store wrapped in `auditOnly()`. `log.audit()` records the request context itself. Pick the section that matches the user's stack.

## Hono

```ts
import { Hono } from 'hono'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { auditOnly, signed } from 'evlog'
import { composeDrains } from 'evlog/toolkit'
import { createAxiomDrain } from 'evlog/axiom'
import { createFsDrain } from 'evlog/fs'

const app = new Hono<EvlogVariables>()
app.use(evlog({
  drain: composeDrains([
    createAxiomDrain({ dataset: 'logs' }),
    auditOnly(signed(createFsDrain({ dir: '.audit/' }), { strategy: 'hash-chain' })),
  ]),
}))
```

## Express

```ts
import express from 'express'
import { evlog } from 'evlog/express'
import { auditOnly, signed } from 'evlog'
import { composeDrains } from 'evlog/toolkit'
import { createAxiomDrain } from 'evlog/axiom'
import { createFsDrain } from 'evlog/fs'

const app = express()
app.use(evlog({
  drain: composeDrains([
    createAxiomDrain({ dataset: 'logs' }),
    auditOnly(signed(createFsDrain({ dir: '.audit/' }), { strategy: 'hash-chain' })),
  ]),
}))
```

## Next.js (App Router)

```ts
// lib/evlog.ts
import { createEvlog } from 'evlog/next'
import { auditOnly, signed } from 'evlog'
import { composeDrains } from 'evlog/toolkit'
import { createAxiomDrain } from 'evlog/axiom'
import { createFsDrain } from 'evlog/fs'

export const { withEvlog, useLogger } = createEvlog({
  service: 'my-app',
  drain: composeDrains([
    createAxiomDrain({ dataset: 'logs' }),
    auditOnly(signed(createFsDrain({ dir: '.audit/' }), { strategy: 'hash-chain' })),
  ]),
})
```

## Standalone scripts / queue workers / CLIs

No request, so `audit()` (or `withAudit()`) replaces `log.audit()`. Await it so the process does not exit before the drain has the record:

```ts
import { audit, auditOnly, initLogger, signed } from 'evlog'
import { createFsDrain } from 'evlog/fs'

initLogger({
  env: { service: 'billing-worker' },
  drain: auditOnly(signed(createFsDrain({ dir: '.audit/' }), { strategy: 'hash-chain' })),
})

await audit({
  action: 'cron.cleanup',
  actor: { type: 'system', id: 'cron' },
  target: { type: 'job', id: 'cleanup-stale-sessions' },
})
```

In a Nuxt or Nitro app, `audit()` from a task or plugin goes through the `evlog:drain` hooks, so the store registered there receives it.

## Notes that apply everywhere

- `composeDrains([...])` and separate `evlog:drain` hooks run each drain independently, so one failing drain never stops the others. A hand-written `Promise.all` must not throw on a single rejection.
- `await log.audit()` resolves once every drain has the record. Without `await`, the integration keeps the delivery alive: with `waitUntil` on Vercel, Cloudflare and Next.js (Nuxt and Nitro 2 on Vercel included), and by waiting before it finishes the request on a Node server or AWS Lambda.
- An audit recorded inside `log.fork()` is its own event too. `await log.fork(label, fn)` also waits for the audits recorded inside it.
- Route filters (`include`, `exclude`) apply to request logs only. `log.audit()` still records on a filtered route.
- For multi-process deployments behind hash-chain, persist `state.{load,save}` (Redis is the common choice) so the chain survives restarts and rolling deploys, and keep one writer, since concurrent writers fork the chain.
