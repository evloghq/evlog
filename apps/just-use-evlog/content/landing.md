---
title: Just fucking use evlog
description: Wide events and structured errors for TypeScript. One log per operation (request, job, or workflow), all the context, zero scavenger hunt.
ogTitle: Just fucking use evlog
ogDescription: Wide events and structured errors for TypeScript. One log per operation, zero scavenger hunt.
ogHeadline: Stop overthinking your logs
---

<p class="vitrine-eyebrow">Stop overthinking your logs</p>

# Just fucking use evlog.

```bash [Terminal]
npx skills add https://www.evlog.dev
```

You've been told to "add more logs" until your stdout looks like a twitch chat. You've opened Sentry at 3am and stared at a stack trace with zero context. You've told a junior "correlate by request id" while knowing half your handlers never set one. That isn't observability. It's hope with a JSON formatter.

**One log per operation. All the context. Zero scavenger hunt.** That's what evlog does. Not ten `INFO` lines that pretend to tell a story. Not "mystery meat" errors where the client sees `500` and the server sees `Error: undefined`. One structured event, with **why** it broke and **what to do next**.

---

## Your logs are a disaster.

Something breaks in prod. You open your log viewer and stare at a wall of events. Hundreds of lines, zero story. You scroll, you filter, you open three tabs trying to reconstruct what happened for *one* request or *one* job run. Half your output is noise ("handler started", "ok", "done"). The other half is missing **user**, **cart**, **flags**, or anything that tells you *what actually broke*.

```bash [Terminal]
$ node server.js
INFO  Starting handler
INFO  user loaded
INFO  db query ok
WARN  slow???
ERROR  Payment failed
ERROR  Error: undefined
INFO  done
```

Seven lines. Zero narrative. You end up in Slack asking "who touched checkout?" while mentally stitching fragments across log entries. **This is the debugging you've normalized.** Fine, but stop pretending scattered `console.log` is "good enough."

And let's be honest, your error handling probably looks like this:

```ts [checkout.ts]
try {
  const user = await getUser(id)
  console.log('user loaded') // loaded what? which user?
  const result = await charge(user)
  console.log('charge ok') // ok how? what amount?
} catch (e) {
  console.error(e) // good luck with "Error: undefined"
  throw e
}
```

No user context. No business data. No actionable error message. When this fails in prod, you get a Slack thread, a Sentry alert with a stack trace pointing to line 4, and three engineers spending 20 minutes piecing together what happened.

Now imagine the same checkout, with evlog:

```json [wide-event.json]
{
  "level": "error",
  "method": "POST",
  "path": "/api/checkout",
  "status": 402,
  "duration": 142,
  "requestId": "req_8x2kf9",
  "user": { "id": "usr_29x8k2", "plan": "pro" },
  "cart": { "items": 3, "total": 9999 },
  "error": {
    "message": "Payment failed",
    "why": "Card declined by issuer",
    "fix": "Try a different payment method"
  }
}
```

One event. The full story. User, cart, error, reason, fix. You open your dashboard, you click the row, you *know* what happened. No stitching, no guessing.

::landing-mid-cta
::

---

## How it works: accumulate, then emit.

You don't build that JSON by hand. You call `log.set()` as your code runs, adding context at each step: auth result, cart state, feature flags, downstream latency, records synced. Whatever matters for *this* operation. At the end, evlog emits **one** event with everything. The **level** reflects outcome. Errors carry **why**, **fix**, and optional **link**, so your frontend (and future you at 3am) stop reverse-engineering stack traces.

---

## What the fuck is evlog, technically?

TypeScript-first logger that works everywhere. Framework hooks auto-create and auto-emit the logger at request boundaries. For scripts, jobs, and workflows, you create a logger, accumulate context, emit when done.

It's also a drop-in replacement for `console.log`, `pino`, or `consola` in **any** TypeScript context — CLI tools, one-shot migrations, published libraries, BullMQ / Inngest jobs, Cloudflare Workers, AWS Lambda, and Astro endpoints. The same `log.info` / `log.error` API runs everywhere, with the same drains, the same redaction, and the same types. You don't pick "evlog for HTTP, something else for the rest" — it's the one logger you ship with.

::code-group

