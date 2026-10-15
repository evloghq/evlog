---
"evlog": patch
---

Send Datadog log batches gzip-compressed. The request carries `Content-Encoding: gzip`, as Datadog recommends for the Logs intake, which keeps larger batches further below the intake's 5 MB uncompressed payload limit. The payload and the response handling are otherwise unchanged.
