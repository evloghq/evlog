---
name: analyze-logs
description: Analyze application logs from the .evlog/logs/ directory. Use when debugging errors, investigating slow requests, understanding request patterns, or answering questions about application behavior. Reads structured NDJSON wide events written by evlog's file system drain.
license: MIT
metadata:
  author: HugoRCD
  version: "0.3"
---

# Analyze application logs

Read and analyze structured wide-event logs from the local `.evlog/logs/` directory to debug errors, investigate performance issues, and understand application behavior.

## When to Use

- User asks to debug an error, investigate a bug, or understand why something failed
- User asks about request patterns, slow endpoints, or error rates
- User asks "what happened" or "what's going on" with their application
- User asks to analyze logs, check recent errors, or review application behavior
- User mentions a specific error message or status code they're seeing

## Finding the logs

Try the CLI first; it reads both file layouts, every dated file, and knows where the project's drain writes. Prefer the copy the project installed (`pnpm evlog`, or the equivalent for its package manager). The wrappers that fetch on demand (`npx`, `bunx`, `npm exec`) install `@evlog/cli` when the project has none, which runs a release the lockfile never pinned. Ask before that happens.

```bash
pnpm evlog logs --json                       # the last 50 events
pnpm evlog logs errors --since 1h --json     # what failed
pnpm evlog logs slow --over 1s --json        # what was slow, worst first
pnpm evlog logs "$REQUEST_ID" --json         # one request, every event with that id
pnpm evlog logs stats --json                 # per route: count, errors, p50, p95; by status and level
pnpm evlog logs --where 'payment.amount>5000' --where audit.outcome=failure --json
```

`--json` is an envelope (`sources`, `view`, `matched`, `events`; `stats` carries `stats` instead); filters are `--since`, `--until`, `--level`, `--path`, `--status` (`500` or `5xx`), `--where field=value|field>n|field~regex|field|!field` on any dotted field (repeatable), `--limit`, `--dir` for a non-default directory, and `--url` for an app on the memory drain that exposes `readMemoryLogs()` over HTTP. From a monorepo root it reads every app's `.evlog/logs` and labels each event. Docs: https://www.evlog.dev/cli/logs. If the CLI is unavailable or the user declines it, read the files directly as below.

Logs are written by evlog's file system drain as `.jsonl` files, organized by date.

**Format detection**: The drain supports two modes:
- **NDJSON** (default, `pretty: false`): One compact JSON object per line. Parse line-by-line.
- **Pretty** (`pretty: true`): Multi-line indented JSON per event. Parse by reading the entire file and splitting on top-level objects (e.g. `JSON.parse('[' + content.replace(/\}\n\{/g, '},{') + ']')`) or use a streaming JSON parser.

Always check the first few bytes of the file to detect the format: if the second character is a newline or `"`, it's NDJSON; if it's a space or newline followed by spaces, it's pretty-printed.

**Search order.** Check these locations relative to the project root:

1. `.evlog/logs/` (default)
2. Any `.evlog/logs/` inside app directories (monorepos: `apps/*/.evlog/logs/`)

Use glob to find log files:

```
.evlog/logs/*.jsonl
*/.evlog/logs/*.jsonl
apps/*/.evlog/logs/*.jsonl
```

Files are named by date: `2026-03-14.jsonl`. Start with the most recent file.

**Programmatic reading**: instead of hand-parsing, a small script can use the readers shipped with evlog: `readFsLogs()` and `tailFsLogs()` from `evlog/fs` are async generators that handle both formats, date ordering, and filtering. Prefer them when the project already has evlog installed and the analysis needs more than a quick grep.

**Memory drain alternative**: some apps use the Memory adapter (`evlog/memory`) instead of (or alongside) the FS drain, exposing recent events through a dev-only HTTP endpoint via `readMemoryLogs()`. If `.evlog/logs/` is empty but the app wires `createMemoryDrain()`, query that endpoint instead.

## If no logs are found

Before wiring a new drain, you can try `npx evlog doctor --json`, which checks whether `evlog` is installed and whether a local `.evlog/logs` drain already exists (read-only). Optional; skip if the CLI is unavailable.

The file system drain may not be enabled. On Nuxt, Nitro, Next.js, TanStack Start, Hono, Express, or Fastify, the fastest path is the CLI, which detects the framework and wires the fs drain (its default dev drain) in one pass:

