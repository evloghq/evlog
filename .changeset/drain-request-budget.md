---
'evlog': minor
---

A request-end flush on a serverless platform is bounded, and AWS Lambda delivers before it freezes.

- `createDrainPipeline({ requestBudget })` caps the drain calls, retries included, that one request-end flush makes on Cloudflare Workers, Vercel, Netlify and AWS Lambda. The default is 10. Events still unsent go to `onDropped` with the new reason `deferred`.
- A request-end flush skips any retry that would start after the runtime stops the request: the invocation deadline on Vercel, 25 s after the request ends on Workers. Those events go to `onDropped` with the new reason `deadline`. `drain.stats().dropped` counts both reasons.
- On AWS Lambda, a request with no `waitUntil` delivers what the pipeline holds before the integration returns the response. A function frozen after each of 20 invocations and killed after the last delivered 0 of 20 events; it now delivers 20 of 20.
