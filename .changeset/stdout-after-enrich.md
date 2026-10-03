---
"evlog": patch
---

Write the console line after enrichers run. Fields added in `enrich` (UserAgent, Geo, TraceContext, `@evlog/signals` verdicts, your own plugins) now appear in stdout and in platform logs such as Vercel, not only in drains. Events that neither enrich nor drain are printed as before.
