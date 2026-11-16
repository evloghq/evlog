---
'evlog': patch
---

`auditDiff` now reports changes to `Date`, `Set`, `Map` and `RegExp` fields as a `replace` (a `Date` is compared by timestamp, so an equal one emits nothing). Patch paths are now valid RFC 6901 JSON Pointers: `~` and `/` in keys are escaped as `~0` and `~1`, and operations on the root value use `''` instead of `'/'`. `redactPaths` still matches keys that contain `/` or `~`.
