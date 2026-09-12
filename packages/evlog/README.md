<p align="center">
  <img src="https://raw.githubusercontent.com/evloghq/evlog/main/assets/evlog-banner.gif" width="100%" alt="evlog — Digging through logs is not observability. It's hope" />
</p>

# evlog

[![npm version](https://img.shields.io/npm/v/evlog?color=black)](https://npmjs.com/package/evlog)
[![npm downloads](https://img.shields.io/npm/dm/evlog?color=black)](https://npm.chart.dev/evlog)
[![CI](https://img.shields.io/github/actions/workflow/status/evloghq/evlog/ci.yml?branch=main&color=black)](https://github.com/evloghq/evlog/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-black?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Documentation](https://img.shields.io/badge/Documentation-black?logo=readme&logoColor=white)](https://evlog.dev)
[![license](https://img.shields.io/github/license/evloghq/evlog?color=black)](https://github.com/evloghq/evlog/blob/main/LICENSE)

**Digging through logs is not observability. It's hope.**

A single request generates 10+ log lines. When production breaks at 3am, you're sifting scattered lines for a needle of signal. Your errors say "Something went wrong", which helps nobody.

**evlog is different.** One wide event per operation. All the context. Errors that explain *why* and what to do next.

## Why evlog?

### The Problem

```typescript
// server/api/checkout.post.ts

// Scattered logs - impossible to debug
console.log('Request received')
console.log('User:', user.id)
console.log('Cart loaded')
console.log('Payment failed')  // Good luck finding this at 3am

throw new Error('Something went wrong')
```

### The Solution

```typescript
// server/api/checkout.post.ts
import { useLogger } from 'evlog'

// One comprehensive event per request
export default defineEventHandler(async (event) => {
  const log = useLogger(event)  // Auto-injected by evlog

  log.set({ user: { id: user.id, plan: 'premium' } })
  log.set({ cart: { items: 3, total: 9999 } })
  log.error(error, { step: 'payment' })

  // Emits ONE event with ALL context + duration (automatic)
})
```

Output:

```json
{
  "timestamp": "2025-01-24T10:23:45.612Z",
  "level": "error",
  "service": "my-app",
  "method": "POST",
  "path": "/api/checkout",
  "duration": "1.2s",
  "durationMs": 1204,
  "user": { "id": "123", "plan": "premium" },
  "cart": { "items": 3, "total": 9999 },
  "error": { "message": "Card declined", "step": "payment" }
}
```

### Built for AI-Assisted Development

We're in the age of AI agents writing and debugging code. When an agent encounters an error, it needs **clear, structured context** to understand what happened and how to fix it.

Traditional logs force agents to grep through noise. evlog gives them:
- **One event per request** with all context in one place
- **Self-documenting errors** with `why` and `fix` fields
- **Structured JSON** that's easy to parse and reason about

Your AI copilot will thank you.

---

## Installation

```bash
npm install evlog
```

## Nuxt Integration

The recommended way to use evlog. Zero config, everything just works.

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],

  evlog: {
    env: {
      service: 'my-app',
    },
    // Optional: only log specific routes (supports glob patterns)
    include: ['/api/**'],
  },
})
```

> **Tip:** Use `$production` to enable [sampling](#sampling) only in production:
> ```typescript
> export default defineNuxtConfig({
>   modules: ['evlog/nuxt'],
>   evlog: { env: { service: 'my-app' } },
>   $production: {
>     evlog: { sampling: { rates: { info: 10, warn: 50, debug: 0 } } },
>   },
> })
> ```

That's it. Now use `useLogger(event)` in any API route:

```typescript
// server/api/checkout.post.ts
import { useLogger, createError } from 'evlog'

export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  // Authenticate user and add to wide event
  const user = await requireAuth(event)
  log.set({ user: { id: user.id, plan: user.plan } })

  // Load cart and add to wide event
  const cart = await getCart(user.id)
  log.set({ cart: { items: cart.items.length, total: cart.total } })

  // Process payment
  try {
    const payment = await processPayment(cart, user)
    log.set({ payment: { id: payment.id, method: payment.method } })
  } catch (error) {
    log.error(error, { step: 'payment' })

    throw createError({
      message: 'Payment failed',
      status: 402,
      why: error.message,
      fix: 'Try a different payment method or contact your bank',
    })
  }

  // Create order
  const order = await createOrder(cart, user)
  log.set({ order: { id: order.id, status: order.status } })

  return order
  // log.emit() called automatically at request end
})
```

The wide event emitted at the end contains **everything**:

```json
{
  "timestamp": "2026-01-24T10:23:45.612Z",
  "level": "info",
  "service": "my-app",
  "method": "POST",
  "path": "/api/checkout",
  "duration": "1.2s",
  "durationMs": 1204,
  "user": { "id": "user_123", "plan": "premium" },
  "cart": { "items": 3, "total": 9999 },
  "payment": { "id": "pay_xyz", "method": "card" },
  "order": { "id": "order_abc", "status": "created" },
  "status": 200
}
```

## Nitro Integration

Works with **any framework powered by Nitro**: Nuxt, Analog, Vinxi, SolidStart, TanStack Start, and more.

### Nitro v3

```typescript
// nitro.config.ts
import { defineConfig } from 'nitro'
import evlog from 'evlog/nitro/v3'

export default defineConfig({
  modules: [
    evlog({ env: { service: 'my-api' } })
  ],
})
```

### Nitro v2

```typescript
// nitro.config.ts
import { defineNitroConfig } from 'nitropack/config'
import evlog from 'evlog/nitro'

export default defineNitroConfig({
  modules: [
    evlog({ env: { service: 'my-api' } })
  ],
})
```

Then use `useLogger` in any route. Import from `evlog/nitro/v3` (v3) or `evlog/nitro` (v2). Usage is identical to the Nuxt section above; see the [Nitro docs](https://www.evlog.dev/integrate/frameworks/nitro) for the full route example.

## Standalone TypeScript

For scripts, workers, or any TypeScript project:

```typescript
// scripts/migrate.ts
import { initLogger, log, createRequestLogger } from 'evlog'

// Initialize once at script start
initLogger({
  env: {
    service: 'migration-script',
    environment: 'production',
  },
})

// Simple logging
log.info('migration', 'Starting database migration')
log.info({ action: 'migration', tables: ['users', 'orders'] })

// Or use request logger for a logical operation
const migrationLog = createRequestLogger({ action: 'full-migration' })

migrationLog.set({ tables: ['users', 'orders', 'products'] })
migrationLog.set({ rowsProcessed: 15000 })
migrationLog.emit()
```

```typescript
// workers/sync-job.ts
import { initLogger, createRequestLogger, createError } from 'evlog'

initLogger({
  env: {
    service: 'sync-worker',
    environment: process.env.NODE_ENV,
  },
})

async function processSyncJob(job: Job) {
  const log = createRequestLogger({ jobId: job.id, type: 'sync' })

  try {
    log.set({ source: job.source, target: job.target })

    const result = await performSync(job)
    log.set({ recordsSynced: result.count })

    return result
  } catch (error) {
    log.error(error, { step: 'sync' })
    throw error
  } finally {
    log.emit()
  }
}
```

## Cloudflare Workers

Use the Workers adapter for structured logs and correct platform severity. With `initWorkersLogger({ drain })`, use **`defineWorkerFetch`** so async drains are registered with `waitUntil` automatically (Cloudflare only passes `ExecutionContext` as the third `fetch` argument, and there is no global).

```typescript
// src/index.ts
import { defineWorkerFetch, initWorkersLogger } from 'evlog/workers'

initWorkersLogger({
  env: { service: 'edge-api' },
})

export default defineWorkerFetch(async (request, _env, _ctx, log) => {
  try {
    log.set({ route: 'health' })
    const response = new Response('ok', { status: 200 })
    log.emit({ status: response.status })
    return response
  } catch (error) {
    log.error(error as Error)
    log.emit({ status: 500 })
    throw error
  }
})
```

If you keep a raw `export default { fetch }`, pass `{ executionCtx: ctx }` to `createWorkersLogger` or `waitUntil` on `createRequestLogger`.

```typescript
// Lower-level (equivalent)
import { createWorkersLogger } from 'evlog/workers'

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext) {
    const log = createWorkersLogger(request, { executionCtx: ctx })
    // ...
  },
}
```

Disable invocation logs to avoid duplicate request logs:

```toml
# wrangler.toml
[observability.logs]
invocation_logs = false
```

Notes:
- Prefer **`defineWorkerFetch`** so you do not have to pass `executionCtx` yourself when using a drain
- `requestId` defaults to `cf-ray` when available
- `request.cf` is included (colo, country, asn) unless disabled
- Use `headerAllowlist` to avoid logging sensitive headers

## Structured Errors

Errors should tell you **what** happened, **why**, and **how to fix it**.

```typescript
// server/api/repos/sync.post.ts
import { useLogger, createError } from 'evlog'

export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  log.set({ repo: { owner: 'acme', name: 'my-project' } })

  try {
    const result = await syncWithGitHub()
    log.set({ sync: { commits: result.commits, files: result.files } })
    return result
  } catch (error) {
    log.error(error, { step: 'github-sync' })

    throw createError({
      message: 'Failed to sync repository',
      status: 503,
      why: 'GitHub API rate limit exceeded',
      fix: 'Wait 1 hour or use a different token',
      link: 'https://docs.github.com/en/rest/rate-limit',
      cause: error,
    })
  }
})
```

Console output (development):

```
Error: Failed to sync repository
Why: GitHub API rate limit exceeded
Fix: Wait 1 hour or use a different token
More info: https://docs.github.com/en/rest/rate-limit
```

## More

The [docs](https://www.evlog.dev) cover everything the README summarizes:

- [Wide events](https://www.evlog.dev/learn/wide-events), the event lifecycle, and `log.fork()`
- [Configuration](https://www.evlog.dev/reference/configuration), every option with its default
- [Client logging](https://www.evlog.dev/use-cases/client-logging) in the browser, with an optional server transport
- [Enrichers](https://www.evlog.dev/use-cases/enrichers) for derived context on every event
- [Audit logs](https://www.evlog.dev/use-cases/audit/overview) as a tamper-evident trail
- [AI SDK integration](https://www.evlog.dev/use-cases/ai-sdk/overview) for token usage, tool calls and cost
- [eve](https://www.evlog.dev/use-cases/eve) for one wide event per agent turn

## Adapters

Send your logs to external observability platforms with built-in drain adapters, wired from a Nitro plugin:

```typescript
// server/plugins/evlog-drain.ts
import { createAxiomDrain } from 'evlog/axiom'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', createAxiomDrain())
})
```

| Destination | Import |
|-------------|--------|
| Axiom | `evlog/axiom` |
| OTLP (Grafana, Datadog, Honeycomb, any OTLP backend) | `evlog/otlp` |
| Datadog | `evlog/datadog` |
| PostHog | `evlog/posthog` |
| Sentry | `evlog/sentry` |
| Better Stack | `evlog/better-stack` |
| HyperDX | `evlog/hyperdx` |
| File system (NDJSON) | `evlog/fs` |
| Memory (any runtime, Workers included) | `evlog/memory` |
| Browser to server (batched HTTP) | `evlog/http` |

Each adapter's configuration and environment variables are documented at [evlog.dev/integrate/adapters/overview](https://www.evlog.dev/integrate/adapters/overview). For production volume, wrap a drain with `createDrainPipeline` from `evlog/pipeline` for batching, retry with backoff, and buffer overflow protection (see the [drain pipeline docs](https://www.evlog.dev/extend/drain-pipeline)), and use [sampling](https://www.evlog.dev/learn/sampling) (head rates and tail keep rules) to control cost.

### `createError(options)`

Create a structured error with HTTP status support. Import from `evlog` directly to avoid conflicts with Nuxt/Nitro's `createError`.

> **Note**: `createEvlogError` is also available as an auto-imported alias in Nuxt/Nitro to avoid conflicts.

```typescript
import { createError } from 'evlog'

