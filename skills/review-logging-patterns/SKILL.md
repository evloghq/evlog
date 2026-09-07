---
name: review-logging-patterns
description: Review code for logging patterns and suggest evlog adoption. Optionally use @evlog/cli (`evlog init` to wire evlog on Nuxt, Nitro, Next.js, TanStack Start, and Hono; `evlog agents` to write the conventions into AGENTS.md; `evlog map` to score entry-point coverage on those plus Express, Fastify, and Elysia; `--baseline` to gate regressions in CI). Guides setup on those plus SvelteKit, React Router, NestJS, oRPC, Cloudflare Workers, AWS Lambda, Astro, and standalone TypeScript. Detects console.log spam, unstructured errors, and missing context. Covers wide events, structured errors, drain adapters (Axiom, OTLP, HyperDX, PostHog, Sentry, Better Stack, Datadog, Loki, ClickHouse, NuxtHub, Memory), sampling, enrichers, and AI SDK integration.
license: MIT
metadata:
  author: HugoRCD
  version: "0.9"
---

# Review logging patterns

Review and improve logging patterns in TypeScript/JavaScript codebases. Transform scattered console.logs into structured wide events and convert generic errors into self-documenting structured errors.

## When to Use

- Setting up evlog in a new or existing project (any supported framework)
- Reviewing code for logging best practices
- Converting console.log statements to structured logging
- Improving error handling with better context
- Configuring log draining, sampling, or enrichment

## Quick Reference

| Working on...           | Resource                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| Setup (CLI)             | [`evlog init`](https://www.evlog.dev/cli/init) — wire evlog into the project |
| Project conventions (CLI) | [`evlog agents`](https://www.evlog.dev/cli/agents) — write the evlog block into the project's AGENTS.md |
| Coverage map (CLI)      | [`evlog map`](https://www.evlog.dev/cli/map) — score dark entry points |
| CI gating (CLI)         | [`evlog map --min-score / --baseline`](https://www.evlog.dev/cli/ci) — gate regressions |
| Wide events patterns    | [references/wide-events.md](references/wide-events.md)             |
| Error handling          | [references/structured-errors.md](references/structured-errors.md) |
| Code review checklist   | [references/code-review.md](references/code-review.md)             |
| Drain pipeline          | [references/drain-pipeline.md](references/drain-pipeline.md)       |
| Audit logs              | [build-audit-logs](../build-audit-logs/SKILL.md) skill + [docs](https://www.evlog.dev/use-cases/audit/overview) |

## Audit logs

For security-sensitive actions (auth, billing, admin, data export), use evlog's audit layer: a typed `audit` field on wide events, not a parallel logger. See the **`build-audit-logs`** skill for end-to-end setup (`log.audit`, `withAudit`, denials, `auditEnricher`, `auditOnly`, `signed`, `mockAudit`).

```typescript
log.audit({
  action: 'invoice.refund',
  actor: { type: 'user', id: user.id },
  target: { type: 'invoice', id: invoice.id },
  outcome: 'success',
})
```

Docs: https://www.evlog.dev/use-cases/audit/overview

## Installation

```bash
npm install evlog
```

## Use the CLI (recommended on Nuxt, Nitro, Next.js, TanStack Start, Hono, Express, Fastify, Elysia)

`@evlog/cli` is a **separate package** from `evlog`, early but worth trying. It reads the project on disk (no traffic, no config). On Nuxt, Nitro, Next.js, TanStack Start, and Hono, `init` wires evlog in one pass. On those five plus Express, Fastify, and Elysia, `map` scores entry-point coverage; `--min-score` and `--baseline` gate regressions in CI. Express, Fastify, and Elysia are **map-only** today. `init` refuses them, so use the manual framework sections below for setup. If the CLI is unavailable, the framework has no adapter yet, or the user declines, continue with the manual sections below; the skill does not depend on it. **Ask before installing anything**; prefer `npx` / `pnpm dlx` for one-shots.

### 1. Setup: `evlog init`

On a project that doesn't use evlog yet, prefer `init` over hand-writing the setup when the framework supports it (Nuxt, Nitro, Next.js, TanStack Start, Hono). It detects the framework, reads what the project already has, and generates config, drains, enrichers, and extras in one pass. It is fully scriptable for agents:

```bash
# preview everything without writing (always start here)
npx @evlog/cli init --dry-run --yes

# then apply — flags instead of prompts
npx @evlog/cli init --yes \
  --service my-app \
  --drain fs \
  --prodDrain axiom \
  --extras enrichers,pipeline,sampling \
  --sampling medium
```

Useful flags: `--framework` (override detection for `init`: `nuxt`, `nitro`, `next`, `tanstack-start`, `hono`; for `map` only, also `express`, `fastify`, `elysia`), `--prodDrain` (comma-separated: `axiom`, `otlp`, `posthog`, `sentry`, `better-stack`, `datadog`, `hyperdx`), `--extras` (`enrichers`, `pipeline`, `sampling`, `vite`, `error-catalog`, `audit-catalog`, `ai`, `better-auth`), `--enrichers`, `--sampling` (traffic tier: `all`, `low`, `medium`, `high`, `very-high`), `--apps` (monorepo: which workspace packages), `--no-install`. Review the `--dry-run` output with the user before applying. Docs: https://www.evlog.dev/cli/init

### 2. Score: `evlog map`

```bash
npx @evlog/cli map --no-write
# agents: npx @evlog/cli map --json --no-write
```

What you get:

- A project score and which entry points are still dark
- **FIX FIRST**: the three most valuable places to fix
- **GOING FURTHER**: opportunities (catalogs, audit coverage, AI logging, auth identity) that never cost points
- Per-file inspect: `npx @evlog/cli map <file> --no-write` shows the shape the handler could take
- Re-run after fixes and watch the score move

Work FIX FIRST in order, keep changes minimal (`useLogger()`, `log.set()`, `log.audit()`, `createError({ why, fix })`), then re-run with `--no-write`. Omit `--no-write` only when the user wants `evlog.map.json` written.

### 3. Lock it in CI: `--min-score` and `--baseline`

After fixing, propose making the score durable. This is where the CLI earns its keep:

```bash
# in CI, after pnpm add -D @evlog/cli (project-local, pinned by the lockfile)
pnpm exec evlog map --min-score 80   # absolute gate: exits 1 below the threshold
pnpm exec evlog map --baseline       # ratchet: exits 1 if this PR made things worse
```

`--baseline` compares the fresh scan against the committed `evlog.map.json`, **per entry point and per requirement**, so a refactor that instruments one route and breaks another fails even if the total score is unchanged. Disabling a passing check with a comment counts as a regression too. New uninstrumented routes are listed as `NEW AND DARK` without failing. Workflow: commit `evlog.map.json` once, add the `--baseline` run to CI (`pnpm add -D @evlog/cli` for a pinned version, and ask first), then re-run `map` without `--baseline` to accept an intentional change. Docs: https://www.evlog.dev/cli/ci

Early days: adapters and rules are still evolving; expect scores to move between releases. Docs: https://www.evlog.dev/cli/map · Rules: https://www.evlog.dev/cli/rules

---

## Framework Setup

### Nuxt

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    env: { service: 'my-app' },
    include: ['/api/**'],
  },
})
```

`useLogger`, `log`, and `parseError` are **auto-imported**. `createError` is not: a bare one resolves to h3's, which drops `why`, `fix`, and `link`. Import it from `evlog`.

```typescript
// server/api/checkout.post.ts — no imports needed
export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  log.set({ user: { id: user.id, plan: user.plan } })
  return { success: true }
})
```

Drain, enrich, and tail sampling use Nitro hooks in server plugins:

```typescript
// server/plugins/evlog-drain.ts
import { createAxiomDrain } from 'evlog/axiom'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', createAxiomDrain())
})
```

Client transport (auto-configured Vue plugin):

```typescript
// nuxt.config.ts
evlog: {
  transport: { enabled: true },  // logs sent to /api/_evlog/ingest
}
```

Client-side: `log`, `setIdentity`, `clearIdentity` are auto-imported in components.

### Next.js

**Step 1: Create central config.** All exports come from here:

```typescript
// lib/evlog.ts
import type { DrainContext } from 'evlog'
import { createEvlog } from 'evlog/next'
import { createUserAgentEnricher, createRequestSizeEnricher } from 'evlog/enrichers'
import { createDrainPipeline } from 'evlog/pipeline'

