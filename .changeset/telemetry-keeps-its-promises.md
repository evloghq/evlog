---
'@evlog/telemetry': patch
'@evlog/cli': patch
---

Telemetry now does what its docs say.

- The run that opts out is no longer queued: `telemetry disable`, or `disableTelemetry()` called inside a run, used to purge the outbox and then write its own event to it.
- `EVLOG_TELEMETRY_DEBUG=1` prints each run's event as the run ends and makes no request. The event is not queued either. It used to print at the next flush, and that flush sent the events.
- An endpoint that never answers no longer keeps the process alive for ten seconds. The drain closes its connection at the 400 ms timeout. It no longer follows redirects, so `endpoint` has to be the final URL.
- `DO_NOT_TRACK=true`, `yes` and `on` opt out like `1`, and `EVLOG_TELEMETRY=false`, `no` and `off` like `0`.
- `withTelemetry()` records only the flags a command declares. An undeclared flag used to be sent by name, and a positional as `<set>`.
- New `bin` option: the command people type, when it is not `name`. The first-run notice prints `<bin> telemetry disable`, so the evlog CLI's notice now says `evlog telemetry disable`, not `evlog-cli telemetry disable`.
- `evlog telemetry status` lists the allowlisted `init*`, `map*` and `logs*` values. The fields `evlog logs` records are documented.
