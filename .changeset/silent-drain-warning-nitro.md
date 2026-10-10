---
"evlog": patch
---

Nuxt and Nitro apps that set `silent: true` in the module options no longer print `silent mode is enabled but no drain is configured` at startup. The logger starts from those options before the server plugins attach the drain, so the warning fired even with an `evlog:drain` hook. Standalone `initLogger({ silent: true })` without a drain still warns.