const enrichers = [createUserAgentEnricher(), createRequestSizeEnricher()]
const pipeline = createDrainPipeline<DrainContext>({ batch: { size: 50, intervalMs: 5000 } })
const drain = pipeline(createAxiomDrain({ dataset: 'logs', apiKey: process.env.AXIOM_API_KEY! }))

export const { withEvlog, useLogger, log, createError } = createEvlog({
  service: 'my-app',
  sampling: {
    rates: { info: 10 },
    keep: [{ status: 400 }, { duration: 1000 }],
  },
  routes: {
    '/api/auth/**': { service: 'auth-service' },
    '/api/checkout/**': { service: 'checkout-service' },
  },
  keep: (ctx) => {
    const user = ctx.context.user as { premium?: boolean } | undefined
    if (user?.premium) ctx.shouldKeep = true
  },
  enrich: (ctx) => {
    for (const enricher of enrichers) enricher(ctx)
  },
  drain,
})
```

**Step 2: Wrap route handlers** with `withEvlog()`:

```typescript
// app/api/checkout/route.ts
import { withEvlog, useLogger } from '@/lib/evlog'

export const POST = withEvlog(async (request: Request) => {
  const log = useLogger()  // Zero arguments — uses AsyncLocalStorage
  log.set({ user: { id: 'user_123', plan: 'enterprise' } })
  log.set({ cart: { items: 3, total: 14999 } })
  return Response.json({ success: true })
})
```

**Step 3: Server Actions.** Same `withEvlog()` wrapper:

```typescript
// app/actions.ts
'use server'
import { withEvlog, useLogger } from '@/lib/evlog'

export const checkout = withEvlog(async (formData: FormData) => {
  const log = useLogger()
  log.set({ action: 'checkout', source: 'server-action' })
  return { success: true }
})
```

**Step 4: Middleware** (optional, sets `x-request-id` + timing headers):

```typescript
// proxy.ts
import { evlogMiddleware } from 'evlog/next'
export const proxy = evlogMiddleware()
export const config = { matcher: ['/api/:path*'] }
```

**Step 5: Client Provider.** Wrap the root layout:

```tsx
// app/layout.tsx
import { EvlogProvider } from 'evlog/next/client'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <EvlogProvider service="my-app" transport={{ enabled: true, endpoint: '/api/evlog/ingest' }}>
          {children}
        </EvlogProvider>
      </body>
    </html>
  )
}
```

**Step 6: Client logging.** In any client component:

```tsx
'use client'
import { log, setIdentity, clearIdentity } from 'evlog/next/client'

