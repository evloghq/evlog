---
"@evlog/cli": minor
---

`evlog map --format github` writes GitHub Actions workflow commands to stdout so findings land on the pull request diff. With `--baseline` it emits the regressions as `::error`; without one, the FIX FIRST list as `::warning`, worst entry point first. `--limit <n>` caps the list (default 10, GitHub's per-step cap) and the closing `::notice` says how many were left out. Paths are rebased on `GITHUB_WORKSPACE` when it is set, so a package scanned with `--cwd` inside a monorepo checkout still annotates the right file. `--format json` is the same as `--json`; asking for both is refused.
