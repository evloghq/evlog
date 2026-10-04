---
"@evlog/cli": minor
---

`evlog map --json` now carries `grade` next to `map` and `summary`, the same word the report prints, so a consumer no longer recomputes it from the score. `--baseline-label <text>` names the baseline in the report and the `--format github` annotations when the map was copied to a temp file, so CI can say `regressed against main` instead of printing a path.
