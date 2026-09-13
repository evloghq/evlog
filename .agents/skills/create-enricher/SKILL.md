---
name: create-evlog-enricher
description: Create a new built-in evlog enricher to add derived context to wide events. Use when adding a new enricher (e.g., for deployment metadata, tenant context, feature flags, etc.) to the evlog package. Covers source code, tests, and all documentation.
metadata:
  internal: true
---

# Create evlog Enricher

Add a new built-in enricher to evlog. Every enricher is built on the public toolkit primitive `defineEnricher` from `evlog/toolkit`, so a community enricher has the same shape as a built-in one.

## PR Title

```
feat(core): add the {name} enricher
```

Enrichers live in the core package surface (`evlog/enrichers`), so use the `core` scope unless a dedicated scope exists.

## Touchpoints Checklist

| # | File | Action |
|---|------|--------|
| 1 | `packages/evlog/src/enrichers/index.ts` | Add enricher source (one `defineEnricher` call) |
| 2 | Same file — `createDefaultEnrichers()` | Decide whether the enricher belongs in the default composition (see below) |
| 3 | `packages/evlog/test/toolkit/enrichers.test.ts` | Add tests (one `describe` block per enricher) |
| 4 | `apps/docs/content/5.use-cases/5.enrichers.md` | Add a section for the enricher + update the import list and, if applicable, the "All built-in enrichers" default composition text |
| 5 | `skills/review-logging-patterns/SKILL.md` | Add the enricher to the `Built-in:` line in the Enrichers section |
| 6 | `packages/evlog/README.md` | Add the enricher to the Built-in Enrichers section (root `README.md` is a symlink to it) |
| 7 | `.changeset/{name}-enricher.md` | Create changeset (`minor`) |

**Important**: Do NOT consider the task complete until all 7 touchpoints have been addressed.

### Should it join `createDefaultEnrichers()`?

`createDefaultEnrichers()` composes user agent, geo, request size, and trace context via `composeEnrichers` (from `../shared/compose`). Add the new enricher to the composition only if it is universally applicable and reads nothing but the request (headers/env). Anything requiring service-specific setup or extra cost stays opt-in. Changing the default composition is a behavior change for every existing `createDefaultEnrichers()` user: call it out explicitly in the changeset.

## Naming Conventions

| Placeholder | Example (UserAgent) | Usage |
|-------------|---------------------|-------|
| `{name}` | `userAgent` | camelCase for event field key |
| `{Name}` | `UserAgent` | PascalCase in function/interface names |
| `{DISPLAY}` | `User Agent` | Human-readable display name |

## Step 1: Enricher Source: built on `defineEnricher`

Add the enricher to `packages/evlog/src/enrichers/index.ts`. Read [references/enricher-template.md](references/enricher-template.md) for the full annotated template.

The contract is `defineEnricher<T>({ name, field, compute }, options?)`. You only ship one piece of logic:

- **`compute(ctx)`**: return the computed value (typed as `T`) or `undefined` to skip.

`defineEnricher` handles the rest:

- merging via `mergeEventField` (respecting `options.overwrite`, default `false`)
- error isolation (throws are caught and logged, never propagated)
- skipping when `compute` returns `undefined`

Key rules:

- **Use the toolkit helpers**: `getHeader()` for case-insensitive header lookup, `normalizeNumber()` for numeric strings. Both from `../shared/headers` (re-exported by `evlog/toolkit`).
- **Single event field**: each enricher writes one top-level field on `ctx.event`. If the enricher must additionally pin top-level fields (like `createTraceContextEnricher` does for `event.traceId` / `event.spanId`), wrap the `defineEnricher` result in a closure, see that enricher for the pattern.
- **Factory pattern**: `create{Name}Enricher(options: EnricherOptions = {})` returns the result of `defineEnricher(...)`, directly in the normal case, or through the thin closure wrapper when the enricher also pins top-level fields (see the single-event-field rule above).
- **No side effects**: never throw, never log; rely on `defineEnricher`'s built-in error handling if something goes wrong.
- **Export the Info type**: `{Name}Info` describing the field shape, exported alongside the factory.

## Step 2: Tests

Add tests to `packages/evlog/test/toolkit/enrichers.test.ts`, following the existing structure (one `describe` block per enricher) and `packages/evlog/test/README.md` conventions.

Required test categories:

1. **Sets the field from its source**: verify the enricher populates the event field correctly, reading whatever it actually reads (`ctx.request`, `ctx.response`, `process.env`, `ctx.event`, or headers)
2. **Skips when source data missing**: verify no field is set when the required input is absent
3. **Preserves existing data**: verify `overwrite: false` (default) doesn't replace user-provided fields
4. **Overwrites when requested**: verify `overwrite: true` replaces existing fields
5. **Handles edge cases**: empty strings and malformed values, plus case-insensitive lookup for a header-based enricher
6. **Default composition**: if the enricher joined `createDefaultEnrichers()`, extend that composition's tests

## Step 3: Update the Enrichers Docs Page

Edit `apps/docs/content/5.use-cases/5.enrichers.md`:

1. Add the enricher to the import list at the top
2. Add a `## {DISPLAY}` section following the structure of the existing ones:

```markdown
## {DISPLAY}

[One-sentence description of what the enricher does.]

**Sets:** `event.{name}`

\`\`\`typescript
const enrich = create{Name}Enricher()
\`\`\`

**Output shape:**

\`\`\`typescript
interface {Name}Info {
  // fields
}
\`\`\`

**Example output:**

\`\`\`json
{
  "{name}": {
    // example values
  }
}
\`\`\`
```

3. If the enricher joined the default composition, update the "All built-in enrichers" section text listing what `createDefaultEnrichers()` composes.

Custom-enricher authoring docs live separately at `apps/docs/content/7.extend/5.custom-enrichers.md`, with no change needed there unless the toolkit contract itself changed.

## Step 4: Update the Public Skill

In `skills/review-logging-patterns/SKILL.md` (published on evlog.dev), find the **Enrichers** section and add the new enricher to the `Built-in:` line.

## Step 5: Update README

Add the enricher to the **Built-in Enrichers** section in `packages/evlog/README.md` (the root `README.md` is a symlink to it).

## Step 6: Changeset

Create `.changeset/{name}-enricher.md` with a `minor` bump describing what the enricher sets and when to use it. Mention explicitly if the default composition changed.

## Verification

```bash
cd packages/evlog
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```
