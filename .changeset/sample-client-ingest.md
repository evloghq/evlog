---
'evlog': minor
---

Apply `sampling.rates` to browser logs received on the client ingest endpoint. Client events previously skipped head sampling entirely, so `info: 0` still sent every client info log to your drains. A sampled-out client event is now dropped before enrichment and draining, with the same defaults as server events: errors and fatal are kept, trace is dropped unless `sampling.rates.trace` is set. If you tuned rates for server traffic only, check that they still fit your client volume.
