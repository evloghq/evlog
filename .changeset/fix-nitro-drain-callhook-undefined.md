---
"evlog": patch
---

Fix a crash on every request under Nitro 3 / hookable 6. `callHook('evlog:drain')` can return `undefined` when no `evlog:drain` hook is registered or when every hook runs synchronously, and evlog chained `.catch` directly on that result, throwing `TypeError: Cannot read properties of undefined (reading 'catch')` for each emitted wide event. The drain call is now awaited inside a `try`/`catch` in both the Nitro drain path and the client ingest route, so a missing, synchronous, or throwing drain hook no longer breaks the request. Drain errors are still logged with `[evlog] drain failed:`.
