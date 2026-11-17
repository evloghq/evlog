---
"evlog": patch
---

Framework entries (`evlog/hono`, `evlog/express`, `evlog/next`, `evlog/nitro`, `evlog/nuxt`, `evlog/workers`, ...) and `evlog/toolkit` no longer load the audit helpers (`withAudit`, `signed`, `auditDiff`, `auditOnly`, `auditEnricher`, `mockAudit`). Without a bundler, each of those entries now loads about 15 kB less from `dist/` (about 5 kB gzipped). `log.audit()` works as before, and the root `evlog` entry still exports every audit helper.
