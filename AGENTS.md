# evlog

TypeScript logging library focused on wide events and structured error handling. pnpm monorepo (managed with Corepack).

## Commands

```bash
pnpm install                       # install deps
pnpm run dev:prepare               # generate types (required before lint/typecheck after a fresh install)
pnpm run dev                       # start playground
pnpm run build:package             # build the package
pnpm run test                      # run tests (vitest)
pnpm run lint                      # lint all packages
pnpm run typecheck                 # type-check all packages
pnpm run docs                      # start docs site
pnpm run telemetry                 # start the telemetry dashboard (apps/telemetry)
pnpm telemetry:cli <command>       # run this repo's CLI into that local dashboard (--cwd to target an app)
pnpm cli:sandbox                   # disposable per-framework apps under .sandbox/ to test the CLI by hand (--reset restores them, --smoke runs the feature matrix)
pnpm content:lint [path]           # rank the written corpus by content findings (see scripts/content-lint/README.md)
pnpm content:lint:test             # the scanner's own tests, including its two calibration fixtures
```

Publishing is automated: changesets + `.github/workflows/release.yml`. Never run `pnpm release` or `changeset publish` manually.

> Use `corepack enable` once so the `packageManager` field in `package.json` pins the right pnpm version automatically.
>
> After a clean `pnpm install`, run `pnpm run dev:prepare` before `pnpm run lint` / `typecheck`. Packages like `@evlog/nuxthub` extend generated `.nuxt/tsconfig.json` files; without prepare, turbo lint fails on missing extends.

## Monorepo Structure

```
packages/evlog/            Main package
  src/nuxt/                Nuxt module
  src/nitro/, src/nitro-v3/  Nitro plugin (v2 + v3)
  src/vite/                Vite plugin (evlog/vite)
  src/shared/              Toolkit — exposed as evlog/toolkit (NOT evlog/shared)
  src/ai/                  AI SDK integration (evlog/ai)
  src/adapters/            Drain adapters (Axiom, OTLP, HyperDX, PostHog, Sentry, Better Stack, Datadog, Loki, ClickHouse, fs, memory)
  src/enrichers/           Built-in enrichers (UserAgent, Geo, RequestSize, TraceContext)
  src/runtime/             Runtime code (client/, server/, utils/)
  src/<framework>/         One dir per framework integration (hono/, next/, sveltekit/, nestjs/, express/, fastify/, elysia/, orpc/, react-router/, workers/, eve/, better-auth/)
  test/                    Tests
packages/cli/              @evlog/cli — log exploration CLI (`pnpm cli`)
packages/nuxthub/          @evlog/nuxthub
packages/telemetry/        @evlog/telemetry
apps/playground/           Main dev environment (`pnpm dev`)
apps/docs/                 Docus documentation site — has its own AGENTS.md
apps/*                     Framework playgrounds (next, nitro, nitro-v2, nuxthub, lab, telemetry, ...) — `pnpm playground` to pick one
examples/                  ~20 runnable examples, one per framework, plus the community-*-skeleton dirs used by the create-adapter/enricher/framework skills
scripts/                   Repo tooling (run-app, cli-sandbox, release-notes, content-lint)
.agents/skills/            Internal skills for creating adapters, enrichers, and framework integrations, and for writing content — each carries `metadata: internal: true` in its frontmatter so the skills CLI skips them for public installs
skills/                     Published skills (analyze-logs, build-audit-logs, review-logging-patterns) — served by the docs site via `/.well-known/skills/` and discovered by `npx skills add evloghq/evlog`
```

## Conventions

