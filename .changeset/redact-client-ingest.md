---
'evlog': patch
---

Redact client events received by the Nuxt and Nitro ingest endpoint. The route built its own wide event and skipped the global `redact` config, so in production a browser event carrying an email or a card number reached stdout and every drain unmasked, while server events were redacted. Client events now go through the same redaction before enrichers, stdout and drains.