setIdentity({ userId: 'usr_123' })
log.info({ action: 'checkout_click' })
clearIdentity()
```

**Step 7 (optional): Instrumentation.** Startup plus global `onRequestError` (SSR/RSC errors outside `withEvlog`). Use `defineNodeInstrumentation(() => import('./lib/evlog'))` in root `instrumentation.ts` to gate Node + cache the import, **or** write `register`/`onRequestError` manually. Both are valid. For custom logic, wrap evlog’s `register`/`onRequestError` inside `lib/evlog.ts` (compose with your own init or metrics), then re-export.

Export `createInstrumentation()` from `lib/evlog.ts` alongside `createEvlog()`. See framework docs for coexistence with `lockLogger`.

**Step 8: Client ingest endpoint.** Receives client logs:

```typescript
// app/api/evlog/ingest/route.ts
import { NextRequest } from 'next/server'

const VALID_LEVELS = ['info', 'error', 'warn', 'debug'] as const

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin && new URL(origin).host !== host) {
    return Response.json({ error: 'Invalid origin' }, { status: 403 })
  }
  const body = await request.json()
  if (!body?.timestamp || !body?.level || !VALID_LEVELS.includes(body.level)) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const { service: _, ...sanitized } = body
  console.log('[CLIENT LOG]', JSON.stringify({ ...sanitized, service: 'my-app', source: 'client' }))
  return new Response(null, { status: 204 })
}
```

### SvelteKit

```typescript
// src/hooks.server.ts
import { initLogger } from 'evlog'
import { createEvlogHooks } from 'evlog/sveltekit'

initLogger({ env: { service: 'my-app' } })

export const { handle, handleError } = createEvlogHooks()
```

Access the logger via `event.locals.log` in route handlers or `useLogger()` from anywhere in the call stack:

```typescript
// src/routes/api/users/[id]/+server.ts
import { json } from '@sveltejs/kit'

export const GET = ({ locals, params }) => {
  locals.log.set({ user: { id: params.id } })
  return json({ id: params.id })
}
```

```typescript
import { useLogger } from 'evlog/sveltekit'

async function findUsers() {
  const log = useLogger()
  log.set({ db: { query: 'SELECT * FROM users' } })
}
```

Full pipeline with drain, enrich, and tail sampling:

```typescript
import { createAxiomDrain } from 'evlog/axiom'

export const { handle, handleError } = createEvlogHooks({
  include: ['/api/**'],
  drain: createAxiomDrain(),
  enrich: (ctx) => { ctx.event.region = process.env.FLY_REGION },
  keep: (ctx) => {
    if (ctx.duration && ctx.duration > 2000) ctx.shouldKeep = true
  },
})
```

### Nitro v3

```typescript
// nitro.config.ts
import { defineConfig } from 'nitro'
import evlog from 'evlog/nitro/v3'

export default defineConfig({
  modules: [evlog({ env: { service: 'my-api' } })],
})
```

```typescript
// routes/api/checkout.post.ts
import { defineHandler } from 'nitro/h3'
import { useLogger } from 'evlog/nitro/v3'

export default defineHandler(async (event) => {
  const log = useLogger(event)
  log.set({ action: 'checkout' })
  return { ok: true }
})
```

### TanStack Start

TanStack Start uses Nitro v3. Install evlog and add a `nitro.config.ts`:

```typescript
// nitro.config.ts
import { defineConfig } from 'nitro'
import evlog from 'evlog/nitro/v3'

export default defineConfig({
  experimental: { asyncContext: true },
  modules: [evlog({ env: { service: 'my-app' } })],
})
```

Add the error handling middleware to `__root.tsx`:

```typescript
// src/routes/__root.tsx
import { createMiddleware } from '@tanstack/react-start'
import { evlogErrorHandler } from 'evlog/nitro/v3'

export const Route = createRootRoute({
  server: {
    middleware: [createMiddleware().server(evlogErrorHandler)],
  },
})
```

Use `useRequest()` from `nitro/context` to access the logger:

```typescript
import { useRequest } from 'nitro/context'
import type { RequestLogger } from 'evlog'

const req = useRequest()
const log = req.context.log as RequestLogger
log.set({ user: { id: 'user_123' } })
```

### Nitro v2

```typescript
// nitro.config.ts
import { defineNitroConfig } from 'nitropack/config'
import evlog from 'evlog/nitro'

export default defineNitroConfig({
  modules: [evlog({ env: { service: 'my-api' } })],
})
```

Import `useLogger` from `evlog/nitro` in routes.

### NestJS

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common'
import { EvlogModule } from 'evlog/nestjs'

@Module({
  imports: [EvlogModule.forRoot()],
})
export class AppModule {}
```

`EvlogModule.forRoot()` registers a global middleware. Use `useLogger()` to access the request-scoped logger from any controller or service:

```typescript
import { useLogger } from 'evlog/nestjs'

async function findUsers() {
  const log = useLogger()
  log.set({ db: { query: 'SELECT * FROM users' } })
}
```

Full pipeline with drain, enrich, and tail sampling:

```typescript
import { createAxiomDrain } from 'evlog/axiom'

EvlogModule.forRoot({
  include: ['/api/**'],
  drain: createAxiomDrain(),
  enrich: (ctx) => { ctx.event.region = process.env.FLY_REGION },
  keep: (ctx) => {
    if (ctx.duration && ctx.duration > 2000) ctx.shouldKeep = true
  },
})
```

