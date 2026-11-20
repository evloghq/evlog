---
"@evlog/eve": patch
---

A tool call that fails with a plain `Error` gets an `error` block on the turn's event, with the name and message eve kept, so `evlog logs errors` and the logs tool's `errors` view list the turn. When two calls in a turn fail with the same message and different evlog errors, neither call gets a `code`, `why` or `fix`; they used to both get the last one's.