createError({
  message: string   // What happened
  status?: number   // HTTP status code (default: 500)
  why?: string      // Why it happened
  fix?: string      // How to fix it
  link?: string     // Documentation URL
  cause?: Error     // Original error
  internal?: Record<string, unknown>  // Backend-only; never in HTTP body or toJSON()
})
```

**`internal`.** Optional context for support, auditing, or debugging (IDs, gateway codes, raw diagnostics). It is stored on `EvlogError` and exposed as `error.internal` in server code. It is **not** included in JSON error responses, `toJSON()`, or `parseError()` results. When the error is passed to `log.error()` (or thrown in integrations that record errors on the wide event), `internal` is copied into the emitted event under `error.internal`.

### `parseError(error)`

Parse a caught error into a flat structure with all evlog fields. Auto-imported in Nuxt.

```typescript
import { parseError } from 'evlog'

try {
  await $fetch('/api/checkout')
} catch (err) {
  const error = parseError(err)

  // Direct access to all fields
  console.log(error.message)  // "Payment failed"
  console.log(error.status)   // 402
  console.log(error.why)      // "Card declined"
  console.log(error.fix)      // "Try another card"
  console.log(error.link)     // "https://docs.example.com/..."

  // Use with toast
  toast.add({
    title: error.message,
    description: error.why,
    color: 'error',
  })
}
```

### Pretty Output Format

In development, evlog uses a compact tree format:

```
16:45:31.060 INFO [my-app] GET /api/checkout 200 in 234ms
  |- user: id=123 plan=premium
  |- cart: items=3 total=9999
  +- payment: id=pay_xyz method=card
