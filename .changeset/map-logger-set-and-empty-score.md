---
'@evlog/cli': patch
---

Fix two `evlog map` results. `useLogger(event).set({ … })` written inline, without binding the logger to a variable, is now credited as request context, so the `context` rule no longer reports the handler as missing `log.set()`. A project with no entry points to score is now graded `unscored` ("nothing to scan") instead of a free "excellent" 100, and `--min-score` exits 1 in that case because there is nothing to meet the threshold against.
