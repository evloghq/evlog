---
"evlog": patch
---

Fix the built-in `email` and `jwt` redaction patterns, which took quadratic time on long strings: a 64 KiB value with no `@` blocked the event loop for about 2 seconds, and redaction is on by default in production. Both patterns now run in linear time, under 1 ms for the same input. Masking is unchanged except at two edges, which are no longer masked: a JWT directly after a `-` (`x-eyJ...`), and an email joined to the one before it by `.`, `+` or `-` (`a@b.com.c@d.org`).
