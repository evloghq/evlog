# Test conventions

Goals: fast (full suite < 2s locally), deterministic, no fake-greens, no console-parsing.

## Decision table

| You want to verify | Use this |
|---|---|
| An HTTP request emitted a wide event with given fields | `createPipelineSpies()` + `assertHttpEventEmitted(drain, { path, method, status, level })` from `helpers/framework.ts` |
| A drain spy was called within a few microtasks of a request returning | `await waitForDrainCalls(drain)` before drilling into `drain.mock.calls` |
| A specific event field is set after `log.set(...)` | `findEventViaDrain(drain, e => e.path === ...)` then assert on the returned event |
| A duration / threshold-based behavior | `vi.useFakeTimers()` + `vi.advanceTimersByTime(N)` + `vi.useRealTimers()` (do *not* `await new Promise(setTimeout)`) |
| Narrowing after `expect(x).toBeDefined()` | `defined(x, 'label')` from `helpers/defined.ts` — not `x!` |
| Accessing the request logger inside a route handler test | `useLogger()` — not `req.log!` (keep one test per framework that asserts `req.log` is attached) |
| An adapter posts the right URL / body / headers | `mockFetch()` from `helpers/fetch.ts` + `getFetchCall` / `getFetchJson` / `getFetchHeaders` |
| A wide event factory for adapter tests | `makeWideEvent(overrides?)` from `helpers/events.ts` |
| The sweep of HTTP framework specs ("emits event", "x-request-id", "route service") | `describeStandardHttpMatrix({ name, mount })` from `helpers/frameworkMatrix.ts` — wired in all seven HTTP framework test files |

## Framework runtime fidelity

This is the most important table in the file. For each framework integration we
verify the test really exercises the framework's runtime, not a substitute.

| Framework | How tests fire requests | What's actually exercised |
|---|---|---|
| `frameworks/express.test.ts` | `request(app)` (supertest) binds an ephemeral HTTP port | Real Express middleware chain, real Node socket lifecycle |
| `frameworks/hono.test.ts` | `app.request(...)` Fetch API | Real Hono router, real handler dispatch |
| `frameworks/fastify.test.ts` | `app.inject(...)` (Light My Request) | Real Fastify lifecycle (preHandler / handler / response hooks) |
| `frameworks/elysia.test.ts` | `app.handle(new Request(...))` | Real Elysia handler |
| `shared/bun-import.test.ts` | Bun subprocesses importing Elysia and eve | Top-level await, `bun:test` lifecycle hooks, and a real Elysia request with `useLogger()` |
| `frameworks/nestjs.test.ts` | Extracts middleware via `EvlogModule.configure()` and mounts on Express | Module API + the Connect-style middleware itself; **does NOT boot NestFactory** |
| `frameworks/nestjs-real-runtime.test.ts` | `Test.createTestingModule(...)` + `app.init()` + supertest | **Real NestFactory boot, real DI, real exception filter pipeline** |
| `frameworks/react-router.test.ts` | Calls middleware directly with `new RouterContextProvider()` from `react-router` | Real react-router context provider (set/get semantics, throws on missing) |
| `frameworks/sveltekit.test.ts` | Calls handle directly with `{ event, resolve }` | The SvelteKit-recommended testing contract; cannot run through `sequence()` because that needs the SvelteKit request-store runtime |
| `next/handler.test.ts` | `await handler(new Request(...))` | Identical to how Next App Router invokes route handlers |
| `next/instrumentation.test.ts` | Calls `register()` + simulates `process.stdout.write` patches | The actual Node instrumentation contract |
| `next/middleware.test.ts` | Calls `evlogMiddleware()` with mocked `NextResponse.next` | Edge middleware contract (Next has no Node-friendly real runtime for edge middleware) |

