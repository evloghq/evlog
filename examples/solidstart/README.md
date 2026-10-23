# SolidStart Example

Demonstrates [evlog](https://github.com/evloghq/evlog) integration with [SolidStart](https://start.solidjs.com/) (Nitro v2 via Vinxi).

## Setup

```bash
bun install
bun run dev
```

## Routes

- `GET /api/hello` — simple wide event with `useLogger`
- `POST /api/checkout` — structured error with `createError`

Open the terminal to see evlog's pretty-printed output.

## How it works

SolidStart uses Nitro v2 through Vinxi. The evlog plugin and error handler are registered in `app.config.ts` via `server.plugins` and `server.errorHandler`:

```ts
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "@solidjs/start/config"

const evlogDir = dirname(fileURLToPath(import.meta.resolve("evlog/nitro/v2")))

process.env.__EVLOG_CONFIG = JSON.stringify({
  env: { service: "solidstart-example" },
  include: ["/api/**"],
})

export default defineConfig({
  server: {
    plugins: [resolve(evlogDir, "plugin")],
    errorHandler: resolve(evlogDir, "errorHandler"),
  },
})
```

In API routes, use `useLogger(event.nativeEvent)` to access the request-scoped logger — `event.nativeEvent` gives you the underlying H3 event that evlog hooks into.