```

In production (`pretty: false`), logs are emitted as JSON for machine parsing.

## Framework Support

| Framework | Integration |
|-----------|-------------|
| **Nuxt** | `modules: ['evlog/nuxt']` |
| **Next.js** | `createEvlog()` factory with `import { createEvlog } from 'evlog/next'` ([docs](https://evlog.dev/integrate/frameworks/nextjs)) |
| **SvelteKit** | `export const { handle, handleError } = createEvlogHooks()` with `import { createEvlogHooks } from 'evlog/sveltekit'` ([docs](https://evlog.dev/integrate/frameworks/sveltekit)) |
| **Nitro v3** | `modules: [evlog()]` with `import evlog from 'evlog/nitro/v3'` |
| **Nitro v2** | `modules: [evlog()]` with `import evlog from 'evlog/nitro'` |
| **TanStack Start** | Nitro v3 module setup ([docs](https://evlog.dev/integrate/frameworks/tanstack-start)) |
| **React Router** | `evlog()` middleware with `import { evlog } from 'evlog/react-router'` ([docs](https://evlog.dev/integrate/frameworks/react-router)) |
| **NestJS** | `EvlogModule.forRoot()` with `import { EvlogModule } from 'evlog/nestjs'` ([docs](https://evlog.dev/integrate/frameworks/nestjs)) |
| **Express** | `app.use(evlog())` with `import { evlog } from 'evlog/express'` ([docs](https://evlog.dev/integrate/frameworks/express)) |
| **Hono** | `app.use(evlog())` with `import { evlog } from 'evlog/hono'` ([docs](https://evlog.dev/integrate/frameworks/hono)) |
| **Fastify** | `app.register(evlog)` with `import { evlog } from 'evlog/fastify'` ([docs](https://evlog.dev/integrate/frameworks/fastify)) |
| **Elysia** | `.use(evlog())` with `import { evlog } from 'evlog/elysia'` ([docs](https://evlog.dev/integrate/frameworks/elysia)) |
| **oRPC** | `withEvlog(handler)` + `os.use(evlog())` with `import { evlog, withEvlog } from 'evlog/orpc'` ([docs](https://evlog.dev/integrate/frameworks/orpc)) |
| **eve** | `defineEvlogHook()` in `agent/hooks/evlog.ts` with `import { defineEvlogHook, useLogger } from 'evlog/eve'` ([docs](https://evlog.dev/use-cases/eve)) |
| **Cloudflare Workers** | Manual setup with `import { initWorkersLogger, createWorkersLogger } from 'evlog/workers'` ([docs](https://evlog.dev/integrate/frameworks/cloudflare-workers)) |
| **Custom** | Build your own with `import { createMiddlewareLogger } from 'evlog/toolkit'` ([guide](https://evlog.dev/extend/custom-framework)) |
| **Analog** | Nitro v2 module setup |
| **Vinxi** | Nitro v2 module setup |
| **SolidStart** | Nitro v2 module setup ([example](https://github.com/evloghq/evlog/tree/main/examples/solidstart)) |

## CLI

[`@evlog/cli`](https://npmjs.com/package/@evlog/cli) is a **separate package**, still early, that scores what your app can tell you when something goes wrong. It reads your project on disk, with no traffic and no instrumentation, and finds every entry point, and names the ones to fix first. Worth trying once you have anything wired; hand the report to an agent if you like.

```bash
npx @evlog/cli map
# or: pnpm dlx @evlog/cli map
```

```
▀▀█ █▀▀   score /100              your-app · Nuxt
  █ █▀█   ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱    29 entry points scanned
  ▀ ▀▀▀   good                    ▂▂▂▃▃▃▃▃▄▆▆▆▆▆███████████████