```ts [Nuxt]
export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const user = await getUser(event)
  log.set({ user: { id: user.id, plan: user.plan } })

  const cart = await getCart(user.id)
  log.set({ cart: { items: cart.length, total: cart.total } })

  const charge = await processPayment(cart)
  log.set({ payment: { provider: 'stripe', status: charge.status } })

  return { ok: true }
})
```

```ts [Next.js]
export const POST = withEvlog(async (request) => {
  const log = useLogger()
  const { userId } = await request.json()
  log.set({ user: { id: userId } })

  const cart = await getCart(userId)
  log.set({ cart: { items: cart.length, total: cart.total } })

  const charge = await processPayment(cart)
  log.set({ payment: { provider: 'stripe', status: charge.status } })

  return Response.json({ ok: true })
})
```

```ts [Express]
app.post('/api/checkout', async (req, res) => {
  req.log.set({ user: { id: req.body.userId } })

  const cart = await getCart(req.body.userId)
  req.log.set({ cart: { items: cart.length, total: cart.total } })

  const charge = await processPayment(cart)
  req.log.set({ payment: { provider: 'stripe', status: charge.status } })

  res.json({ ok: true })
})
```

```ts [Hono]
app.post('/api/checkout', async (c) => {
  const log = c.get('log')
  const { userId } = await c.req.json()
  log.set({ user: { id: userId } })

  const cart = await getCart(userId)
  log.set({ cart: { items: cart.length, total: cart.total } })

  const charge = await processPayment(cart)
  log.set({ payment: { provider: 'stripe', status: charge.status } })

  return c.json({ ok: true })
})
```

```ts [Fastify]
app.post('/api/checkout', async (request) => {
  request.log.set({ user: { id: request.body.userId } })

  const cart = await getCart(request.body.userId)
  request.log.set({ cart: { items: cart.length, total: cart.total } })

  const charge = await processPayment(cart)
  request.log.set({ payment: { provider: 'stripe', status: charge.status } })

  return { ok: true }
})
```

```ts [SvelteKit]
export const POST = (async ({ locals }) => {
  const log = locals.log
  const userId = locals.user.id
  log.set({ user: { id: userId } })

  const cart = await getCart(userId)
  log.set({ cart: { items: cart.length, total: cart.total } })

  const charge = await processPayment(cart)
  log.set({ payment: { provider: 'stripe', status: charge.status } })

  return json({ ok: true })
}) satisfies RequestHandler
```

```ts [React Router]
export async function action({ context }: Route.ActionArgs) {
  const log = context.get(loggerContext)
  const userId = formData.get('userId')
  log.set({ user: { id: userId } })

  const cart = await getCart(userId)
  log.set({ cart: { items: cart.length, total: cart.total } })

  const charge = await processPayment(cart)
  log.set({ payment: { provider: 'stripe', status: charge.status } })

  return { ok: true }
}
```

```json [Result]
{
  "level": "info",
  "method": "POST",
  "path": "/api/checkout",
  "status": 200,
  "duration": 94,
  "requestId": "req_8x2kf9",
  "user": { "id": "usr_29x8k2", "plan": "pro" },
  "cart": { "items": 3, "total": 9999 },
  "payment": { "provider": "stripe", "status": "succeeded" }
}
```

::

Same code pattern, same output, every framework. Human-readable in dev, structured JSON in prod.

::landing-stats
::

---

## Why it's fucking great

### One API, two shapes

Fire single structured events like pino or consola when you just need a log line. Accumulate one wide event per operation when you want the full story. Same drains, same redaction, same types — pick per call. Wide events aren't a separate mode you opt into; they live inside the same logger you'd use for `console.log`.

### 0 transitive dependencies

No peer deps, no polyfills, no bundler drama. Nothing to audit, nothing that breaks on the next Node LTS. Just one `bun add evlog` and you're done.

### 12 frameworks, same API

Nuxt, Next.js, SvelteKit, Nitro, Express, Fastify, Hono, Elysia, NestJS, React Router, TanStack Start, Cloudflare Workers. Add the middleware, get wide events. Switch frameworks, keep the same `log.set()` pattern.

### 12 drain adapters, plug and play

Axiom, OTLP (Grafana, Honeycomb), Datadog, Sentry, PostHog, Better Stack, HyperDX, Sazabi, Loki, ClickHouse, filesystem, memory. Two lines of config. Async, batched, out-of-band. Your users don't wait on your log pipeline.

