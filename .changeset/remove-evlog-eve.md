---
"evlog": major
---

Removes the `evlog/eve` entry point. Install `@evlog/eve`, replace `agent/hooks/evlog.ts` (`defineEvlogHook(config)`) with `agent/extensions/evlog.ts` (`export default evlog(config)` from `@evlog/eve`), and import `useLogger` from `@evlog/eve/logger`. The migration guide lists the removed options.

`evlog/toolkit` adds `onErrorCreated(listener)`, called with every `EvlogError` as it is built, and `createMiddlewareLogger().finish()` accepts `durationMs` for an integration that knows when the work started.
