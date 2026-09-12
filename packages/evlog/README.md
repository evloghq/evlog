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

A single request generates 10+ log lines scattered across your output, and when production breaks at 3am you are sifting through all of them for a needle of signal. Your errors say "Something went wrong", which helps nobody.

**evlog is different.** One wide event per operation, all the context in one place, and errors that explain *why* they happened and what to do next. It is TypeScript-first, works in Node, edge and Cloudflare Workers, and is built to give AI agents the structured context they need to understand and fix a failure.

Everything below in depth: [evlog.dev](https://www.evlog.dev)

## Why evlog?

The usual approach:

```typescript
// server/api/checkout.post.ts

console.log('Request received')
console.log('User:', user.id)
console.log('Payment failed')  // Good luck finding this at 3am

throw new Error('Something went wrong')
```

evlog emits **one wide event per operation**, with everything attached:

```typescript
// server/api/checkout.post.ts
import { useLogger, createError } from 'evlog'

export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  const user = await requireAuth(event)
  log.set({ user: { id: user.id, plan: user.plan } })

  const cart = await getCart(user.id)
  log.set({ cart: { items: 3, total: 9999 } })

  try {
    await processPayment(cart, user)
  } catch (error) {
    log.error(error, { step: 'payment' })

    throw createError({
      message: 'Payment failed',
      status: 402,
      why: error.message,
      fix: 'Try a different payment method or contact your bank',
    })
  }
})
```

The event, emitted automatically at request end:

```json
{
  "level": "error",
  "method": "POST",
  "path": "/api/checkout",
  "durationMs": 1204,
  "user": { "id": "123", "plan": "premium" },
  "cart": { "items": 3, "total": 9999 },
  "error": { "message": "Card declined", "step": "payment" }
}
```

## Installation

```bash
npm install evlog
```

## Start in Nuxt

The recommended way to use evlog. Zero config, everything just works.

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],

  evlog: {
    env: {
      service: 'my-app',
    },
  },
})
```

Now `useLogger(event)` is available in any API route, and the wide event is emitted automatically when the request ends. `createError` from `evlog` throws structured errors with `why`, `fix` and `link` fields that land on the event and in the HTTP response.

Outside a framework, use `initLogger()` and `createRequestLogger()`. Client-side logging ships with `evlog/client`. Both are covered in the [docs](https://www.evlog.dev).

## Which framework are you on?

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

## Send logs somewhere

Built-in drain adapters send wide events to external platforms from a Nitro plugin:

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

Each adapter's configuration and environment variables are documented at [evlog.dev/integrate/adapters/overview](https://www.evlog.dev/integrate/adapters/overview). For production volume, wrap a drain with `createDrainPipeline` from `evlog/pipeline` for batching, retry with backoff, and buffer overflow protection, and use sampling (head rates and tail keep rules) to control cost. See the [drain pipeline docs](https://www.evlog.dev/extend/drain-pipeline).

## Run the CLI

[`@evlog/cli`](https://npmjs.com/package/@evlog/cli) is a separate package, still early, that scores what your app can tell you when something goes wrong. It reads your project on disk, with no traffic and no instrumentation, and names the entry points to fix first.

```bash
npx @evlog/cli map
```

| Command | What it does |
|---------|-------------|
| `evlog map` | Score every entry point and list the three worth fixing first |
| `evlog map <route-or-file>` | Explain one entry point in full, with the shape it could take |
| `evlog map --all` | Every entry point as a check matrix |
| `evlog map --min-score <n>` | Exit 1 below the threshold, a CI gate |
| `evlog doctor` | Diagnose the install: Node, workspace, evlog version, local logs |

Docs: [CLI](https://www.evlog.dev/cli/overview) · [`evlog map`](https://www.evlog.dev/cli/map) · [Rules](https://www.evlog.dev/cli/rules) · [Scoring](https://www.evlog.dev/cli/scoring) · [CI](https://www.evlog.dev/cli/ci)

## Agent Skills

evlog ships [Agent Skills](https://www.evlog.dev/reference/agent-skills) so AI coding assistants apply wide event patterns and structured errors correctly in your codebase:

```bash
npx skills add https://www.evlog.dev
```

## Philosophy

Inspired by [Logging Sucks](https://loggingsucks.com/) by [Boris Tane](https://x.com/boristane).

1. **Wide Events**: One log per request with all context
2. **Structured Errors**: Errors that explain themselves
3. **Request Scoping**: Accumulate context, emit once
4. **Pretty for Dev, JSON for Prod**: Human-readable locally, machine-parseable in production

## Sponsors

evlog is built and maintained in the open. Financial contributions pay for maintainer time, infrastructure, and contributor bounties, and every expense is public on [Open Collective](https://opencollective.com/evlog).

<a href="https://opencollective.com/evlog#support">
  <img src="https://opencollective.com/evlog/backers.svg?width=890" alt="evlog backers on Open Collective" />
</a>

[Become a sponsor](https://opencollective.com/evlog/contribute): sponsor tiers get your logo in this README and on the collective page.

## License

[MIT](https://github.com/evloghq/evlog/blob/main/LICENSE)

Made by [@HugoRCD](https://github.com/HugoRCD)
