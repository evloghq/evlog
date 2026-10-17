#!/bin/sh
# Vercel "Ignored Build Step" for one app: exit 0 skips the build, exit 1 builds.
# The changesets release branches are never previewed, so they never build.
case "$VERCEL_GIT_COMMIT_REF" in changeset-release/*) exit 0 ;; esac
[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] || exit 1
git fetch --unshallow >/dev/null 2>&1
npx turbo query affected --packages "$1" --exit-code --base "$VERCEL_GIT_PREVIOUS_SHA" || exit 1
