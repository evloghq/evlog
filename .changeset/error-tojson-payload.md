---
"evlog": patch
---

A custom error's own `toJSON` now decides how its `data` and `internal` fields are logged. A value it rewrites, such as `data: '[REDACTED]'`, is logged as rewritten, and a value it sets to `undefined` is not logged. Before, only a key that `toJSON` left out was hidden, and a rewritten value was logged raw. `EvlogError` is unchanged: logs keep its `internal`.
