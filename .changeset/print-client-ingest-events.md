---
'evlog': patch
---

Client events received by the Nuxt and Nitro ingest endpoint are now printed to stdout, the same way server events are. Before, they were only sent to drains, so an app without a drain accepted browser logs with a 204 and they never showed up anywhere. Events still reach your drains, and `silent: true` still suppresses the console output.
