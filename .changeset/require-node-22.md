---
"evlog": major
"@evlog/nuxthub": major
"@evlog/telemetry": major
"@evlog/signals": major
---

Require Node.js 22 or later. `engines.node` is now `>=22.0.0` (it was `>=18.0.0`, and `>=20.0.0` for `@evlog/signals`). The build target follows the floor, so the published output targets Node 22.

Nuxt 4.6.1 declares `^22.22.3 || ^24.15.0 || >=26.0.0`, so Nuxt projects should run one of those ranges.
