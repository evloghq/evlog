---
"evlog": patch
---

`log.set()` no longer exposes fields hidden by a `toJSON` method when the same key is set twice. An object whose `toJSON` leaves fields out keeps that `toJSON` on the merged copy, so a second `set()` under the same key does not log the hidden fields.