For async configuration with NestJS DI, use `forRootAsync()`:

```typescript
EvlogModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config) => ({
    drain: createAxiomDrain({ apiKey: config.get('AXIOM_API_KEY') }),
  }),
})
```

### Express

```typescript
import express from 'express'
import { initLogger } from 'evlog'
import { evlog, useLogger } from 'evlog/express'

initLogger({ env: { service: 'my-api' } })

const app = express()
app.use(evlog())

app.get('/api/users', (req, res) => {
  req.log.set({ users: { count: 42 } })
  res.json({ users: [] })
})
```

Use `useLogger()` to access the logger from anywhere in the call stack without passing `req`:

```typescript
import { useLogger } from 'evlog/express'

async function findUsers() {
  const log = useLogger()
  log.set({ db: { query: 'SELECT * FROM users' } })
}
```

Full pipeline with drain, enrich, and tail sampling:

```typescript
import { createAxiomDrain } from 'evlog/axiom'

app.use(evlog({
  include: ['/api/**'],
  drain: createAxiomDrain(),
  enrich: (ctx) => { ctx.event.region = process.env.FLY_REGION },
  keep: (ctx) => {
    if (ctx.duration && ctx.duration > 2000) ctx.shouldKeep = true
  },
}))
```

### Hono

```typescript
import { Hono } from 'hono'
import { initLogger } from 'evlog'
import { evlog, type EvlogVariables } from 'evlog/hono'

initLogger({ env: { service: 'my-api' } })

const app = new Hono<EvlogVariables>()
app.use(evlog())

app.get('/api/users', (c) => {
  const log = c.get('log')
  log.set({ users: { count: 42 } })
  return c.json({ users: [] })
})
```

Access the logger via `c.get('log')` in handlers. Use `useLogger()` from `evlog/hono` in the layers underneath (services, repositories) where `c` is not in hand. Both return the same logger:

```typescript
import { useLogger } from 'evlog/hono'

async function findUsers() {
  const log = useLogger()
  log.set({ db: { query: 'SELECT * FROM users' } })
}
```

On Cloudflare Workers, `useLogger()` needs the `nodejs_compat` (or `nodejs_als`) compatibility flag; `c.get('log')` works with or without it.

Structured errors: throw `createError()`, then in `app.onError` use `parseError()` and pass `parsed.status as ContentfulStatusCode` to `c.json()` (Hono types the status argument as `ContentfulStatusCode`, not `number`).

```typescript
import { createError, parseError } from 'evlog'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

app.onError((error, c) => {
  c.get('log').error(error)
  const parsed = parseError(error)
  return c.json(
    { message: parsed.message, why: parsed.why, fix: parsed.fix, link: parsed.link },
    parsed.status as ContentfulStatusCode,
  )
})
```

Full pipeline with drain, enrich, and tail sampling:

```typescript
import { createAxiomDrain } from 'evlog/axiom'

app.use(evlog({
  include: ['/api/**'],
  drain: createAxiomDrain(),
  enrich: (ctx) => { ctx.event.region = process.env.FLY_REGION },
  keep: (ctx) => {
    if (ctx.duration && ctx.duration > 2000) ctx.shouldKeep = true
  },
}))
```

### Fastify

```typescript
import Fastify from 'fastify'
import { initLogger } from 'evlog'
import { evlog, useLogger } from 'evlog/fastify'

initLogger({ env: { service: 'my-api' } })

const app = Fastify({ logger: false })
await app.register(evlog)

app.get('/api/users', async (request) => {
  request.log.set({ users: { count: 42 } })
  return { users: [] }
})
```

