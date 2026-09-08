# pino

Checked: 2026-09-08 · Sources: https://github.com/pinojs/pino/blob/main/docs/api.md and https://github.com/pinojs/pino/blob/main/docs/transports.md

The default comparison. Most readers arriving at evlog either use pino or considered it, so this is the dossier that gets used.

## What it does

- JSON logger for Node. Levels are numeric (`trace` 10 to `fatal` 60) and the level is written as a number unless a formatter changes it.
- `logger.child(bindings)` returns a logger carrying extra fields. `logger.setBindings()` can add bindings later. It does not overwrite existing keys and can produce duplicates.
- Transports (`pino.transport`, `pino/file`, `pino-pretty`) run in a worker thread over `thread-stream`, so serialization stays on the main thread and the write does not.
- Redaction is built in: `redact: ['req.headers.authorization']` with path syntax, censoring or removing.
- Serializers per key (`serializers: { err: pino.stdSerializers.err }`).
- `pino-http` is the request logger, and it emits on response.
- Low overhead is the project's stated design goal, and its benchmarks are published in the repository.

## What evlog does differently

- pino writes a line per call. evlog accumulates fields over the request and emits one event at the end, including when the handler throws.
- `child()` starts with bindings and `setBindings()` can add more. `log.fork()` branches the accumulated context and can be discarded without touching the parent.
- pino's drains are transports the user assembles. evlog ships the adapters and the pipeline that batches, retries, and isolates a failing one.

## What we must never say

- That pino is slow. Do not rank speed without equivalent workloads and a versioned measurement. Any performance sentence naming pino carries a number and its source or does not ship.
- That pino has no redaction, no serializers, or no request logging. It has all three.
- That pino cannot do wide events. Nothing stops a user accumulating an object and logging it once; what evlog ships is the accumulation, the request lifecycle, and the error path.
