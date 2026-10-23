# evlog-community-framework-skeleton

Reference implementation showing the **complete** contract for a community evlog framework integration — manifest-mode `defineFrameworkIntegration`, `useLogger()` accessor backed by `AsyncLocalStorage`, lifecycle wiring, and tests.

> Replace `MyFramework` everywhere with your actual framework name and ship the package as `evlog-myframework` (or whichever name fits).

## What this skeleton demonstrates

- ~50 lines of glue. Everything else (header normalization, request-id, ALS, `log.fork()`, route filtering, sampling, emit, enrich, drain, plugin hooks) comes from `defineFrameworkIntegration` + `createMiddlewareLogger`.
- Manifest mode: `extractRequest`, `attachLogger`, optional `storage`. Pick the same storage you pass to `createLoggerStorage()` (from `evlog/toolkit/storage`) so `useLogger()` and `log.fork()` work.
- Full lifecycle: `try { await runWith(next) ; await finish({ status }) } catch (e) { await finish({ error: e }) ; throw }`.
- `peerDependency` on `evlog`.

## Layout

```
src/index.ts                    # evlog() middleware + useLogger
test/myframework.test.ts        # Vitest suite covering happy path, error path, route filtering
package.json                    # peerDependency on evlog
tsconfig.json
```

## Run the tests

```bash
pnpm install
pnpm --filter evlog-community-framework-skeleton test
```

## Use it from a host app

```ts
import { evlog, useLogger } from 'evlog-myframework'
import { createAxiomDrain } from 'evlog/axiom'

app.use(evlog({
  drain: createAxiomDrain(),
  enrich: (ctx) => {
    ctx.event.region = process.env.FLY_REGION
  },
}))

app.get('/api/users', (ctx) => {
  ctx.log!.set({ users: { count: 42 } })
  return { users: [] }
})

function findUsers() {
  const log = useLogger()
  log.set({ db: { query: 'SELECT * FROM users' } })
}
```

## When to drop to custom mode

If your framework's lifecycle doesn't fit a `(ctx, next)` middleware (NestJS interceptors, Next.js App Router, SvelteKit `handle`), skip `defineFrameworkIntegration` and call `createMiddlewareLogger` directly. You'll write more glue (~80–120 lines) but keep the full pipeline.

## See also

- [Toolkit reference](https://evlog.dev/adapters/building-blocks/toolkit)
- [Custom Integration](https://evlog.dev/frameworks/custom-integration)
- The matching adapter and enricher skeletons in this folder.
