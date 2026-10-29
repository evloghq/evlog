---
'evlog': patch
---

Keep request errors in Nitro 3 wide events when an earlier async error hook delays evlog's hook. Emit once without late-write warnings.
