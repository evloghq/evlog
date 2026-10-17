---
"evlog": patch
---

The `iban` redaction built-in masks a spaced IBAN whole when `creditCard` is also on, as it is with the default `redact: true`. The card pattern ran first and matched the digits inside it, so `FR76 3000 6000 0112 3456 7890 189` was logged as `FR76 ****3456 7890 189`. It is now `FR76****189`. A `builtins` list runs in a fixed order, whatever order it is written in.