- All code in TypeScript. Follow existing patterns in `packages/evlog/src/`.
- JSDoc on all public APIs.
- No HTML comments (`<!-- -->`) in Vue templates.
- `README.md` at root is a **symlink** to `packages/evlog/README.md`. Edit the source directly.
- `evlog/toolkit` is the public entrypoint for `src/shared/`. Never use `evlog/shared`.
- `evlog/browser` is deprecated, use `evlog/http` instead.
- Every framework integration exposes the **same contract**: `evlog()` middleware, `useLogger()`, `log.fork()`, and the full `BaseEvlogOptions` surface. Framework-native accessors (`c.get('log')`, `req.log`, `event.locals.log`, `context.get(loggerContext)`) stay alongside it. They are the idiomatic path inside handlers, `useLogger()` is for the layers underneath. When adding an integration, provide both.
- `useLogger()` is backed by `AsyncLocalStorage`. On Cloudflare Workers that needs the `nodejs_compat` / `nodejs_als` flag, so `evlog/workers` deliberately has no `useLogger()` and passes the logger as the handler's fourth argument instead.
- New export? Update `packages/evlog/package.json` exports, its `typesVersions`, and `packages/evlog/tsdown.config.ts`. A subpath missing from `typesVersions` resolves at runtime and fails to type-check.
- Creating a new adapter, enricher, or framework integration? Read the matching skill at `.agents/skills/` **before starting**:
  - `.agents/skills/create-adapter/SKILL.md`
  - `.agents/skills/create-enricher/SKILL.md`
  - `.agents/skills/create-framework-integration/SKILL.md`
  - `.agents/skills/create-map-rule/SKILL.md` (also covers new `evlog map` framework adapters)
- Writing or reviewing prose, a docs page, the landing, a blog post, a package README, a skill, an AGENTS.md, a changeset? Read `.agents/skills/write-evlog-content/SKILL.md` first, and run `pnpm content:lint <path>` before the review. It carries the voice, the atomic rules, the terminology, the competitor dossiers, and the AI-tell corpus with the legitimate twin for each tell. These files are content too: `pnpm content:lint --surface skill` and `--surface agents` rank them.
- **Skills must stay in sync with the code.** There are two sets: internal skills in `.agents/skills/` and published skills in `skills/` at the repo root (served from the docs site via `.well-known/skills`, and discovered by a bare `npx skills add evloghq/evlog`). When a change touches something a skill documents (an adapter, enricher, integration, API surface, or workflow), update the affected SKILL.md (and its `references/`) in the same PR. A skill that describes the old behavior is worse than no skill.

### Code style: no slop

- **No gratuitous defensive code.** Don't add try/catch, null checks, or input validation the surrounding file doesn't have, especially on paths already validated upstream. Match the file's level of paranoia.
- **No silent fallbacks.** No empty `catch`, no `?? default` that masks a bug, no `as any` to silence TypeScript. If something can fail, let it fail loudly or handle it explicitly.
- **Comments are rare and earn their place.** Only for constraints the code can't express (a protocol quirk, a deliberate perf trade-off). Never paraphrase the code, never narrate a change. When in doubt: no comment.
- **A comment states a durable constraint, not the moment you wrote it.** One or two lines. No issue ids, no measurements, no before/after story, no "I found that…". That belongs in the PR body, the changeset, or a doc. Code outlives the task that produced it; a paragraph pinned to last Tuesday's investigation reads as noise six months later and nobody dares delete it.
- **This extends to all prose**: test names, error/log messages, changeset descriptions, PR bodies. Factual and plain, no emoji, no superlatives, no filler.
- **No speculative code.** No unrequested options or parameters, no "just in case" branches, no keeping the old code path alongside the new one. Delete dead code; public API deprecations are a maintainer decision. Ask first.
- **Prefer deleting and simplifying over working around.** If the fix needs a workaround, question the design before adding the workaround.

### Changesets

**Every user-facing change must include a changeset.** Before opening a PR for features, bug fixes, or breaking changes, run `pnpm changeset` and commit the generated `.changeset/*.md` file alongside the code.

