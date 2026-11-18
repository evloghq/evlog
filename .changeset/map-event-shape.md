---
"@evlog/cli": minor
---

`evlog map` now records what each entry point's wide event carries. Every route in `evlog.map.json` and in `--json` gains an `event` key with the dotted paths `log.set()` writes (`user.id`, `cart.items`) and the literal `action` of each `log.audit()` call. Comparing it between two scans shows which fields a change removes from your production logs. Routes that set nothing have no `event` key, and the existing keys are unchanged.
