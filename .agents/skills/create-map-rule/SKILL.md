---
name: create-evlog-map-rule
description: Add a new rule or a new framework adapter to `evlog map` in @evlog/cli. Use when adding a coverage check (requirement or opportunity) that scores entry points, or when extending the map scanner to a new framework. Covers rule source, registry, types, tests, docs, and the published skill.
metadata:
  internal: true
---

# Create an `evlog map` Rule (or Framework Adapter)

Extend the coverage scanner in `@evlog/cli`. Two kinds of extension:

- **A rule**: a new question asked of every entry point (`packages/cli/src/lib/map/rules/`). This is the common case.
- **A framework adapter**: teach `evlog map` to find entry points in a new framework (`packages/cli/src/lib/map/adapters/`). Rarer and heavier; see the last section.

## PR Title

```
feat(cli): add the {id} map rule
```

The `cli` scope already exists, so no scope registration is needed.

## Requirement or opportunity? Decide first

This is the design decision everything else follows from (see `apps/docs/content/3.cli/3.rules.md` for the published contract):

| | Requirement | Opportunity |
|---|---|---|
| Effect on the score | Costs `weight` points when it fails | None, ever. The type forbids a weight |
| When it appears | Whenever it applies | Only when the project **already uses** the feature (`appliesTo.when` gated on `project.features` / `project.pairable`) |
| In the report | `FIX FIRST` / `THEN` | `GOING FURTHER` |
| Can fail a CI gate (`--min-score`, `--baseline`) | Yes | No |

Guiding principle (from `error-catalog.ts`): a rule that fires on perfectly good code is policing, not helping. Opportunities must be gated on a signal that makes the case on its own (duplication, an installed package used without its evlog integration), never on "you could adopt a feature you don't use".

Current requirements: `wide-event` (40), `audit` (25), `structured-errors` (20), `page-error-handling` (20), `context` (15), `error-handling` (15). Current opportunities: `error-catalog`, `audit-coverage`, `ai-logging`, `auth-identity`.

## Touchpoints Checklist (rule)

| # | File | Action |
|---|------|--------|
| 1 | `packages/cli/src/lib/map/rules/{id}.ts` | Create the rule (one exported const) |
| 2 | `packages/cli/src/lib/map/rules/index.ts` | Import + one line in `REGISTRY` |
| 3 | `packages/cli/src/lib/map/types.ts` | Add the id to the `CheckId` union (a type assert in `index.ts` fails the build if the registry and union drift) |
| 4 | `packages/cli/test/map/rules.test.ts` | Add cases (the file has an ESLint-`RuleTester`-style `Case` harness (`runRuleSet` exercises one rule in isolation)) |
| 5 | `apps/docs/content/3.cli/3.rules.md` | Add a row to the Requirements or Opportunities table + a `### {title}` section |
| 6 | `apps/docs/content/3.cli/4.scoring.md` | Requirements only: reflect the new weight in the scoring explanation |
| 7 | `skills/review-logging-patterns/references/code-review.md` | Add a row to the matching rules table |
| 8 | `.changeset/{id}-map-rule.md` | Changeset for `"@evlog/cli": minor` |

**Important**: Do NOT consider the task complete until all applicable touchpoints have been addressed.

## Step 1: Rule Source

One file, one exported const satisfying `MapRule` (from `rules/types.ts`; requirements and opportunities are its two variants):

```typescript
export const {camelId}Rule = {
  id: '{id}',                    // kebab-case, matches CheckId
  category: 'requirement',       // or 'opportunity'
  title: '{col}',                // column header in --all, ~8 chars max
  expects: '{concrete thing}',   // e.g. 'log.audit()'
  question: 'Does this entry point …?',  // one sentence, shown by --inspect
  weight: 15,                    // requirements only — opportunities cannot have one
  docs: '/learn/…',              // docs path, no domain
  fixSlot: 'body',               // where suggest() lands: 'setup' | 'body' | … (default 'body')
  appliesTo: {
    kinds: HANDLER_KINDS,        // or a subset: 'api' | 'server-action' | 'middleware' | 'cron' | 'page'
    // frameworks: ['next'],     // optional framework gate
    when: ({ project, facts }) => /* opportunity gate — cheap, declarative */,
  },
  suggest({ project, target }) {
    // Code suggestion for `evlog map <file>`, aware of what the project already
    // has (project.catalogs, project.features…). Return lines of code.
    return ['const log = useLogger(event)']
  },
  create(context) {
    return {
      // Prefer onEnd + FileFacts — the shared AST pass already answers most
      // questions. Node-type listeners are the escape hatch.
      onEnd() {
        if (/* gap found */) context.report({ message: '…', line, snippet: true })
      },
    }
  },
} satisfies MapRule
```

Key rules:

