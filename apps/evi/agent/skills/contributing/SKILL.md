---
name: contributing
description: How to contribute to evlog, covering commit and PR conventions, changesets, the Definition of Done, testing rules, and the authored skills that walk through building a new adapter, enricher, framework integration, or map rule. Load this for any question about contributing, opening a PR, or adding something to the package.
---

# Contributing to evlog

The repository's own `AGENTS.md` is the source of truth for all of this. It changes; this skill does not restate it in full on purpose. **Read `AGENTS.md` from the repo before giving specifics.**

Your system context has a **Workspace** section saying whether the repository is checked out on this turn. With a checkout, `read_file /workspace/AGENTS.md`: free, and at the ref you were summoned on. Without one, `github__getFileContent` on `AGENTS.md` at the root of `evloghq/evlog`.

What follows is the shape of the answer, so you know what to look for and what to warn about.

## The parts people get wrong

- **A changeset is required** for anything a consumer of evlog would notice: a feature, a bug fix, a breaking change. `pnpm changeset`, committed alongside the code. Changes confined to `apps/*` or `examples/*` never need one. A PR without a changeset for a user-facing change does not merge.
- **Conventional Commits, lowercase subject.** `feat: add stream server`, not `feat: Add stream server`. Omit the scope when the change is cross-cutting; never use `evlog` as a scope. A new subsystem needs its scope registered in both `.github/workflows/semantic-pull-request.yml` and `.github/pull_request_template.md`, and because title validation reads the base branch, that registration has to land in an earlier PR.
- **The scope list is a closed set, and you read it before you write the title.** `.github/workflows/semantic-pull-request.yml` holds the only scopes CI accepts. Anything else fails `Validate PR title`, and a scope that merely sounds plausible (`evlog`, the package name, the app directory) is the usual way that happens. A change confined to `apps/docs` is `docs:`, with no scope: `docs` is already the type.
- **A bug fix needs a failing regression test first**, then the fix.
- **New exports** go in `packages/evlog/package.json` (`exports` and `typesVersions`) *and* `tsdown.config.ts`.
- **Skills must stay in sync.** If a change touches something a skill documents, the SKILL.md changes in the same PR, both the internal `.agents/skills/` and the published `skills/`.

## The Definition of Done

`AGENTS.md` lists eight conditions. The ones worth repeating up front: `pnpm run lint`, `pnpm run typecheck` and `pnpm run test` all exit 0; the change has a matching test; new public APIs have JSDoc.

## Authored procedures in the repo

For anything substantial, the repo already has a step-by-step skill. Read the relevant one with `github__getFileContent` rather than improvising:

| Task | Skill |
| --- | --- |
| New drain adapter | `.agents/skills/create-adapter/SKILL.md` |
| New enricher | `.agents/skills/create-enricher/SKILL.md` |
| New framework integration | `.agents/skills/create-framework-integration/SKILL.md` |
| New `evlog map` rule or framework adapter | `.agents/skills/create-map-rule/SKILL.md` |

Each covers source, build config, package exports, tests, and every doc page that has to move with it. They are long and specific; point people at them and read the relevant section rather than summarizing from memory. On a GitHub turn they are on disk under `/workspace/.agents/skills/`.

## Verifying a change before you propose it

The sandbox carries a ready-to-work checkout at `/workspace/repo`, with dependencies installed and `dev:prepare` already run; each session starts on the current `main`. When you have written or edited code, run the checks there rather than asserting they pass:

```
cd /workspace/repo
pnpm run lint
pnpm run typecheck
pnpm --filter evlog exec vitest run test/path/to/file
```

If you could not run the checks, say so plainly in the pull request body instead of implying a green build.

For authored or changed prose, run the content review even when the scanner scores 100. Capture each page with `content_snapshot` and send its identity to `content_review`, along with sources and executed-check results. Source edits must be committed before this handoff; page text can remain uncommitted. The reviewer shares the parent workspace and must use `content_load`. Do not edit files or change Git state while reviewers are reading. Wait for all readers to finish, recapture and compare the current identity with the rewrite input, then apply reviewed changes serially with the parent’s existing editing tools. A changed identity requires a fresh review first. Capture and review the saved file again after editing; a proposed rewrite is not verification of the saved result. A critical factual error or missing evidence blocks readiness. Follow `content-pass` for the verification procedure, while keeping the scope the maintainer requested.

Read the changed pages together before shipping. Each should answer a distinct reader question, agree on behavior and link to shared explanations instead of repeating them. Record the revision, command and observed result for runtime claims. After changing relevant code or examples, rerun the affected checks.

## Shipping a change

The whole flow runs in `/workspace/repo`; nothing ships through the GitHub file API.

1. Branch off the current `main` the session starts on: `git checkout -b <branch>`.
2. Edit, then run the checks above. A bug fix commits its failing regression test first, then the fix. For a visual change, start the dev server in the background before the checks (see `before-after`, step 0) so it warms while they run. Before the first check of the session, call `turbo__enable_remote_cache` once, then prefix each check with `TURBO_REMOTE_CACHE_READ_ONLY=true`: turbo reuses the artifacts CI already built, and the template cache covers the rest, so only what the diff affects actually runs.
3. When a consumer of evlog would notice the change, add a changeset: write `.changeset/<some-name>.md` by hand with the `---` frontmatter naming the package and bump plus a consumer-facing description (`pnpm changeset` is interactive and cannot run here). Look at an existing file in `.changeset/` for the exact shape.
4. Commit with a Conventional Commits subject: lowercase, a registered scope or none.
5. **Push the branch with `git__push`.** That tool is the only way code reaches the remote: never the GitHub file API. It refuses `main` and `master`, and only maintainer sessions have it.
6. Open the pull request with `github__createPullRequest`, report each check result in the body, and request `hugorcd` via `github__requestReviewers` unless it is a draft.
7. **Read CI back once it has run.** `Validate PR title` settles in seconds and is the check your own title most often breaks. A pull request announced as ready while a required check is red costs the maintainer the review; fix the title or the code and say so, rather than leaving it for them to find.

A pull request is not finished when it is open. Before you report it, the local checks are green, CI is green, and you have looked at the rendered result of anything visual. "Lint and typecheck pass" is a claim about the build, not about whether the thing you wrote is correct or reads well.

`pnpm --filter @evlog/cli exec evlog map --json --no-write` scores an entry point's observability and is built for exactly this: it is the fastest way to ground a "should this be logged" answer in the tree you are working in. Run the workspace copy rather than `npx @evlog/cli`, which would fetch and execute whatever version the registry currently serves.

## Tests

`packages/evlog/test/` mirrors `src/` and uses Vitest. `packages/evlog/test/README.md` has the file layout, the framework runtime fidelity matrix, and the helper decision table; read it before answering a testing question. Framework tests must drive the framework's real request driver (supertest, `app.inject`, `app.handle`, ...), never a hand-rolled stand-in.

## Style

The repo has an explicit "no slop" section: no defensive code the surrounding file does not have, no silent fallbacks, no `as any`, comments only for constraints the code cannot express, no speculative options. It applies to prose too: test names, error messages, changeset descriptions, PR bodies. Factual and plain.
