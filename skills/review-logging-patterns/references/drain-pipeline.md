# Drain Pipeline Reference

The drain pipeline wraps any adapter to add batching, retry with backoff, and buffer overflow protection. Use it in production to reduce network overhead and handle transient failures.

## When to Recommend

- The user has a drain adapter (Axiom, OTLP, custom) and is deploying to production
- High-throughput scenarios where one HTTP request per event is wasteful
- The user needs retry logic for unreliable backends
- The user is implementing batching manually with `setInterval` and arrays

## Basic Setup

```typescript
// server/plugins/evlog-drain.ts
import type { DrainContext } from 'evlog'
import { createDrainPipeline } from 'evlog/pipeline'
import { createAxiomDrain } from 'evlog/axiom'

export default defineNitroPlugin((nitroApp) => {
  const pipeline = createDrainPipeline<DrainContext>()
  const drain = pipeline(createAxiomDrain())

  nitroApp.hooks.hook('evlog:drain', drain)
  nitroApp.hooks.hook('close', () => drain.flush())
})
```

**Shutdown:** evlog flushes every pipeline that holds events on `SIGTERM` and `SIGINT` (up to 400 ms, then the signal's default exit runs unless the app has its own listener), on `beforeExit`, and on the close hooks of Nitro, Fastify and NestJS. `process.exit()` skips all of these, so call `await drain.flush()` before it.

## Full Configuration

```typescript
import { DrainDeliveryError } from 'evlog/toolkit'

const pipeline = createDrainPipeline<DrainContext>({
  batch: {
    size: 50,          // Max events per batch (default: 50)
    intervalMs: 5000,  // Max wait before flushing partial batch (default: 5000)
  },
  retry: {
    maxAttempts: 3,           // Total attempts including first (default: 3)
    backoff: 'exponential',   // 'exponential' | 'linear' | 'fixed' (default: 'exponential')
    initialDelayMs: 1000,     // Base delay for first retry (default: 1000)
    maxDelayMs: 30000,        // Upper bound for any retry delay (default: 30000)
  },
  maxBufferSize: 1000,  // Max buffered events; oldest dropped on overflow (default: 1000)
  requestBudget: 10,    // Drain calls, retries included, per request-end flush on serverless (default: 10)
  onDropped: (events, error, reason) => {
    // reason: 'buffer-full' | 'rejected' | 'retries-exhausted' | 'rate-limited' | 'deferred' | 'deadline'
    // A partial rejection passes the whole batch; error.rejected is how many were lost.
    const lost = (error instanceof DrainDeliveryError ? error.rejected : undefined) ?? events.length
    console.error(`[evlog] Dropped ${lost} events (${reason}):`, error?.message)
  },
})
```

## How It Works

1. `drain(ctx)` pushes a single event into the buffer
2. When `buffer.length >= batch.size`, the batch is flushed immediately
3. If the batch isn't full, a timer starts; after `intervalMs`, whatever is buffered gets flushed
4. On flush, the drain function receives `T[]` (always an array)
5. Adapter drains built with `defineDrain` / `defineHttpDrain` are unwrapped to their throwing `raw` variant, which defaults to one HTTP attempt per pipeline attempt: the pipeline owns retries, unless `retries` is explicitly configured on the adapter, which then still applies inside each pipeline attempt
6. If the drain throws, the batch is retried with the configured backoff (jittered), or after the provider's `Retry-After` when it sends one. Built-in HTTP drains only mark network errors, timeouts, `408`, `429`, `502`, `503`, `504` and provider-documented statuses (Datadog `500`) as retryable; any other status, or a `DrainDeliveryError` thrown with `retryable: false`, drops the batch after one attempt. When that error carries `rejected` (the OTLP adapters set it from a `partialSuccess`), `onDropped` still gets the whole batch but `stats()` counts only `rejected` events as dropped
7. After `maxAttempts` failures, `onDropped` is called with reason `retries-exhausted` and the batch is discarded. Without `onDropped`, drops of every reason are logged at most once a minute and on `flush()`. A `Retry-After` longer than `retry.maxDelayMs` pauses the pipeline and keeps the batch buffered instead; `flush()` drops a paused batch rather than waiting
8. If the buffer exceeds `maxBufferSize`, the oldest event is dropped and `onDropped` is called with reason `buffer-full`

## Backoff Strategies

| Strategy | Delay Pattern | Best For |
|----------|--------------|----------|
| `exponential` | 1s, 2s, 4s, 8s... | Default. Transient failures needing recovery time |
| `linear` | 1s, 2s, 3s, 4s... | Predictable delay growth |
| `fixed` | 1s, 1s, 1s, 1s... | Rate-limited APIs with known cooldown |

## Returned Drain Function API

```typescript
const drain = pipeline(myDrainFn)

drain(ctx)            // Push a single event (synchronous, non-blocking)
await drain.flush()   // Force-flush all buffered events
await drain.settled() // Resolves once everything buffered is delivered or dropped, without forcing a flush
drain.pending         // Number of events currently buffered (readonly)
drain.stats()         // { delivered, dropped: { 'buffer-full', rejected, 'retries-exhausted', 'rate-limited', deferred, deadline } }
```

## Serverless

`drain(ctx)` returns after buffering, so delivery must outlive the response. On Cloudflare Workers, Vercel, Netlify and AWS Lambda, every integration that has the request's `waitUntil` (Next `after()`, Workers `ctx.waitUntil`, Nitro's request context including `evlog:drain` hook pipelines, SvelteKit `event.platform.context`, and on Vercel the Functions request context for every `defineFrameworkIntegration` integration) sends what the pipeline holds at request end, without waiting for `batch.intervalMs`, and keeps the instance alive until those events are delivered or dropped, within the platform's limits (a drain call still running when the runtime stops the request is cut off without a drop report). Events are tracked by object: push each context once, since a request-end flush may finish before a second push of the same object is sent. A provider pause longer than `retry.maxDelayMs` drops them as `rate-limited`. On long-lived servers that expose `waitUntil` (Nitro 3 on Node, `next start`), batches still wait for `batch.intervalMs`. A pipeline holding events past `intervalMs` on those platforms with no request-end flush warns once; when request-end flushes run but a request finds events older than `intervalMs` (a route without `waitUntil`, then a freeze), a `stale-buffer` warning fires once. A request-end flush makes at most `requestBudget` drain calls (default 10, retries included; the rest drop as `deferred`; batches an explicit `flush()` started are not counted) and skips retries past the runtime's deadline (Vercel's invocation deadline, 25 s after the request on Workers; dropped as `deadline`). On AWS Lambda without `waitUntil`, the integration delivers before returning the response. Two paths stay unprotected there: Nitro error drains, which run after the error response, and integrations that call `finish()` after the response is written, such as Express through `serverless-http`.

## Common Patterns

### With multiple adapters

```typescript
const axiom = createAxiomDrain()
const otlp = createOTLPDrain()

const pipeline = createDrainPipeline<DrainContext>()
const drain = pipeline(async (batch) => {
  await Promise.allSettled([axiom(batch), otlp(batch)])
})
```

### Custom drain function

```typescript
const pipeline = createDrainPipeline<DrainContext>({ batch: { size: 100 } })
const drain = pipeline(async (batch) => {
  await fetch('https://your-service.com/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch.map(ctx => ctx.event)),
  })
})
```

### Low-traffic with longer interval

```typescript
const pipeline = createDrainPipeline<DrainContext>({
  batch: { size: 10, intervalMs: 30000 },  // Flush every 30s or 10 events
})
```

## Anti-Patterns

### Manual batching with setInterval

```typescript
// ❌ No retry, no overflow protection, no flush on shutdown
const batch: WideEvent[] = []
setInterval(() => {
  if (batch.length > 0) fetch(...)
}, 5000)
```

**Transform to:**

```typescript
// ✅ Use the pipeline
const pipeline = createDrainPipeline<DrainContext>()
const drain = pipeline(async (batch) => { await fetch(...) })
nitroApp.hooks.hook('close', () => drain.flush())
```

### Missing flush before `process.exit()`

```typescript
// ❌ process.exit() ends the process before the signal and beforeExit flushes run
await main()
process.exit(0)
```

**Fix:**

```typescript
// ✅ Flush first
await main()
await drain.flush()
process.exit(0)
```

### A signal listener that only flushes

```typescript
// ❌ The listener cancels Node's default exit: the server flushes, then keeps running
process.on('SIGTERM', () => drain.flush())
```

**Fix:** remove it. evlog flushes pending pipelines on `SIGTERM` and `SIGINT` itself and then lets the default exit run.

## Review Checklist

- [ ] Pipeline wraps the adapter for production use
- [ ] `await drain.flush()` before any `process.exit()`; no `process.on('SIGTERM', () => drain.flush())` listener that blocks the default exit
- [ ] On serverless, the integration receives the platform's `waitUntil` (Workers `ctx`, Next `after()`, Nitro context, SvelteKit `event.platform.context`; found automatically on Vercel), so the request-end flush runs; no manual `drain.settled()` registration
- [ ] `onDropped` callback logs or reports dropped events
- [ ] Retries are owned by one layer: no explicit `retries` on the adapter config when the pipeline wraps it
- [ ] Batch size and interval are appropriate for the traffic volume
- [ ] `maxBufferSize` is set to prevent memory leaks under load
