# evlog

## 2.33.1

### Patch Changes

- [#906](https://github.com/evloghq/evlog/pull/906) [`da6ef1a`](https://github.com/evloghq/evlog/commit/da6ef1aba940eed9c0b7c412bd3d8c6acd2afb11) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The `bearer` redaction built-in now runs before every other built-in, so a Bearer token is masked whole. A token shaped like an IBAN or a card number was partly rewritten first and then no longer matched: `Bearer FR76ABCD123456789012` was logged as `Bearer FR76****012`, and `Bearer 4111111111111111` as `Bearer ****1111`. Both are now `Bearer ***`, and so is a JWT after `Bearer`, which was logged as `Bearer eyJ***.***`.

- [#906](https://github.com/evloghq/evlog/pull/906) [`da6ef1a`](https://github.com/evloghq/evlog/commit/da6ef1aba940eed9c0b7c412bd3d8c6acd2afb11) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The `iban` redaction built-in masks a spaced IBAN whole when `creditCard` is also on, as it is with the default `redact: true`. The card pattern ran first and matched the digits inside it, so `FR76 3000 6000 0112 3456 7890 189` was logged as `FR76 ****3456 7890 189`. It is now `FR76****189`. A `builtins` list runs in a fixed order, whatever order it is written in.

- [#906](https://github.com/evloghq/evlog/pull/906) [`da6ef1a`](https://github.com/evloghq/evlog/commit/da6ef1aba940eed9c0b7c412bd3d8c6acd2afb11) Thanks [@HugoRCD](https://github.com/HugoRCD)! - A cycle in the context passed to `createLogger()` or `createRequestLogger()`, or in the fields passed to `emit()`, is logged as `'[Circular]'`, as it already was for `set()`. It used to overflow the stack when redaction was on, which it is by default in production. An `Error` in that context or in `emit()` fields is now serialized with its `name`, `message` and `stack` instead of being logged as `{}`.

- [#906](https://github.com/evloghq/evlog/pull/906) [`da6ef1a`](https://github.com/evloghq/evlog/commit/da6ef1aba940eed9c0b7c412bd3d8c6acd2afb11) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `log.set()` only merges plain objects. A class instance or a `Date` is now a value: the next `set()` on the same key replaces it. Before, merging into one wrote the new fields into the caller's own object, and a second `Date` on the same key was ignored. `log.set({ account })` followed by `log.set({ account: { plan: 'pro' } })` now logs `{ plan: 'pro' }` and leaves `account` untouched.

- [#913](https://github.com/evloghq/evlog/pull/913) [`3f1617d`](https://github.com/evloghq/evlog/commit/3f1617d7ebda58a61ccfb9c0e1857297dc0e6175) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `createEvlogHooks().handleError` and `evlogHandleError()` now accept SvelteKit 3's `handleError` input (`kind`, `error`, `event`) and type-check as Kit 3's `HandleServerError`. On SvelteKit 3, errors that are not an `EvlogError` keep Kit's own status and message instead of being overwritten with `undefined`, which made production responses return HTTP 200. The hook no longer reads Kit 3's deprecated `status` and `message` input properties, so dev mode stops logging deprecation warnings. SvelteKit 2 behavior is unchanged.

## 2.33.0

### Minor Changes

- [#855](https://github.com/evloghq/evlog/pull/855) [`a45bdd3`](https://github.com/evloghq/evlog/commit/a45bdd3f982677c8b0e7d310ec671789c81bbb76) Thanks [@JustYannicc](https://github.com/JustYannicc)! - Add `evlog/effect` for Effect 4, in beta: its exports and the fields it writes may change in a minor release. Provide `routerLayer(options)` to an `HttpRouter` or `HttpApi` and every request emits one wide event, with the failure read from the `Cause` and the status the client received. Handlers read the event with `yield* EvlogLogger` (or `yield* useLogger<Fields>()` for typed fields), and `withLogger('action')` turns a job, queue message or Durable Object alarm into its own event. Events carry the unit's `traceId` and `spanId` and continue an incoming `traceparent`. `loggerLayer()` folds `Effect.log*` calls into the current event, and `initLoggerLayer(config)` initializes evlog and flushes a pipeline drain on shutdown. The entry point uses no `AsyncLocalStorage`, so it runs on Cloudflare Workers without `nodejs_compat`.

- [#856](https://github.com/evloghq/evlog/pull/856) [`25de5f0`](https://github.com/evloghq/evlog/commit/25de5f09f3e98049508cf0edf76d3dacc3cd2bd8) Thanks [@JustYannicc](https://github.com/JustYannicc)! - Add `issues` to the Sentry drain. With `createSentryDrain({ issues: true })`, `error` and `fatal` wide events are also sent as Sentry error events, so they open issues and trigger issue alerts. Events with a 4xx status (a thrown 404, 401 or validation 400) stay logs and open no issue. Each issue carries the wide event's trace context (`traceId`, `spanId`, `parentSpanId`), the same `trace_id` as its structured log, the error stack as frames, `service` and the configured `tags` as tags, `userId` or `user.id` as the user, and `METHOD /path` or `action` as the transaction. Events without a `traceId` get one generated, shared by the log and the issue. Issues are sent one at a time after the logs and are best-effort: a failed issue request does not fail the batch. The option defaults to `false`, so existing setups keep sending logs only.

- [#872](https://github.com/evloghq/evlog/pull/872) [`8f3ccc7`](https://github.com/evloghq/evlog/commit/8f3ccc707f4032c0bfde4aa1d1c85c1f2ef60749) Thanks [@evlogai](https://github.com/apps/evlogai)! - Warn at runtime when a removed v2 API is used. Each deprecated API now prints one `console.warn` per process, on call, that names the replacement and states that the API is removed in v3. The warning is plain `console.warn` and never goes through evlog's logger or drains. It is silent when `NODE_ENV` is `production` or `test`, under Vitest or Jest, or when `EVLOG_NO_DEPRECATION_WARNINGS=1` (or `true`) is set.

  Covered in this release: `evlog/browser` (use `evlog/http`), `createPostHogEventsDrain()` (use `createPostHogDrain({ mode: 'events' })`), the Axiom `token` option and its `AXIOM_TOKEN` / `NUXT_AXIOM_TOKEN` variables, the Better Stack `sourceToken` option and its `BETTER_STACK_SOURCE_TOKEN` / `NUXT_BETTER_STACK_SOURCE_TOKEN` variables, the Nuxt `evlog.axiom.token` option, and the eve `redactMessage` option. The Axiom and Better Stack alias warnings are no longer printed in production. Types and the `evlog/toolkit` storage re-export are marked `@deprecated` only.

### Patch Changes

- [#875](https://github.com/evloghq/evlog/pull/875) [`aa9e358`](https://github.com/evloghq/evlog/commit/aa9e3588c467a12d9e8a67606a02b4f289e184b2) Thanks [@vasilistotskas](https://github.com/vasilistotskas)! - In the browser, an `Error` inside an event field is now serialized the same way as `log.error(err)`, with `name`, `message`, `stack`, `cause` and fields such as `status` and `statusCode`, instead of being sent as `{}`. This covers the object form of the client `log.info/warn/error/...({ ... })` at any depth, as the server logger already does, so `log.error({ action: 'checkout', error })` keeps both the action and the error. An Error inside an error's own `cause` or `data` is serialized too, an object that defines `toJSON` is left to it, and an event whose level is not logged is not read.

- [#863](https://github.com/evloghq/evlog/pull/863) [`c7e8097`](https://github.com/evloghq/evlog/commit/c7e8097d862b5da5c6ca1e3d3a81a8f68189a19b) Thanks [@evlogai](https://github.com/apps/evlogai)! - Split Datadog log batches into requests of at most 1000 entries. The Logs intake accepts at most 1000 entries per request, but a batch above 1000 (from `batch.size` or a direct `sendBatchToDatadog` call) was sent as one request. It is now sent as several requests of up to 1000 entries each. Batches of 1000 or fewer are unchanged, and retry behavior is unchanged.

- [#865](https://github.com/evloghq/evlog/pull/865) [`7dec758`](https://github.com/evloghq/evlog/commit/7dec75821ad794fd73bf5cd614ff0e1b7b6e3c98) Thanks [@evlogai](https://github.com/apps/evlogai)! - Send Datadog log batches gzip-compressed. The request carries `Content-Encoding: gzip`, as Datadog recommends for the Logs intake, so less data goes over the network. The intake's 5 MB limit applies to the uncompressed payload, so gzip does not raise how much a batch can hold. The payload and the response handling are otherwise unchanged.

- [#892](https://github.com/evloghq/evlog/pull/892) [`6f6b537`](https://github.com/evloghq/evlog/commit/6f6b5372c438f74e19123ef68966630b75ed9fa7) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog/eve` reports `ai.model` and `ai.provider` again on eve 0.76, which moved the model id from `session.started` to `step.started`. The turn event carries the model of its last step, so a gateway fallback shows the model that served the turn. The `model` option and the `session.started` model are still used when no step reports one.

  Subagent calls are recorded again in `eve.subagents` on eve 0.76, which no longer emits `subagent.*` events. evlog now reads the `subagent-call` and `remote-agent-call` actions and their results: each entry has the subagent name, the tool name, `status` (`called`, `completed` or `failed`), the duration and the error message. The subagent's output is not recorded, and a remote agent is marked `remote: true`. The `ai.tools` entry for a subagent call now measures its duration from the call instead of from the start of the step. Background tasks reported through `task.started` and `task.settled` are not tracked yet.

- [#890](https://github.com/evloghq/evlog/pull/890) [`dccaf5c`](https://github.com/evloghq/evlog/commit/dccaf5c795797d348af5b8620ac268efad4e4798) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix the Nuxt client ingest endpoint (`/api/_evlog/ingest`) answering 500 to a request whose `Origin` is `null`, as sandboxed iframes send, or whose `Referer` is not a URL. It now answers 403, like any other origin that does not match the host.

- [#898](https://github.com/evloghq/evlog/pull/898) [`396f7b1`](https://github.com/evloghq/evlog/commit/396f7b1ae167d3a41f5d93a1c97e8ad02e57b5a2) Thanks [@evlogai](https://github.com/apps/evlogai)! - `log.set()` no longer exposes fields hidden by a `toJSON` method when the same key is set twice. An object whose `toJSON` leaves fields out keeps that `toJSON` on the merged copy, so a second `set()` under the same key does not log the hidden fields.

- [#884](https://github.com/evloghq/evlog/pull/884) [`6e59678`](https://github.com/evloghq/evlog/commit/6e5967869aa1917ec6dd06196c6e055f0efdf180) Thanks [@nathanchase](https://github.com/nathanchase)! - A wide event no longer gets lost when the same plain object is logged as a field and then thrown as an error's `data`, for example `log.warn('failed', { error: payload })` followed by `throw createError({ data: payload })`. evlog used to keep the caller's object in the event and merge the error into it, which made the object contain itself. Redaction then overflowed the stack, and without redaction `JSON.stringify` threw. evlog now copies a plain object before merging into it, so it never writes into an object you passed in. Objects that are never merged into are stored as before, with no copy.

  A `__proto__` key in logged fields, such as one from `JSON.parse` of a request body, is now stored as a field. It used to be merged into `Object.prototype`.

- [#867](https://github.com/evloghq/evlog/pull/867) [`a1467e2`](https://github.com/evloghq/evlog/commit/a1467e299c317184f65d61e5cf38f30458061e7f) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix the built-in `email` and `jwt` redaction patterns, which took quadratic time on long strings: a 64 KiB value with no `@` blocked the event loop for about 2 seconds, and redaction is on by default in production. Both patterns now run in linear time, under 15 ms for the same input. Addresses and tokens are masked as before, except that an email local part longer than 64 characters (invalid under RFC 5321) keeps its leading characters.

- [#893](https://github.com/evloghq/evlog/pull/893) [`2edb43d`](https://github.com/evloghq/evlog/commit/2edb43d5eceefce81c8828d193d709a02e6fdd85) Thanks [@HugoRCD](https://github.com/HugoRCD)! - HTTP drains now retry a `408 Request Timeout` response, with the same backoff and attempt limit as `429` and `5xx`. A `408` used to fail the request on the first attempt and drop the batch. This covers every drain built on the shared HTTP client: Axiom, Better Stack, ClickHouse, Datadog, HyperDX, Loki, OTLP, PostHog, Sazabi and Sentry. Other `4xx` responses are still not retried.

- [#880](https://github.com/evloghq/evlog/pull/880) [`a0187db`](https://github.com/evloghq/evlog/commit/a0187db7a500e5a51bcaa98e5f32ca1fe6df42e5) Thanks [@evlogai](https://github.com/apps/evlogai)! - The Sentry drain's `issues` option now reads an error's `status` before its legacy `statusCode` when it decides whether an event is a 4xx. An `EvlogError` carries both, so an error whose two values disagree is classified by `status`. Logs and the drained wide event are unchanged.

- [#864](https://github.com/evloghq/evlog/pull/864) [`1546dfb`](https://github.com/evloghq/evlog/commit/1546dfb181c461f8233086649de320eac04a2222) Thanks [@evlogai](https://github.com/apps/evlogai)! - Split Sentry log batches into envelopes of at most 100 logs. Sentry's log protocol does not allow more than 100 logs per `log` envelope, but a batch above 100 (from `batch.size` or a direct `sendBatchToSentry` call) was sent as one envelope. It is now sent as several envelopes of up to 100 logs each. Batches of 100 or fewer are unchanged.

- [#866](https://github.com/evloghq/evlog/pull/866) [`ca4abc9`](https://github.com/evloghq/evlog/commit/ca4abc9f21727b1e9f3cfbeefa5c8d4f06e0b8dd) Thanks [@evlogai](https://github.com/apps/evlogai)! - Send the evlog SDK identity to Sentry. Every log now carries `sentry.sdk.name` (`evlog`) and `sentry.sdk.version` attributes, which Sentry's log protocol requires on every log, and each envelope header carries an `sdk` field. Logs also carry the event's `span_id` when the event has one, so Sentry can link a log to its span. Existing fields are unchanged, so no setup change is needed.

- [#875](https://github.com/evloghq/evlog/pull/875) [`aa9e358`](https://github.com/evloghq/evlog/commit/aa9e3588c467a12d9e8a67606a02b4f289e184b2) Thanks [@vasilistotskas](https://github.com/vasilistotskas)! - A logged error no longer carries the `data` or `internal` fields that its own `toJSON` leaves out, on the server and in the browser, whether passed as `log.error(err)` or inside an event. Its name, message, stack, cause and status fields are still logged. `EvlogError` keeps `internal`, since its `toJSON` shapes the HTTP response, not the log.

  On the server, an object that defines `toJSON` inside a `log.*({ ... })` event is now serialized by that method even when it holds an `Error`. It used to be copied into a plain object to serialize the Error, which dropped `toJSON` and sent the fields it leaves out.

- [#877](https://github.com/evloghq/evlog/pull/877) [`07177ec`](https://github.com/evloghq/evlog/commit/07177eca97a602dee0b9dcf288cff22fe2c48834) Thanks [@HugoRCD](https://github.com/HugoRCD)! - In the browser, errors are serialized the way the server logger does it: an h3 or Nuxt error that wraps another is logged once instead of repeating its message and stack, and the options object `createError()` keeps as `cause` is dropped. With `pretty: true`, DevTools now receives the logged Error itself, with its stack. On the server, `why`, `fix` and `link` are logged on any error, not only on `EvlogError`.

- [#895](https://github.com/evloghq/evlog/pull/895) [`6203a07`](https://github.com/evloghq/evlog/commit/6203a076bf209118528ae2f562b75bbd73f5fa03) Thanks [@evlogai](https://github.com/apps/evlogai)! - The published packages no longer ship `.map` files. They pointed to `src/`, which is not part of the package, so they only added to the install size. `evlog` drops from 340 files (about 2.09 MB unpacked) to 183 files (about 905 KB). No runtime or API change.

- [#889](https://github.com/evloghq/evlog/pull/889) [`84d31be`](https://github.com/evloghq/evlog/commit/84d31bef0e8f25f6422a250c7de03614ac08ed0d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix the local stream server (`startStreamServer`, `stream: true` in Nuxt and Next.js) accepting browser pages from other sites when no `token` is set. It matched the `Origin` host by prefix, so a page on `https://localhost.example.com` could read the live events, and it never checked `Host`, so a page on a domain that resolves to `127.0.0.1` could too. Without a token, it now accepts a request only when `Host` is `localhost`, `127.0.0.1` or `[::1]` and `Origin`, if sent, names one of them exactly. The Nuxt discovery route `/api/_evlog/stream-info` no longer answers with `Access-Control-Allow-Origin: *`: it allows loopback origins only.

## 2.32.0

### Minor Changes

- [#852](https://github.com/evloghq/evlog/pull/852) [`0f5970d`](https://github.com/evloghq/evlog/commit/0f5970d0e0c17cea249751819b5c521136b3e330) Thanks [@alex-holovach](https://github.com/alex-holovach)! - Add the Sazabi drain adapter (`evlog/sazabi`). It sends wide events to a Sazabi log stream over OTLP/HTTP, reusing the OTLP adapter's encoding. The stream's intake URL carries its key, so configuration is one variable: `SAZABI_INTAKE_URL` (optional `SAZABI_SERVICE_NAME`, falling back to `OTEL_SERVICE_NAME`). `createSazabiDrain()` also accepts `endpoint`, `serviceName`, `resourceAttributes`, `timeout` and `retries`, and an intake URL pasted with its `/v1/logs` suffix is used as is. Records use the compact OTLP shape by default (a one-line summary body and dotted attributes); `recordShape: 'json'` sends the serialized event instead. `sendToSazabi` and `sendBatchToSazabi` send events directly.

### Patch Changes

- [#843](https://github.com/evloghq/evlog/pull/843) [`f3541b1`](https://github.com/evloghq/evlog/commit/f3541b1573a9482abc16f09365ed7076c6bc4f62) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix `request.log` on `@nestjs/platform-fastify`. `EvlogModule` now sets the evlog logger on `FastifyRequest.log` before guards, interceptors, pipes, and controllers run, so `request.log.set(...)` no longer throws `TypeError: request.log.set is not a function`. `FastifyRequest.log` is typed as the evlog logger when `evlog/nestjs` is imported.

## 2.31.0

### Minor Changes

- [#807](https://github.com/evloghq/evlog/pull/807) [`7e6282a`](https://github.com/evloghq/evlog/commit/7e6282ad8ad43d440285930b63c6c2ff635282ef) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The Nuxt and Nitro modules (v2 and v3) load `evlog.config.ts` (or `.mts`, `.js`, `.mjs`), the nearest one from the app up to the workspace root, and bundle it into the server. Options passed to the module, or set under the `evlog` key in `nuxt.config.ts`, override the file with the same merge as `extends`. The `drain`, `enrich` and `keep` of the file run next to the `evlog:drain`, `evlog:enrich` and `evlog:emit:keep` hooks, and a drain built with `createDrainPipeline()` is flushed when the server closes. On Nuxt the browser logger takes `enabled`, `pretty` and `minLevel` from the file too, unless the `evlog` key in `nuxt.config.ts` or a `NUXT_PUBLIC_EVLOG_*` variable sets them. `defineEvlogHook()` from `evlog/eve` takes the settings of `evlog.config.ts`, so an Eve agent spreads its config into the hook: `defineEvlogHook({ ...config, message: 'preview' })`. Its logger settings start the logger on the first turn, and `init` still replaces them when given.

- [#805](https://github.com/evloghq/evlog/pull/805) [`7951563`](https://github.com/evloghq/evlog/commit/7951563d3a86335249d08b4c4e55ccd8e92d5ff0) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `defineEvlog()` accepts `extends`, another config to build on, such as a preset published to npm. Objects merge key by key with the config winning on each key, lists are replaced except `redact.paths`, `redact.patterns` and `sampling.keep`, which add up, `plugins` merge by `name`, and a config extends one level only. `mergeEvlogConfig()` applies the same merge outside `defineEvlog()`. `EvlogConfig` also takes `map` and `logs`, the settings `evlog map` and `evlog logs` read from `evlog.config.ts`, and `toLoggerConfig()` and `toMiddlewareOptions()` leave them out.

- [#834](https://github.com/evloghq/evlog/pull/834) [`b1880ab`](https://github.com/evloghq/evlog/commit/b1880ab766d1da012795bd11727b7ee6c06ec72c) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `log.fork()` returns a promise that resolves once the child event has drained, and never rejects. Await it when a write in the child, such as an audit routed to `auditOnly(sink, { await: true })`, must land before the response. With `waitUntil` set, `log.fork()` registers the child with it when called, so an unawaited fork drains before the runtime stops and `ForkLifecycle.onChildExit` fires after the child's drain. A failure after the child event is emitted, such as a throwing console write, is now logged with `console.error` instead of being dropped. Forks you leave unawaited need `void log.fork(...)` under a `no-floating-promises` lint rule.

- [#836](https://github.com/evloghq/evlog/pull/836) [`f3613ee`](https://github.com/evloghq/evlog/commit/f3613ee77be5f7eceec3d818af2a4307254d01bf) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Redact secrets by key name. A new `secrets` built-in, on by default with the other built-ins, replaces the value of any key ending in `password`, `passwd`, `secret` or `token` (case-insensitive, at any depth) with `replacement`. So `password`, `newPassword`, `client_secret` and `accessToken` no longer reach production logs, while counters such as `totalTokens` and `tokensPerSecond` are kept. Values are replaced in full, booleans and `null` are left alone, and listing `builtins` without `'secrets'` turns it off. `evlog config` lists `secrets` among the built-ins.

- [#811](https://github.com/evloghq/evlog/pull/811) [`567bc62`](https://github.com/evloghq/evlog/commit/567bc62ddd87342d20fc7a42745521beb561879d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Apply `sampling.rates` to browser logs received on the client ingest endpoint. Client events previously skipped head sampling entirely, so `info: 0` still sent every client info log to your drains. A sampled-out client event is now dropped before enrichment and draining, with the same defaults as server events: errors and fatal are kept, trace is dropped unless `sampling.rates.trace` is set. If you tuned rates for server traffic only, check that they still fit your client volume.

### Patch Changes

- [#816](https://github.com/evloghq/evlog/pull/816) [`db19fc2`](https://github.com/evloghq/evlog/commit/db19fc241b6521f561e351263e8c7fb780f0dadf) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix `captureOutput` in `evlog/next/instrumentation` sending evlog's own events to drains a second time: in JSON mode, each wide event printed to stdout came back as a `log.info` event, and error events as `log.error` through stderr. evlog now marks its own writes so the capture passes them through.

- [#810](https://github.com/evloghq/evlog/pull/810) [`d476140`](https://github.com/evloghq/evlog/commit/d476140b5ec8c39380d0582db3ecbb21cc626d0e) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix every client log being silently dropped in Nuxt when `minLevel` is not set: the public runtime config turns the unset value into `''`, which no level passed. The client logger now falls back to `'debug'` for any value that is not a valid level.

- [#829](https://github.com/evloghq/evlog/pull/829) [`b49915d`](https://github.com/evloghq/evlog/commit/b49915dd8ce7518ea313ea589f1c92f1ffd10ddc) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Stop wide events from repeating an error made with h3's `createError({ statusCode, message })` under `error.cause`. h3 keeps that options object as `cause`, so the event carried the message and status code twice. evlog now drops the `cause` when it only restates fields the error already has, and keeps it when it carries anything else.

- [#816](https://github.com/evloghq/evlog/pull/816) [`db19fc2`](https://github.com/evloghq/evlog/commit/db19fc241b6521f561e351263e8c7fb780f0dadf) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix every route returning 500 with `Cannot find package 'evlog'` in a Next.js app built with Turbopack and deployed without `node_modules` (Vercel, `output: 'standalone'`) when root `instrumentation.ts` uses `defineNodeInstrumentation({ ... })`. The gate loaded `evlog/next/instrumentation/create` through a computed `import()` that the build left out of the output file trace. It now imports the module behind `process.env.NEXT_RUNTIME === 'nodejs'`, so Next.js bundles it into the Node.js build and drops it from the Edge build. With webpack, the module used to load unbundled from `node_modules`, where `NEXT_RUNTIME` is unset, so `captureOutput` never applied. It applies now.

- [#830](https://github.com/evloghq/evlog/pull/830) [`d419b9c`](https://github.com/evloghq/evlog/commit/d419b9cd7070bf992adcc7ab977b51cf4a6acdf4) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Stop `evlog/next` from logging "`after` was called outside a request scope" when a streamed response (SSE, NDJSON, AI SDK streams) completes or the client disconnects. A streamed response now registers its `waitUntil` while the handler is still running, and the drain started when the body finishes joins that registration. The same applies to any integration given a `waitUntil` option, such as Hono and Cloudflare Workers.

- [#837](https://github.com/evloghq/evlog/pull/837) [`b3b3b35`](https://github.com/evloghq/evlog/commit/b3b3b35a7cba1bdba7c84e824483048b03bcf92f) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Stop Nitro and Nuxt from printing an error a second time when evlog already records it. In production, an unhandled error or a `fatal` one produced both the wide event and Nitro's `[request error] [unhandled]` block with its stack. evlog's error handler now skips Nitro's default logging whenever the request has a wide event. Nitro still logs the error when evlog is disabled, the route is excluded, or the plugin is not registered.

- [#819](https://github.com/evloghq/evlog/pull/819) [`e7c954b`](https://github.com/evloghq/evlog/commit/e7c954bf5adfb3befa4e676342db89eab0ddc85d) Thanks [@evlogai](https://github.com/apps/evlogai)! - Stop Nitro and Nuxt from printing expected `createError` 4xx responses as `[request error] [unhandled]` in production. The wide event already records these errors, so evlog's Nitro error handler now skips Nitro's default logging for `EvlogError` with a status below 500. Server errors and errors that are not from evlog are still logged by Nitro.

- [#821](https://github.com/evloghq/evlog/pull/821) [`6887f13`](https://github.com/evloghq/evlog/commit/6887f13327b617e256115fab2c4872c7ef7e8993) Thanks [@evlogai](https://github.com/apps/evlogai)! - Client events received by the Nuxt and Nitro ingest endpoint are now printed to stdout, the same way server events are. Before, they were only sent to drains, so an app without a drain accepted browser logs with a 204 and they never showed up anywhere. Events still reach your drains, and `silent: true` still suppresses the console output.

- [#838](https://github.com/evloghq/evlog/pull/838) [`94043b1`](https://github.com/evloghq/evlog/commit/94043b18926d10e6ec3823e361c478cc2c1e846a) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Redact client events received by the Nuxt and Nitro ingest endpoint. The route built its own wide event and skipped the global `redact` config, so in production a browser event carrying an email or a card number reached stdout and every drain unmasked, while server events were redacted. Client events now go through the same redaction before enrichers, stdout and drains.

- [#817](https://github.com/evloghq/evlog/pull/817) [`038de6a`](https://github.com/evloghq/evlog/commit/038de6a0c041a16bef228dcb243aac968053228a) Thanks [@evlogai](https://github.com/apps/evlogai)! - Fix the built-in `email` redaction masking pnpm store paths in stack traces. Segments such as `node_modules/.pnpm/h3@1.15.11/...` were rewritten to `h***@***.11`, so drained `error.stack` values lost the package name and version. The email pattern now requires a letters-only top-level domain, so real addresses are still masked as `a***@***.com`.

- [#794](https://github.com/evloghq/evlog/pull/794) [`bd3558d`](https://github.com/evloghq/evlog/commit/bd3558dbcc56965d8ff2d57ff4d2965db7b4280b) Thanks [@evlogai](https://github.com/apps/evlogai)! - Fix custom RegExp `redact.patterns` declared in `nuxt.config.ts` (or Nitro module options) being silently dropped: patterns are now serialized as `{ source, flags }` across the config bridges and rebuilt into RegExp on the server. A pattern object without a `source` field is reported instead of skipped, and a function-valued `redact.replacement` / `redact.transform` in the Nuxt module now prints the same warning the standalone Nitro modules already print.

- [#835](https://github.com/evloghq/evlog/pull/835) [`e02edd1`](https://github.com/evloghq/evlog/commit/e02edd171d9adaac9f04e9e75e021df85ce5c82c) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `debug()` to the request logger. `useLogger(event).debug('...')` threw `log.debug is not a function`, though the generated `AGENTS.md` tells agents to use `log.debug()` for step detail. It now records a `debug` entry in `requestLogs` and merges its context, without raising the event level, and the `evlog/vite` plugin strips it from production builds like the global `log.debug()`.

- [#804](https://github.com/evloghq/evlog/pull/804) [`49af75e`](https://github.com/evloghq/evlog/commit/49af75eb53e3bb9bb0642c607328b04d9f0472a0) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Nuxt and Nitro apps that set `silent: true` in the module options no longer print `silent mode is enabled but no drain is configured` at startup. The logger starts from those options before the server plugins attach the drain, so the warning fired even with an `evlog:drain` hook. Standalone `initLogger({ silent: true })` without a drain still warns.

- [#826](https://github.com/evloghq/evlog/pull/826) [`670db27`](https://github.com/evloghq/evlog/commit/670db2784f026145a0f44b6130bd641959f0d53c) Thanks [@evlogai](https://github.com/apps/evlogai)! - Stop the Nuxt client transport endpoint from emitting a request wide event for every batch of client logs. A successful `POST /api/_evlog/ingest` (204) no longer adds a server event next to each `source: "client"` event, in drains or on the console. Failed transport requests (4xx and 5xx) still emit, so a broken transport stays visible. A custom `transport.endpoint` is honoured, and an explicit `exclude` pattern still excludes the route.

- [#825](https://github.com/evloghq/evlog/pull/825) [`2bbd392`](https://github.com/evloghq/evlog/commit/2bbd39292bef4e53f3d6bf341687b86145881761) Thanks [@evlogai](https://github.com/apps/evlogai)! - Stop wide events from repeating the whole error under `error.cause` when h3 wraps a thrown error. h3 keeps the original error as `cause` and copies its message and stack, so every error event carried the message, stack and payload twice. evlog now serializes the original error once and keeps the h3 status fields (`statusCode`, `statusMessage`, `data`). A `cause` that is a different error is still kept.

## 2.30.1

### Patch Changes

- [#774](https://github.com/evloghq/evlog/pull/774) [`5ca8bd4`](https://github.com/evloghq/evlog/commit/5ca8bd4fbe481acaf05dd226e5cfc44618dd50c9) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `readFsLogs()` and `tailFsLogs()` from `evlog/fs` now read files the drain wrote with `pretty: true`, assembling each indented event, where they used to skip every line of them as malformed.

- [#778](https://github.com/evloghq/evlog/pull/778) [`88d2c9f`](https://github.com/evloghq/evlog/commit/88d2c9f2254a41e6ff7b744b4cbeac844a6b0023) Thanks [@adelrodriguez](https://github.com/adelrodriguez)! - An `Error` inside an event field is now serialized the same way as `log.error(err)`, with `name`, `message`, `stack`, and `cause`, instead of being written as `{}`. This covers the object form of `log.info/warn/error/...({ ... })` at any depth, and `set()` plus the context argument of the level methods on a request logger.

- [#780](https://github.com/evloghq/evlog/pull/780) [`8fabc14`](https://github.com/evloghq/evlog/commit/8fabc14aff3ca30089fbb246b7747d6cd2907220) Thanks [@simplyzetax](https://github.com/simplyzetax)! - `withEvlog` and `defineWorkerFetch` (`evlog/workers`) keep the type of an annotated `ctx`, so a handler typed with Cloudflare's `ExecutionContext` reaches `ctx.exports`, `ctx.props` and `ctx.passThroughOnException()` without a cast. An unannotated `ctx` is still `WorkerExecutionContext`.

## 2.30.0

### Minor Changes

- [#743](https://github.com/evloghq/evlog/pull/743) [`9000215`](https://github.com/evloghq/evlog/commit/9000215b8053c4cbabf36d9b40205b299abf9184) Thanks [@evlogai](https://github.com/apps/evlogai)! - Add a default export so `import logger from 'evlog'` works like pino and consola: every call prints immediately, with no `initLogger()` needed. It is the bare `log` API under the default slot, so `logger.info('tag', 'message')`, `logger.info('message')` and `logger.info({ event })` all output right away. For wide events with drains and sampling, `initLogger()` and `createLogger()` stay the documented path.

  Running in production without `initLogger()` now warns once on the first emitted event, pointing at `initLogger({ drain })`: without it events carry the default service and environment, skip redaction, and reach no drain. Apps that already call `initLogger()` see no change.

- [#731](https://github.com/evloghq/evlog/pull/731) [`46cad75`](https://github.com/evloghq/evlog/commit/46cad756f1c15bdd6580f53e86b21980242e368a) Thanks [@evlogai](https://github.com/apps/evlogai)! - Add an `enrichTurn` option to `defineEvlogHook()` in `evlog/eve`. It runs once per turn where the turn logger is created, with the eve session in scope, so enrichers can reach `ctx.session.auth` and the session lineage instead of only HTTP-shaped context. Returned fields merge onto the turn event over the built-in `eve`, `agent` and `channel` fields, and stay turn-scoped: they are not carried across turns of the same session. The existing `enrich` option keeps its HTTP-shaped context.

- [#754](https://github.com/evloghq/evlog/pull/754) [`aebed60`](https://github.com/evloghq/evlog/commit/aebed601afce00aeeb4250cf1b075d4504067f5d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog` now ships the `evlog` executable: once evlog is installed, `npx evlog init`, `npx evlog map`, `npx evlog doctor` and `npx evlog agents` are available without adding anything. The executable runs `@evlog/cli` when it is installed and otherwise fetches it with the package manager that launched it (`npx`, `pnpm dlx`, `bunx`, `yarn dlx`), so `evlog` gains no dependency. Add `@evlog/cli` as a dev dependency for a pinned, instant run in CI. `@evlog/cli` now declares `evlog` as a peer dependency instead of a dependency, so a project carries one copy of the logger.

- [#742](https://github.com/evloghq/evlog/pull/742) [`3fc8c1f`](https://github.com/evloghq/evlog/commit/3fc8c1fa7d938c3c504d77061d59c1f84b2765f2) Thanks [@evlogai](https://github.com/apps/evlogai)! - Add `fatal` and `trace` log levels. `log.fatal()` emits an error-level event that sampling always keeps, and `log.trace()` emits a debug-level event that is dropped by default; opt in with `sampling.rates.trace`. Both levels flow through console output, colors, OTLP severity mapping, Datadog status mapping and the ingest validation, and the request logger accepts `fatal()` and `trace()` entries (`trace` never raises the event level, `fatal` escalates it above `error`).

- [#748](https://github.com/evloghq/evlog/pull/748) [`7af9caf`](https://github.com/evloghq/evlog/commit/7af9caf4d3f01328f8056e3218dbb0bdf652c086) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Align the OTLP adapter with the OpenTelemetry exporter specification. `createOTLPDrain()` now reads `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` (used as the full logs URL, without appending `/v1/logs`), `OTEL_EXPORTER_OTLP_LOGS_HEADERS` (merged over `OTEL_EXPORTER_OTLP_HEADERS`) and `OTEL_RESOURCE_ATTRIBUTES`, so a deployment already configured for an OTel SDK needs no evlog-specific variables. A new `compression: 'gzip'` option, also read from `OTEL_EXPORTER_OTLP_[LOGS_]COMPRESSION`, gzips the request body.

  Fix attribute encoding in the OTLP, HyperDX and PostHog adapters: non-integer numbers are sent as `doubleValue` instead of strings, and arrays of a single primitive type as `arrayValue`, so backends can aggregate and filter on them. Malformed or all-zero `traceId` / `spanId` values are kept as attributes instead of being placed in the record's trace fields, where collectors reject them. Events that differ in `version`, `region` or `commitHash` no longer share a resource, and the instrumentation scope carries the evlog version.

- [#750](https://github.com/evloghq/evlog/pull/750) [`5e0d543`](https://github.com/evloghq/evlog/commit/5e0d5437db3db92ba663f26f7a6a11c29376b1e2) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `protocol: 'http/protobuf'` to the OTLP adapter for collectors and gateways that only accept protobuf. The protocol is also read from `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` and `OTEL_EXPORTER_OTLP_PROTOCOL`. The encoder has no dependencies and is loaded only when selected; it is also exported as `encodeOTLPLogsRequest()` from `evlog/otlp/protobuf`. Integers outside the safe integer range are now sent as `doubleValue` instead of a rounded `intValue`.

- [#749](https://github.com/evloghq/evlog/pull/749) [`11e1d4f`](https://github.com/evloghq/evlog/commit/11e1d4f0c7e3be5d3f3da4a695e3ba713efdbaad) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `createTraceContextEnricher()` no longer sets `event.spanId` from an incoming `traceparent`. That span belongs to the caller, so linking the event to it pointed log-to-span correlation one level too high. The id is now recorded as `event.parentSpanId` (and `traceContext.parentSpanId`), and `event.spanId` is left for your tracer to set from the active server span, for example `trace.getActiveSpan()?.spanContext().spanId` with OpenTelemetry. If you relied on the enricher for `spanId` in the OTLP or Datadog adapters, set it from the active span.

  The OTLP adapter's default `json` record shape now sends nested objects as OTLP key-value lists (`kvlistValue`) instead of JSON strings, so collectors and backends can read their fields. The `compact` shape is unchanged.

  A new `semanticConventions: true` option on `createOTLPDrain()` adds OpenTelemetry semantic convention attributes next to the evlog field names: `http.request.method`, `url.path`, `http.response.status_code`, `user_agent.original`, `exception.*` and `gen_ai.*` (model, provider, response id, token usage, finish reasons), plus the `deployment.environment.name` resource attribute. It becomes the default in the next major.

### Patch Changes

- [#725](https://github.com/evloghq/evlog/pull/725) [`543b00f`](https://github.com/evloghq/evlog/commit/543b00fd7410ac3a11783e127ea30f89d4262baf) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Allow Eve agents to disable subagent lifecycle subscriptions with `subagentEvents: false` when those events do not carry hook session context.

- [#764](https://github.com/evloghq/evlog/pull/764) [`24ffe06`](https://github.com/evloghq/evlog/commit/24ffe064e67a9ac46a86f4960ee9015226604457) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Measure `durationMs` before tail-sampling `keep` hooks run, so a hook that awaits I/O no longer inflates the request duration on the emitted event.

- [#741](https://github.com/evloghq/evlog/pull/741) [`fe75141`](https://github.com/evloghq/evlog/commit/fe7514179827cac062a96527d58c651bc1ee4e89) Thanks [@evlogai](https://github.com/apps/evlogai)! - Support printf-style interpolation in `log` messages: `%s`, `%d`, and `%j` in a message string are formatted with the extra arguments, matching node's `util.format` semantics for the supported specifiers. Interpolation applies to the message only, never to field values, and the formatter stays tree-shakeable.

- [#738](https://github.com/evloghq/evlog/pull/738) [`5b4a493`](https://github.com/evloghq/evlog/commit/5b4a49387936a64c5ed7c5ff5b036d9bb0587d7b) Thanks [@jamalkamaladdin](https://github.com/jamalkamaladdin)! - Serialize an `Error` in `error.cause` the same way as the top-level error, with `name`, `message`, `stack` and its metadata fields. A wrapped driver error such as the `pg` error inside a `DrizzleQueryError` no longer reaches drains as `{}`, and a cause chain that loops back emits `[Circular]`.

- [#764](https://github.com/evloghq/evlog/pull/764) [`24ffe06`](https://github.com/evloghq/evlog/commit/24ffe064e67a9ac46a86f4960ee9015226604457) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Write the console line after enrichers run. Fields added in `enrich` (UserAgent, Geo, TraceContext, `@evlog/signals` verdicts, your own plugins) now appear in stdout and in platform logs such as Vercel, not only in drains. Events that neither enrich nor drain are printed as before.

## 2.29.0

### Minor Changes

- [#669](https://github.com/evloghq/evlog/pull/669) [`4debb2d`](https://github.com/evloghq/evlog/commit/4debb2d3301d104ba4196306b0227acc11ac6b8a) Thanks [@evlogai](https://github.com/apps/evlogai)! - Add `prompt` and `output` options to the AI SDK integration. Each one independently captures one direction of the model call: `prompt: true` adds `ai.prompt` (the formatted prompt sent to the first model call) and `output: true` adds `ai.output` (the text generated by the last model call). Both accept `maxLength` truncation and a `transform` hook for redaction. Off by default.

  The pretty console output renders `ai.prompt` and `ai.output` as tree entries (one line per message block, truncated for the terminal). The full text stays in the wide event.

### Patch Changes

- [#660](https://github.com/evloghq/evlog/pull/660) [`07db128`](https://github.com/evloghq/evlog/commit/07db12893f8c3dfa59ce4ca49c83f5c4c4600ae0) Thanks [@evlogai](https://github.com/apps/evlogai)! - Defer global Next.js drains through `after()` and keep them active until asynchronous sends and buffered batches finish.

- [#682](https://github.com/evloghq/evlog/pull/682) [`3a84ba9`](https://github.com/evloghq/evlog/commit/3a84ba9f5f181502dd331db57f7e471b0990ed36) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Preserve error details in global `log.error(Error)` calls, replace circular error metadata with `[Circular]`, and keep `audit()` calls safe when request logging is disabled or excluded. Correct generic logger accessor types and load the Nitro 3 hook declarations during source type checking.

- [#696](https://github.com/evloghq/evlog/pull/696) [`7811f7d`](https://github.com/evloghq/evlog/commit/7811f7d51469245958a16f105289bc4b94293d12) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix Bun crashes and test lifecycle timeouts when importing the Elysia or eve integration by isolating the AsyncLocalStorage capability probe from the caller's context.

## 2.28.1

### Patch Changes

- [#649](https://github.com/evloghq/evlog/pull/649) [`0417784`](https://github.com/evloghq/evlog/commit/0417784dc9e6d3825c10b5d715ff2cb1e7e3acdd) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Point the package metadata (`repository`, `bugs`) and README links at the repository's new home, `evloghq/evlog`.

## 2.28.0

### Minor Changes

- [#643](https://github.com/HugoRCD/evlog/pull/643) [`ada6408`](https://github.com/HugoRCD/evlog/commit/ada6408caa7271f7f4a2595dc7f56dd934367052) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `createError({ data })` returns an extra payload to the client, merged into the response body's `data` object next to `code`, `why`, `fix`, and `link`. Those four win on a key collision, and anything the client must never see still goes in `internal`. Read it client-side with `parseError(err).data`.

  The Nitro and Nuxt error handler no longer drops `data` from errors thrown with h3's `createError`. It now follows Nitro's own rule for what it withholds: the message and `data` of an unhandled error are hidden in production, while a deliberate `createError({ status: 500, message })` keeps both. Development returns the error as thrown, as Nitro does.

### Patch Changes

- [`c0a0385`](https://github.com/HugoRCD/evlog/commit/c0a03855d476224039154aee46064a38da008836) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `useLogger()` from `evlog/eve` no longer throws when it cannot reach the current turn's logger. It warns once for that turn and returns a logger that accepts every call and emits nothing, so a tool is never failed by its own instrumentation.

  Turn state is held per process, while an eve turn is durable and can resume in another process after a step boundary. A tool calling `useLogger(ctx)` after such a resume used to throw, which failed the tool itself — a long-running turn could lose real work to a missing log field. Enrichment for that turn is dropped instead, and the warning names the turn so the gap is visible.

- [#644](https://github.com/HugoRCD/evlog/pull/644) [`c2af424`](https://github.com/HugoRCD/evlog/commit/c2af424256789c0b957325455acbc3d14003cf06) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog/hono` records errors again in apps that register `app.onError`. Hono hands a thrown error to `onError` at the route's own dispatch level, so the middleware resumed as if the request had succeeded and the failure was emitted as an info event with no `error` field. The wide event now carries the error and the status the handler actually returned.

## 2.27.1

### Patch Changes

- [#633](https://github.com/HugoRCD/evlog/pull/633) [`f030d01`](https://github.com/HugoRCD/evlog/commit/f030d01a6423c3cb7843e33cb8b95d9bbc4b9c12) Thanks [@evlogai](https://github.com/apps/evlogai)! - The Axiom adapter now sends the event's own `timestamp` as Axiom's `_time` via the `timestamp-field` ingest parameter, so batched and retried events keep their original time instead of being stamped at ingest. It also logs partial ingest failures and schema warnings that Axiom's ingest response can carry on a 2xx. The shared HTTP transport now retries `429` responses with backoff alongside `5xx`, which matters for Axiom's rate limits.

## 2.27.0

### Minor Changes

- [#622](https://github.com/HugoRCD/evlog/pull/622) [`1704339`](https://github.com/HugoRCD/evlog/commit/17043394e7bcf8c1603ffb44f0f4952a5be77a31) Thanks [@evlogai](https://github.com/apps/evlogai)! - The `evlog/eve` wide event now records which AI provider (deployment) served each turn. The `ai.model` field continues to carry the gateway slug (e.g. `deepseek/deepseek-v4-flash`), while the new `ai.provider` field reports the resolved provider (e.g. `deepseek`), extracted from the model id eve reports on `session.started`. Cost-per-provider analysis no longer requires cross-referencing the rate card against the model catalogue.

- [#627](https://github.com/HugoRCD/evlog/pull/627) [`72093df`](https://github.com/HugoRCD/evlog/commit/72093df2e658bf307312feaf57cecaf0c2cad19f) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Wrapping an adapter drain in `createDrainPipeline` now behaves as documented. Adapter drains swallow delivery failures so they never break a request, which silently disabled the pipeline's `retry` and `onDropped` and stacked the adapter's internal HTTP retries on top of the pipeline's. Drains built with `defineDrain` / `defineHttpDrain` now expose a throwing `raw` variant that performs a single attempt unless retries are explicitly configured, and the pipeline picks it up automatically: `retry` and `onDropped` observe real failures, and one layer owns retrying. A batch dropped with no `onDropped` configured is logged instead of vanishing.

  On serverless runtimes the pipeline no longer strands buffered events. It exposes `settled()`, which resolves once everything buffered so far has been delivered or dropped, and the shared middleware registers it with the runtime's `waitUntil` (Next's `after()`, Workers' `ctx.waitUntil`) so the instance is not frozen while a batch sits in the buffer.

- [#580](https://github.com/HugoRCD/evlog/pull/580) [`c40e0fd`](https://github.com/HugoRCD/evlog/commit/c40e0fd5a60ab094b28bd98aa8ff3b5120784d7f) Thanks [@evlogai](https://github.com/apps/evlogai)! - The `evlog/eve` integration now records how much context each tool result added. `ai.tools[]` gains an `inputTokens` field per tool, measured as the input-token delta between the step that called the tool and the step that consumed its result, so the tool that dominates a turn's context shows up without a manual before/after diff. Parallel tool results in one step share the delta evenly; a result whose delta crosses a compaction or context reset is left unset rather than mis-attributed.

## 2.26.0

### Minor Changes

- [#556](https://github.com/HugoRCD/evlog/pull/556) [`15b292d`](https://github.com/HugoRCD/evlog/commit/15b292d2e824f90738b69ccdfb3ba41da3710f16) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Link PostHog logs to people and session replays, and add a compact OTLP record shape.

  The PostHog adapter now sends `posthogDistinctId` (from `userId`) and `sessionId` as log attributes, which is how PostHog surfaces a log on a person's profile and links it to their session replay. Both sources are configurable and accept dot paths:

  ```ts
  createPostHogDrain({
    distinctIdField: "user.id",
    sessionIdField: "session.id",
  });
  ```

  In `mode: 'events'`, events without a resolvable identity are now sent as anonymous PostHog events (`$process_person_profile: false`) instead of being attributed to a person named after the service. A numeric `userId` is used as the identifier rather than discarded.

  The `otlp`, `posthog`, and `hyperdx` adapters accept a new `recordShape` option. `'compact'` sends a one-line body (`POST /api/checkout (500)`) and flattens nested fields into dotted attributes (`user.id`, `ai.costUsd`) that backends can filter and break down by:

  ```ts
  createOTLPDrain({ recordShape: "compact" });
  ```

  In `mode: 'events'`, `'compact'` flattens the same way, so nested fields become properties the PostHog UI can filter and break down by rather than one opaque object.

  The default stays `'json'` — the whole event in the body, one attribute per top-level field, nested properties untouched — so existing records and the queries built on them are unchanged. `'compact'` becomes the default in the next major.

### Patch Changes

- [`ebed9cf`](https://github.com/HugoRCD/evlog/commit/ebed9cf8936672552ebb2ed125f3722b53c183ba) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Qualify the eve turn `requestId` with its session id.

  eve numbers turns within a session, so `turn_0` is the first turn of every session. Recording it as `requestId` made the field non-unique — every single-turn session produced the same value, which is unusable as a correlation key in a drain. The wide event now reports `<sessionId>:<turnId>`, and `evlogRuntimeContext` stamps the same value on the model-call spans so a trace still joins to the event it belongs to. `eve.sessionId` and `eve.turnId` are unchanged.

## 2.25.0

### Minor Changes

- [#501](https://github.com/HugoRCD/evlog/pull/501) [`16d5323`](https://github.com/HugoRCD/evlog/commit/16d5323efb132fead23643bc002d2411d1f48124) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Cover the eve 0.30 event surface. **`evlog/eve` now requires eve >= 0.30** — the peer range moves from `>=0.24.3`. The eve integration is still beta and its peer floor moves with it, so this ships as a minor; nothing outside `evlog/eve` is affected. Agents on an older eve keep working on the previous evlog — upgrade eve first.

  The wide event now carries what eve started reporting since 0.24:
  - `eve.runtime` — eve version, agent id, model, and the deployed git sha, branch and date, from `session.started`
  - `eve.parent` — parent and root session ids for a subagent run, so a drain can rebuild the delegation tree
  - `eve.authorizations` — connection sign-ins with their outcome, reason and duration; a turn parked on one ends as `eve.phase: 'awaiting-authorization'`
  - `eve.compaction` — how many compactions ran, on which model, and how full the context was when the first one triggered
  - `eve.contextCleared`, `eve.stepFailures` and `eve.failedSteps` — a model call that failed and was retried no longer disappears from a turn that ends up succeeding
  - `ai.costUsd` — the cost eve reports, used in place of the `cost` pricing map when available. `ai.model` falls back to the model reported at session start, so `model` is only needed for dynamic-model agents
  - subagents record `durationMs` and a `started` status

  `message` replaces `redactMessage` with three modes: `'omit'` (default), `'preview'` (text truncated to `messagePreviewLength`, attachments reduced to their type and media type) and `'full'`. Attachment parts were previously not redacted at all. `redactMessage` still works and is deprecated.

  `sessionEvent: true` adds one wide event per session on top of the per-turn ones, rolling up turns, tokens, cost, tools used, compactions and authorizations — one row per conversation, which is what makes tail sampling useful on an agent.

- [#506](https://github.com/HugoRCD/evlog/pull/506) [`f8fb677`](https://github.com/HugoRCD/evlog/commit/f8fb677d5a267d2a25bca52bff2453b5f0c1bdf2) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Close the remaining gaps in the eve integration, and add `defineEvlogInstrumentation()`.

  A wide event and an Agent Runs span describe the same turn, but nothing joined them: you could not jump from a trace in Braintrust, Datadog or the Vercel dashboard to the event in your drain. Export the new definition from `agent/instrumentation.ts` and every model-call span carries `evlog.request_id` and `evlog.session_id`, the values the wide event reports as `requestId` and `eve.sessionId`:

  ```ts
  // agent/instrumentation.ts
  import { defineEvlogInstrumentation } from "evlog/eve";

  export default defineEvlogInstrumentation();
  ```

  Without `setup`, OpenTelemetry export is untouched and eve keeps writing its local traces. `functionId`, `recordInputs`, `recordOutputs` and `traceChannelRequests` pass through to eve.

  Three more of eve's stream events now reach the wide event:
  - `eve.reasoning` — `blocks` and `chars`, the size of the model's thinking. The reasoning text itself is never recorded.
  - `message.responseChars`, and `message.response` once `message` is `'preview'` or `'full'` — the agent's answer, following the same rule as the incoming message.
  - `eve.result` — the structured result of an agent with an output schema.

- [#507](https://github.com/HugoRCD/evlog/pull/507) [`1838d60`](https://github.com/HugoRCD/evlog/commit/1838d609ed41f973a48ebf62dc0557a16117221d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `evlog/eve` records the caller, and composes with another observability backend.

  An agent has exactly one `agent/instrumentation.ts`, and every observability item in eve's registry writes it. `defineEvlogInstrumentation()` owns that file, so it only fits an agent whose instrumentation is evlog's alone. The new `evlogRuntimeContext` contributes evlog's span attributes to instrumentation you already have, the way the other integrations do:

  ```ts
  import { defineInstrumentation } from 'eve/instrumentation'
  import { evlogRuntimeContext } from 'evlog/eve'

  export default defineInstrumentation({
    setup: ({ agentName }) => registerOTel({ serviceName: agentName, spanProcessors: [...] }),
    events: {
      'step.started': input => ({
        runtimeContext: {
          ...evlogRuntimeContext(input),
          posthog_distinct_id: input.session.auth.current?.principalId ?? '',
        },
      }),
    },
  })
  ```

  It returns `undefined` outside a tracked turn, so spreading it adds nothing.

  Turn and session events now carry `eve.caller` with the principal eve resolved at dispatch: `principalId`, `principalType` and `authenticator`. On a multi-user channel that is the dimension you group cost, volume and refusals by, and it was previously unreachable — the enrich hook is HTTP-shaped and exposes no path to the eve session. `subject` and `attributes` are deliberately excluded, since a channel may put a name or an email in them.

### Patch Changes

- [#500](https://github.com/HugoRCD/evlog/pull/500) [`8ffba92`](https://github.com/HugoRCD/evlog/commit/8ffba925f5fedb94cce782aa173011cde0245ace) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Emit a wide event for eve turns that end without `turn.completed` or `turn.failed`.

  A turn cancelled by eve produced no wide event, and its logger, accumulator and session slot stayed in memory for good: LRU eviction skips any session that still has an active turn, so nothing ever reclaimed them. `turn.cancelled` now closes the turn on its own terminal path — status `499`, `eve.phase: 'cancelled'`, level `info`, because cancellation is not a failure in eve's model.

  `session.failed` and `session.completed` flush any turn still open for that session and drop its carried-over context, which also ends the indefinite retention of snapshots for finished sessions.

- [#510](https://github.com/HugoRCD/evlog/pull/510) [`68b05fa`](https://github.com/HugoRCD/evlog/commit/68b05fa1456ee3b7d6cfe9e34abe3175c74cb5d0) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The file system drain now detects an unwritable directory reliably.

  The previous check probed with `mkdir({ recursive: true })`, which is a no-op on a directory that already exists and therefore succeeds even when that directory is read-only. A deployment whose log directory already existed still threw on every batch. The probe also ran per call rather than per resolved state, so concurrent batches could each warn.

  The write itself is now the check: once an append fails with `EROFS`, `EACCES` or `EPERM`, the drain is disabled for that directory and warns once. Batches already in flight when that happens still attempt their own append. Any other failure, including a full disk, is reported by the drain as before.

- [#509](https://github.com/HugoRCD/evlog/pull/509) [`2dfde11`](https://github.com/HugoRCD/evlog/commit/2dfde11d5c79a2b119a5c64110dc25d0e2f43656) Thanks [@HugoRCD](https://github.com/HugoRCD)! - The file system drain disables itself when its directory is not writable.

  `createFsDrain()` guarded neither its `mkdir` nor its `appendFile`, so attaching it on a serverless host — where everything outside the temp directory is read-only — threw once per batch for the lifetime of the deployment, and the events went nowhere regardless. Callers had to guess at the environment to avoid it:

  ```ts
  // no longer needed
  const drain = process.env.VERCEL !== "1" ? createFsDrain() : undefined;
  ```

  The drain now disables itself once it observes an `EROFS`, `EACCES` or `EPERM` write failure for that directory, warning a single time, the same way it already disables itself in the Edge runtime. Attach it unconditionally. Any other failure — a full disk, a genuine bug — still propagates.

## 2.24.0

### Minor Changes

- [#495](https://github.com/HugoRCD/evlog/pull/495) [`c739cf8`](https://github.com/HugoRCD/evlog/commit/c739cf87aa2dfbc72dd9d868b688fdf7bed5d8dd) Thanks [@HugoRCD](https://github.com/HugoRCD)! - feat: publish wide events on a `node:diagnostics_channel`

  New opt-in entry point `evlog/diagnostics`. Call `enableDiagnosticsChannel()` once at startup and every emitted wide event is published on the `evlog.event` channel:

  ```ts
  // server/plugins/evlog-diagnostics.ts
  import { enableDiagnosticsChannel } from "evlog/diagnostics";

  export default defineNitroPlugin(async () => {
    await enableDiagnosticsChannel();
  });
  ```

  A consumer then subscribes by channel name alone, with no evlog import and no entry in `initLogger()`:

  ```ts
  import { subscribe } from "node:diagnostics_channel";

  subscribe("evlog.event", ({ event }) =>
    metrics.timing("http.request", event.durationMs),
  );
  ```

  `subscribeToWideEvents()` is exported for consumers that already depend on evlog and want the payload typed.

  Subscribers receive the same object drains receive — post-audit, post-redaction, post-enrich — and must treat it as read-only. They run synchronously and are not awaited: this is an observation side channel, not a transport. On Cloudflare, Workers forwards every channel message to a Tail Worker, so enabling it gets wide events out of an isolate with no drain and no `waitUntil`.

  Off by default, and free when off — `node:diagnostics_channel` is loaded lazily so it never enters the main bundle graph, and with the channel enabled but unsubscribed the emit path benchmarks identically to having it disabled.

- [#494](https://github.com/HugoRCD/evlog/pull/494) [`44705f7`](https://github.com/HugoRCD/evlog/commit/44705f7bd90ef2d903e9a10beea7a704c724e50e) Thanks [@HugoRCD](https://github.com/HugoRCD)! - feat(core): expose `durationMs` as a number on the wide event

  Request loggers now write `durationMs` (a number, in milliseconds) next to the existing `duration` string. `duration` keeps its current shape — `"12ms"`, `"1.20s"` — and is still what the pretty terminal renders; `durationMs` is the one to query. Backends stop needing a parse step: ClickHouse can `avg()` and `quantile(0.95)()` on a real column, LogQL can do `| json | durationMs > 1000`, and facet-based UIs get a numeric field instead of a string.

  The ClickHouse adapter's default `toClickHouseRow()` maps it to a new `duration_ms` column. Add it to an existing table before upgrading:

  ```sql
  ALTER TABLE evlog_events ADD COLUMN duration_ms Nullable(UInt32) AFTER duration;
  ```

  Durations are measured with a clamped elapsed helper, so a backward wall-clock step (NTP, manual change) during a request can no longer surface a negative `durationMs`, `duration`, or tail-sampling duration.

  `BaseWideEvent` now declares both fields, so `event.durationMs` is typed `number | undefined` in enrichers and drains. Code that read `event.duration` as a number was already wrong at runtime and will now fail to type-check — switch it to `event.durationMs`.

## 2.23.0

### Minor Changes

- [#473](https://github.com/HugoRCD/evlog/pull/473) [`f39ab30`](https://github.com/HugoRCD/evlog/commit/f39ab30d90af608acb1527a766d4823460dc99bd) Thanks [@HugoRCD](https://github.com/HugoRCD)! - refactor: build each adapter's HTTP request once instead of twice — every HTTP adapter (`axiom`, `better-stack`, `datadog`, `otlp`, `sentry`, `posthog` in `events` mode) constructed its URL, headers and body in two places: the `encode()` passed to `defineHttpDrain()` and again inside its standalone `sendBatchTo*` helper. The two copies had already drifted, reporting the same failure under different names (`axiom API error` from the drain, `Axiom API error` from the helper), and Axiom's and Better Stack's `encode()` ignored the deprecated `token` / `sourceToken` aliases the helper honoured. Both paths now share one encoder per adapter and report failures identically. `defineHttpDrain()` accepts an optional `label` for the human-readable name used in error messages, and `sendEncodedDrainRequest()` is exported from `evlog/toolkit` so custom adapters can reuse their own encoder the same way

- [#481](https://github.com/HugoRCD/evlog/pull/481) [`d7f482a`](https://github.com/HugoRCD/evlog/commit/d7f482aa41ad696db21ba07ffaaa355bf7fd0b56) Thanks [@HugoRCD](https://github.com/HugoRCD)! - feat(clickhouse): add the ClickHouse drain adapter (`evlog/clickhouse`) — `createClickHouseDrain()` inserts wide events over ClickHouse's HTTP interface in `JSONEachRow` format, working with a local instance, a self-managed cluster, and ClickHouse Cloud. The default `evlog_events` schema keeps typed columns for what you filter and aggregate on (`timestamp`, `level`, `service`, `environment`, `request_id`, `trace_id`, `method`, `path`, `status`, …) plus the complete event as JSON in `data`, so adding a field to your events never needs a migration; pass `transform` to target your own schema. Asynchronous inserts are enabled and not awaited by default (`async_insert=1&wait_for_async_insert=0`), so ClickHouse batches server-side instead of creating one MergeTree part per request and draining never blocks on disk writes. Credentials are sent as `X-ClickHouse-User` / `X-ClickHouse-Key` headers rather than query parameters, so they never reach `system.query_log`. Configured via `CLICKHOUSE_ENDPOINT` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `CLICKHOUSE_DATABASE` / `CLICKHOUSE_TABLE` or overrides, with `sendToClickHouse` / `sendBatchToClickHouse` for direct use. The adapter docs carry the matching `CREATE TABLE`.

- [#465](https://github.com/HugoRCD/evlog/pull/465) [`12852d3`](https://github.com/HugoRCD/evlog/commit/12852d31ad10e990091c6cb1740d201fb9fc95ac) Thanks [@HugoRCD](https://github.com/HugoRCD)! - fix(datadog): lift `event.traceId` / `event.spanId` into a root `dd` block — Datadog's log-to-trace correlation only reads `dd.trace_id` / `dd.span_id` at the payload root, so the ids `createDefaultEnrichers()` already sets arrived nested under `evlog` and never correlated. The nested copy stays, so `@evlog.*` facets keep working, and `resolveDatadogTraceContext` is exported for custom drains

- [#468](https://github.com/HugoRCD/evlog/pull/468) [`ecc3ea6`](https://github.com/HugoRCD/evlog/commit/ecc3ea60db28d7513c515958f127af6a1ec6a0d5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - fix(core): key request scope, logger config and error identity to a versioned `globalThis` registry — evlog declares 18 optional peers, and pnpm/bun (isolated linker) hash resolved peers into store paths, so two workspaces that resolve `ai` or `zod` differently end up with physically distinct copies of the _same_ evlog version. Each copy used to carry its own `AsyncLocalStorage` (so `useLogger()` threw inside another copy's `withEvlog()`), its own logger configuration (so events emitted through the second copy were silently undrained and unredacted), and its own `EvlogError` class (so `instanceof` downgraded structured errors to bare 500s). All three are now shared per major version. `createLoggerStorage()` takes an optional storage id, and `EvlogError.isEvlogError()` replaces `instanceof` for cross-copy checks

- [#471](https://github.com/HugoRCD/evlog/pull/471) [`4e12ebb`](https://github.com/HugoRCD/evlog/commit/4e12ebbbc33a04d8cc77c7bf09edce418466d804) Thanks [@HugoRCD](https://github.com/HugoRCD)! - refactor: route `evlog/nestjs`, `evlog/react-router` and `evlog/sveltekit` through `defineFrameworkIntegration()` — the three integrations each rebuilt the same request extraction, `crypto.randomUUID()` fallback, `attachForkToLogger()` call and `storage.run()` wrapper by hand instead of using the helper Hono, Express, Elysia, Fastify and oRPC already share. Behaviour is unchanged, but they now inherit anything the helper gains (including `waitUntil` extraction) for free. A new `pickBaseEvlogOptions()` toolkit export becomes the single place listing the `BaseEvlogOptions` fields, replacing the copy in `toMiddlewareOptions()` and the hand-written field list in `evlog/eve` — which silently dropped `waitUntil`, and would have dropped every option added later

- [#476](https://github.com/HugoRCD/evlog/pull/476) [`35431c2`](https://github.com/HugoRCD/evlog/commit/35431c2685a10b0448e22fd416a9b37e626ec1e0) Thanks [@HugoRCD](https://github.com/HugoRCD)! - feat(hono): export `useLogger()` and enable `log.fork()` — Hono was the only framework integration without `useLogger()`, so reaching the request logger from a service or repository meant threading the Hono `Context` down through every call. `import { useLogger } from 'evlog/hono'` now resolves the same logger `c.get('log')` returns, and `c.get('log')` is unchanged — it stays the idiomatic accessor inside route handlers. Attaching AsyncLocalStorage also enables `log.fork()` on Hono, for background work that emits its own wide event correlated by `_parentRequestId`.

  **Cloudflare Workers:** `useLogger()` is backed by `AsyncLocalStorage`, so `evlog/hono` now imports `node:async_hooks`. Workers deployments need the `nodejs_compat` (or `nodejs_als`) compatibility flag in `wrangler.toml`. If you cannot enable it, use `evlog/workers`, which stays free of `node:async_hooks` by design.

- [#480](https://github.com/HugoRCD/evlog/pull/480) [`1b0edb8`](https://github.com/HugoRCD/evlog/commit/1b0edb80b080b3c03fc2f60e848191fac2a6a2f7) Thanks [@HugoRCD](https://github.com/HugoRCD)! - feat(loki): add the Grafana Loki drain adapter (`evlog/loki`) — `createLokiDrain()` pushes wide events to Loki's push API, covering self-hosted single-tenant, multi-tenant (`X-Scope-OrgID`), and Grafana Cloud (instance ID + token as HTTP Basic). Each event is pushed as a JSON log line under a deliberately small label set — `service`, `environment`, `level` by default — so Loki's index stays cheap while everything else (`requestId`, `path`, custom fields) remains queryable with `| json`. Promote extra fields with `labelFields`, add deployment-wide labels with `labels`. Events sharing a label set are grouped into one stream and sorted by timestamp, since Loki rejects out-of-order entries. Configured via `LOKI_ENDPOINT` / `LOKI_API_KEY` / `LOKI_USER` / `LOKI_TENANT_ID` or overrides, with `sendToLoki` / `sendBatchToLoki` for direct use.

- [#474](https://github.com/HugoRCD/evlog/pull/474) [`c5e85b0`](https://github.com/HugoRCD/evlog/commit/c5e85b0b121a60b69699b4f6f2fe5831dee62f19) Thanks [@HugoRCD](https://github.com/HugoRCD)! - refactor(next): run `withEvlog()` through the shared middleware pipeline — `evlog/next` reimplemented the whole request pipeline (route filtering, per-route service, tail sampling, emit, enrich, drain) instead of calling `createMiddlewareLogger`, so it silently drifted from every other integration. Two options declared on `NextEvlogOptions` never did anything: `plugins` was never applied, because Next built no plugin runner at all, and global `sampling.keep` tail conditions were never evaluated — Next only called the user's `keep` callback, and its tail context carried no `duration`, so duration-based keep rules could not match. Both now work. `keep` callbacks also receive `ctx.duration`, and error statuses are derived through the shared `extractErrorStatus`. Next's `after()` is wired as the pipeline's `waitUntil`, so drain work still runs after the response is sent; enrich now runs before the response returns, matching the documented `waitUntil` contract and every other integration — move latency-sensitive work into `drain` if you relied on enrich being deferred

- [#466](https://github.com/HugoRCD/evlog/pull/466) [`5d99391`](https://github.com/HugoRCD/evlog/commit/5d99391638a13bb7ea3a8b98f3ac71e07b9b72cb) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Make emit-time redaction programmable

  `RedactConfig.replacement` now accepts a function, so a replacement can be derived from the value it replaces instead of being a constant — a stable fingerprint keeps requests correlatable without exposing the credential:

  ```ts
  initLogger({
    redact: {
      patterns: [/\/public\/claim\/([A-Za-z0-9._-]{12,})/g],
      replacement: (_match, ctx) =>
        `/public/claim/[tok:${fingerprint(ctx.groups[0])}]`,
    },
  });
  ```

  `RedactConfig.transform` covers policies that cannot be expressed declaratively — conditional on a sibling field, tenant-scoped, or allowlist-shaped. It runs before the declarative stages, so it sees raw values and `paths` / `builtins` / `patterns` still apply to whatever it leaves behind.

  Both run where redaction already runs: after the event is built, before the console write and before any drain. Failures are caught and reported like drain failures — a `replacement` function that throws or returns a non-string falls back to `[REDACTED]` rather than emitting the raw value, and a throwing `transform` is skipped without stopping the event from being logged.

  Function-valued policy cannot survive the build-time config bridges, which serialize to JSON; the Nitro modules now warn instead of dropping it silently.

  Closes [#463](https://github.com/HugoRCD/evlog/issues/463)

- [#470](https://github.com/HugoRCD/evlog/pull/470) [`374abfd`](https://github.com/HugoRCD/evlog/commit/374abfdd01522a7e74d26ecfc8f20c2ae8571e1a) Thanks [@HugoRCD](https://github.com/HugoRCD)! - fix(core): stop dropping `waitUntil` when a `defineEvlog()` config is passed to middleware — `toMiddlewareOptions()` copied every other `BaseEvlogOptions` field but silently omitted `waitUntil`, so `defineEvlog({ waitUntil })` lost the serverless drain hook on its way to the framework integration and drains were awaited inline instead of being registered with the platform. `evlog/hono` now also picks up `c.executionCtx.waitUntil` on its own, so drains on Cloudflare Workers and Vercel Edge complete after the response is returned with no manual wiring; adapters without an `ExecutionContext` (Node, Bun, Deno) keep draining inline, and an explicit `waitUntil` option still wins

- [#472](https://github.com/HugoRCD/evlog/pull/472) [`2540aa5`](https://github.com/HugoRCD/evlog/commit/2540aa5eb526f9cd25a637cde1bc7115575a280e) Thanks [@HugoRCD](https://github.com/HugoRCD)! - feat(workers): add `withEvlog()` so Cloudflare Workers get the full middleware pipeline — `evlog/workers` was the only integration that never ran `createMiddlewareLogger`, so `include` / `exclude`, per-route `routes` overrides, `redact`, `enrich`, `keep` tail sampling and `plugins` simply had no effect there. Wrap your fetch handler with `withEvlog(handler, options)` and the wide event is emitted for you when the handler returns, with the same option surface every other framework accepts; `ctx.waitUntil` is picked up from the third argument so drains outlive the response, streaming bodies defer the emit until they complete, and `requestId` now honours `x-request-id` before falling back to `cf-ray`. `defineWorkerFetch()` and `createWorkersLogger()` are unchanged and remain the manual-emit path. The entrypoint stays free of `node:async_hooks`, so it still runs without `nodejs_compat`

### Patch Changes

- [#457](https://github.com/HugoRCD/evlog/pull/457) [`899464a`](https://github.com/HugoRCD/evlog/commit/899464a6c4a2dcf0a2816ddd39eb74203c4d4a82) Thanks [@EmilGramDK](https://github.com/EmilGramDK)! - fix(core): redact own enumerable fields only, so getter-only prototype accessors such as `DOMException.code` are never assigned to. A field that still refuses the write now warns instead of throwing, and redaction keeps covering the own fields of class instances.

- [#477](https://github.com/HugoRCD/evlog/pull/477) [`f5d7474`](https://github.com/HugoRCD/evlog/commit/f5d7474232379a3346f2dfa8e23335b4a9bfa44a) Thanks [@HugoRCD](https://github.com/HugoRCD)! - fix(core): serialize Error instances passed to the client `log.error()` — `name`, `message` and `stack` are non-enumerable, so an `Error` spread into a wide event contributed nothing and the call emitted an event with no error at all. The docs teach `log.error(new Error(...))` for Next.js client components, and the type only accepted a tag pair or a plain object, so the pattern failed to type check as well. Errors now land under `error` with the same shape the server logger stores, including `code`, `status`, `cause` and friends

- [#478](https://github.com/HugoRCD/evlog/pull/478) [`f662848`](https://github.com/HugoRCD/evlog/commit/f6628484226c11456611543f0930ef9ad6c9c857) Thanks [@HugoRCD](https://github.com/HugoRCD)! - fix(elysia): defer the wide event until a streaming body closes — `evlog/elysia` emitted from `onAfterResponse`, which fires as soon as the response is handed off. For an SSE or chunked body that is long before the stream finishes, so anything the handler set mid-stream (AI token counts, tool calls, final status) was dropped with a post-emit `[evlog]` warning. Streaming responses are now claimed in `mapResponse` and their body wrapped, so the emit waits for the stream to close — the same behaviour Hono, oRPC, SvelteKit, React Router and Next already had ([#321](https://github.com/HugoRCD/evlog/issues/321)). Non-streaming responses are unaffected and still emit immediately.

- [#457](https://github.com/HugoRCD/evlog/pull/457) [`2c20be7`](https://github.com/HugoRCD/evlog/commit/2c20be7620e4eeea1bb31cfbca91af66e60e849e) Thanks [@EmilGramDK](https://github.com/EmilGramDK)! - fix(core): record the same error twice without crashing. A handler that logs the error it then throws hands the same instance to `log.error()` and to the integration's `finish({ error })`; the second merge walked into the caller's own object and threw on any read-only field it carried.

- [#484](https://github.com/HugoRCD/evlog/pull/484) [`9e3bd96`](https://github.com/HugoRCD/evlog/commit/9e3bd96d401890ff24001da742848b14ce65a4b7) Thanks [@HugoRCD](https://github.com/HugoRCD)! - docs: move OTLP and HyperDX into the "Cloud or Self-Hosted" category — both self-host as readily as they run managed, so filing them under `cloud/` alongside Axiom and Datadog was misleading. They join Loki and ClickHouse under `hybrid/`, and each page now splits its setup into explicit self-hosted and managed sections rather than mixing the two. The old `/integrate/adapters/cloud/otlp` and `/integrate/adapters/cloud/hyperdx` URLs 301 to the new locations.

## 2.22.4

### Patch Changes

- [#442](https://github.com/HugoRCD/evlog/pull/442) [`8f294d1`](https://github.com/HugoRCD/evlog/commit/8f294d17b65e17a77aa40f2be721168be35b61bb) Thanks [@lichterspiel](https://github.com/lichterspiel)! - fix(next): thread `redact` through `createInstrumentation().register()` — it previously re-initialised the logger without redaction and locked it, silently disabling `redact` configured for the Next.js instrumentation path

## 2.22.3

### Patch Changes

- [#437](https://github.com/HugoRCD/evlog/pull/437) [`00fadc9`](https://github.com/HugoRCD/evlog/commit/00fadc9573ae8d49b64a5deccd6d2e93ee3ad66b) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix `nuxt typecheck` failing with `TS2304: Cannot find name 'useLogger'` (and `createEvlogError`) on server routes. `$fetch`'s return-type inference pulls server routes — and their auto-imported globals — into the app tsconfig project's typecheck too, but the Nuxt module only declared these globals for the server project. `useLogger` and `createEvlogError` are now declared for both projects; the server-only `log` export stays scoped to the server project since it shares its global name with the (differently-typed) client `log`.

## 2.22.2

### Patch Changes

- [#438](https://github.com/HugoRCD/evlog/pull/438) [`8f7b5e3`](https://github.com/HugoRCD/evlog/commit/8f7b5e3c933bfd58e910dfa501dbfc0789260cb5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix `withEvlog` (Next.js) logging a phantom ERROR at status 500 for every `redirect()`/`notFound()`/`forbidden()`/`unauthorized()` call. These APIs throw an internal Next.js control-flow signal that isn't a real error — `withEvlog` now detects it via `unstable_rethrow` and rethrows it untouched instead of logging and emitting an error event.

## 2.22.1

### Patch Changes

- [#431](https://github.com/HugoRCD/evlog/pull/431) [`573f772`](https://github.com/HugoRCD/evlog/commit/573f772cdb0d69425739c389b780119fbb63259e) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Export `evlog/package.json` so tooling (e.g. `evlog doctor`) can resolve the installed version via `require.resolve('evlog/package.json')` under Node's `exports` map.

- [#433](https://github.com/HugoRCD/evlog/pull/433) [`9b2d3d9`](https://github.com/HugoRCD/evlog/commit/9b2d3d94ad0e922942f35cc6b604db7e8b764fa0) Thanks [@TheLiberal](https://github.com/TheLiberal)! - Fix the Nitro v3 response hook breaking every streaming response (SSE, NDJSON, and `transfer-encoding: chunked` — which includes all tRPC v11 `httpBatchStreamLink` traffic). The hook locked the original response body via `getReader()` and assigned the wrapped response to `event.res`, which is a getter-only accessor on h3 v2, producing `Attempted to assign to readonly property` followed by `ReadableStream is locked` and a 500 for the client. Streaming responses now pass through untouched and the wide event is emitted at header time; stream-lifetime metrics are not observable from h3 v2's `onResponse` hook, which cannot replace the outgoing response.

## 2.22.0

### Minor Changes

- [#430](https://github.com/HugoRCD/evlog/pull/430) [`31c251f`](https://github.com/HugoRCD/evlog/commit/31c251f2670ebb5a771e259ee01b802fcc33a99d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `evlog/toolkit/storage` for `createLoggerStorage` so edge/Workers integrations can import ALS separately. The main `evlog/toolkit` barrel still re-exports it for compatibility; prefer `evlog/toolkit/storage` when you need to keep `node:async_hooks` out of bundles that do not tree-shake unused exports. Drop the barrel re-export at the next major.

- [#429](https://github.com/HugoRCD/evlog/pull/429) [`1e325b9`](https://github.com/HugoRCD/evlog/commit/1e325b9cdc0567cb5e1937dbd4bf29e6879a97a6) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `waitUntil` support to `createMiddlewareLogger` and `defineFrameworkIntegration` so custom framework integrations can defer async drains on Cloudflare Workers and Vercel Edge without blocking the response. Pass `waitUntil` per request (e.g. `ctx.waitUntil.bind(ctx)`) or declare `extractWaitUntil` on the integration manifest.

### Patch Changes

- [#419](https://github.com/HugoRCD/evlog/pull/419) [`1953cfe`](https://github.com/HugoRCD/evlog/commit/1953cfe27e355fe36888985b43017e5ba152b2fc) Thanks [@crtwheel](https://github.com/crtwheel)! - fix: pretty printer shows `[object Object]` for array field values

- [#428](https://github.com/HugoRCD/evlog/pull/428) [`ec13863`](https://github.com/HugoRCD/evlog/commit/ec1386379dd0330a467e4a503f232f486d4f7dfc) Thanks [@HugoRCD](https://github.com/HugoRCD)! - fix(nitro): preserve h3 HTTPError `message` in JSON error responses instead of overwriting it with `statusText`

  ***

## 2.21.0

### Minor Changes

- [#410](https://github.com/HugoRCD/evlog/pull/410) [`30208db`](https://github.com/HugoRCD/evlog/commit/30208db84348e78ec3150cc6bfdf01a7557fd277) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add AI SDK v7 `LanguageModelV4` wrap/middleware support in `evlog/ai`. `createAILogger().wrap()` and `createAIMiddleware()` now use V4-native middleware (`specificationVersion: 'v4'`) while still accepting V3 models (AI SDK upgrades them via `wrapLanguageModel`). `wrap()` is typed against `LanguageModel` from `ai`, so V3, V4, and gateway model strings all type-check on AI SDK v7.

### Patch Changes

- [#409](https://github.com/HugoRCD/evlog/pull/409) [`0fc4e80`](https://github.com/HugoRCD/evlog/commit/0fc4e8080c2b1e1f7da9329de191e1f3ac77ca72) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix `createEvlog({ redact })` / `withEvlog` so custom `redact` rules apply to the main Next.js request wide event (console output and drain), not only forked child events.

- [#412](https://github.com/HugoRCD/evlog/pull/412) [`b4d4baf`](https://github.com/HugoRCD/evlog/commit/b4d4baf840e707f4b09d31cb51d6e9a7fb483e45) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix Nuxt auto-import types for `useLogger`, `log`, `parseError`, and related helpers. The Nuxt module now ships explicit type templates that resolve through `evlog` / `evlog/client` package exports instead of Nitro's extensionless `dist/` paths, which typed as `any`.

## 2.20.0

### Minor Changes

- [#404](https://github.com/HugoRCD/evlog/pull/404) [`f5df8ff`](https://github.com/HugoRCD/evlog/commit/f5df8ffd6a564d3d807caa85838dd479102eee25) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add AI SDK v7 compatibility for `evlog/ai`. `createEvlogIntegration()` now implements both v6 hooks (`onToolCallFinish`, `onFinish`) and v7 hooks (`onToolExecutionEnd`, `onEnd`, `onEmbedEnd`, `onAbort`, `onError`). On v7, embeddings are auto-captured via `onEmbedEnd` when telemetry is enabled, and abort/error lifecycle events are written to the wide event. Pass the integration via `telemetry.integrations` (v7) or `experimental_telemetry.integrations` (v6). Exports a new `EvlogTelemetry` type.

- [#399](https://github.com/HugoRCD/evlog/pull/399) [`b1d04d0`](https://github.com/HugoRCD/evlog/commit/b1d04d0ec4d22af3102bc13c252112091fffc8c4) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `evlog/eve` with `defineEvlogHook()` for one wide event per agent turn and `useLogger()` in tools (AsyncLocalStorage on `turn.started`; pass `ctx` only when ALS is unavailable) — full drain, enrich, and tail-sampling pipeline. Tracks tool durations (including post-approval resumes), session context carry-over with LRU eviction (`maxSessions`), slim `eve.phase` / `eve.sessionTurns` fields, and compact HITL `approval`. The turn logger is bound via AsyncLocalStorage on `turn.started`; pass `ctx` when ALS is unavailable. Turn state is shared via `globalThis` when eve bundles hooks and tools separately. `finalizeAudit()` no longer crashes on partial `audit` objects missing `actor` fields. Fixes `_auditForceKeep` leaking on force-kept events and skips Nitro runtime probes on Next.js hosts.

### Patch Changes

- [#395](https://github.com/HugoRCD/evlog/pull/395) [`a024f4c`](https://github.com/HugoRCD/evlog/commit/a024f4ce8adc5bf2857fc2d077dfeae4827ef519) Thanks [@HugoRCD](https://github.com/HugoRCD)! - # fix(elysia): support Cloudflare Workers without AsyncLocalStorage.enterWith

  Cloudflare Workers omit native `AsyncLocalStorage.enterWith()`. The Elysia integration now installs a small polyfill on load so `useLogger()` keeps working in typical `wrangler dev` flows. `{ log }` from derive remains the safest option when multiple requests may interleave in the same isolate.

  Closes [#394](https://github.com/HugoRCD/evlog/issues/394)

- [#401](https://github.com/HugoRCD/evlog/pull/401) [`bf5705b`](https://github.com/HugoRCD/evlog/commit/bf5705bcef3f6be9fb2d0a605138cc77a2284058) Thanks [@HugoRCD](https://github.com/HugoRCD)! - # fix(nitro): avoid comment collision when inlining config with `*/` globs

  Nitro's textual `nitro.options.replace` substitution was also rewriting JSDoc that mentioned the inline config token. Route globs containing `*/` (for example `/api/graphs/**/changes`) could terminate block comments early and break production builds with Rolldown parse errors.

  Closes [#397](https://github.com/HugoRCD/evlog/issues/397)

- [#402](https://github.com/HugoRCD/evlog/pull/402) [`4f80f39`](https://github.com/HugoRCD/evlog/commit/4f80f399bddc832af4ce7e610c9ec5425dde8bd2) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix dev pretty output so structured wide events include a timestamp, matching tagged logs.

  Closes [#396](https://github.com/HugoRCD/evlog/issues/396)

- [#399](https://github.com/HugoRCD/evlog/pull/399) [`b1d04d0`](https://github.com/HugoRCD/evlog/commit/b1d04d0ec4d22af3102bc13c252112091fffc8c4) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix stream server mis-detection when co-located with eve dev: return 404 (not SSE 200) for non-root GET paths, and re-bind the turn logger on `actions.requested` so tool handlers can resolve `useLogger()`.

## 2.19.2

### Patch Changes

- [#393](https://github.com/HugoRCD/evlog/pull/393) [`aa394e5`](https://github.com/HugoRCD/evlog/commit/aa394e534102a06d7fbd50d4503636db7214660e) Thanks [@HugoRCD](https://github.com/HugoRCD)! - # fix: type framework loggers as AuditableLogger with required `.audit()`

  `useLogger()`, `c.get('log')`, `req.log`, and other integration surfaces now return `AuditableLogger` instead of `RequestLogger`, so `.audit()` type-checks without optional chaining. Matches runtime behavior from `createRequestLogger()`.

  Closes [#389](https://github.com/HugoRCD/evlog/issues/389)

- [#392](https://github.com/HugoRCD/evlog/pull/392) [`ffdd28f`](https://github.com/HugoRCD/evlog/commit/ffdd28f915dffaa82072da506ca35afd2c0beb30) Thanks [@HugoRCD](https://github.com/HugoRCD)! - # fix: keep Node built-ins out of the main entrypoint bundle

  Non-Node bundlers (Convex, etc.) failed when importing `defineErrorCatalog` from `evlog` because the main bundle transitively referenced `node:crypto` and `pretty-error-snippet.node` (`node:fs`, `node:path`, `node:module`). The audit signer now uses `globalThis.crypto.subtle` only, disk snippet loading is registered from Node-only integration entrypoints instead of `initLogger`, and catalog utilities live in a dedicated `evlog/catalog` subpath backed by a lean `audit-action` module.

  Closes [#387](https://github.com/HugoRCD/evlog/issues/387)

- [#391](https://github.com/HugoRCD/evlog/pull/391) [`467d615`](https://github.com/HugoRCD/evlog/commit/467d615bdaf1ce0bc7caceed2fdc9c50ed654e79) Thanks [@HugoRCD](https://github.com/HugoRCD)! - # fix(nuxt): restore `error.vue` rendering for SSR page errors

  With `evlog/nuxt` installed, every non-API SSR error (404/500) was returned as raw Nitro JSON instead of rendering the framework error page. The Nitro error handler now delegates document/HTML navigations to the next handler in Nitro's chain (Nuxt's `error.vue` renderer) while still serializing JSON for API routes and `EvlogError` responses.

  Closes [#390](https://github.com/HugoRCD/evlog/issues/390)

- [#384](https://github.com/HugoRCD/evlog/pull/384) [`6eb0957`](https://github.com/HugoRCD/evlog/commit/6eb0957d03c69fffbac2390c6e2bc84cf42fbb4b) Thanks [@nadaniels](https://github.com/nadaniels)! - fix(hono): resolve "ReadableStream is locked" error with AI SDK streaming responses

  Using `createUIMessageStreamResponse` or `createAgentUIStreamResponse` from the Vercel AI SDK inside a Hono route would throw `ERR_INVALID_STATE: ReadableStream is locked` when running under `@hono/node-server`.

  **Root cause:** The middleware called `createObservedBody(c.res.body)` (which calls `body.getReader()`, locking the stream) and then relied on Hono's `compose` to update `c.res` with the wrapped response via the middleware return value. However, Hono skips that update when `context.finalized` is already `true` — which is always the case after a route handler returns a `Response`. This left `c.res` pointing at the original response whose body was now locked, so `@hono/node-server`'s subsequent `response.body.getReader()` call threw.

  **Fix:** Explicitly assign `c.res = await finishResponse(c.res, ...)` instead of returning the wrapped response, so `c.res` is always updated regardless of `context.finalized`.

  Closes [#382](https://github.com/HugoRCD/evlog/issues/382)

## 2.19.1

### Patch Changes

- [#379](https://github.com/HugoRCD/evlog/pull/379) [`8ede2c2`](https://github.com/HugoRCD/evlog/commit/8ede2c2d648156b1e6f05ec8fb015100bb6d5560) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Adapter error and deprecation messages now show canonical environment variable names only (`BETTER_STACK_API_KEY`, `AXIOM_API_KEY`, `SENTRY_DSN`, etc.). `NUXT_*` aliases still resolve silently for backward compatibility, but are no longer mentioned in console output or documentation.

  The OTLP adapter now also accepts the shorter `OTLP_ENDPOINT` / `OTLP_HEADERS` env vars as aliases for the standard `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`.

- [#381](https://github.com/HugoRCD/evlog/pull/381) [`6f21121`](https://github.com/HugoRCD/evlog/commit/6f2112127861f31660182e6ebe5b47ef66911301) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix duplicate terminal output when Next.js `captureOutput` is enabled: pretty-print writes use the native stdout handle registered at patch time and passthrough is skipped unless `silent: true`. Next.js dev stacks are source-mapped to original TypeScript (like Nitro) via a Next-only enricher that does not bundle nitropack/youch; stored stacks are compacted in dev (production stacks are kept intact) and useless `.next`/`node:` snippet previews are skipped. The primary `at` line now points at your route/handler file instead of Next `route-modules` internals.

- [#373](https://github.com/HugoRCD/evlog/pull/373) [`4c51970`](https://github.com/HugoRCD/evlog/commit/4c5197095b9717c9f725b52c0796d1b6b62814cc) Thanks [@jmcgoldrick](https://github.com/jmcgoldrick)! - Fix `evlog/nitro/v3` pulling in the optional `h3` peer. The v3 plugin shared a deferred-drain helper from the v2 module, which imports `getHeaders` from `h3`, so the v3 bundle referenced `h3` even though the v3 runtime never uses it. Consumers that don't install `h3` directly (e.g. Nitro v3 / TanStack Start on Vite) failed to build with `"getHeaders" is not exported by "__vite-optional-peer-dep:h3:evlog"`. The helper now lives in an h3-free module, so the v3 path no longer references `h3`.

- [#380](https://github.com/HugoRCD/evlog/pull/380) [`af238a2`](https://github.com/HugoRCD/evlog/commit/af238a24470b39910024b561989170e857244d54) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Split Next.js instrumentation into an Edge-safe gate (`evlog/next/instrumentation`) and a Node-only factory (`evlog/next/instrumentation/create`) so root `instrumentation.ts` no longer pulls the logger, audit, or file-system helpers into the Edge bundle. `defineNodeInstrumentation` now accepts an options object directly (no `import().then()` in user code). Filter known Next.js Edge bundler warnings from `captureOutput` (`CaptureOutputOptions`: `stdout`, `stderr`, `ignore`). The FS adapter warns once and skips writes when `NEXT_RUNTIME` is `edge`.

- [#375](https://github.com/HugoRCD/evlog/pull/375) [`83ec28f`](https://github.com/HugoRCD/evlog/commit/83ec28f98e32809e4a86c16900bead2b7b1a69e3) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix Nitro v2 error responses hanging in Nuxt/Nitro apps after thrown API errors. The Nitro v2 error handler now ends the Node response directly instead of relying on h3 `send()`, so clients receive the expected JSON error response.

- [#376](https://github.com/HugoRCD/evlog/pull/376) [`4c13bb0`](https://github.com/HugoRCD/evlog/commit/4c13bb0043c5acca4bd8e99638740396a557ead0) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Hardening and performance improvements across the package:
  - **Redaction**: path matchers are now precompiled once per resolved config instead of on every event, and case-insensitive leaf lookups are O(1).
  - **Pipeline**: the idle flush scheduling timer is `unref()`'d so it never holds a Node process open on shutdown — call `flush()` to deliver buffered events before exit (unchanged, documented contract). Retry backoff timers stay ref'd so in-flight batches are not dropped mid-retry.
  - **Ingest endpoint**: request bodies are capped at 32KB (413 beyond) and parsed as strict JSON.
  - **Audit**: `stableStringify` guards against circular references in audit `changes` instead of recursing forever; shared (non-circular) references keep stable signatures.
  - **Toolkit**: new `applyDeprecatedAlias` helper to map deprecated config fields onto their replacement with a one-time warning, used by the Axiom and Better Stack adapters.
  - **Vite**: warns when `sourceLocation` is enabled for a production build (source paths embedded in the client bundle).
  - Published packages now declare `engines.node >= 18`.

## 2.19.0

### Minor Changes

- [#356](https://github.com/HugoRCD/evlog/pull/356) [`bb3ec19`](https://github.com/HugoRCD/evlog/commit/bb3ec1932402861fd12bb47633c191cf3c993941) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add optional catalog metadata on `defineAuditCatalog` and `defineAuditAction` entries: `description`, `severity`, `requiresChanges`, `requiresReason`, and `redactPaths`. Metadata is exposed on each factory for introspection, docs, and review tooling.

- [#370](https://github.com/HugoRCD/evlog/pull/370) [`6dc352d`](https://github.com/HugoRCD/evlog/commit/6dc352ddba142ae68735ca932119566ac6074730) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Improve dev terminal error output and introduce a clearer `dev` config API.

  **Presets:** `dev: 'evlog' | 'nitro' | 'both'` — controls Nitro's Youch overlay (`frameworkOverlay`) and how much stack detail evlog prints in the wide event (`prettyError.detail`). Default in pretty dev is `'evlog'` (no Nitro overlay, full evlog error block). `'nitro'` keeps Nitro's stack and prints only message + Why/Fix/link in the wide event. `'both'` shows both full outputs.

  **Explicit object:** `dev: { frameworkOverlay, prettyError: { snippet, stackDepth, compact, detail: 'full' | 'guidance' } }`.

  Other improvements: tighter error blocks by default (`prettyError.compact`), tree spacers, hanging-indent Why/Fix wrapping, `stdout` for error wide events in dev, source-mapped file:line via Nitro `loadStackTrace`, Nitro error hook enrich+drain no longer blocks HTTP responses.

- [#371](https://github.com/HugoRCD/evlog/pull/371) [`0625240`](https://github.com/HugoRCD/evlog/commit/0625240cecf483107550000dfc38ba48359b32bd) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add glob path redaction to `RedactConfig.paths`. Single-segment patterns like `password` are shorthand for `**.password` (any nesting depth). Key-name globs (`*_token`) and path globs (`user.*`) are supported. `auditRedactPreset` simplified to path globs.

  ```ts
  initLogger({
    redact: {
      paths: ["password", "*_token", "headers.x-forwarded-for"],
    },
  });
  ```

- [#367](https://github.com/HugoRCD/evlog/pull/367) [`23d616f`](https://github.com/HugoRCD/evlog/commit/23d616ffecd9c2105051297d3ece44dd5542879d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Defer wide-event emit for streaming HTTP responses (SSE, AI SDK UI streams, chunked bodies) until the response body finishes, so `createAILogger()` metadata is included on the same request event instead of triggering post-emit warnings.

  Applies to Next.js `withEvlog`, SvelteKit, Hono, React Router, oRPC, and Nitro/Nuxt integrations. Also merges late `ai` fields onto an emitted event before enrich/drain when metadata arrives in a narrow race window.

  Fixes [#321](https://github.com/HugoRCD/evlog/issues/321)

### Patch Changes

- [#356](https://github.com/HugoRCD/evlog/pull/356) [`bb3ec19`](https://github.com/HugoRCD/evlog/commit/bb3ec1932402861fd12bb47633c191cf3c993941) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix `mockAudit()` to capture in-request `log.audit()` events on emit (with finalized `idempotencyKey`). Add `assertAudit()` matcher on the mock result. Type `AuditFields.changes.patch` via new `AuditChanges` export.

- [#369](https://github.com/HugoRCD/evlog/pull/369) [`0c6cb24`](https://github.com/HugoRCD/evlog/commit/0c6cb247cb608083f3fca72ed1d69dc55e34962f) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix Nuxt `silent` option not suppressing built-in console output in production builds on evlog 2.11+. The Nuxt module now bakes evlog options into `nitro.options.replace.__EVLOG_CONFIG__` (matching standalone Nitro modules), so the Nitro plugin receives `silent: true` and no longer emits an unenriched log line before your `evlog:drain` hook runs.

- [#359](https://github.com/HugoRCD/evlog/pull/359) [`1b17ff1`](https://github.com/HugoRCD/evlog/commit/1b17ff1d51ebe92c75026d269d31c9b6da25857c) Thanks [@abhishekg999](https://github.com/abhishekg999)! - Fix `evlog/elysia` to capture unmatched routes so Elysia 404 responses emit HTTP events with the correct path and error level.

- [#365](https://github.com/HugoRCD/evlog/pull/365) [`e2806b8`](https://github.com/HugoRCD/evlog/commit/e2806b8e47e78b4c147ec4fc3b1daef47749dac7) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix redaction mutating source objects and arrays passed by reference. Wide events are now deep-cloned before redaction, so `log.info({ user })` and `createLogger().emit()` only scrub the emitted copy sent to console and drains.

## 2.18.1

### Patch Changes

- [#340](https://github.com/HugoRCD/evlog/pull/340) [`cfc9322`](https://github.com/HugoRCD/evlog/commit/cfc932289aa5192706c70bb728afebad560a17e5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix a runtime crash on Vercel + Bun + Nitro v3 where every request failed with `bun is unable to write files: ReadOnlyFileSystem`. The Nitro plugin probed `nitro/runtime-config` at runtime to read evlog's config; that module transitively imports the build-only `#nitro/virtual/runtime-config`, which doesn't exist in deployed bundles. On Vercel + Bun the missing virtual triggered Bun's package auto-installer, which tried to write `node_modules/.cache` and crashed on the read-only function filesystem.

  The Nitro modules now bake the evlog config into the bundle as a literal via `nitro.options.replace.__EVLOG_CONFIG__`. The shared config bridge reads that build-time literal first and skips all runtime probing — no `import('nitro/runtime-config')`, no env propagation guesswork. The bridge also exposes the inlined value as a synthetic `{ evlog: <inlined> }` record, so drain adapters resolving `runtimeConfig.evlog.<adapter>` never trigger the probe either.

  For defense-in-depth, the bridge additionally scopes its dynamic-import fallback to the major version declared by the plugin (new internal `setActiveNitroRuntime` helper) — `nitro/runtime-config` for v3, `nitropack/...` for v2 — so standalone use outside a plugin (e.g. adapters called from non-Nitro code) doesn't probe both versions.

  No public-API change.

  Closes [#312](https://github.com/HugoRCD/evlog/issues/312).

## 2.18.0

### Minor Changes

- [#351](https://github.com/HugoRCD/evlog/pull/351) [`ee997b3`](https://github.com/HugoRCD/evlog/commit/ee997b311b4b59cf319c0fbd5efae4a7ac10e30c) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `evlog/memory` — an in-memory ring buffer drain that works in any runtime, including Cloudflare Workers (workerd) where Node's `fs` module is unavailable.

  ```ts
  import {
    createMemoryDrain,
    readMemoryLogs,
    clearMemoryLogs,
    parseReadMemoryLogsQuery,
  } from "evlog/memory";

  // Wire the drain
  app.use(evlog({ drain: createMemoryDrain() }));

  // Expose a dev-only endpoint — agents can filter via query params
  app.get("/_evlog/logs", (c) =>
    c.json(readMemoryLogs(parseReadMemoryLogsQuery(c.req.query()))),
  );
  ```

  Key features:
  - **Zero runtime dependencies** — pure in-memory, no `fs`, no network
  - **Bounded ring buffer** — configurable `maxEvents` (default `1000`) prevents unbounded memory growth
  - **Named stores** — isolate buffers per service or test suite via the `store` option
  - **Filtering API** — `readMemoryLogs` accepts `since`, `until`, `level`, `filter`, and `limit` options, matching the `readFsLogs` interface
  - **`parseReadMemoryLogsQuery(query)`** — coerce HTTP query-string params (`Record<string, string>`) into typed `ReadMemoryLogsOptions`; works with Hono, h3/Nitro, Express, Fastify, Next.js, Elysia, NestJS
  - **`clearMemoryLogs(store?)`** — reset a store, useful in tests
  - **Environment variables** — `NUXT_EVLOG_MEMORY_STORE` / `EVLOG_MEMORY_STORE`, `NUXT_EVLOG_MEMORY_MAX_EVENTS` / `EVLOG_MEMORY_MAX_EVENTS` (via `resolveAdapterConfig`)
  - **Nuxt module** — `ModuleOptions.axiom` now documents `apiKey` as the canonical field; legacy `token` remains as a deprecated alias until the next major release

  Closes [#349](https://github.com/HugoRCD/evlog/issues/349).

- [#344](https://github.com/HugoRCD/evlog/pull/344) [`5bc3c73`](https://github.com/HugoRCD/evlog/commit/5bc3c73c9ed414b53c616b9f20de8b2b981dc145) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add oRPC integration (`evlog/orpc`) with automatic wide-event logging. Two complementary primitives:
  - `withEvlog(handler)` — wraps `RPCHandler` / `OpenAPIHandler` from `@orpc/server/fetch`. Each matched request becomes one wide event with full pipeline support (drain, enrich, `include`/`exclude`, route-based service overrides, tail sampling). Excluded routes still receive a no-op `context.log` so procedures never crash on missing fields.
  - `evlog()` — procedure-level middleware (`os.use(evlog())`). Tags the wide event with `operation` (procedure path joined with `.`), forwards the request logger as `context.log`, promotes the level to `error` when a procedure throws, and bridges `createError()` / `defineErrorCatalog()` throws to `ORPCError` (code, status, message, plus `why`/`fix`/`link` in `data`).

  ```ts
  import { os } from "@orpc/server";
  import { RPCHandler } from "@orpc/server/fetch";
  import { evlog, withEvlog, type EvlogOrpcContext } from "evlog/orpc";

  const base = os.$context<EvlogOrpcContext>().use(evlog());

  const router = {
    ping: base.handler(({ context }) => {
      context.log.set({ pinged: true });
      return { ok: true };
    }),
  };

  const handler = withEvlog(new RPCHandler(router));

  export default async function fetch(request: Request) {
    const { matched, response } = await handler.handle(request, {
      prefix: "/rpc",
    });
    return matched ? response : new Response("Not Found", { status: 404 });
  }
  ```

  `useLogger()` is exposed for off-context access (utility modules / deep service functions). `EvlogOrpcContext` is the type to plug into `os.$context()` for typed access.

  Closes [#297](https://github.com/HugoRCD/evlog/issues/297).

- [#339](https://github.com/HugoRCD/evlog/pull/339) [`31b6b31`](https://github.com/HugoRCD/evlog/commit/31b6b310b1f0a9d0919888d49664927ad0f2f146) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `log.setLevel(level)` to promote the wide event level explicitly without touching the `error` context.

  `log.error(err)` populates `error: { name, message, stack, ... }` from the thrown value. When you want to mark the event as `error` (or `warn`) while controlling the `error` field yourself — typed error codes, no stack, custom shapes — call `log.setLevel('error' | 'warn' | 'info' | 'debug')` and pair it with `log.set({ error: { code: 'PAYMENT_DECLINED' } })`. The explicit level wins over the level computed from `.error()` / `.warn()`.

  ```ts
  log.setLevel("error");
  log.set({
    error: { code: "PAYMENT_DECLINED", reason: "insufficient_funds" },
  });
  ```

  Closes [#301](https://github.com/HugoRCD/evlog/issues/301).

### Patch Changes

- [#348](https://github.com/HugoRCD/evlog/pull/348) [`6d4d87c`](https://github.com/HugoRCD/evlog/commit/6d4d87c1c4997021501900e0a8a3d4c8f95e7ce5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix `evlog/nitro` and `evlog/nitro/v3` on Windows. The module passed native `path.resolve()` paths to `nitro.options.plugins` and `nitro.options.errorHandler`. Nitro raw-interpolates those into the `#nitro/virtual/plugins` and `#nitro/virtual/error-handler` JS string literals, so Windows backslashes were parsed as escape sequences (`\n`, `\v`, …) and broke module resolution — surfacing as `Cannot find module … imported from '#nitro/virtual/error-handler'`. Paths are now normalized to forward slashes before being handed to Nitro.

  Closes [#345](https://github.com/HugoRCD/evlog/issues/345).

## 2.17.0

### Minor Changes

- [#332](https://github.com/HugoRCD/evlog/pull/332) [`ced6eda`](https://github.com/HugoRCD/evlog/commit/ced6eda8677719bde4c629d8d3692ed7b88a0616) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Tag every drain request with identity headers so receivers can recognize evlog traffic and the originating adapter without parsing the body.
  - `User-Agent: evlog/<version>` on Node / server runtimes (browsers strip `User-Agent`).
  - `X-Evlog-Source: <adapter>` (`axiom`, `datadog`, `otlp`, `posthog`, `sentry`, `better-stack`, `hyperdx`, `client` for browser-originated drains).
  - `httpPost` gains `userAgent?: string | false` and `source?: string` options so custom drains can override or suppress the headers.
  - New exports from `evlog/toolkit`: `EVLOG_VERSION`, `EVLOG_USER_AGENT`, `withEvlogIdentityHeaders`.

  Adapters built with `defineHttpDrain()` automatically forward their `name` as `source`. The legacy `sendBatchTo*` helpers in `evlog/axiom`, `evlog/datadog`, `evlog/otlp`, `evlog/posthog`, `evlog/sentry`, and `evlog/better-stack` pass it explicitly.

- [#325](https://github.com/HugoRCD/evlog/pull/325) [`6b06511`](https://github.com/HugoRCD/evlog/commit/6b06511504e6650b6691c41536d82c503fdbd65e) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add typed error and audit catalogs as a thin layer over `createError` and `defineAuditAction`. Three new primitives, zero runtime registration, zero init step. The whole feature is opt-in: existing `createError({ code, ... })` and `defineAuditAction(...)` call sites keep working unchanged, with no migration required.

  ```ts
  import { defineErrorCatalog, defineAuditCatalog } from "evlog";

  export const billingErrors = defineErrorCatalog("billing", {
    PAYMENT_DECLINED: {
      status: 402,
      message: "Card declined",
      why: "...",
      fix: "...",
      link: "...",
    },
    INSUFFICIENT_FUNDS: {
      status: 402,
      message: ({
        available,
        required,
      }: {
        available: number;
        required: number;
      }) => `Insufficient funds: $${available}/$${required}`,
    },
  });

  export const billingAudit = defineAuditCatalog("billing", {
    INVOICE_REFUND: { target: "invoice" },
    INVOICE_CREATE: { target: "invoice" },
  });

  throw billingErrors.PAYMENT_DECLINED({ cause: stripeErr });
  throw billingErrors.INSUFFICIENT_FUNDS({ available: 5, required: 100 });
  log.audit(billingAudit.INVOICE_REFUND({ actor, target: { id: "inv_889" } }));
  ```

  New API on the main `evlog` entrypoint:
  - `defineError(code, options)` — single-error factory bound to a stable code. Accepts every existing `EvlogError` field plus a `tags` array and an `internal` defaults object. `message` can be either a string or a typed function whose params become required at the call site.
  - `defineErrorCatalog(prefix, map)` — bundle a record of entries under a common prefix. The wire `code` for each entry is `${prefix}.${KEY}` (UPPER_SNAKE_CASE keys preserved). Catalog metadata (`_codes`, `_prefix`) exposed for introspection.
  - `defineAuditCatalog(prefix, map)` — symmetric primitive for audit actions. Each entry produces a thin wrapper around `defineAuditAction` with the prefix and target type pre-applied. Exposes `_actions` and `_prefix`.

  Type-level upgrade (opt-in, zero runtime cost):
  - `RegisteredErrorCatalogs` and `RegisteredAuditCatalogs` interfaces (empty by default, augmentable via `declare module 'evlog'`).
  - New `ErrorCode` and `AuditAction` types derived from registered catalogs.
  - `ErrorOptions.code` and `ParsedError.code` now typed as `ErrorCode | (string & {})` — autocomplete on registered codes everywhere (`createError`, `parseError`, custom helpers) without breaking ad-hoc string usage.

  Catalog factories return regular `EvlogError` instances and `AuditInput` objects respectively, so they integrate transparently with every existing evlog primitive (HTTP serializers, `parseError`, wide event capture, audit pipeline, drains). Catalogs are pure data — package them as npm libraries (one prefix per package), and the typing flows transitively to consumers via the published `.d.ts`. No global init, no proxy, no string-based dispatch helper.

- [#332](https://github.com/HugoRCD/evlog/pull/332) [`ced6eda`](https://github.com/HugoRCD/evlog/commit/ced6eda8677719bde4c629d8d3692ed7b88a0616) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `readFsLogs()` and `tailFsLogs()` to `evlog/fs` so any external Node tool can replay or follow the local NDJSON drain without hooking into the running app. The `fs` adapter has been write-only until now; this closes the loop.

  ```ts
  import { readFsLogs, tailFsLogs } from "evlog/fs";

  // Replay history (ends when the last file is read)
  for await (const event of readFsLogs({
    since: "2026-03-01",
    level: "error",
  })) {
    // ...
  }

  // Live tail (yields existing then keeps yielding new ones — abort via AbortSignal)
  const ac = new AbortController();
  for await (const event of tailFsLogs({ signal: ac.signal })) {
    // ...
  }
  ```

  Both helpers accept `dir`, `since`, `until`, `level`, and a custom `filter` predicate. `tailFsLogs` additionally takes `pollIntervalMs`, `fromEnd`, and `signal`. Files outside the date window are skipped without being opened, malformed lines are silently skipped, and partial-write chunks are reassembled across polls.

  Useful for post-incident triage scripts, Vitest e2e assertions on emitted wide events, replay-to-Axiom backfills, and `grep`-style CLIs that pipe filtered events into `jq`.

- [#332](https://github.com/HugoRCD/evlog/pull/332) [`ced6eda`](https://github.com/HugoRCD/evlog/commit/ced6eda8677719bde4c629d8d3692ed7b88a0616) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add a local Server-Sent Events stream server so any consumer (browser tab, CLI, devtool) can subscribe to live wide events without going through your app's API surface. The server runs in the same Node process on its own ephemeral port; the URL is printed at startup and written to `.evlog/stream.url` for tools to discover.

  Strict opt-in for the framework integrations: the Nuxt module and the Next.js `defineStreamedInstrumentation` helper only boot the server when `stream: true` (or a config object) is passed. `startStreamServer()` itself is always an explicit call — call it from any standalone script or framework wiring that doesn't have a built-in evlog config.

  **Nuxt**

  ```ts [nuxt.config.ts]
  evlog: {
    stream: true,
    // or: stream: { port: 4317, token: process.env.EVLOG_STREAM_TOKEN }
  }
  ```

  **Next.js** — new helper in `evlog/next/stream`:

  ```ts [lib/evlog.ts]
  import { defineStreamedInstrumentation } from "evlog/next/stream";

  export const { register, onRequestError } = defineStreamedInstrumentation({
    service: "my-app",
    stream: true,
  });
  ```

  **Standalone / any framework**:

  ```ts
  import { startStreamServer } from "evlog/stream";

  const server = await startStreamServer();
  // pass server.drain wherever you compose your evlog drain
  ```

  The Nuxt module also registers a tiny `/api/_evlog/stream-info` route that returns the mini-server URL so a same-origin browser tab can discover the ephemeral port.

  API surface in `evlog/stream`:
  - `startStreamServer(options): Promise<StreamServer>` — `node:http` server bound to `127.0.0.1` by default, idempotent, lazy-imports Node-only modules so `evlog/stream` stays edge-friendly for the in-process primitive.
  - `StreamServerOptions`: `port`, `host`, `token`, `heartbeatMs`, `buffer`, `banner`, `urlFileDir`.
  - `StreamServer`: `{ url, port, drain, stream, close }`.
  - Cleans up `.evlog/stream.url` and listeners on `close()` + `SIGINT` / `SIGTERM` / `exit`.

  Wire format is a versioned JSON envelope `{ evlog: "1", type, data }` with frames `hello`, `replay`, `event`, and `ping`.

  **Local-only by design.** The server is in-process — on serverless platforms (Vercel Functions, Cloudflare Workers, AWS Lambda) each invocation is isolated, so a subscriber would only see events from its own isolate. Use a real broker for cross-instance fan-out in those environments.

### Patch Changes

- [#335](https://github.com/HugoRCD/evlog/pull/335) [`fd830a0`](https://github.com/HugoRCD/evlog/commit/fd830a014924863342e5d627c0011123027fc048) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Documentation site restructured into 6 audience-driven categories: **Start → Learn → Integrate → Use Cases → Extend → Reference**. The npm-shipped `README.md` and a single JSDoc `@see` URL have been updated to point to the new locations.

  Old documentation URLs continue to work via 301 redirects defined in `apps/docs/config/redirects.ts`. No public API changed.

  If you bookmarked specific documentation pages, the most common moves are:
  - `/getting-started/*` → `/start/*`
  - `/logging/{simple-logging,wide-events,structured-errors}` → `/learn/*`
  - `/logging/{ai-sdk,better-auth,audit,client-logging}/*` → `/use-cases/*`
  - `/core-concepts/{lifecycle,sampling,typed-fields,redaction}` → `/learn/*`
  - `/core-concepts/{configuration,performance,vite-plugin,best-practices}` → `/reference/*`
  - `/frameworks/*` → `/integrate/frameworks/*`
  - `/adapters/*` → `/integrate/adapters/*`
  - `/build-on-top/*` → `/extend/*`
  - `/enrichers/*` → `/use-cases/enrichers` or `/extend/custom-enrichers`

- [#336](https://github.com/HugoRCD/evlog/pull/336) [`872f150`](https://github.com/HugoRCD/evlog/commit/872f1509884017b8289a958fd5b65582b3d6337d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix wide event never being emitted when the client disconnects mid-request in `evlog/express` and `evlog/nestjs`.

  Both integrations now listen for the underlying socket `close` event in addition to `finish`. When the client aborts before `res.end()` resolves, the wide event is still emitted (with the same `status`, `duration`, and accumulated context) and tagged with `connectionClosed: true` so disconnects are observable in your drain. The first event to fire wins, so successful responses are unaffected.

  For background work that must outlive the HTTP response (resumable streams, post-response usage accounting), continue to use `req.log.fork('label', fn)` — once the request logger has been emitted it is sealed.

  Closes [#305](https://github.com/HugoRCD/evlog/issues/305).

## 2.16.0

### Minor Changes

- [#318](https://github.com/HugoRCD/evlog/pull/318) [`8080662`](https://github.com/HugoRCD/evlog/commit/8080662e0ba2b3746aebf0aa1c5cf89756c3c44d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add an optional `code` field to `createError` / `EvlogError` so structured errors can carry a stable, machine-readable identifier for client branching, dashboards, and future error-catalog tooling. Foundation for an upcoming `defineErrorCatalog` primitive.

  ```ts
  import { createError, parseError } from "evlog";

  throw createError({
    code: "PAYMENT_DECLINED",
    message: "Payment failed",
    status: 402,
    why: "Card declined by issuer",
    fix: "Try a different payment method",
  });

  // Client
  const err = parseError(caught);
  if (err.code === "PAYMENT_DECLINED") retryWithDifferentCard();
  ```

  `code` is public and propagates through every existing serialization path with no breaking change:
  - **HTTP responses** — surfaces under `data.code` via the existing `EvlogError.data` getter (Nitro v2/v3, Next.js, and any framework using `serializeEvlogErrorResponse` get it for free).
  - **`parseError(err)`** — new `code` field on `ParsedError`. Extracted from EvlogError JSON, h3-style `data.code`, and Node-style `Error.code` (e.g. `'ENOENT'`, `'ECONNRESET'`) so existing system errors flow through the same client branch.
  - **Wide events** — copied onto `event.error.code` so drains and dashboards can group, alert, and chart by code without parsing free-text messages.
  - **`toString()`** — renders a `Code:` line for terminal pretty-print.

  Out of scope here (planned next): `defineErrorCatalog` for centralized typed code unions, plus the equivalent for audit actions.

## 2.15.0

### Minor Changes

- [#315](https://github.com/HugoRCD/evlog/pull/315) [`9b3739b`](https://github.com/HugoRCD/evlog/commit/9b3739ba97a1723c56c3f276b1cbea052990a5e5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Refactor core & toolkit into composable building blocks (EVL-155). The internal helpers that powered every built-in adapter, enricher, and framework integration are now public under `evlog/toolkit`, alongside three new factories and a canonical config entry point.

  **This release is fully backwards-compatible.** Every previously-working snippet keeps working — adapter renames ship with deprecated aliases, the dual PostHog factory is kept as a thin wrapper, and the new toolkit primitives are additive. Nothing to migrate.

  ### What's new
  - **`definePlugin()`** — single canonical extension contract. A plugin can opt into any subset of `setup`, `enrich`, `drain`, `keep`, `onRequestStart`, `onRequestFinish`, `onClientLog`, `extendLogger`. Drains and enrichers are now sugar over plugins (`drainPlugin`, `enricherPlugin`).
  - **`defineHttpDrain()`** — adapter factory. Provide `resolve()` (config) and `encode()` (payload); retries, timeouts, batching, and error isolation are handled for you. All 8 built-in adapters (Axiom, OTLP, HyperDX, PostHog, Sentry, Better Stack, Datadog, FS) now use this internally.
  - **`defineEnricher()`** — enricher factory. Provide `compute()`; merge, error isolation, and undefined skipping are handled for you. All 4 built-in enrichers (UserAgent, Geo, RequestSize, TraceContext) now use this internally.
  - **`defineFrameworkIntegration()`** — manifest-mode framework integration. Provide `extractRequest`, `attachLogger`, and an optional `storage`; the helper handles header normalization, request-id generation, ALS, and `log.fork()` attachment. Hono, Express, Fastify, and Elysia now use this internally.
  - **`defineEvlog()`** — canonical config object. One shape that works across `initLogger`, framework middlewares, the Nuxt module, and Workers via `toLoggerConfig` / `toMiddlewareOptions`.
  - **Composers**: `composeEnrichers`, `composeDrains`, `composeKeep`, `composePlugins` for combining multiple extensions with built-in error isolation.
  - **`evlog/toolkit`** is now the public entry point for all building blocks.
  - **`createDefaultEnrichers()`** — shorthand for `composeEnrichers([userAgent, geo, requestSize, traceContext])`.

  ### Standardized naming (additive, with deprecated aliases)

  We've standardized on `apiKey` for any bearer-style secret. The previous names continue to work and emit a one-time deprecation warning:

  | Adapter      | Recommended                       | Still works (deprecated)                    |
  | ------------ | --------------------------------- | ------------------------------------------- |
  | Axiom        | `apiKey` / `AXIOM_API_KEY`        | `token` / `AXIOM_TOKEN`                     |
  | Better Stack | `apiKey` / `BETTER_STACK_API_KEY` | `sourceToken` / `BETTER_STACK_SOURCE_TOKEN` |

  Sentry keeps `dsn` (genuinely different format).

  PostHog's two factories are unified — but the old name is still exported:

  ```ts
  // Recommended
  createPostHogDrain({ mode: "events" });

  // Still works (deprecated, re-routes to the line above)
  createPostHogEventsDrain();
  ```

  These deprecated aliases will be removed in the next **major** release.

  ### Adoption

  Existing code keeps working. To opt into the new primitives:

  ```ts
  import { defineEvlog, defineHttpDrain, definePlugin } from "evlog/toolkit";
  ```

  See [Toolkit Reference](https://evlog.dev/adapters/building-blocks/toolkit) for the complete public API.

### Patch Changes

- [#317](https://github.com/HugoRCD/evlog/pull/317) [`cda80e5`](https://github.com/HugoRCD/evlog/commit/cda80e5d4a99320814194d95e2c61ce6b26437ba) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add end-to-end adapter tests against the real Axiom, PostHog, Sentry, and Better Stack APIs (`pnpm run test:e2e`). They run nightly via a dedicated GitHub Actions workflow plus on PRs labelled `e2e`, so any breaking change on a destination platform is caught within 24 hours instead of in production.

  The Axiom suite does a full round-trip — it ingests events tagged with a unique correlation ID, queries them back via APL, and asserts presence and shape. PostHog/Sentry/Better Stack are smoke-tested (their write APIs don't expose a read path).

  Pure infra: no user-facing API change, no published code change.

## 2.14.1

### Patch Changes

- [#309](https://github.com/HugoRCD/evlog/pull/309) [`3cc3308`](https://github.com/HugoRCD/evlog/commit/3cc33080ab2e18dbe33b5ac67830b2fc7b1d3a07) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Remove `better-auth` from `peerDependencies`. Optional peers still led npm to resolve Better Auth’s peer graph (including `@sveltejs/kit` / Vite), causing `ERESOLVE` for apps that do not use Better Auth ([#299](https://github.com/HugoRCD/evlog/issues/299)). Users of `evlog/better-auth` should keep `better-auth` as a direct dependency (see docs).

- [#298](https://github.com/HugoRCD/evlog/pull/298) [`02c4c03`](https://github.com/HugoRCD/evlog/commit/02c4c033afff95a8b7ce2d6f1e2ee85c5d0234b2) Thanks [@M-Hassan-Raza](https://github.com/M-Hassan-Raza)! - Avoid unnecessary Nitro runtime-config probes when drain adapter overrides or env vars already satisfy the env-backed config fields.

- [#306](https://github.com/HugoRCD/evlog/pull/306) [`570d675`](https://github.com/HugoRCD/evlog/commit/570d675ed70d472ba108cfa9143dcc23e347081c) Thanks [@shubh73](https://github.com/shubh73)! - Detect browser environments for `%c` console styling using `isBrowser()` (window, document, and non–React Native `navigator.product`) so React Native / Metro no longer prints format strings and CSS arguments as literal text when `window` is polyfilled. `isClient()` / `isServer()` are unchanged for existing consumers.

## 2.14.0

### Minor Changes

- [#295](https://github.com/HugoRCD/evlog/pull/295) [`aa9984f`](https://github.com/HugoRCD/evlog/commit/aa9984f50259b292e8d1a2a671b600fcb74844db) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Expose AI SDK execution metadata as a public API on `AILogger`. Three new methods let app code read the same data that gets attached to wide events: `getMetadata()` returns an immutable snapshot of the run (model, provider, tokens, calls, steps, tool calls, cost, finish reason, embeddings), `getEstimatedCost()` returns the dollar cost computed from the configured pricing map, and `onUpdate(cb)` subscribes to incremental snapshots emitted on every step, embedding, error, and integration finish (returns an unsubscribe function). New types `AIMetadata` (alias for `AIEventData`) and `AIMetadataListener` are exported. `model` and `provider` on `AIMetadata` are now optional to reflect early-snapshot reality (e.g. embedding-only runs).

- [#302](https://github.com/HugoRCD/evlog/pull/302) [`7060006`](https://github.com/HugoRCD/evlog/commit/70600062eeafd86bd4e76d30aae3789434ca7f9b) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add first-class audit logs as a thin layer over existing evlog primitives. Audit is not a parallel system: it is a typed `audit` field on the wide event plus a few opt-in helpers and drain wrappers. Companies already running evlog can enable audit logs by adding 1 enricher + 1 drain wrapper + `log.audit()`, with zero new sub-exports.

  New API on the main `evlog` entrypoint:
  - `AuditFields` reserved on `BaseWideEvent` (`action`, `actor`, `target`, `outcome`, `reason`, `changes`, `causationId`, `correlationId`, `version`, `idempotencyKey`, `context`, `signature`, `prevHash`, `hash`) plus `AUDIT_SCHEMA_VERSION`.
  - `log.audit(fields)` and `log.audit.deny(reason, fields)` on `RequestLogger` and the return value of `createLogger()`. Sugar over `log.set({ audit })` that also force-keeps the event through tail sampling.
  - Standalone `audit(fields)` for jobs / scripts / CLIs.
  - `withAudit({ action, target, actor? })(fn)` higher-order wrapper that auto-emits `success` / `failure` / `denied` based on the wrapped function's outcome (with `AuditDeniedError` for AuthZ refusals).
  - `defineAuditAction(name, opts)` typed action registry, `auditDiff(before, after)` redact-aware JSON Patch helper, `mockAudit()` test utility (`expectIncludes`, `expectActionCount`, `clear`, `restore`).
  - `auditEnricher({ tenantId?, betterAuth? })` enricher that auto-fills `event.audit.context` (`requestId`, `traceId`, `ip`, `userAgent`, `tenantId`) and optionally bridges `actor` from a session.
  - `auditOnly(drain, { await? })` drain wrapper that filters to events with `event.audit` set, optionally awaiting writes for crash safety. `signed(drain, { strategy: 'hmac' | 'hash-chain', ... })` generic tamper-evidence wrapper with pluggable `state.{load,save}` for hash chains.
  - `auditRedactPreset` strict PII preset composable with existing `RedactConfig`.

  Audit events are always force-kept by tail sampling and get a deterministic `idempotencyKey` derived from `action + actor + target + timestamp` so retries are safe across drains. Schema is OTEL-compatible and the `actor.type === 'agent'` slot carries `model`, `tools`, `reason`, `promptId` for AI agent auditing. No new sub-exports were added.

## 2.13.0

### Minor Changes

- [#280](https://github.com/HugoRCD/evlog/pull/280) [`fa0ee26`](https://github.com/HugoRCD/evlog/commit/fa0ee267a10d65164b4aec6caa64208ce08af291) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `evlog/better-auth` integration for automatic user identification from [Better Auth](https://better-auth.com/) sessions.

  **New exports** (`evlog/better-auth`):
  - `identifyUser(log, session, options?)` — sets `userId`, `user`, and `session` fields on a wide event. Returns `true` if identified
  - `createAuthMiddleware(auth, options?)` — framework-agnostic `(log, headers, path?) => Promise<boolean>` with route filtering, timing capture, and lifecycle hooks
  - `createAuthIdentifier(auth, options?)` — Nitro `request` hook factory for standalone Nitro apps
  - `maskEmail(email)` — utility to mask emails for safe logging (`h***@example.com`)
  - `BetterAuthInstance` — reusable type for the auth parameter

  **Features:**
  - `include`/`exclude` route pattern filtering on `createAuthMiddleware`
  - `extend` callback for Better Auth plugin fields (organizations, roles, etc.)
  - `auth.resolvedIn` timing in every wide event
  - `auth.identified` boolean in every wide event
  - `session.userAgent` captured by default
  - `onIdentify`/`onAnonymous` lifecycle hooks
  - `console.warn` in development when session resolution fails

- [#284](https://github.com/HugoRCD/evlog/pull/284) [`861f6d2`](https://github.com/HugoRCD/evlog/commit/861f6d2c4e89ca99ef628484a68d69779acf4056) Thanks [@HugoRCD](https://github.com/HugoRCD)! - `log.set()` concatenates arrays when merging context for the same key. For example, `set({ items: [1, 2] })` followed by `set({ items: [3] })` yields `{ items: [1, 2, 3] }` instead of replacing with `[3]`. Plain objects are still deep-merged recursively; if either the existing or incoming value is not an array, the new value replaces the old one.

  **Breaking change:** Call sites that relied on the last `set` overwriting an array now accumulate elements. To replace a value at emit time, use `emit({ ... })` overrides or a different field name.

## 2.12.0

### Minor Changes

- [#272](https://github.com/HugoRCD/evlog/pull/272) [`2b5c8a4`](https://github.com/HugoRCD/evlog/commit/2b5c8a44de2aaeb38b3c9dbb5883e90f88b607b7) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add AI SDK telemetry integration (`createEvlogIntegration`), cost estimation, and enriched embedding capture. `createEvlogIntegration()` implements the AI SDK's `TelemetryIntegration` interface to capture per-tool execution timing/success/errors and total generation wall time. Cost estimation computes `ai.estimatedCost` from a user-provided pricing map. `captureEmbed` now accepts model ID, dimensions, and batch count for richer embedding observability.

- [#271](https://github.com/HugoRCD/evlog/pull/271) [`583fab4`](https://github.com/HugoRCD/evlog/commit/583fab4ccd739bb735ad8e816d3bb397f6d08144) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add auto-redaction (PII protection) with smart partial masking, enabled by default in production (`NODE_ENV === 'production'`). Built-in patterns (credit card, email, IPv4, phone, JWT, Bearer, IBAN) use context-preserving masks (e.g. `****1111`, `a***@***.com`) instead of flat `[REDACTED]`. Disabled in development for full debugging visibility. Fine-tune with `paths`, `patterns`, and `builtins`, or opt out with `redact: false`. Custom patterns use the configurable `replacement` string. Redaction runs before console output and before any drain sees the data.

- [#269](https://github.com/HugoRCD/evlog/pull/269) [`037dc81`](https://github.com/HugoRCD/evlog/commit/037dc8115001de081c0b524320cafc414346c25c) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `evlog/http` as the canonical HTTP ingest drain (`createHttpDrain`, `createHttpLogDrain`, `HttpDrainConfig`). Deprecate `evlog/browser`; it re-exports the same API and will be removed in the next **major** release.

- [#266](https://github.com/HugoRCD/evlog/pull/266) [`3898a3f`](https://github.com/HugoRCD/evlog/commit/3898a3f0972d21e21cded7dcdcb33e47869002cd) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `minLevel` for a deterministic severity threshold on the global `log` API and client `initLog`, plus `setMinLevel()` for runtime toggling in the browser. Orthogonal to probabilistic `sampling.rates`; request wide events from `useLogger` / `createLogger().emit()` are unchanged. Includes `isLevelEnabled()` helper and wiring for Nuxt, Vite, and Next.js.

  **2026-04-11** — Playground: interactive panel to try client `minLevel` / `setMinLevel` and trigger logs per level.

### Patch Changes

- [#270](https://github.com/HugoRCD/evlog/pull/270) [`79cb4a4`](https://github.com/HugoRCD/evlog/commit/79cb4a4e6a9300df2758f62ad1dda4794f9b4f05) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add an [AWS Lambda](https://www.evlog.dev/frameworks/aws-lambda) guide to the documentation site (`initLogger` once, `createLogger` per invocation, manual `emit`).

## 2.11.1

### Patch Changes

- [#261](https://github.com/HugoRCD/evlog/pull/261) [`08cab7b`](https://github.com/HugoRCD/evlog/commit/08cab7b8e3e7d9e8179cf7add784349acd3632ea) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix Nuxt `evlog` options not reaching the Nitro plugin in dev: the Nuxt module now mirrors standalone Nitro by setting `process.env.__EVLOG_CONFIG` during `nitro:config`. When `enabled` is `false`, the Nitro plugins still attach a no-op request logger so `useLogger(event)` does not throw.

## 2.11.0

### Minor Changes

- [#249](https://github.com/HugoRCD/evlog/pull/249) [`72d7d6e`](https://github.com/HugoRCD/evlog/commit/72d7d6e57c9341fb2a1df78c3f80588ca50b08f5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `internal` to `createError` / `ErrorOptions`: backend-only context stored on `EvlogError`, included in wide events via `log.error()`, never serialized in HTTP responses or `toJSON()` ([EVL-140](https://linear.app/evlog/issue/EVL-140)).

- [#251](https://github.com/HugoRCD/evlog/pull/251) [`19ae4a9`](https://github.com/HugoRCD/evlog/commit/19ae4a98e0da89c4b1ea0e00f32e238927da1fbb) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add Datadog Logs HTTP drain adapter (`evlog/datadog`): `createDatadogDrain()`, `sendToDatadog` / `sendBatchToDatadog`, env vars `DD_API_KEY` / `NUXT_DATADOG_*` / `DD_SITE`, and intake URL for all Datadog sites. Maps wide events with a short `message` line, full payload under `evlog`, severity `status`, and recursive `httpStatusCode` renaming so HTTP `status` fields never clash with Datadog’s reserved severity ([EVL-144](https://linear.app/evlog/issue/EVL-144)).

### Patch Changes

- [#245](https://github.com/HugoRCD/evlog/pull/245) [`c96967b`](https://github.com/HugoRCD/evlog/commit/c96967bdff5b4e5d423f59cea436cd57cb281b57) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Fix Nitro server builds on strict Worker presets (e.g. `cloudflare-durable`) by avoiding Rollup-resolvable literals for `nitro/runtime-config` in published dist. Centralize runtime config access in an internal bridge (`__EVLOG_CONFIG` first, then dynamic `import()` with computed module specifiers for Nitro v3 and nitropack). Add regression tests for dist output and a `cloudflare-durable` production build using the compiled plugin.

- [#242](https://github.com/HugoRCD/evlog/pull/242) [`24c9a80`](https://github.com/HugoRCD/evlog/commit/24c9a80289561584f6b302a5e1b5419b8aac7401) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Export `createError`, `createEvlogError`, `EvlogError`, and `parseError` from `evlog/nitro/v3` so Nitro v3 apps can use the documented single import path alongside `useLogger` ([#241](https://github.com/HugoRCD/evlog/issues/241)).

- [#247](https://github.com/HugoRCD/evlog/pull/247) [`730c984`](https://github.com/HugoRCD/evlog/commit/730c984c16bf1543da6525caa6aa5ca788f64306) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Align `evlogErrorHandler` with TanStack Start’s `createMiddleware().server()` types: widen `next()` to sync-or-async results, match `RequestServerFn` return typing via `RequestServerResult`, and declare an optional peer on `@tanstack/start-client-core` for accurate declarations ([#235](https://github.com/HugoRCD/evlog/issues/235), [EVL-142](https://linear.app/evlog/issue/EVL-142)).

## 2.10.0

### Minor Changes

- [#225](https://github.com/HugoRCD/evlog/pull/225) [`3d1dcd4`](https://github.com/HugoRCD/evlog/commit/3d1dcd4678da83c05e754623b7443426231565ab) Thanks [@izadoesdev](https://github.com/izadoesdev)! - Add HyperDX drain adapter (`evlog/hyperdx`) for OTLP/HTTP ingest, with defaults aligned to [HyperDX OpenTelemetry documentation](https://hyperdx.io/docs/install/opentelemetry) (`https://in-otel.hyperdx.io`, `authorization` header). Includes docs site and `review-logging-patterns` skill updates.

- [#232](https://github.com/HugoRCD/evlog/pull/232) [`767ba27`](https://github.com/HugoRCD/evlog/commit/767ba2702c5e8c254360c315c76491128bd54169) Thanks [@MrLightful](https://github.com/MrLightful)! - Add configurable `credentials` (`RequestCredentials`, default `same-origin`) for the client log transport and browser drain `fetch` calls. The Nuxt module forwards `transport.credentials` into `runtimeConfig.public.evlog` so client `initLog()` receives it.

### Patch Changes

- [#228](https://github.com/HugoRCD/evlog/pull/228) [`4385dbc`](https://github.com/HugoRCD/evlog/commit/4385dbc6551577388123b77bcfaf3d709897ee08) Thanks [@shubh73](https://github.com/shubh73)! - Resolve Nitro runtime config in drain adapters via dynamic `import()` (Cloudflare Workers and other runtimes without `require`). Cache Nitro module namespaces after first load to avoid repeated imports on every drain. Fix HyperDX drain to `await` `resolveAdapterConfig()` so env/runtime config is applied when using `createHyperDXDrain()` without inline overrides.

- [#188](https://github.com/HugoRCD/evlog/pull/188) [`e3ebe9f`](https://github.com/HugoRCD/evlog/commit/e3ebe9faeac8bce7091ba9a8d90b31e8d66e4f43) Thanks [@mnismt](https://github.com/mnismt)! - Add `defineNodeInstrumentation()` for Next.js root `instrumentation.ts`: gate on `NEXT_RUNTIME === 'nodejs'`, cache the dynamic `import()` of `lib/evlog` between `register` and `onRequestError`, and export `NextInstrumentationRequest` / `NextInstrumentationErrorContext` types.

## 2.9.0

### Minor Changes

- [#212](https://github.com/HugoRCD/evlog/pull/212) [`96c47cd`](https://github.com/HugoRCD/evlog/commit/96c47cd3adfbaf0e6c53db9be55b45f652dfbdb8) Thanks [@MrLightful](https://github.com/MrLightful)! - Add React Router middleware integration (`evlog/react-router`) with automatic wide-event logging, drain, enrich, and tail sampling support

### Patch Changes

- [#220](https://github.com/HugoRCD/evlog/pull/220) [`b0c26d5`](https://github.com/HugoRCD/evlog/commit/b0c26d5eacb2382402a0ab99744650796ea52be7) Thanks [@HugoRCD](https://github.com/HugoRCD)! - fix(nitro): make `evlogErrorHandler` compatible with TanStack Start's `createMiddleware().server()` API

  `evlogErrorHandler` now accepts both `(next)` and `({ next })` signatures, so `createMiddleware().server(evlogErrorHandler)` works directly without a wrapper in all TanStack Start versions.

- [#215](https://github.com/HugoRCD/evlog/pull/215) [`31cb4ab`](https://github.com/HugoRCD/evlog/commit/31cb4ab903c969107a368cb5a9629eff6fe0c63b) Thanks [@HugoRCD](https://github.com/HugoRCD)! - fix(nitro): always create logger in request hook so `useLogger()` works in server middleware

  Previously, calling `useLogger(event)` inside a Nuxt server middleware would throw `"Logger not initialized"` because the Nitro plugin skipped logger creation for routes not matching `include` patterns. Since middleware runs for every request, this made it impossible to use `useLogger` there.

  The `shouldLog` filtering is now evaluated at emit time instead of creation time — the logger is always available on `event.context.log`, but events for non-matching routes are silently discarded.

- [#218](https://github.com/HugoRCD/evlog/pull/218) [`453a548`](https://github.com/HugoRCD/evlog/commit/453a5483d1a7b2db7979edbc306cd9b9584e9f40) Thanks [@benhid](https://github.com/benhid)! - fix(parseError): respect `.status` / `.statusCode` on Error instances instead of hardcoding 500

  Frameworks like NestJS attach HTTP status directly on Error subclasses (e.g. `BadRequestException` has `.status = 400`). Previously, `parseError()` ignored these properties and always returned 500 for any `Error` instance without a `data` property. Now uses `extractErrorStatus()` to extract the correct status.

- [#219](https://github.com/HugoRCD/evlog/pull/219) [`79f811d`](https://github.com/HugoRCD/evlog/commit/79f811dab02717470ed5f178b5c944a395dc4025) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Improve TanStack Start documentation with route filtering, pipeline (batching & retry), tail sampling sections, Vite plugin callout, and TanStack Router vs TanStack Start disambiguation

## 2.8.0

### Minor Changes

- [#196](https://github.com/HugoRCD/evlog/pull/196) [`abda28c`](https://github.com/HugoRCD/evlog/commit/abda28cc00b6276a59c2cf9dcfca295f4d7b878c) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `evlog/ai` integration for AI SDK v6+ observability.
  - `createAILogger(log)` returns an `AILogger` with `wrap()` and `captureEmbed()`
  - Model middleware captures token usage, tool calls, finish reason, and streaming metrics
  - Supports `generateText`, `streamText`, `generateObject`, `streamObject`, and `ToolLoopAgent`
  - Accumulates data across multi-step agent runs (steps, models, tokens)
  - String model IDs resolved via `gateway()` with full autocompletion
  - Gateway provider parsing extracts actual provider and model name
  - Streaming metrics: `msToFirstChunk`, `msToFinish`, `tokensPerSecond`
  - Cache tokens (`cacheReadTokens`, `cacheWriteTokens`) and reasoning tokens tracked
  - Error capture from failed model calls and stream error chunks
  - `captureEmbed()` for embedding calls (`embed`, `embedMany`)
  - `ai` is an optional peer dependency

- [#189](https://github.com/HugoRCD/evlog/pull/189) [`d92fb46`](https://github.com/HugoRCD/evlog/commit/d92fb46b2d272dca0de73a0ffedda746304f57b6) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `evlog/vite` plugin for build-time DX enhancements in any Vite-based framework.
  - Zero-config auto-initialization via Vite `define` (no `initLogger()` needed)
  - Build-time `log.debug()` stripping in production builds (default)
  - Source location injection (`__source: 'file:line'`) for object-form log calls
  - Opt-in auto-imports for `log`, `createEvlogError`, `parseError`
  - Client-side logger injection via `transformIndexHtml`
  - New `evlog/client` public entrypoint
  - Nuxt module gains `strip` and `sourceLocation` options (no breaking changes)

### Patch Changes

- [#197](https://github.com/HugoRCD/evlog/pull/197) [`3601d30`](https://github.com/HugoRCD/evlog/commit/3601d303c122509a8f665f20e8275248e6e6e7f5) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add retry with exponential backoff to all HTTP drain adapters and improve timeout error messages.
  - Transient failures (timeouts, network errors, 5xx) are retried up to 2 times with exponential backoff (200ms, 400ms)
  - `AbortError` timeout errors now display a clear message: `"Axiom request timed out after 5000ms"` instead of the cryptic `"DOMException [AbortError]: This operation was aborted"`
  - New `retries` option on all adapter configs (Axiom, OTLP, Sentry, PostHog, Better Stack)
  - 4xx client errors are never retried

## 2.7.0

### Minor Changes

- [#175](https://github.com/HugoRCD/evlog/pull/175) [`aa18840`](https://github.com/HugoRCD/evlog/commit/aa18840459b4adced2747f70ebe0fed394348195) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add file system drain adapter (`evlog/fs`) to write wide events as NDJSON files to the local file system with date-based rotation, size-based rotation, automatic cleanup, and `.gitignore` generation

- [#174](https://github.com/HugoRCD/evlog/pull/174) [`a77a69a`](https://github.com/HugoRCD/evlog/commit/a77a69a11caf350e190d0e9eae743c904a86cf4c) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add `silent` option to suppress console output while still passing events to drains, fix drain pipeline to prevent double-draining in framework integrations, and add central configuration reference page to docs

### Patch Changes

- [#178](https://github.com/HugoRCD/evlog/pull/178) [`2b26ed2`](https://github.com/HugoRCD/evlog/commit/2b26ed2682cd98b21a5a64a44e6f3337018bae3c) Thanks [@ruisaraiva19](https://github.com/ruisaraiva19)! - Use request `originalUrl` for correct path extraction in NestJS and Express integrations (`evlog/nestjs`, `evlog/express`)

- [#172](https://github.com/HugoRCD/evlog/pull/172) [`d87d1e0`](https://github.com/HugoRCD/evlog/commit/d87d1e03ae47b913338f6d73bd7ed874316e749b) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Remove `@sveltejs/kit` optional peer dependency that caused `ERESOLVE` failures in non-SvelteKit projects (e.g. Nuxt 4) due to transitive `vite@^8.0.0` requirement

## 2.6.0

### Minor Changes

- [#169](https://github.com/HugoRCD/evlog/pull/169) [`e38787f`](https://github.com/HugoRCD/evlog/commit/e38787f08ea63bbff4ba2fea10945b2f9af94ef5) Thanks [@OskarLebuda](https://github.com/OskarLebuda)! - Add `evlog/toolkit` entrypoint exposing building blocks for custom framework integrations (`createMiddlewareLogger`, `extractSafeHeaders`, `createLoggerStorage`, `extractErrorStatus`)

### Patch Changes

- [#164](https://github.com/HugoRCD/evlog/pull/164) [`d84b032`](https://github.com/HugoRCD/evlog/commit/d84b03277d20cce649e4711db2e6bedbafd3f0f4) Thanks [@oritwoen](https://github.com/oritwoen)! - Fix browser DevTools pretty printing to use CSS `%c` formatting instead of ANSI escape codes (fixes Firefox rendering), share CSS color constants between standalone and client loggers, and escape `%` in dynamic values to prevent format string injection

- [#166](https://github.com/HugoRCD/evlog/pull/166) [`5f45b3f`](https://github.com/HugoRCD/evlog/commit/5f45b3ff01d2f73dbd92de14e384608541002bd3) Thanks [@schplitt](https://github.com/schplitt)! - Fix Nitro v3 error handler registration and update to Nitro v3 beta

## 2.5.0

### Minor Changes

- [`d7b06fa`](https://github.com/HugoRCD/evlog/commit/d7b06faba5704aa97fe1b9a46628be974a1b8a37) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add default condition to subpath exports for CJS compatibility and fix OTLP batch grouping by resource identity

## 2.4.1

### Patch Changes

- [`8ade245`](https://github.com/HugoRCD/evlog/commit/8ade2455ecc8f8da37e71fe19b7302dfb1563d69) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Restore useLogger() JSDoc for IntelliSense and remove unused RequestLogger import from Fastify adapter

## 2.4.0

### Minor Changes

- [#141](https://github.com/HugoRCD/evlog/pull/141) [`91f8ceb`](https://github.com/HugoRCD/evlog/commit/91f8cebe3d00efcd1b9fc8795b2b272a17b8258d) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add NestJS integration (`evlog/nestjs`) with Express-compatible middleware, `useLogger()` via AsyncLocalStorage, and full pipeline support (drain, enrich, keep)

- [#142](https://github.com/HugoRCD/evlog/pull/142) [`866b286`](https://github.com/HugoRCD/evlog/commit/866b28687cd9cae2dfe347c5831a3c62648906ef) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add SvelteKit integration (`evlog/sveltekit`) with handle hook, error handler, `useLogger()`, and `createEvlogHooks()` for automatic wide-event logging, drain, enrich, and tail sampling support

## 2.3.0

### Minor Changes

- [#135](https://github.com/HugoRCD/evlog/pull/135) [`e3e53a2`](https://github.com/HugoRCD/evlog/commit/e3e53a2dac958e0ede9dffb70623f90ff800c0bc) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add Elysia plugin integration (`evlog/elysia`) with automatic wide-event logging, drain, enrich, and tail sampling support

## 2.2.0

### Minor Changes

- [#134](https://github.com/HugoRCD/evlog/pull/134) [`2f92513`](https://github.com/HugoRCD/evlog/commit/2f9251346384eef42cc209919ae367aee6054845) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add Express middleware integration (`evlog/express`) with automatic wide-event logging, drain, enrich, and tail sampling support

- [#132](https://github.com/HugoRCD/evlog/pull/132) [`e8d68ac`](https://github.com/HugoRCD/evlog/commit/e8d68acf7e6ef44ad4ee44aff2decc4a4885d73f) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Add Hono middleware integration (`evlog/hono`) for automatic wide-event logging in Hono applications, with support for `drain`, `enrich`, and `keep` callbacks

## 2.1.0

### Minor Changes

- [`f6cba9b`](https://github.com/HugoRCD/evlog/commit/f6cba9b39a84e88ae44eef8ea167e6baa3a43e51) Thanks [@HugoRCD](https://github.com/HugoRCD)! - bump version