`request.log` is the evlog wide-event logger (shadows Fastify's built-in pino logger on the request). Fastify's pino logger remains accessible via `fastify.log`.

Use `useLogger()` to access the logger from anywhere in the call stack without passing `request`:

```typescript
import { useLogger } from 'evlog/fastify'

async function findUsers() {
  const log = useLogger()
  log.set({ db: { query: 'SELECT * FROM users' } })
}
```

Full pipeline with drain, enrich, and tail sampling:

```typescript
import { createAxiomDrain } from 'evlog/axiom'

await app.register(evlog, {
  include: ['/api/**'],
  drain: createAxiomDrain(),
  enrich: (ctx) => { ctx.event.region = process.env.FLY_REGION },
  keep: (ctx) => {
    if (ctx.duration && ctx.duration > 2000) ctx.shouldKeep = true
  },
})
```

### Elysia

```typescript
import { Elysia } from 'elysia'
import { initLogger } from 'evlog'
import { evlog, useLogger } from 'evlog/elysia'

initLogger({ env: { service: 'my-api' } })

const app = new Elysia()
  .use(evlog())
  .get('/api/users', ({ log }) => {
    log.set({ users: { count: 42 } })
    return { users: [] }
  })
  .listen(3000)
```

Use `useLogger()` to access the logger from anywhere in the call stack:

```typescript
import { useLogger } from 'evlog/elysia'

async function findUsers() {
  const log = useLogger()
  log.set({ db: { query: 'SELECT * FROM users' } })
}
```

Full pipeline with drain, enrich, and tail sampling:

```typescript
import { createAxiomDrain } from 'evlog/axiom'

app.use(evlog({
  include: ['/api/**'],
  drain: createAxiomDrain(),
  enrich: (ctx) => { ctx.event.region = process.env.FLY_REGION },
  keep: (ctx) => {
    if (ctx.duration && ctx.duration > 2000) ctx.shouldKeep = true
  },
}))
```

### React Router

```typescript
// react-router.config.ts
import type { Config } from '@react-router/dev/config'

export default {
  future: {
    v8_middleware: true,
  },
} satisfies Config
```

```typescript
// app/root.tsx
import { initLogger } from 'evlog'
import { evlog } from 'evlog/react-router'

initLogger({ env: { service: 'my-api' } })

export const middleware: Route.MiddlewareFunction[] = [
  evlog(),
]
```

Access the logger via `context.get(loggerContext)` in loaders and actions:

```typescript
// app/routes/api.users.$id.tsx
import { loggerContext } from 'evlog/react-router'

export async function loader({ params, context }: Route.LoaderArgs) {
  const log = context.get(loggerContext)
  log.set({ user: { id: params.id } })
  return { users: [] }
}
```

Use `useLogger()` to access the logger from anywhere in the call stack without passing context:

```typescript
import { useLogger } from 'evlog/react-router'

async function findUsers() {
  const log = useLogger()
  log.set({ db: { query: 'SELECT * FROM users' } })
}
```

Full pipeline with drain, enrich, and tail sampling:

```typescript
import { createAxiomDrain } from 'evlog/axiom'

export const middleware: Route.MiddlewareFunction[] = [
  evlog({
    include: ['/api/**'],
    drain: createAxiomDrain(),
    enrich: (ctx) => { ctx.event.region = process.env.FLY_REGION },
    keep: (ctx) => {
      if (ctx.duration && ctx.duration > 2000) ctx.shouldKeep = true
    },
  }),
]
```

### oRPC

```typescript
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { initLogger } from 'evlog'
import { evlog, withEvlog, type EvlogOrpcContext } from 'evlog/orpc'

initLogger({ env: { service: 'my-rpc' } })

const base = os.$context<EvlogOrpcContext>().use(evlog())

const router = {
  ping: base.handler(({ context }) => {
    context.log.set({ pinged: true })
    return { ok: true }
  }),
}

const handler = withEvlog(new RPCHandler(router))

export default async function fetch(request: Request) {
  const { matched, response } = await handler.handle(request, { prefix: '/rpc' })
  return matched ? response : new Response('Not Found', { status: 404 })
}
```

`withEvlog()` wraps the handler so each matched request emits one wide event; `os.use(evlog())` exposes `context.log` on every procedure that descends from `base` and tags the wide event with `operation` (the procedure path joined with `.`).

Use `useLogger()` to access the logger from utility modules:

```typescript
import { useLogger } from 'evlog/orpc'

async function chargeCard(amount: number) {
  const log = useLogger()
  log.set({ payment: { amount } })
}
```

Full pipeline with drain, enrich, and tail sampling:

```typescript
import { createAxiomDrain } from 'evlog/axiom'

const handler = withEvlog(new RPCHandler(router), {
  include: ['/rpc/**'],
  drain: createAxiomDrain(),
  enrich: (ctx) => { ctx.event.region = process.env.FLY_REGION },
  keep: (ctx) => {
    if (ctx.duration && ctx.duration > 2000) ctx.shouldKeep = true
  },
})
```

### Cloudflare Workers

```typescript
import { initWorkersLogger, withEvlog } from 'evlog/workers'

initWorkersLogger({ env: { service: 'edge-api' } })

export default withEvlog(async (request, _env, _ctx, log) => {
  log.set({ action: 'handle_request' })
  return Response.json({ ok: true })
})
```

`withEvlog` emits one wide event per request when the handler returns, with no manual `log.emit()`. Async drains are registered with `waitUntil` so they survive the response; streaming responses defer the emit until the body completes. `requestId` comes from `x-request-id` (fallback `cf-ray`); `method`, `path`, `cf-ray`, `traceparent`, and the safe subset of `request.cf` are captured automatically. It accepts the same options (`drain`, `enrich`, `keep`, `include`, `exclude`, `routes`) as every other integration. For manual control (scheduled handlers, queues), `createWorkersLogger(request)` + `log.emit()` remains available. No ALS-based `useLogger()` on Workers, so pass `log` explicitly.

### AWS Lambda

Lambda has no HTTP middleware lifecycle, so evlog behaves like standalone TypeScript, with one critical rule: **one logger per invocation**, never a shared module-level logger (Lambda reuses execution environments, so a shared instance leaks fields between invocations).

```typescript
import { initLogger, createLogger } from 'evlog'

initLogger({ env: { service: 'my-fn' } })  // once at module load (cold start)

export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const log = createLogger({ messageId: record.messageId })
    try {
      log.set({ queue: { source: record.eventSourceARN } })
      await processMessage(record)
    } catch (error) {
      log.error(error as Error)
      throw error
    } finally {
      log.emit()
    }
  }
}
```

### Astro

```typescript
// src/middleware.ts
import { defineMiddleware } from 'astro:middleware'
import { initLogger, createRequestLogger } from 'evlog'

initLogger({ env: { service: 'my-astro-app' } })

export const onRequest = defineMiddleware(async ({ request, locals }, next) => {
  const url = new URL(request.url)
  const log = createRequestLogger({ method: request.method, path: url.pathname })
  locals.log = log

  try {
    const response = await next()
    log.emit()
    return response
  } catch (error) {
    log.error(error instanceof Error ? error : new Error(String(error)))
    log.emit()
    throw error
  }
})
```

Type `locals.log` in `src/env.d.ts` (`interface Locals { log: RequestLogger }`). Pair with the Vite plugin (below) for auto-imports and build-time DX.

### Vite Plugin (any Vite-based framework)

For any Vite-based project (SvelteKit, Astro, SolidStart, React+Vite, etc.), use the Vite plugin for auto-init, auto-imports, and build-time features:

```typescript
// vite.config.ts
import evlog from 'evlog/vite'

export default defineConfig({
  plugins: [
    evlog({
      service: 'my-app',
      autoImports: true,           // auto-import log, createEvlogError, parseError
      strip: ['debug'],            // remove log.debug() in production
      sourceLocation: true,        // inject file:line in dev + prod
      client: {                    // client-side logging
        transport: { endpoint: '/api/logs' },
      },
    }),
  ],
})
```

Server-side middleware (drain, enrich, keep, routes) is still configured in the framework integration (e.g., `evlog()` middleware for Hono/Express/SvelteKit). The Vite plugin handles build-time DX only.

### Standalone TypeScript

```typescript
import { initLogger, createRequestLogger } from 'evlog'

initLogger({ env: { service: 'my-worker', environment: 'production' } })

const log = createRequestLogger({ jobId: job.id })
log.set({ source: job.source, recordsSynced: 150 })
log.emit()  // Manual emit required in standalone
```

---

## Configuration Options

All options work in Nuxt (`evlog` key), Nitro (passed to `evlog()`), Next.js (`createEvlog()`), and standalone (`initLogger()`).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `env.service` / `service` | `string` | `'app'` | Service name in logs |
| `enabled` | `boolean` | `true` | Global toggle (no-ops when false) |
| `pretty` | `boolean` | `true` in dev | Pretty tree format vs JSON |
| `silent` | `boolean` | `false` | Suppress console output. Events still go to drains |
| `include` | `string[]` | All routes | Route glob patterns to log |
| `exclude` | `string[]` | None | Route patterns to exclude (takes precedence) |
| `routes` | `Record<string, { service }>` | -- | Route-specific service names |
| `minLevel` | `'debug' \| 'info' \| 'warn' \| 'error'` | `'debug'` | Hard threshold for the global `log` API and client `log` (not request wide events). Use `sampling.rates` for probabilistic volume on requests |
| `sampling.rates` | `object` | -- | Head sampling: `{ info: 10, warn: 50 }` (0-100%) |
| `sampling.keep` | `array` | -- | Tail sampling: `[{ status: 400 }, { duration: 1000 }]` |
| `drain` | `(ctx) => void` | -- | Drain callback (Next.js, standalone) |
| `enrich` | `(ctx) => void` | -- | Enrich callback (Next.js) |
| `keep` | `(ctx) => void` | -- | Custom tail sampling callback (Next.js) |
| `redact` | `boolean \| RedactConfig` | `true` in production | Enabled by default in production. `false` to disable. Object for fine-grained control |

### Nitro Hooks (Nuxt, Nitro v2/v3)

| Hook | When | Use |
|------|------|-----|
| `evlog:drain` | After enrichment | Send events to external services |
| `evlog:enrich` | After emit, before drain | Add derived context |
| `evlog:emit:keep` | During emit | Custom tail sampling logic |
| `close` | Server shutdown | Flush drain pipeline buffers |

---

## Drain Adapters

| Adapter | Import | Env Vars |
|---------|--------|----------|
| Axiom | `evlog/axiom` | `AXIOM_API_KEY`, `AXIOM_DATASET` |
| OTLP | `evlog/otlp` | `OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_ENDPOINT`) |
| HyperDX | `evlog/hyperdx` | `HYPERDX_API_KEY` (optional `HYPERDX_OTLP_ENDPOINT`; defaults to `https://in-otel.hyperdx.io`) |
| PostHog | `evlog/posthog` | `POSTHOG_API_KEY`, `POSTHOG_HOST` |
| Sentry | `evlog/sentry` | `SENTRY_DSN` |
| Better Stack | `evlog/better-stack` | `BETTER_STACK_API_KEY` |
| Datadog | `evlog/datadog` | `DD_API_KEY` or `DATADOG_API_KEY`, optional `DD_SITE` / `DATADOG_LOGS_URL` |
| Grafana Loki | `evlog/loki` | `LOKI_ENDPOINT`, optional `LOKI_API_KEY` + `LOKI_USER` (Grafana Cloud) or `LOKI_TENANT_ID` (multi-tenant) |
| ClickHouse | `evlog/clickhouse` | `CLICKHOUSE_ENDPOINT`, optional `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `CLICKHOUSE_DATABASE` / `CLICKHOUSE_TABLE` |
| File System | `evlog/fs` | None (local file system) |
| Memory | `evlog/memory` | None (in-process ring buffer; optional `EVLOG_MEMORY_STORE`, `EVLOG_MEMORY_MAX_EVENTS`). Read back with `readMemoryLogs()` — ideal for dev-only log endpoints agents can query |
| NuxtHub | `@evlog/nuxthub` (separate package, Nuxt module) | None — stores wide events in the NuxtHub database with retention-based cleanup (set `evlog.retention: '7d'` in the module options; accepts `d`/`h`/`m`) |
| HTTP (browser ingest) | `evlog/http` | None (configure `endpoint` in code). `evlog/browser` is deprecated; same API, removed next major |

Use canonical env var names (e.g. `AXIOM_API_KEY`, `BETTER_STACK_API_KEY`), and the same names work in every framework.

Setup pattern per framework:

```typescript
// Nuxt/Nitro: server/plugins/evlog-drain.ts
import { createAxiomDrain } from 'evlog/axiom'
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', createAxiomDrain())
})

