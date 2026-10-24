---
"@evlog/cli": patch
---

`evlog logs` and the NuxtHub log viewer now show the HTTP status of an error from `error.status`, falling back to `error.statusCode` for files written before v3. Before, a v3 error event rendered no status, and a 2.x error created with only `status` (for example a plain h3 error) rendered none either.