- **When to add a changeset:** any change that affects the public API, adds a feature, fixes a bug, or introduces a breaking change. If a consumer of evlog would notice the difference, it needs a changeset.
- **When you can skip:** internal-only changes (CI config, docs typos, test refactors, devDeps bumps) that don't touch the published package.
- **Bump type:** `patch` for fixes, `minor` for features, `major` for breaking changes.
- **Description:** write from the consumer's perspective: what changed and how to use it. See existing changesets in `.changeset/` for tone and level of detail.

A PR without a changeset for a user-facing change will not be merged. Changes confined to `apps/*` or `examples/*`, docs included, never need one. For the rare published-package change that genuinely needs no release note, run `pnpm changeset add --empty`.

### Commits & PR titles

PR titles and commits follow [Conventional Commits](https://conventionalcommits.org). The CI source of truth is `.github/workflows/semantic-pull-request.yml` (lints PR titles via `amannn/action-semantic-pull-request`); `.github/pull_request_template.md` mirrors the same lists for contributors.

- **Subject must not start with an uppercase letter.** `feat: add stream server` ✓. `feat: Add stream server` ✗.
- **Omit the scope when the change is cross-cutting** (touches multiple subsystems, or is repo-wide). Don't use `evlog` as a scope: the whole monorepo *is* evlog, so a no-scope title already means "evlog itself".
- **Use a scope only to point at one subsystem.** Adapters get their own scope (one per entrypoint, e.g. `axiom`, `datadog`, `fs`); framework integrations get the framework's name (`nuxt`, `next`, `hono`, ...); core internals (logger, pipeline, error, redact, catalog) go under `core`.
- **When you add a new subsystem** (adapter, integration, top-level entrypoint), add its scope to **both** the workflow and the template. Keep both lists alphabetically sorted. Because title validation reads the base branch's scope list, either register the scope in a preceding PR or omit the scope from the subsystem PR title.

### Docs app

Working in `apps/docs/`? Read `apps/docs/AGENTS.md` first. It has the (strict) rules for MDC animation components.

## Testing

Tests live in `packages/evlog/test/` (mirrors `src/`) and use Vitest. **Read `packages/evlog/test/README.md` before writing or editing tests**. It has the file layout, the framework runtime fidelity matrix, and the helper decision table.

```bash
pnpm run test                                          # full suite (~1.5s)
pnpm --filter evlog exec vitest run test/path/to/file  # single test file
pnpm test:coverage                                     # with thresholds; :open for HTML
pnpm api:snapshot                                      # diff public API surface; :update to accept
pnpm mutate                                            # Stryker (slow; weekly cron in CI)
pnpm test:e2e                                          # adapters vs real endpoints (needs pnpm sandbox:up first — Docker Loki/ClickHouse; sandbox:down to clean up)
```

> CI typecheck excludes `evlog-telemetry` (`--filter='!evlog-telemetry'`), so local `pnpm run typecheck` is stricter than CI, and a local pass is the real bar.

Rules:
1. Every change has a matching test. Bug fixes require a *failing* regression test before the fix.
2. Always import real source helpers, never re-implement them in tests.
3. Use the helpers in `test/helpers/` (drain spies, fake timers, fetch mock, framework matrix). The full decision table is in `test/README.md`.
4. Framework tests must use the framework's real request driver (supertest, `app.inject`, `app.handle`, `Test.createTestingModule`, ...), see the fidelity matrix in `test/README.md`.

## Definition of Done

A task is complete when **all** of the following pass:

1. `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` exit 0
2. The change has a matching test (bug fix → failing regression first, then the fix)
3. `pnpm test:coverage` stays above the configured thresholds; if you changed a public export, the `pnpm api:snapshot` diff was reviewed
4. New public APIs have JSDoc
5. New exports are registered in `package.json#exports`, `package.json#typesVersions`, and `tsdown.config.ts`
6. If adapter/enricher/integration: the matching `.agents/skills/create-*/SKILL.md` was followed
7. Any skill (internal `.agents/skills/` or published `skills/`) documenting the changed behavior was updated in the same PR
8. A changeset is included for any user-facing change (`pnpm changeset`)

## Boundaries

**Always do:**
- Run lint, typecheck, and test before reporting done
- Follow existing code patterns: read neighboring files before writing new ones
- Use the skills at `.agents/skills/` for new adapters, enrichers, or integrations
- Add a changeset (`pnpm changeset`) for every user-facing change: features, bug fixes, breaking changes

**Ask first:**
- Adding new dependencies: note `pnpm-workspace.yaml` sets `minimumReleaseAge: 2880`: a package published less than 48h ago fails to install unless added to `minimumReleaseAgeExclude`
- Changing package exports or build config
- Architectural decisions that affect multiple packages

**Never:**
- Commit secrets, `.env` files, or API keys
- Skip tests or lint to "fix later"
- Loosen an assertion, widen a type, or delete a test to make it pass: a failing test is a signal; fix the cause
- Ship a feature, bug fix, or refactor without a matching test
- Add HTML comments in Vue `<template>` blocks
- Modify `node_modules/` or generated files
- Open a PR for a user-facing change without a changeset

## Git & PRs: local always OK, remote on explicit instruction

Default: anything that stays on the local clone is fine, anything that touches the remote or GitHub requires an explicit instruction in the task at hand. Never act on assumption. If the maintainer didn't ask for a push or a PR, prepare the branch locally and stop there.

**OK (local-only, no ask needed):**
- `git branch`, `git checkout`, `git switch`, `git checkout -b`: create and move between branches freely
- `git add`, `git commit`: staging and local commits are fine
- `git status`, `git diff`, `git log`, `git show`, `git stash`, `git restore`, `git reset` (local only): read and rearrange the working tree
- `gh pr view`, `gh pr list`, `gh pr diff`, `gh issue view`, `gh run view`: read-only GitHub queries

**OK when the maintainer explicitly asks (in the current task):**
- `git push -u origin <feature-branch>`: push a feature branch you just prepared
- `git push --force-with-lease origin <feature-branch>`: only on a feature branch you authored, after a clean rebase
- `gh pr create --base main --head <feature-branch>`: open a PR
- Write a **PR title** (Conventional Commits, see above) and a **PR body**: keep the body factual, mirror the changeset, reference the issue (`Closes #X`); no marketing copy

**Never (no exceptions, even when asked):**
- Push directly to `main` (or `master`): protected, always goes through a PR
- `git push --force` without `--with-lease`, `git push --tags`
- `gh pr merge`, `gh pr close`, `gh pr review`, `gh issue create`, `gh issue edit`, `gh release create`
- Write a changelog entry, release note, or commit message **body** with multi-paragraph narrative. The changeset is the source of truth; commit subjects stay single-line, PR bodies stay short
- Add a `Co-authored-by`, `Signed-off-by`, "Generated with…", "🤖", or any signature/attribution that names an agent, model, or tool: **the work is the maintainer's, full stop**

## When Stuck
- Unsure about architecture → read the relevant SKILL.md or ask
- Unclear requirements → ask a clarifying question before making large speculative changes

## Feedback & Self-Maintenance

**You are expected to submit feedback.** Report DX friction, documentation gaps, or anything that made your task harder than it should be, mid-work rather than at the end. When in doubt, report it; no feedback being submitted is itself a problem.

**This file is living documentation, so keep it true.** If you catch it contradicting the repo (a command that doesn't exist, a path that moved, a described workflow that isn't real), flag it immediately and propose the fix, even if it's unrelated to your task. Update it when you encounter:
- A recurring mistake or easy-to-get-wrong pattern
- Explicit guidance from the maintainer
- A new convention that should be applied consistently

Rules for updating: a correction is a few lines, not a rewrite. Keep this file lean. App- or package-specific guidance goes in a nested `AGENTS.md` next to the code (see `apps/docs/AGENTS.md`), not here.
