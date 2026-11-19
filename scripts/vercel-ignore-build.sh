#!/bin/sh
# Vercel "Ignored Build Step" for one app: exit 0 skips the build, exit 1 builds.
# Arguments are the repository paths the app's build reads, its own directory first.
# Package dependencies alone over-build (a test-only evlog change rebuilt every app
# that imports it) and miss what an app reads outside them (docs serves `skills/`).
cd "$(git rev-parse --show-toplevel)" || exit 1
# Vercel's clone has no `origin` remote, so fetch from the repository URL.
repo="https://github.com/$VERCEL_GIT_REPO_OWNER/$VERCEL_GIT_REPO_SLUG.git"
git fetch --unshallow "$repo" >/dev/null 2>&1
base=$VERCEL_GIT_PREVIOUS_SHA
# A new branch has no previous deployment and a rebase orphans the one it had:
# compare with where the branch left main rather than build every app.
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  [ "$VERCEL_GIT_COMMIT_REF" = "main" ] && exit 1
  git fetch "$repo" main >/dev/null 2>&1
  base=$(git merge-base FETCH_HEAD HEAD) || exit 1
fi
git diff --quiet "$base" HEAD -- "$@" \
  ':(exclude,glob)**/test/**' \
  ':(exclude,glob)**/*.test.*' \
  ':(exclude,glob)**/evals/**' \
  ':(exclude,glob)**/AGENTS.md' \
  ':(exclude,glob)**/CLAUDE.md' \
  ':(exclude,glob)**/README.md' \
  ':(exclude,glob)packages/**/*.md' || exit 1
# Turbo reads the lockfile per package, so only it can tell whether a lockfile
# change reaches this app's dependencies.
git diff --quiet "$base" HEAD -- pnpm-lock.yaml pnpm-workspace.yaml && exit 0
npx turbo query affected --packages "$(node -p "require('./$1/package.json').name")" --exit-code --base "$base" || exit 1
