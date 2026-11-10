---
'evlog': patch
---

Redaction is 2 to 3.7 times faster on typical wide events. A built-in pattern now runs on a string only when the string can match it (long enough, and holding the characters the pattern needs), and plain JSON-shaped events are copied without `structuredClone`. Events holding a `Date`, a `Map`, a class instance or a shared reference still go through `structuredClone`. Redacted output is unchanged.
