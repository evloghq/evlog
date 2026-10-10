---
'evlog': patch
---

Fix `captureOutput` in `evlog/next/instrumentation` sending evlog's own events to drains a second time: in JSON mode, each wide event printed to stdout came back as a `log.info` event, and error events as `log.error` through stderr. evlog now marks its own writes so the capture passes them through.
