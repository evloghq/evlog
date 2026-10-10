---
'evlog': patch
---

Stop Nitro and Nuxt from printing expected `createError` 4xx responses as `[request error] [unhandled]` in production. The wide event already records these errors, so evlog's Nitro error handler now skips Nitro's default logging for `EvlogError` with a status below 500. Server errors and errors that are not from evlog are still logged by Nitro.
