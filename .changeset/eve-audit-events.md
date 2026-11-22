---
"@evlog/eve": major
---

An `audit` call in a tool records its own event, with the turn's `requestId`, instead of setting `audit` on the turn's event. The turn's event no longer carries `audit` and follows sampling like any other turn. Audits are recorded on turns excluded by route filters.
