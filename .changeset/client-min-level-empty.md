---
'evlog': patch
---

Fix every client log being silently dropped in Nuxt when `minLevel` is not set: the public runtime config turns the unset value into `''`, which no level passed. The client logger now falls back to `'debug'` for any value that is not a valid level.
