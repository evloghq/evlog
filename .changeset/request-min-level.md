---
'evlog': minor
---

Add `requestMinLevel`, a severity floor for request wide events. `initLogger({ requestMinLevel: 'warn' })` drops info and debug request events before sampling, and a `sampling.keep` rule or `keep` callback cannot bring them back. `error` and `fatal` events, and audit events, are always emitted. It also works in `evlog.config.ts` (`defineEvlog`, `toLoggerConfig`) and in the Nuxt and Nitro `evlog` options. `minLevel` is unchanged and still applies to the `log` API only.
