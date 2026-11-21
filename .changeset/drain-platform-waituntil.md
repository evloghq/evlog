---
'evlog': minor
---

More integrations deliver a `createDrainPipeline` drain when the request ends on serverless platforms, and a pipeline warns when a frozen instance left events behind.

- On Vercel, Express, Fastify, Elysia, NestJS, React Router, oRPC and SvelteKit read the request's `waitUntil` from the Vercel Functions runtime, the one `waitUntil()` from `@vercel/functions` calls, without the package installed. A pipeline drain then sends at request end instead of waiting for `batch.intervalMs`.
- SvelteKit reads `waitUntil` from `event.platform.context` on the Cloudflare and Netlify adapters.
- When request-end flushes run but a request finds events older than `batch.intervalMs`, the pipeline warns once with `stale-buffer`: a route without `waitUntil` buffered them and the runtime froze before their batch was sent.