- **Reporting nothing means the rule passed.** `context.report()` only for gaps.
- **Read `FileFacts` first** (`../facts.ts`). If the answer isn't there, consider extending the facts rather than writing AST listeners; facts are computed once per file for all rules.
- **`project` (`ProjectFacts`) is the gate for opportunities**: `project.features` (evlog features in use), `project.pairable` (installed packages evlog integrates with), `project.catalogs` (for naming things in suggestions).
- **Messages are report copy.** Concrete, lowercase, pointing at the evidence (`"X is spelled out here and in 2 other files, and one catalog entry would cover them"`). No exclamation marks, no advice-column tone.
- **Weights are a scoring decision**: look at `score.ts` and the existing spread (40 down to 15) and discuss the number in the PR rather than inventing precedent.
- Every rule id is also a suppression target (`evlog-map-disable {id}`) and part of the public `evlog.map.json` contract. Renaming later is a breaking change.

## Steps 2 and 3: Registry + CheckId

Add the import and one `REGISTRY` line in `rules/index.ts` (report order matters: requirements before opportunities, heaviest first), and the id to the `CheckId` union in `types.ts`. The `AssertIdsMatch` type in `index.ts` fails the build if you forget either side.

## Step 4: Tests

`packages/cli/test/map/rules.test.ts` has a declarative `Case` harness: source code in, expected check results out, with knobs for `kind`, `framework`, `path` (sensitivity), `hasEvlog`, `features`, `pairable`, `dependencies`, `catalogs`, `barrels`. Use `runRuleSet([yourRule], run)` to exercise the rule in isolation.

Cover at minimum:

1. The gap fires (with the message and line you expect)
2. The compliant version passes
3. The `n/a` boundaries: wrong `kind`, gated `when` returning false, `hasEvlog: false` phrasing if the rule branches on it
4. Opportunity gating. Does NOT fire when the project doesn't use the feature
5. `suggest()` output when it adapts to the project (e.g. names an existing catalog)
6. Suppression (`evlog-map-disable {id}`) behaves like the other rules. Usually free via the shared harness

Run: `pnpm --filter @evlog/cli exec vitest run test/map/rules.test.ts`

## Step 5 and 6: Docs

Read `apps/docs/AGENTS.md` before touching anything under `apps/docs/`. Then in `apps/docs/content/3.cli/3.rules.md`: add the row (column title, id, weight/fires-when, expects) and a `### {title} — {question}` section following the existing ones, covering what it checks, what passes, what fails, the suggested shape. Requirements with a weight also touch the scoring narrative in `4.scoring.md`.

## Step 7: Published Skill

`skills/review-logging-patterns/references/code-review.md` mirrors the rules tables (requirements + opportunities) and maps each rule to a skill section. Add the row and, if the rule promotes a feature the skill documents elsewhere, link the section.

## Step 8: Changeset

`.changeset/{id}-map-rule.md` with `"@evlog/cli": minor`, written from the user's perspective: what the rule checks, when it fires, whether it moves the score.

## Verification

```bash
pnpm --filter @evlog/cli run lint
pnpm --filter @evlog/cli run typecheck   # catches REGISTRY/CheckId drift
pnpm --filter @evlog/cli run test
```

Then sanity-check on a real project: `pnpm cli:sandbox` builds disposable, unevenly-instrumented apps under `.sandbox/` (one per supported framework, each a git repo), and prints the commands to run against them. `pnpm cli:sandbox --reset` rolls an app back to pristine after an `init` or `map` run; `--smoke` drives the whole non-interactive feature matrix and reports what broke.

---

## Variant: New Framework Adapter

Teaching `evlog map` a new framework is a different, heavier change: the adapter owns route discovery and framework capabilities.

| # | File | Action |
|---|------|--------|
| 1 | `packages/cli/src/lib/map/adapters/{framework}.ts` | Route extraction: find entry points, classify `RouteKind`, declare `FrameworkCapabilities` (`requestLogger: 'ambient' \| 'explicit'`, `evlogAutoImports`) |
| 2 | `packages/cli/src/lib/map/adapters/index.ts` | Add the `getAdapter` switch case |
| 3 | `packages/cli/src/lib/map/types.ts` | Extend the `Framework` union |
| 4 | `packages/cli/src/lib/map/detect.ts` | Detect the framework from the project (`detectFramework`) |
| 5 | `packages/cli/test/map/adapters.test.ts` + `detect.test.ts` + `fixtures/` | Route extraction + detection tests against a fixture tree |
| 6 | `packages/cli/src/lib/init/` | Decide whether `evlog init` gains the framework too (a separate scope of work, so flag it explicitly in the PR if not) |
| 7 | `apps/docs/content/3.cli/2.map.md` + `0.overview.md` | Update the supported-frameworks statements |
| 8 | `skills/review-logging-patterns/SKILL.md` | Update every "Nuxt, Nitro, Next.js, and TanStack Start" list (frontmatter description + CLI section), same in `references/code-review.md` and `skills/build-audit-logs/SKILL.md` (Pass 2) and `analyze-logs/SKILL.md` (init suggestion) |
| 9 | `scripts/cli-sandbox.mjs` | Add the framework to `APPS` (reuse the map fixture) so `pnpm cli:sandbox` covers it and `--smoke` exercises every CLI command against it |
| 10 | `.changeset/{framework}-map-adapter.md` | Changeset for `"@evlog/cli": minor` |

Reference implementations: `adapters/nuxt.ts` (shared Nuxt/Nitro), `adapters/next.ts`, `adapters/tanstack-start.ts`.
