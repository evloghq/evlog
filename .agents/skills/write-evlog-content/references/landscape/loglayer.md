# LogLayer

Checked: 2026-10-17 · loglayer 9.4.0, @loglayer/mixin-wide-events 1.4.0, @loglayer/plugin-redaction 4.1.0, @loglayer/express 1.3.0
Sources: https://loglayer.dev/introduction, https://loglayer.dev/mixins/wide-events, https://loglayer.dev/guides/wide-events, https://loglayer.dev/plugins/redaction, https://loglayer.dev/integrations/express, https://loglayer.dev/logging-api/unit-testing, https://loglayer.dev/configuration

## What it does

- A fluent API (`withContext()`, `withMetadata()`, `withError()`) in front of a logging library or service. Transports forward records to pino, winston, bunyan, LogTape, consola, console and others, or to services such as Datadog, Axiom and OpenTelemetry. One instance can send to several transports.
- Context persists across records. Metadata and errors apply to one record. `errorSerializer`, `errorFieldName`, `contextFieldName` and `metadataFieldName` decide where each lands.
- Groups route records to chosen transports with per-group levels, and `LOGLAYER_GROUPS` narrows them at runtime.
- Plugins hook into record assembly. `@loglayer/plugin-redaction` redacts configured paths with fast-redact; its documented options are paths, `censor`, `remove` and `strict`, with no value-pattern scanning. There are also sampling and filter plugins.
- Wide events come from `@loglayer/mixin-wide-events`: `withWideEvents()` deep-merges into the pending event, `withWideEventError()` records an error, `emitWideEvent({ message, level })` emits it. It needs an `AsyncLocalStorage` the application creates and passes in, and a `tsconfig.json` include for its types. Sampling options: a rate, per-level rates, `shouldEmit` and `forceKeep`, with `error` and `fatal` kept by default.
- Framework integrations for Express, Fastify, Hono, Koa and Elysia attach a request-scoped child logger with a `requestId` and write pino-http style `incoming request` and `request completed` records.
- `MockLogLayer` implements the logger interface with no-op methods for tests.
- The core package declares under 8 kB gzipped.

## Verified by running it (2026-10-17, Node 26.7)

- Outside `asyncContext.run()`, `withWideEvents()` keeps nothing: `emitWideEvent()` writes a record with only the message, and `getWideEvents()` returns `{}`. No warning is printed.
- The emitted wide event carries `level`, `time`, `msg` and the accumulated fields. It has no duration field unless the application adds one.
- `emitWideEvent()` defaults to `info`. Recording an error with `withWideEventError()` does not change the level; pass `level: 'error'`.

## What comparisons must distinguish

- LogLayer has wide events. Do not describe it as lacking accumulation. The difference is who wires the lifecycle: its integrations do not emit wide events, and its guide has the application write middleware that runs the async context and calls `emitWideEvent()` on response finish. evlog's integrations do that themselves.
- LogLayer's purpose is to keep an existing logger and swap it behind one API. Recommending a migration away from pino or winston through LogLayer misreads what it is for: LogLayer can sit in front of either.
- Its redaction is path-based and opt-in. evlog's default redaction in production also masks values matched by built-in patterns. Neither guarantees all personal data is found.
- `MockLogLayer` silences logging; it does not capture records. Do not compare it with evlog's memory drain as if both captured events.
- Any speed comparison includes the transport's logger: LogLayer over pino costs pino plus the LogLayer layer.
