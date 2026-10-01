# Enricher Source Template

Template for adding a new enricher to `packages/evlog/src/enrichers/index.ts` using `defineEnricher`.

Replace `{Name}`, `{name}`, and `{DISPLAY}` with the actual enricher name.

## Info Interface

Define the output shape:

```typescript
export interface {Name}Info {
  /** Description of field */
  field1?: string
  /** Description of field */
  field2?: number
}
```

## Factory Function

```typescript
import type { EnrichContext } from '../types'
import { defineEnricher, type EnricherOptions } from '../shared/enricher'
import { getHeader, normalizeNumber } from '../shared/headers'

/**
 * Enrich events with {DISPLAY} data.
 * Sets `event.{name}` with `{Name}Info` shape: `{ field1?, field2? }`.
 */
export function create{Name}Enricher(options: EnricherOptions = {}): (ctx: EnrichContext) => void {
  return defineEnricher<{Name}Info>({
    name: '{name}',
    field: '{name}',
    compute: ({ headers }) => {
      const value = getHeader(headers, 'x-my-header')
      if (!value) return undefined
      return {
        field1: value,
        field2: normalizeNumber(value),
      }
    },
  }, options)
}
```

## Architecture Rules

1. **Use the toolkit primitive**: `defineEnricher<T>({ name, field, compute }, options)` from `../shared/enricher` (re-exported as `evlog/toolkit`).
2. **Use the toolkit helpers**: `getHeader()` for case-insensitive header lookup and `normalizeNumber()` for numeric strings. Both come from `../shared/headers`.
3. **Single event field**: each enricher writes one top-level field on `ctx.event` (declared via the `field` option).
4. **Return `undefined` to skip**: `compute` returning `undefined` makes the enricher a no-op for that event (no field merge, no errors).
5. **Factory pattern**: always wrap `defineEnricher` in a `create{Name}Enricher(options?)` factory and return its result (directly, or through the closure wrapper of rule 7 when pinning top-level fields).
6. **No try/catch**: `defineEnricher` already isolates errors (logs as `[evlog/{name}] enrich failed:` and never throws to the pipeline).
7. **No mutation outside `compute`**: let `defineEnricher` handle the merge via `mergeEventField`. The one sanctioned exception: pinning top-level fields in addition to the enricher's own field, done by wrapping the `defineEnricher` result in a closure (see `createTraceContextEnricher`, which also sets `event.traceId` / `event.parentSpanId`).
8. **Composition**: to combine several enrichers into one callback, use `composeEnrichers` from `../shared/compose` (that's how `createDefaultEnrichers()` is built) instead of a manual loop.

## Available Helpers

These helpers are exported from `../shared/headers` (and from `evlog/toolkit`):

```typescript
// Case-insensitive header lookup
function getHeader(headers: Record<string, string> | undefined, name: string): string | undefined

// Parse string to number, returning undefined for non-finite values
function normalizeNumber(value: string | undefined): number | undefined
```

For lower-level merging (rarely needed) the toolkit also exports `mergeEventField` from `../shared/event`.

## Data Sources

Enrichers typically read from `ctx`:

- **`ctx.headers`**: HTTP request headers (sensitive headers already filtered)
- **`ctx.response?.headers`**: HTTP response headers
- **`ctx.response?.status`**: HTTP response status code
- **`ctx.request`**: Request metadata (method, path, requestId)
- **`process.env`**: Environment variables (for deployment metadata)
- **`ctx.event`**: The event itself (for computed/derived fields)
