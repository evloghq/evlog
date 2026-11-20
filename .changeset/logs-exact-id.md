---
"@evlog/cli": patch
"@evlog/eve": patch
---

A complete request id selects only the events that carry it. `evlog logs wrun_1:turn_1` and the Eve logs tool's `trace` view used to match every id starting with it, so `turn_10` to `turn_19` crowded `turn_1` out of the results. A prefix still works when no event carries the id whole.
