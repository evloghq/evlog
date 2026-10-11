---
"@evlog/cli": minor
---

`evlog config` reads the options passed to the evlog module in `nuxt.config.ts` or `nitro.config.ts`, which override `evlog.config.ts` at runtime. A note under the file name says so, and each setting they replace shows the value that applies with its line, and the value of the file under it. `--json` adds `moduleOptions` and an `overrides: { value, source }` field on those settings.
