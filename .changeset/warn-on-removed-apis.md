---
"evlog": minor
---

Warn at runtime when a removed v2 API is used. Each deprecated API now prints one `console.warn` per process, on call, that names the replacement and states that the API is removed in v3. The warning is plain `console.warn` and never goes through evlog's logger or drains. It is silent when `NODE_ENV` is `production` or `test`, under Vitest or Jest, or when `EVLOG_NO_DEPRECATION_WARNINGS=1` (or `true`) is set.

Covered in this release: `evlog/browser` (use `evlog/http`), `createPostHogEventsDrain()` (use `createPostHogDrain({ mode: 'events' })`), the Axiom `token` option and its `AXIOM_TOKEN` / `NUXT_AXIOM_TOKEN` variables, the Better Stack `sourceToken` option and its `BETTER_STACK_SOURCE_TOKEN` / `NUXT_BETTER_STACK_SOURCE_TOKEN` variables, the Nuxt `evlog.axiom.token` option, and the eve `redactMessage` option. The Axiom and Better Stack alias warnings are no longer printed in production. Types and the `evlog/toolkit` storage re-export are marked `@deprecated` only.
