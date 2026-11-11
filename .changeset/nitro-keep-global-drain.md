---
'evlog': patch
---

The Nitro plugin (`evlog/nitro` and `evlog/nitro/v3`, so the Nuxt module too) no longer clears a drain that another Nitro plugin set with `initLogger({ drain })`. Nitro does not await plugins, so evlog's plugin finished after a synchronous plugin and reset the global drain. Request events still reached `evlog:drain` hooks, but standalone loggers (`createLogger`, or `createRequestLogger` in a scheduled task or queue worker) drained nowhere. The drain registered before evlog's plugin settles is now kept.
