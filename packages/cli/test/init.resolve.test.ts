import { describe, expect, it } from 'vitest'
import { createContext } from '../src/core/context'
import { availableExtras, DESTINATIONS, EXTRAS, findDestination } from '../src/lib/init/catalog'
import type { DrainId } from '../src/lib/init/catalog'
import { canPrompt } from '../src/lib/init/prompts'
import { droppedExtras, parseDrainArg, parseExtrasArg, parseProdDrainsArg, resolveAnswers } from '../src/lib/init/resolve'
import type { Framework } from '../src/lib/frameworks'

describe('parseDrainArg', () => {
  it('accepts every id the catalog advertises', () => {
    for (const destination of DESTINATIONS) {
      expect(parseDrainArg(destination.id)).toBe(destination.id)
    }
  })

  it('refuses an unknown destination instead of falling back', () => {
    /* Defaulting would wire local files into an app whose author asked for
       Axiom, and they would find out when production told them nothing. */
    expect(() => parseDrainArg('axium')).toThrow(/Unknown --drain "axium"/)
  })

  it('lists the known ids in the message so the fix is in the error', () => {
    expect(() => parseDrainArg('nope')).toThrow(/axiom/)
  })

  it('treats an absent flag as no opinion', () => {
    expect(parseDrainArg(undefined)).toBeUndefined()
    expect(parseDrainArg('')).toBeUndefined()
  })
})

describe('parseProdDrainsArg', () => {
  it('refuses the filesystem sink for production', () => {
    /* The one rule that stops a per-box file sink being wired into production,
       where nobody would ever read it. */
    expect(() => parseProdDrainsArg('fs')).toThrow(/Unknown --drain "fs"/)
    expect(() => parseProdDrainsArg('none')).toThrow(/Unknown --drain "none"/)
  })

  it('accepts several hosted destinations at once', () => {
    expect(parseProdDrainsArg('axiom, sentry ,axiom')).toEqual(['axiom', 'sentry'])
  })
})

describe('parseExtrasArg', () => {
  it('reads a comma-separated list and drops duplicates', () => {
    expect(parseExtrasArg('enrichers, sampling ,enrichers')).toEqual(['enrichers', 'sampling'])
  })

  it('refuses an unknown extra', () => {
    expect(() => parseExtrasArg('enrichers,telemetry')).toThrow(/Unknown --extras entry "telemetry"/)
  })
})

describe('resolveAnswers', () => {
  /* No scan ran, so evidence-gated offers are unavailable — which is exactly
     what a caller passing flags against an unreadable project gets. */
  const offers = (prodDrains: DrainId[], framework: Framework) => ({
    framework,
    prodDrains,
    facts: null,
    auditGaps: 0,
  })

  const base = {
    framework: 'nuxt' as const,
    defaultService: 'shop',
    evlogInstalled: false,
    install: true,
    agentGuide: false,
    offers,
  }

  it('defaults to the local sink, nothing in production, no extras', () => {
    expect(resolveAnswers(base)).toEqual({
      framework: 'nuxt',
      service: 'shop',
      devDrain: 'fs',
      prodDrains: [],
      extras: [],
      enrichers: [],
      sampling: 'all',
      agentGuide: false,
      install: true,
    })
  })

  it('never installs when evlog is already resolvable', () => {
    expect(resolveAnswers({ ...base, evlogInstalled: true }).install).toBe(false)
  })

  it('drops an extra the framework cannot use rather than failing the run', () => {
    /* `--extras vite,enrichers` across a monorepo of mixed frameworks should
       wire what fits each app instead of failing on the one that does not. */
    const input = { ...base, extras: ['vite' as const, 'enrichers' as const] }

    expect(resolveAnswers(input).extras).toEqual(['enrichers'])
    expect(droppedExtras(input)).toEqual(['vite'])
  })

  it('turns every enricher on when the extra is selected without a list', () => {
    const answers = resolveAnswers({ ...base, extras: ['enrichers'] })

    expect(answers.enrichers).toEqual(['user-agent', 'geo', 'request-size', 'trace-context'])
  })

  it('defaults sampling to the medium tier only when the extra is selected', () => {
    expect(resolveAnswers({ ...base, extras: ['sampling'] }).sampling).toBe('medium')
    expect(resolveAnswers(base).sampling).toBe('all')
  })

  it('hides batching until something actually leaves the process', () => {
    const local = { ...base, extras: ['pipeline' as const] }
    expect(resolveAnswers(local).extras).toEqual([])

    const hosted = { ...base, prodDrains: ['axiom' as const], extras: ['pipeline' as const] }
    expect(resolveAnswers(hosted).extras).toEqual(['pipeline'])
  })
})

