---
"@evlog/telemetry": patch
---

Fix `createGitHubActionsTelemetry()` to expose `set()`, `flush()`, and a live `enabled` getter alongside `run()`.
