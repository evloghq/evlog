---
"@evlog/cli": patch
"@evlog/telemetry": patch
---

`evlog` now loads only the command it runs, so `evlog doctor` and `evlog telemetry` no longer load the source parser that `evlog map` and `evlog init` use. `withTelemetry` in `@evlog/telemetry` accepts lazy citty subcommands (`() => import('./cmd').then(m => m.default)`) and wraps them when citty resolves them, without loading the other commands.
