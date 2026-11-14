---
'evlog': minor
---

Add `requestMinLevel`, a severity floor for wide events. `initLogger({ requestMinLevel: 'warn' })` drops info and debug wide events before sampling, from request loggers and from standalone `createLogger()` loggers such as jobs and workflows, and a `sampling.keep` rule or `keep` callback cannot bring them back. `error` and `fatal` events, and audit events, always pass this floor (error events still follow `sampling`; fatal events are always kept). It also works in `evlog.config.ts` (`defineEvlog`, `toLoggerConfig`), in the Nuxt and Nitro `evlog` options, and in Next.js `createEvlog()`. `minLevel` is unchanged and still applies to the `log` API only.
