---
"evlog": patch
---

Send Datadog log batches gzip-compressed. The request carries `Content-Encoding: gzip`, as Datadog recommends for the Logs intake, so less data goes over the network. The intake's 5 MB limit applies to the uncompressed payload, so gzip does not raise how much a batch can hold. The payload and the response handling are otherwise unchanged.