```bash
npx evlog init --dry-run --yes   # preview first
npx evlog init --yes --drain fs  # apply
```

Ask before running it. On other frameworks (or if the user declines), guide the manual setup:

```typescript
import { createFsDrain } from 'evlog/fs'

// Nuxt / Nitro: server/plugins/evlog-drain.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', createFsDrain())
})

// Hono / Express / Elysia: pass in middleware options
app.use(evlog({ drain: createFsDrain() }))

// Fastify: pass in plugin options
await app.register(evlog, { drain: createFsDrain() })

// NestJS: pass in module options
EvlogModule.forRoot({ drain: createFsDrain() })

// Standalone: pass to initLogger
initLogger({ drain: createFsDrain() })
```

After setup, the user needs to trigger some requests to generate logs, then re-analyze.

## Log format

Each line is a self-contained JSON object (wide event). Key fields:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `string` | ISO 8601 timestamp |
| `level` | `string` | `info`, `warn`, `error`, `debug` |
| `service` | `string` | Service name |
| `environment` | `string` | `development`, `production`, etc. |
| `method` | `string` | HTTP method (`GET`, `POST`, etc.) |
| `path` | `string` | Request path (`/api/checkout`) |
| `status` | `number` | HTTP response status code |
| `duration` | `string` | Request duration, human-formatted (`"234ms"`) |
| `durationMs` | `number` | Request duration in milliseconds. Filter and sort on this one |
| `requestId` | `string` | Unique request identifier |
| `error` | `object` | Error details: `name`, `message`, `stack`, `statusCode`, `data` |
| `error.data.why` | `string` | Human-readable explanation of what went wrong |
| `error.data.fix` | `string` | Suggested fix for the error |
| `source` | `string` | `client` for browser logs, absent for server logs |
| `userAgent` | `object` | Parsed browser/OS/device info |

All other fields are application-specific context added via `log.set()` (e.g. `user`, `cart`, `payment`).

## How to analyze

### Step 1: Read the most recent log file

Read the latest `.jsonl` file. Each line is one JSON event. Parse each line independently.

### Step 2: Identify the relevant events

Filter based on the user's question:

- **Errors**: `"level"` of `"error"` or `"fatal"`, `status >= 500`, or an `error` object on the event, which is what `evlog logs errors` matches. A 4xx status on its own is the client's and does not count, though a 4xx event still matches when it carries one of the other two signals; read `status` or pass `--status 4xx` to see them all
- **Specific endpoint**: match on `path`
- **Slow requests**: filter on `durationMs` (e.g. `durationMs > 500`)
- **Specific user/action**: match on application-specific fields
- **Client-side issues**: filter by `"source":"client"`
- **Time range**: compare `timestamp` values

### Step 3: Analyze and explain

For each relevant event:

1. **What happened**: summarize the `path`, `method`, `status`, `level`
2. **Why it failed** (errors): read `error.message`, `error.data.why`, and the stack trace
3. **How to fix**: check `error.data.fix` for suggested remediation
4. **Context**: examine application-specific fields for business context (user info, payment details, etc.)
5. **Patterns**: look for recurring errors, degrading performance, or correlated failures

## Analysis patterns

### Find all errors

```
Filter: level === "error"
Group by: error.message or path
Look for: recurring patterns, common failure modes
```

### Find slow requests

```
Filter: durationMs > 1000
Sort by: durationMs descending
Look for: specific endpoints, time-of-day patterns
```

### Trace a specific request

```
Filter: requestId === "the-request-id"
Result: single wide event with all context for that request
```

### Error rate by endpoint

```
Group events by: path
Count: total events vs error events per path
Look for: endpoints with high error ratios
```

### Client vs server errors

```
Split by: source === "client" vs no source field
Compare: error patterns between client and server
Look for: client errors that don't have corresponding server errors (network issues)
```

## Important notes

- Each line is a **complete, self-contained event**. Unlike traditional logs, you don't need to correlate multiple lines. One line has all the context for one request.
- The `error.data.why` and `error.data.fix` fields are evlog-specific structured error fields. When present, they provide the most actionable information.
- `duration` is human-formatted with units (e.g. `"706ms"`). `durationMs` is the same duration in milliseconds; filter and sort on `durationMs`.
- Events with `"source":"client"` originated from browser-side logging and were sent to the server via the HTTP drain endpoint.
- Log files are `.gitignore`'d automatically. They exist only on the local machine or server where the app runs.
