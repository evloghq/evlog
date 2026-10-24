---
"@evlog/cli": minor
---

`evlog upgrade` moves `createLoggerStorage` imports and re-exports from `evlog/toolkit` to `evlog/toolkit/storage`. The other names in the statement stay on `evlog/toolkit`, and the moved name joins an existing `evlog/toolkit/storage` import when the file has one. It reports `export *` from `evlog/toolkit`, which no longer includes `createLoggerStorage`, and namespace, `import()` or `require()` reads of it.
