---
'evlog': minor
---

The `evlog/nuxt` module takes `client: false` for server-only apps: `evlog: { client: false }` in `nuxt.config.ts` skips the browser plugin, the client auto-imports (`log`, `setIdentity`, `clearIdentity`, `setMinLevel`) and `runtimeConfig.public.evlog`. The Nitro plugin, the error handler and the server auto-imports (`useLogger`, `log`, `createEvlogError`) stay registered, and `createEvlogError` and `parseError` stay auto-imported in app code. The default, `true`, keeps the current behavior.