// Hono / Express / Elysia: pass drain in middleware options
import { createAxiomDrain } from 'evlog/axiom'
app.use(evlog({ drain: createAxiomDrain() }))

// Fastify: pass drain in plugin options
import { createAxiomDrain } from 'evlog/axiom'
await app.register(evlog, { drain: createAxiomDrain() })

// NestJS: pass drain in module options
import { createAxiomDrain } from 'evlog/axiom'
EvlogModule.forRoot({ drain: createAxiomDrain() })

// Next.js: pass drain to createEvlog()
import { createAxiomDrain } from 'evlog/axiom'
import { createDrainPipeline } from 'evlog/pipeline'
const pipeline = createDrainPipeline<DrainContext>({ batch: { size: 50 } })
const drain = pipeline(createAxiomDrain())
// then: createEvlog({ ..., drain })

// Standalone: pass drain to initLogger()
initLogger({ env: { service: 'my-app' }, drain: createAxiomDrain() })
```

See [references/drain-pipeline.md](references/drain-pipeline.md) for batching, retry, and buffer overflow config.

---

## Enrichers

Built-in: `createUserAgentEnricher()`, `createGeoEnricher()`, `createRequestSizeEnricher()`, `createTraceContextEnricher()`, all from `evlog/enrichers`. Each accepts `{ overwrite?: boolean }` (default `false`). Use `createDefaultEnrichers()` to compose all four in one call:

```typescript
import { createDefaultEnrichers } from 'evlog/enrichers'
app.use(evlog({ enrich: createDefaultEnrichers() }))
```

```typescript
// Nuxt/Nitro: server/plugins/evlog-enrich.ts
import { createUserAgentEnricher, createGeoEnricher } from 'evlog/enrichers'
export default defineNitroPlugin((nitroApp) => {
  const enrichers = [createUserAgentEnricher(), createGeoEnricher()]
  nitroApp.hooks.hook('evlog:enrich', (ctx) => {
    for (const enricher of enrichers) enricher(ctx)
  })
})

