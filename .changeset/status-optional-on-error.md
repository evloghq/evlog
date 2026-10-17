---
"evlog": major
---

`status` is optional on `EvlogError`, on `createError()` options, and on error catalog entries (`defineErrorCatalog`, `defineError`). Core no longer defaults it to 500. An error that never reaches an HTTP response (an agent turn, a job, a cron task, a CLI script) has no `status`, and `toJSON()` and the logged event leave the field out.

Every HTTP boundary still answers 500 for an error without a `status`. This covers the Nuxt and Nitro error handlers, h3, Next, Hono, Express, Fastify, Elysia, NestJS, SvelteKit and `parseError()`. Code that read `error.status` directly and expected a number needs to handle `undefined`, or read the status the framework sends.

A non-HTTP error, logged without a status:

```json
{ "name": "EvlogError", "message": "Export job stalled", "data": { "why": "No progress for 5 minutes", "fix": "Retry the export" }, "why": "No progress for 5 minutes", "fix": "Retry the export" }
```

Before this change the same error also logged `status: 500`. No codemod is needed. Upgrade checklist: check code that reads `error.status` as a number, and any alert or sampling rule that matched on it.
