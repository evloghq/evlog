---
"evlog": patch
---

`log.set()`, `emit()` and the redaction production turns on by default do less work per event. The error check that runs on every `set()` payload no longer allocates when the payload holds no error. Redaction copies a plain event once while it redacts, instead of a `structuredClone` followed by a walk per stage, and skips the built-in patterns on strings none of them can match. Events with a `Date`, a `Map`, a class instance or another value that is not plain JSON still go through the previous path. The event `timestamp` is now one flat string. The concatenated string it replaces made `JSON.stringify` of the event, in a drain or a console line, about three times slower on Node 26. Logged and drained events are unchanged.
