---
"evlog": patch
---

The Nitro v2, Nitro v3 and Nuxt integrations now use the incoming `x-request-id` header as the event's `requestId`, as every other integration does. Before, they ignored it and generated a UUID (or used `cf-ray` on Cloudflare, which is now the fallback when no `x-request-id` is sent).
