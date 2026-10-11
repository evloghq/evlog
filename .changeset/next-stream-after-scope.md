---
'evlog': patch
---

Stop `evlog/next` from logging "`after` was called outside a request scope" when a streamed response (SSE, NDJSON, AI SDK streams) completes or the client disconnects. A streamed response now registers its `waitUntil` while the handler is still running, and the drain started when the body finishes joins that registration. The same applies to any integration given a `waitUntil` option, such as Hono and Cloudflare Workers.
