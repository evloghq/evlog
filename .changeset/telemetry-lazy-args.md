---
"@evlog/telemetry": patch
---

`withTelemetry` now reads a command's `args` when the command runs, so a command whose `args` are declared lazily (`args: async () => …`) still has its defaulted flags filtered out of the telemetry event.