// Next.js: in lib/evlog.ts
createEvlog({
  enrich: (ctx) => {
    for (const enricher of enrichers) enricher(ctx)
    ctx.event.region = process.env.VERCEL_REGION
  },
})
```

---

## Auto-Redaction (PII Protection)

Built-in redaction scrubs sensitive data from wide events **before** console output and **before** any drain sees the data. **Enabled by default in production** (`NODE_ENV === 'production'`), disabled in development. Uses **smart partial masking**, preserving enough context for debugging.

```typescript
// Disable in production (opt-out)
evlog: { redact: false }

// Add custom paths on top of built-ins
evlog: {
  redact: {
    paths: ['user.password', 'headers.authorization'],
  }
}

// Only specific built-ins
evlog: {
  redact: {
    builtins: ['email', 'creditCard'],
  }
}

// No built-ins, only custom (uses flat [REDACTED] replacement)
evlog: {
  redact: {
    builtins: false,
    paths: ['user.ssn'],
    patterns: [/SECRET_\w+/g],
  }
}
```

**Built-in patterns** with smart masking output:

| Pattern | Example Input | Masked Output |
|---------|---------------|---------------|
| `creditCard` | `4111111111111111` | `****1111` |
| `email` | `alice@example.com` | `a***@***.com` |
| `ipv4` | `192.168.1.100` | `***.***.***.100` |
| `phone` | `+33 6 12 34 56 78` | `+33 ****5678` |
| `jwt` | `eyJhbGciOi...` | `eyJ***.***` |
| `bearer` | `Bearer sk_live_abc...` | `Bearer ***` |
| `iban` | `FR76 3000 6000 ...189` | `FR76****189` |

Works in all frameworks: Nuxt (`evlog` config), Nitro (`evlog()` module options), Next.js (`createEvlog()`), standalone (`initLogger()`), and all middleware integrations (Hono, Express, Fastify, Elysia, NestJS).

---

## AI SDK Integration

Capture token usage, tool calls, model info, streaming metrics, tool execution timing, cost estimation, and embedding metadata from the Vercel AI SDK into wide events. Import from `evlog/ai`. Requires `ai >=6.0.168 <8.0.0` as a peer dependency.

### Basic setup (middleware)

```typescript
import { createAILogger } from 'evlog/ai'

const log = useLogger(event) // or any RequestLogger
const ai = createAILogger(log)

const result = streamText({
  model: ai.wrap('anthropic/claude-sonnet-4.6'),  // accepts string or model object
  messages,
})
```

`ai.wrap()` uses model middleware to transparently capture all LLM calls. Works with `generateText`, `streamText`, and `ToolLoopAgent`.

### Telemetry integration (deeper observability)

For tool execution timing, success/failure tracking, and total generation wall time, add `createEvlogIntegration()`:

```typescript
import { createAILogger, createEvlogIntegration } from 'evlog/ai'

const ai = createAILogger(log)

