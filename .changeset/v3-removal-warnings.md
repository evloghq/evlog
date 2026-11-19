---
"evlog": minor
---

Every deprecation warning now links to its section of [What's coming in v3](https://www.evlog.dev/reference/migrate-v3), and more of what evlog 3 removes or changes now warns in development:

- `defineEvlogHook()` and `defineEvlogInstrumentation()` from `evlog/eve`, which evlog 3 replaces with the `@evlog/eve` extension for eve 1.0.
- `createLoggerStorage` and `applyDeprecatedAlias` imported from `evlog/toolkit`. Import `createLoggerStorage` from `evlog/toolkit/storage`, which does not warn.
- `createOTLPDrain()` without `recordShape` or `semanticConventions`, and `createPostHogDrain()` without `recordShape`, since evlog 3 changes their defaults to `'compact'` and `true`. Set them to `'json'` and `false` to keep the current output.

Like the existing warnings, these print once per process and stay silent in production, in tests, and with `EVLOG_NO_DEPRECATION_WARNINGS=1`.
