---
'@evlog/telemetry': patch
'@evlog/cli': patch
---

New `telemetry.fail(code?)` for a command that handles its own failure: it prints the error, sets an exit code and returns, so the run used to be recorded as `outcome: "success"`. Call it where the error is handled and the event carries `outcome: "error"` with `code` as its `errorCode`.

The evlog CLI calls it for every error it reports, so `evlog logs` with no log directory, `evlog config` on an invalid file and a mistyped flag are sent as errors with their `cli.*` code. A failed `--min-score` or `--baseline` gate stays a successful run with `mapGateFailed: true`.
