---
'evlog': patch
---

On Cloudflare Workers, Vercel, Netlify and AWS Lambda, a `createDrainPipeline` drain sends its buffered events when the request ends, instead of after `batch.intervalMs`, and the integration keeps the runtime alive with `waitUntil` until they are delivered or dropped. Before, the timer that sends the batch could die with the request: a Worker sending one event every 1.2 s with a 1 s interval delivered 0 of 21 events.

- Applies to the middleware integrations, `log.fork()`, standalone loggers created with `waitUntil`, Next's `after()`, and Nitro, including pipelines registered on the `evlog:drain` hook.
- Concurrent requests on one instance share the batch. A provider pause longer than `retry.maxDelayMs` drops the request's events as `rate-limited` rather than holding the instance.
- Long-lived servers that expose `waitUntil` (Nitro 3 on Node, `next start`) keep batching until `batch.intervalMs`.
- A pipeline that holds events past `batch.intervalMs` on one of these platforms, with no request-end flush in the process, logs one warning asking for the platform's `waitUntil`.
