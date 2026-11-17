---
'evlog': minor
---

Add `sampling.minLevel`, a severity floor for wide events. `initLogger({ sampling: { minLevel: 'warn' } })` drops trace, debug and info wide events before sampling, from request loggers and from standalone `createLogger()` loggers such as jobs and workflows, and a `sampling.keep` rule or `keep` callback cannot bring them back. `error` and `fatal` events, and audit events, always pass this floor (error events still follow `sampling.rates`; fatal events are always kept). It works everywhere `sampling` is accepted: `initLogger()`, `evlog.config.ts`, the Nuxt and Nitro `evlog` options, the Vite plugin and Next.js. The top-level `minLevel` is unchanged and still applies to the `log` API only.
