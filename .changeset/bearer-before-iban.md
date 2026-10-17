---
"evlog": patch
---

The `bearer` redaction built-in now runs before every other built-in, so a Bearer token is masked whole. A token shaped like an IBAN or a card number was partly rewritten first and then no longer matched: `Bearer FR76ABCD123456789012` was logged as `Bearer FR76****012`, and `Bearer 4111111111111111` as `Bearer ****1111`. Both are now `Bearer ***`, and so is a JWT after `Bearer`, which was logged as `Bearer eyJ***.***`.
