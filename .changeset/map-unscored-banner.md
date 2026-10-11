---
'@evlog/cli': patch
---

`evlog map` no longer draws a score for an unscored scan. A project with no entry points to score showed a full banner reading `100` and a full bar, next to "nothing to scan". The banner now draws `--` with an empty bar, and `--all` shows `--` in place of `100/100`. The JSON output and the `--min-score` gate were already correct and are unchanged.
