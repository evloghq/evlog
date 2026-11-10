#!/bin/sh
# Vercel "Ignored Build Step" for one app: exit 0 skips the build, exit 1 builds.
git fetch --unshallow >/dev/null 2>&1
base=$VERCEL_GIT_PREVIOUS_SHA
# A new branch has no previous deployment and a rebase orphans the one it had:
# compare with where the branch left main rather than build every app.
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  [ "$VERCEL_GIT_COMMIT_REF" = "main" ] && exit 1
  git fetch origin main >/dev/null 2>&1
  base=$(git merge-base FETCH_HEAD HEAD) || exit 1
fi
npx turbo query affected --packages "$1" --exit-code --base "$base" || exit 1
