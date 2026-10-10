---
"@evlog/cli": minor
---

`evlog map` and `evlog logs` read `evlog.config.ts` (or `.mts`, `.js`, `.mjs`), the nearest one from the package up to the workspace root, without running it. `map.rules` turns checks off or back on for every entry point, `map.ignore` leaves entry points out by file glob, `map.minScore` and `map.baseline` gate like `--min-score` and `--baseline`, and `logs.dir` and `logs.limit` set the defaults of `--dir` and `--limit`. A flag wins over the config. The config can extend a local file or a published preset, one level deep. `evlog config` prints the settings that apply and the file and line each one comes from, `--json` for the same as JSON, and `evlog doctor` reports a config it cannot read. A misspelt setting, a value under `map` or `logs` computed at runtime, or turning off `wide-event` or `context` stops the command with a `cli.CONFIG_*` error. The CLI now needs `evlog` 2.31.0 or later.
