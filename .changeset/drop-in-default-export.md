---
'evlog': minor
---

Add a default export so `import logger from 'evlog'` works like pino and consola: every call prints immediately, with no `initLogger()` needed. It is the bare `log` API under the default slot, so `logger.info('tag', 'message')`, `logger.info('message')` and `logger.info({ event })` all output right away. For wide events with drains and sampling, `initLogger()` and `createLogger()` stay the documented path.

Running in production without `initLogger()` now warns once on the first emitted event, pointing at `initLogger({ drain })`: without it events carry the default service and environment, skip redaction, and reach no drain. Apps that already call `initLogger()` see no change.
