---
"evlog": minor
---

Add `evlog/otel`. `createOtelPlugin()` reads the OpenTelemetry span active when a request starts and sets `traceId` and `spanId` on that request's wide event, so the OTLP drain links the log record to its trace.

```ts
import { createOtelPlugin } from 'evlog/otel'

app.use(evlog({ plugins: [createOtelPlugin()] }))
```

`@opentelemetry/api` is a new optional peer at `>=1.9.0 <2`, which covers apps on OpenTelemetry JS SDK 2 and SDK 3. evlog adds no runtime dependency, and an app that does not import `evlog/otel` does not load `@opentelemetry/api`. The plugin runs on every integration with a `plugins` option, and on Nuxt and Nitro from the `plugins` of `evlog.config.ts`.