### AI SDK integration, built in

Wrap the model once. Token usage, tool calls, streaming metrics, cost estimation, multi-step agents, cache hits, reasoning tokens — all land in the **same** wide event. Add the telemetry integration for tool execution timing and total generation wall time.

```ts [server/api/chat.post.ts]
const ai = createAILogger(log, {
  toolInputs: { maxLength: 500 },
  cost: { 'claude-sonnet-4.6': { input: 3, output: 15 } },
})
const result = streamText({
  model: ai.wrap('anthropic/claude-sonnet-4.6'),
  messages,
})
```

Multi-step agents, embeddings, cost estimation — zero extra code. No callback conflicts. No separate pipeline for AI observability.

### PII auto-redaction, zero config

Enabled by default in production. Credit cards become `****1111`, emails become `a***@***.com`, IPs, phone numbers, JWTs, IBANs — all smart-masked before your console or drain ever sees them. No flag to remember, no manual sanitize helpers, no forgotten fields leaking to Axiom. GDPR compliance shouldn't require a sprint.

### Head + tail sampling

Drop 90% of `info` in prod, keep 100% of errors, force-keep anything slower than 1s. Two config blocks, no custom code. Stop storing noise and missing the incidents.

### Structured errors with `why` and `fix`

`createError({ why, fix, link })` on the server. `parseError()` on the client. Your error toast finally tells users *what went wrong* and *what to do about it*. Your on-call finally stops reverse-engineering stack traces.

### Typed error & audit catalogs

Stop scattering magic strings across your codebase. Group errors and audit actions into typed catalogs once, get autocomplete on `code` everywhere, refactor-safe comparisons in catch blocks, and one npm package per bounded context that ships its own type augmentation. Scales from a single `errors.ts` file to a multi-package monorepo without changing the API.

```ts [errors/billing.ts]
export const billingErrors = defineErrorCatalog('billing', {
  PAYMENT_DECLINED: { status: 402, message: 'Card declined', why: '...', fix: '...' },
  INSUFFICIENT_FUNDS: {
    status: 402,
    message: ({ available, required }: { available: number, required: number }) =>
      `Insufficient funds: $${available}/$${required}`,
  },
})

throw billingErrors.PAYMENT_DECLINED({ cause: stripeErr })
throw billingErrors.INSUFFICIENT_FUNDS({ available: 5, required: 100 })
```

### A filesystem drain for agents and scripts

Write NDJSON to disk. Your AI agents, scripts, and teammates query structured events **without a Datadog subscription**. Wide events work for incidents and evals.

---

## "But wait…"

### "I already use pino."

pino gives you fast line-by-line JSON. evlog gives you that **plus** wide events, structured errors with `why`/`fix`/`link`, head + tail sampling, twelve drain adapters, AI SDK integration with full o11y, and auto-instrumentation for twelve frameworks. Zero transitive deps, lighter install, same job done better. pino was the standard. evlog is what comes next.

### "I already have Sentry / Datadog."

Great, they'll get better data. Right now your alert fires and you open a dashboard full of `INFO handler started` lines. With evlog, one wide event lands as a **single queryable row**: user, cart, duration, flags, error, fix. Filter by `status >= 400`, group by `user.plan`, done. Sentry adapter and OTLP adapter are two lines of config each.

### "Another dependency?"

One package, zero transitive deps. The alternative is another quarter of guessing. Your call.

### "We'll 'clean up logging' next sprint."

No you won't. Ship the pattern now or keep debugging the hard way forever.

---

## Still here? Good.

You've read this far, which means your logs are probably bad and you know it. Here's what happens when you add evlog:

**Day 1**: You add the middleware. Your routes start emitting wide events. You open your first dashboard query and realize you can filter by `user.plan`, `cart.total`, `status`. You've never had that before.

**Week 1**: A payment bug hits prod. Instead of the usual 30-minute Slack thread, someone opens the event, sees `why: "Card declined by issuer"`, and closes the ticket in two minutes.

**Month 1**: Your AI routes have token usage and tool call data in every event. Your sampling config drops 90% of noise. Your on-call rotations get shorter. You stop writing "add better logging" in sprint retrospectives.

This isn't aspirational. This is what structured wide events do when you stop treating logging as an afterthought.

::landing-badges
::

::landing-ctas
::
