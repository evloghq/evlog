---
name: upstream-sync
description: Check the eve and Vercel Connect ecosystem for updates and new features, keep the app current with them, and replace workarounds with the real improvements. Load this when the upstream-sync schedule fires, or when asked to check for eve or @vercel/connect updates.
---

# Upstream sync

The frameworks this app runs on move independently: eve and its satellites (@agent-browser/eve, @github-tools/eve-extension) from vercel/eve, and @vercel/connect from vercel/vercel. The twice-weekly run checks them, updates the app where warranted, and opens draft PRs. The PRs are the deliverable; nothing merges without a human.

## 1. What changed upstream

- Installed versions: `apps/evi/package.json`.
- Latest published versions: `npm view <pkg> version` from the sandbox, or the npm registry page, for `eve`, `@agent-browser/eve`, `@github-tools/eve-extension`, `@vercel/connect`.
- Release notes: GitHub releases on `vercel/eve`, `vercel-labs/agent-browser`, `vercel-labs/github-tools`, and the `packages/connect` changelog in `vercel/vercel`. For behavior changes, `eve.dev/docs` and the installed `node_modules/eve/docs`.

## 2. Map onto this repo

- **eve APIs**: everything under `agent/` (channels, connections, extensions, schedules, sandbox.ts). `node_modules/eve/docs` is the framework reference.
- **@vercel/connect/eve**: `channels/slack.ts`, `channels/photon.ts`, `channels/linear.ts`, `connections/vercel.ts`, `lib/github/credentials.ts`.
- **@agent-browser/eve**: `sandbox.ts`, `extensions/browser.ts`. **@github-tools/eve-extension**: `extensions/github.ts`.
- **packages/evlog/src/eve**: the evlog integration for eve. A change there is user-facing and needs a changeset.
- **docs/notes.md**: the "eve", "github-tools" and "Vercel Connect" sections record workarounds. A newer version that fixes one means the workaround goes and the note goes with it.

## 3. Deliver the PRs

- One draft PR per coherent change: a dependency bump with its adaptation, or a workaround replacement. Never bundle unrelated updates.
- Branch off `main` in `/workspace/repo`, apply the change, run `pnpm run lint`, `pnpm run typecheck` and `pnpm run test`. Add a changeset when a consumer of evlog would notice the change.
- Push the branch, open a draft PR per branch. Drafts cannot merge; marking one ready is Hugo's call.

## 4. Track what needs a human in Linear

A draft PR is its own artifact and needs nothing else. But an upstream finding that could **not** become a safe PR (a deprecation to plan around, a breaking change to schedule, a new capability worth adopting deliberately) becomes a **Linear issue** via `linear__save_issue` on the evlog team: a title stating the situation, the upstream link, what it affects in this repo, and the decision Hugo has to make. One issue per finding; search `linear__list_issues` first so a recurring finding updates the existing issue instead of duplicating it.

Then post one summary to the thread: one line per draft PR and per Linear issue, links inline.

## When nothing is warranted

One line in the thread: versions current, or nothing in the releases affects this app. Never invent work to fill the run, and never open a Linear issue to say nothing happened.
