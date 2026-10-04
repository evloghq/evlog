---
"@evlog/cli": minor
---

`evlog logs` reads the wide events the fs drain wrote to `.evlog/logs`: the last 50 (`evlog logs`), the failures (`evlog logs errors`), the slowest (`evlog logs slow --over 1s`), one request in full by id (`evlog logs <requestId>`, a UUID prefix is enough), or the shape of the traffic (`evlog logs stats`: per route, status class and level). Filters compose with every view: `--since 15m`, `--until`, `--level error,fatal`, `--path`, `--status 5xx`, `--where payment.amount>5000` on any field of the event (`=`, `!=`, `>`, `>=`, `<`, `<=`, `~regex`, present, `!absent`, repeatable), `--limit`, `--dir`. `-f` follows new events like `tail -f`; `--json` returns the events as JSON. It finds the project's log directory the way `doctor` does, reads every app of a workspace when the root has none, reads the memory drain's dev endpoint with `--url`, handles both the compact and the pretty layout, and never writes.
