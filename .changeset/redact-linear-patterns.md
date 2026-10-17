---
"evlog": patch
---

Fix the built-in `email` and `jwt` redaction patterns, which took quadratic time on long strings: a 64 KiB value with no `@` blocked the event loop for about 2 seconds, and redaction is on by default in production. Both patterns now run in linear time, under 15 ms for the same input. Addresses and tokens are masked as before, except that an email local part longer than 64 characters (invalid under RFC 5321) keeps its leading characters.
