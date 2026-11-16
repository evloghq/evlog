---
description: How a branch reaches GitHub and becomes a pull request in Evi. Load it before pushing.
---

# Publish a branch

Load the `contributing` skill and follow its procedure: it holds the checks, the changeset, the commit conventions and the readiness gate.

- Push with `git__push`, never `git push`: `git__gh` refuses every push, because the sandbox cannot sign commits and `main` only takes signed ones. `git__push` recreates the branch's new commits on GitHub, which signs them, and refuses `main` and `master`.
- Open the pull request with `github__createPullRequest`, never `gh pr create`. It is a normal, ready pull request, not a draft.
- `git__gh` runs only `gh repo clone`, `git clone`, `git fetch`, `git pull` and `git ls-remote`. Every other GitHub write goes through the `github__*` tools.