describe('the catalog', () => {
  it('gives every destination a factory and specifier, or neither', () => {
    for (const destination of DESTINATIONS) {
      expect(Boolean(destination.specifier)).toBe(Boolean(destination.factory))
    }
  })

  it('marks only the filesystem drain as unsafe for production', () => {
    const unsafe = DESTINATIONS.filter(destination => !destination.productionSafe)
    expect(unsafe.map(destination => destination.id)).toEqual(['fs'])
  })

  it('keeps every extra reachable from at least one framework', () => {
    /* Full evidence: every gate satisfied, so anything still missing is an
       extra no project could ever be offered. */
    const facts = {
      dependencies: new Set(['ai', 'better-auth']),
      features: new Set<never>(),
      pairable: new Set(['ai', 'better-auth'] as const),
      catalogs: [],
      evlogBarrels: new Map(),
      repeatedErrors: new Map([['status=402', { label: '402', files: ['a.ts', 'b.ts'] }]]),
    }

    for (const extra of EXTRAS) {
      const reachable = (['nuxt', 'nitro', 'next', 'tanstack-start'] as const).some(framework =>
        availableExtras({ framework, prodDrains: ['axiom'], facts: facts as never, auditGaps: 2 }).includes(extra))
      expect(reachable, `${extra.id} is offered nowhere`).toBe(true)
    }
  })

  it('points every destination at a docs path', () => {
    for (const destination of DESTINATIONS) {
      expect(destination.docs.startsWith('/'), destination.id).toBe(true)
    }
    expect(findDestination('axiom')?.env.map(v => v.name)).toEqual(['AXIOM_DATASET', 'AXIOM_API_KEY'])
  })
})

describe('canPrompt', () => {
  /* The context owns the terminal state, so a case says what it means instead
     of patching `process` and hoping the runner agrees. */
  const ctx = (overrides: Partial<Parameters<typeof createContext>[0]> = {}) =>
    createContext({
      cwd: '/tmp',
      env: {},
      nodeVersion: 'v22.0.0',
      tty: true,
      stdinTty: true,
      color: false,
      columns: 80,
      ...overrides,
    })

  it('prompts on a terminal with nothing saying otherwise', () => {
    expect(canPrompt(ctx())).toBe(true)
  })

  it('refuses under CI even on a terminal', () => {
    /* An agent or a workflow runner must never end up waiting on a keystroke
       that is not coming. */
    expect(canPrompt(ctx({ env: { CI: 'true' } }))).toBe(false)
    expect(canPrompt(ctx({ env: { CI: '1' } }))).toBe(false)
  })

  it('ignores a CI variable that says it is off', () => {
    expect(canPrompt(ctx({ env: { CI: 'false' } }))).toBe(true)
    expect(canPrompt(ctx({ env: { CI: '0' } }))).toBe(true)
  })

  it('refuses when stdin is piped, however good the output side looks', () => {
    expect(canPrompt(ctx({ stdinTty: false }))).toBe(false)
  })

  it('refuses when there is nowhere to draw', () => {
    expect(canPrompt(ctx({ tty: false }))).toBe(false)
  })
})
