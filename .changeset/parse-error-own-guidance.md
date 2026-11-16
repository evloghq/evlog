---
'evlog': patch
---

`parseError()` now keeps the `why`, `fix` and `link` an `Error` carries as its own properties. An error class that sets `fix` on itself and also has a `data` property, even `undefined`, used to come back with `fix: undefined`. Guidance found in the payload still wins.