const agent = new ToolLoopAgent({
  model: ai.wrap('anthropic/claude-sonnet-4.6'),
  tools: { searchWeb, queryDatabase },
  stopWhen: stepCountIs(5),
  telemetry: {
    integrations: [createEvlogIntegration(ai)],
  },
})
```

This adds `ai.tools` (per-tool `{ name, durationMs, success, error? }`) and `ai.totalDurationMs` to the wide event.

### Embeddings

```typescript
const { embedding, usage } = await embed({ model: embeddingModel, value: query })
ai.captureEmbed({ usage, model: 'text-embedding-3-small', dimensions: 1536 })
```

For `embedMany`, pass the batch count:

```typescript
ai.captureEmbed({ usage, model: 'text-embedding-3-small', count: documents.length })
```

### Cost estimation

Pass a pricing map to get `ai.estimatedCost` in the wide event:

```typescript
const ai = createAILogger(log, {
  cost: {
    'claude-sonnet-4.6': { input: 3, output: 15 },
    'gpt-4o': { input: 2.5, output: 10 },
  },
})
```

### Wide event `ai` field

Includes: `calls`, `model`, `provider`, `inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens`, `reasoningTokens`, `finishReason`, `toolCalls`, `steps`, `msToFirstChunk`, `msToFinish`, `tokensPerSecond`, `error`, `tools` (via telemetry integration), `totalDurationMs` (via telemetry integration), `embedding` (via `captureEmbed`), `estimatedCost` (via `cost` option).

Anti-patterns to detect:

| Anti-Pattern | Fix |
|--------------|-----|
| Manual token tracking in `onFinish` | `ai.wrap()` — middleware captures automatically |
| `console.log('tokens:', result.usage)` | `ai.wrap()` — structured `ai.*` fields in wide event |
| No AI observability | Add `createAILogger(log)` + `ai.wrap()` |
| No tool execution timing | Add `createEvlogIntegration(ai)` to `telemetry.integrations` |
| Manual cost calculation | Use `cost` option in `createAILogger()` |

---

## Related Capabilities (pointers)

Recommend these when the review surfaces the matching need. Each has full docs on evlog.dev:

| Need spotted | evlog answer | Docs |
|--------------|--------------|------|
| Auth'd user identity missing from events (Better Auth apps) | `evlog/better-auth` — `identifyUser()`, `createAuthMiddleware()`, client identity sync | https://www.evlog.dev/use-cases/better-auth/overview |
| Ad-hoc field names drifting across the codebase | Typed fields + error/audit catalogs (`evlog/catalog`) | https://www.evlog.dev/learn/typed-fields · https://www.evlog.dev/learn/catalogs |
| Cross-cutting hooks (request start/finish, client logs, logger extension) | Plugins — `definePlugin` | https://www.evlog.dev/extend/plugins |
| Tail logs live during dev / build a log viewer | `createStreamDrain` (`evlog/stream`, SSE) + `readFsLogs` / `tailFsLogs` (`evlog/fs`) | https://www.evlog.dev/extend/stream |
| Agents need to query logs over HTTP in dev | Memory adapter + `readMemoryLogs()` behind a dev-only endpoint | https://www.evlog.dev/integrate/adapters/self-hosted/memory |

---

## Structured Errors

```typescript
import { createError } from 'evlog'  // required in Nuxt too: a bare createError is h3's

// Minimal
throw createError({ message: 'Database connection failed', status: 500 })

// Standard
throw createError({ message: 'Payment failed', status: 402, why: 'Card declined by issuer' })

// Complete
throw createError({
  message: 'Payment failed',
  status: 402,
  why: 'Card declined by issuer - insufficient funds',
  fix: 'Please use a different payment method or contact your bank',
  link: 'https://docs.example.com/payments/declined',
  cause: originalError,
})

// Backend-only context (wide events / drains — never HTTP body or parseError())
throw createError({
  message: 'Not allowed',
  status: 403,
  why: 'Insufficient permissions',
  internal: { correlationId: 'req_abc', resourceId: 'proj_123' },
})
```

Frontend: extract user-facing fields with `parseError()` (`internal` is never returned to clients):

```typescript
import { parseError } from 'evlog'

const error = parseError(err)
// error.message, error.status, error.why, error.fix, error.link
```

See [references/structured-errors.md](references/structured-errors.md) for common patterns and templates.

---

## Anti-Patterns to Detect

| Anti-Pattern | Fix |
|--------------|-----|
| Multiple `console.log` in one function | Single wide event with `log.set()` |
| `throw new Error('...')` | `throw createError({ message, status, why, fix })` |
| `console.error(e); throw e` | `log.error(e); throw createError(...)` |
| No logging in request handlers | Add `useLogger(event)` / `useLogger()` / `createRequestLogger()` |
| Flat log data `{ uid, n, t }` | Grouped objects: `{ user: {...}, cart: {...} }` |
| Logging sensitive data `log.set({ user: body })` | Explicit fields: `{ user: { id: body.id, plan: body.plan } }` + enable `redact: true` |
| Putting support-only IDs in `why` / `message` | Use `createError({ ..., internal: { ... } })` for non-user-facing diagnostics |

See [references/code-review.md](references/code-review.md) for the full checklist.

---

## Loading Reference Files

Load based on what you're working on, and **do not load all at once**:

- Designing wide events → [references/wide-events.md](references/wide-events.md)
- Improving errors → [references/structured-errors.md](references/structured-errors.md)
- Full code review → [references/code-review.md](references/code-review.md)
- Drain pipeline setup → [references/drain-pipeline.md](references/drain-pipeline.md)