**Rule of thumb**: if the framework has a Node-friendly request driver (`inject`,
`request`, `handle`, `Test.createTestingModule`, supertest), the test must use
it. If the framework has no such driver (SvelteKit's full router needs `vite preview`,
Next's edge middleware needs the Edge runtime), the test calls the user-facing
contract directly with realistic input shapes.

**Found a fake test?** Move it. The `nestjs-real-runtime.test.ts` exists exactly
because the original `nestjs.test.ts` extracted the middleware from
`EvlogModule.configure()` — convenient for unit-testing the middleware function,
but it bypassed NestJS's exception filter, request scope, and Express adapter
boot. Both files coexist now: the original tests the module API surface fast;
the real-runtime version catches integration regressions.

## Anti-patterns (do not do)

1. `vi.spyOn(console, 'info')` then `find(call => includes('"path":"/x"'))` then `JSON.parse(call[0])`. Use a drain spy instead.
2. Re-implementing `shouldLog` / `getServiceForPath` / similar source helpers locally to "test the logic". Import the real export — anything else is a false-green machine.
3. `await new Promise(r => setTimeout(r, N))` for timing assertions. Use fake timers; `setTimeout` couples the test to wall-clock and CI load.
4. `expect(x).toBeDefined()` as the *only* assertion. Always drill at least one level deeper.
5. Adding a new export to `package.json` without updating `tsdown.config.ts` and re-running `pnpm test` so `api-surface.test.ts` snapshots the new surface.
6. Non-null assertions (`!`) and type casts (`as`) when a helper or guard can express the same intent — use `defined()`, `getDrainCallArg()`, `useLogger()`, or `expect(...).toEqual(...)`.

## File layout

Layout mirrors `src/`. Pick the folder that matches the source area you're touching.

```text
test/
  helpers/                 # always import from here, never re-roll
    events.ts              # makeEvent / makeWideEvent / makeContext / makeError
    fetch.ts               # mockFetch / getFetchCall / getFetchJson / getFetchHeaders
    framework.ts           # createPipelineSpies / assertHttpEventEmitted / waitForDrainCalls / findEventViaDrain / ...
    defined.ts             # defined() / getDrainCallArg() — type-safe narrowing without `!`
    frameworkMatrix.ts     # describeStandardHttpMatrix(adapter)
    slowReporter.ts        # CI-only reporter for tests > EVLOG_SLOW_TEST_BUDGET_MS (default 500ms)
    timers.ts              # withFakeTimers / flushMicrotasks

  core/                    # logger, pipeline, redact, error, audit, catalog, fork, utils, identity, middleware, client-console
    logger.test.ts
    logger-request-logger.test.ts  # extracted from logger.test.ts (Phase 7a)
    logger-browser.test.ts
    pipeline.test.ts
    redact.test.ts
    redact-integration.test.ts     # extracted from redact.test.ts (Phase 7b)
    error.test.ts
    audit.test.ts
    catalog.test.ts
    fork.test.ts
    utils.test.ts
    identity.test.ts
    middleware.test.ts
    client-console.test.ts

  http/                    # transport plumbing
    http.test.ts                   # createHttpDrain / createHttpLogDrain
    stream.test.ts                 # createStreamDrain / default stream
    stream-server.test.ts          # local SSE stream server
    shared-http-identity.test.ts   # User-Agent + X-Evlog-Source identity headers

  frameworks/              # HTTP framework integrations
    express.test.ts
    hono.test.ts
    fastify.test.ts
    elysia.test.ts
    nestjs.test.ts                 # module API surface (fast, mock middleware)
    nestjs-real-runtime.test.ts    # real NestFactory + DI + supertest
    react-router.test.ts           # uses real RouterContextProvider
    sveltekit.test.ts

  nitro/                   # Nitro v2 plugin
    plugin.test.ts                 # drain headers, waitUntil, routes, useLogger, middleware (#210)
    plugin-enrichment.test.ts      # T7 enrichment pipeline (extracted)
    errorHandler.test.ts

  nitro-v3/                # Nitro v3 (separate; full fixture build + dev-server)
    barrel-exports.test.ts
    cloudflare-durable-build.test.ts  # gated on dist/, ~120s timeout
    nitro-v3.test.ts                  # real createNitro + listen + fetch
    fixture/                          # nitro app used by nitro-v3.test.ts

  workers/                 # Cloudflare Workers
    logger.test.ts                 # createWorkersLogger / defineWorkerFetch
    preset-dist-imports.test.ts    # gated on dist/, audits forbidden import specifiers

  toolkit/                 # public toolkit + API contract
    toolkit.test.ts                # defineEvlog, defineHttpDrain, plugins, composers
    barrel.test.ts                 # exports smoke
    api-surface.test.ts            # snapshot of every public subpath export (gated on dist/)
    enrichers.test.ts              # built-in enrichers

  adapters/                # one file per drain adapter (axiom, posthog, otlp, sentry, datadog, ...)
  ai/                      # createAILogger + middleware (large; aiMocks extraction filed as follow-up)
  better-auth/             # createAuthMiddleware / identifyUser / ...
  next/                    # withEvlog, instrumentation, middleware, storage, stream
  vite/                    # auto-imports, auto-init, client-inject, source-location, strip
  e2e/                     # real-network tests (gated on env vars + cron)
```

Decision tree:

- "I touched `src/<area>.ts`" → `test/<area>/...` exists; add the test there. If it doesn't, that's a coverage gap — flag it.
- "I added a new framework integration" → `test/frameworks/<name>.test.ts` and consult § Framework runtime fidelity for the right driver.
- "I added a new drain adapter" → `test/adapters/<name>.test.ts` (use `helpers/fetch.ts`) + `test/e2e/<name>.e2e.ts` gated on env vars.

## Running

```bash
pnpm test                                       # full suite
pnpm exec vitest run test/core/redact.test.ts   # one file
pnpm test:coverage                              # with v8 coverage + thresholds
pnpm test:e2e                                   # real network (skipped without API keys)
pnpm run mutate                                 # Stryker (slow; weekly cron in CI)
```

`shared/bun-import.test.ts` requires `bun` on `PATH` and skips locally when it is
absent. CI installs Bun 1.3.14 to exercise import-time async context regressions.
The `.mjs` fixtures run in Bun, outside Vitest's TypeScript test discovery.

## Coverage thresholds

The thresholds in [`packages/evlog/vitest.config.ts`](../vitest.config.ts) (`statements` / `branches` / `functions` / `lines`) are kept ~3 points below the measured baseline so a real regression fails CI but flaky-but-fast metrics don't generate false alarms.

Bumping them up:

1. Run `pnpm test:coverage` locally and capture the new percentages.
2. Edit `vitest.config.ts` to set the new floor (still ~3 points below the new baseline).
3. The PR must include the coverage output in the description so a reviewer can sanity-check before merging.

Lowering them is a smell — every drop needs a comment explaining why and an issue / follow-up to restore.

`vitest.config.ts` is the single source of truth for the numbers; this section is only the policy.

## Slow test budget

Set `EVLOG_SLOW_TEST_BUDGET_MS=300 CI=1 pnpm test` to surface tests above 300ms
(default 500). The CI run prints the top 20 offenders without failing.

## CI structure

`.github/workflows/ci.yml` runs four jobs in parallel on every PR:

- `quality`: lint and typecheck affected packages, excluding `evlog-telemetry` from typecheck.
- `test`: test affected workspace packages, run content checks, then build evlog and run its full coverage suite. Bun 1.3.14 runs the import regressions. CLI changes also run the sandbox smoke tests.
- `examples`: build affected examples.
- `publish`: build and publish preview packages independently of the other checks.

The `ci` job checks that `quality`, `test`, and `examples` succeeded.

Mutation testing is intentionally separate: `.github/workflows/mutation.yml` runs Stryker on a weekly Monday cron and on `workflow_dispatch` (Stryker is too slow to gate every PR).
