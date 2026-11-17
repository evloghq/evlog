# Integration contract, per integration

What each framework integration ships against the contract in `AGENTS.md`: an `evlog()` entry point taking the full `BaseEvlogOptions`, a zero-argument `useLogger()` backed by `AsyncLocalStorage`, `log.fork()`, and a framework-native accessor.

Two places enforce this table, and a change to one needs the other:

- `packages/evlog/test/frameworks/contract.test-d.ts` checks the types. One `describe` per row; an exception asserts the shape the integration ships instead, so it fails when an integration drops part of the contract and when a gap closes without its row changing. It also fails when `package.json` gains an export that is neither classified as an integration nor listed as something else.
- `describeStandardHttpMatrix` (options passed in code) and `describeBuiltAppMatrix` (options in a built app's config) in `packages/evlog/test/helpers/frameworkMatrix.ts` run the same behavioral checks against every integration: event fields, `x-request-id`, per-route `service`.

## Table

| Integration | Options entry | `BaseEvlogOptions` | `useLogger()` | `log.fork()` | Native accessor | Matrix |
| --- | --- | --- | --- | --- | --- | --- |
| `evlog/hono` | `evlog(options)` | all | yes | yes | `c.get('log')` | yes |
| `evlog/express` | `evlog(options)` | all | yes | yes | `req.log` | yes |
| `evlog/fastify` | `app.register(evlog, options)` | all | yes | yes | `request.evlog` | yes |
| `evlog/elysia` | `evlog(options)` | all | yes | yes | `log` in the handler context | yes |
| `evlog/nestjs` | `EvlogModule.forRoot(options)`, `forRootAsync()` | all | yes | yes | `req.log` (`request.evlog` on Fastify) | yes |
| `evlog/orpc` | `withEvlog(handler, options)`; `evlog()` is procedure middleware with no options | all | yes | yes | `context.log` | yes |
| `evlog/react-router` | `evlog(options)` | all | yes | yes | `context.get(loggerContext)` | yes |
| `evlog/sveltekit` | `evlog(options)`, `createEvlogHooks(options)` | all | yes | yes | `event.locals.log`, typed by the app on `App.Locals` | yes |
| `evlog/next` | `createEvlog(options).withEvlog` | all | yes | yes | none: `useLogger()` is the accessor | yes |
| `evlog/workers` | `withEvlog(handler, options)` | all | no, sanctioned | yes, `fn` receives the child | the handler's fourth argument | yes |
| `evlog/effect` | `evlog(options)`, `routerLayer(options)` | all | an Effect, sanctioned | no, sanctioned: nested `withLogger` | the `EvlogLogger` service | yes |
| `evlog/nitro` (v3) | `modules: [evlog(options)]` | `include`, `exclude`, `routes`, `redact`; the rest as below | yes, with `experimental.asyncContext`; `useLogger(event)` everywhere | yes, `fn` receives the child | `useLogger(event)` | yes (built app) |
| `evlog/nitro/v2` | `modules: [evlog(options)]` | as Nitro v3 | as Nitro v3 | yes, `fn` receives the child | `useLogger(event)`, `event.context.log` | yes (built app) |
| `evlog/nuxt` | `modules: ['evlog/nuxt']`, `evlog: { … }` | as Nitro v3 | as Nitro v3 (`nitro.experimental`), auto-imported | yes, `fn` receives the child | `useLogger(event)`, `event.context.log` | yes (built app) |

### How the Nitro-based integrations take the other options

A function cannot cross a Nitro build, so these are not module options:

| Option | Nitro v3, Nitro v2, Nuxt |
| --- | --- |
| `drain` | `evlog:drain` hook, or `drain` in `evlog.config.ts` |
| `enrich` | `evlog:enrich` hook, or `enrich` in `evlog.config.ts` |
| `keep` | `evlog:emit:keep` hook, or `keep` in `evlog.config.ts` |
| `plugins` | `plugins` in `evlog.config.ts` |
| `waitUntil` | read from the event (`event.context.cloudflare.context` or `event.context`) |

## Known gaps

- **Nitro v3, Nitro v2 and Nuxt need Nitro's `experimental.asyncContext` for a zero-argument `useLogger()`.** The plugins register a resolver (`setNitroRequestLoggerResolver` in `src/shared/globalRegistry.ts`) that reads the request from Nitro's async context, so the root `evlog` entry never imports Nitro. Without the flag it throws and names the flag.
- **Effect answers a `createError({ status })` failure with `500`** unless the handler catches it and responds with `parseError()`. Documented as a known limit on the Effect page; it does not show in this table because the matrix only drives successful requests.
