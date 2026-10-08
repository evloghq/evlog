---
'evlog': patch
---

Fix custom RegExp `redact.patterns` declared in `nuxt.config.ts` (or Nitro module options) being silently dropped: patterns are now serialized as `{ source, flags }` across the config bridges and rebuilt into RegExp on the server. A pattern object without a `source` field is reported instead of skipped, and a function-valued `redact.replacement` / `redact.transform` in the Nuxt module now prints the same warning the standalone Nitro modules already print.
