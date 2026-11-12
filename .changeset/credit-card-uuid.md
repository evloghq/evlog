---
'evlog': patch
---

The `creditCard` built-in no longer masks the digit groups of a UUID. A path such as `/api/orders/00000000-0000-4000-8000-000000000000` used to come out as `/api/orders/****4000-****0000`; it is now left as is. Card numbers written with spaces, hyphens or no separator are still masked to `****1111`.
