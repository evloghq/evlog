---
"@evlog/cli": minor
---

`evlog logs` reads the wide events the fs drain wrote to `.evlog/logs`: the last 50 (`evlog logs`), the failures (`evlog logs errors`), the slowest (`evlog logs slow --over 1s`), or one request in full by id (`evlog logs <requestId>`, a UUID prefix is enough). Filters compose with every view: `--since 15m`, `--until`, `--level error,fatal`, `--path`, `--status 5xx`, `--limit`, `--dir`. `-f` follows new events like `tail -f`; `--json` returns the events as JSON. It finds the project's log directory the way `doctor` does, reads both the compact and the pretty layout, and never writes.
