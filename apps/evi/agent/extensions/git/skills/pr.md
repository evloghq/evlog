---
description: How a branch reaches GitHub and becomes a pull request in Evi. Load it before pushing.
---

# Publish a branch

Load the `contributing` skill and follow its procedure: it holds the checks, the changeset, the commit conventions and the readiness gate.

- Push with `git__gh`: `git push <remote URL> <branch>` from the checkout, with `repository` set to its `owner/name`. Spell out the remote URL, `https://github.com/<owner>/<name>.git`, rather than `origin`. Only feature branches go through; `main` and `master` are refused under any name.
- Open the pull request with `github__createPullRequest`, never `gh pr create`. It is a normal, ready pull request, not a draft.
- `git__gh` runs only `gh repo clone`, `git clone`, `git fetch`, `git pull`, `git ls-remote` and feature-branch pushes. Every other GitHub write goes through the `github__*` tools.
