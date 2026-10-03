---
"@evlog/cli": minor
---

`evlog map --format github` writes GitHub Actions workflow commands to stdout, one `::warning` per failing requirement with its file and line, `::error` for a baseline regression or a score under `--min-score`, and a closing `::notice` with the score, so findings land on the pull request diff. `evlog map --format sarif` writes a SARIF 2.1.0 log for code scanning, with every rule declared and one result per failed check. `--format json` is the same as `--json`; asking for both is refused.