FIX FIRST
1. ANY    /api/auth/:all* A — touches auth and logs nothing
   server/api/auth/[...all].ts:1 · evlog.dev/learn/wide-events
```

| Command | What it does |
|---------|-------------|
| `evlog map` | Score every entry point and list the three worth fixing first |
| `evlog map <route-or-file>` | Explain one entry point in full, with the shape it could take |
| `evlog map --all` | Every entry point as a check matrix |
| `evlog map --min-score <n>` | Exit 1 below the threshold — a CI gate |
| `evlog doctor` | Diagnose the install: Node, workspace, evlog version, local logs |

Same code in, same verdict out, with the file and line for every finding, which also makes it something you can hand to an agent: run it, fix the list, run it again.

> **Early days:** the CLI is tested and safe to run on any project, but it is young: four framework adapters today, rules still being refined. Expect verdicts and scores to move between releases; pin it as a dev dependency when you gate CI on the number.

Docs: [CLI](https://www.evlog.dev/cli/overview) · [`evlog map`](https://www.evlog.dev/cli/map) · [Rules](https://www.evlog.dev/cli/rules) · [Scoring](https://www.evlog.dev/cli/scoring) · [CI](https://www.evlog.dev/cli/ci)

## Agent Skills

evlog provides [Agent Skills](https://www.evlog.dev/reference/agent-skills) to help AI coding assistants understand and implement proper logging patterns in your codebase.

### Installation

```bash
npx skills add https://www.evlog.dev
```

### What it does

Once installed, your AI assistant will:
- Review your logging code and suggest wide event patterns
- Help refactor scattered `console.log` calls into structured events
- Guide you to use `createError()` for self-documenting errors
- Ensure proper use of `useLogger(event)` in Nuxt/Nitro routes
- Optionally run [`evlog map`](https://www.evlog.dev/cli/map) (`npx @evlog/cli map`) to score dark entry points. It is a separate early CLI package, worth trying

### Examples

```text
Add logging to this endpoint
Review my logging code
Raise my evlog map score
Help me set up logging for this service
```

## Philosophy

Inspired by [Logging Sucks](https://loggingsucks.com/) by [Boris Tane](https://x.com/boristane).

1. **Wide Events**: One log per request with all context
2. **Structured Errors**: Errors that explain themselves
3. **Request Scoping**: Accumulate context, emit once
4. **Pretty for Dev, JSON for Prod**: Human-readable locally, machine-parseable in production

<!-- automd:fetch url="gh:hugorcd/markdown/main/src/sponsors.md" -->
## Sponsors

evlog is built and maintained in the open. Financial contributions pay for maintainer time, infrastructure, and contributor bounties, and every expense is public on [Open Collective](https://opencollective.com/evlog).

<a href="https://opencollective.com/evlog#support">
  <img src="https://opencollective.com/evlog/backers.svg?width=890" alt="evlog backers on Open Collective" />
</a>

[Become a sponsor](https://opencollective.com/evlog/contribute): sponsor tiers get your logo in this README and on the collective page.

## License

[MIT](https://github.com/evloghq/evlog/blob/main/LICENSE)

Made by [@HugoRCD](https://github.com/HugoRCD)
