import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrainContext } from '../../src/types'
import { createAxiomDrain } from '../../src/adapters/axiom'
import { createOTLPDrain } from '../../src/adapters/otlp'
import { createPostHogDrain, createPostHogEventsDrain } from '../../src/adapters/posthog'
import { createBrowserDrain } from '../../src/browser'
import { defineEvlogHook, defineEvlogInstrumentation } from '../../src/eve'
import { applyDeprecatedAlias, createLoggerStorage } from '../../src/shared'
import { createLoggerStorage as createLoggerStorageFromStorageEntry } from '../../src/shared/storage'
import { warnDeprecated } from '../../src/shared/deprecate'
import { resetGlobalRegistry } from '../../src/shared/globalRegistry'
import { enableDeprecationWarnings } from '../helpers/deprecations'

describe('warnDeprecated', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    enableDeprecationWarnings()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetGlobalRegistry()
  })

  it('prints the message once per id', () => {
    warnDeprecated('test:once', '[evlog/test] first', 'browser-entry-removed')
    warnDeprecated('test:once', '[evlog/test] first', 'browser-entry-removed')
    warnDeprecated('test:other', '[evlog/test] second', 'browser-entry-removed')
    expect(warnSpy.mock.calls).toEqual([
      ['[evlog/test] first See https://www.evlog.dev/reference/migrate-v3#browser-entry-removed'],
      ['[evlog/test] second See https://www.evlog.dev/reference/migrate-v3#browser-entry-removed'],
    ])
  })

  it.each([
    ['NODE_ENV=production', () => vi.stubEnv('NODE_ENV', 'production')],
    ['NODE_ENV=test', () => vi.stubEnv('NODE_ENV', 'test')],
    ['VITEST', () => vi.stubEnv('VITEST', 'true')],
    ['JEST_WORKER_ID', () => vi.stubEnv('JEST_WORKER_ID', '1')],
    ['EVLOG_NO_DEPRECATION_WARNINGS=1', () => vi.stubEnv('EVLOG_NO_DEPRECATION_WARNINGS', '1')],
    ['EVLOG_NO_DEPRECATION_WARNINGS=true', () => vi.stubEnv('EVLOG_NO_DEPRECATION_WARNINGS', 'true')],
  ])('stays silent when %s is set', (_label, silence) => {
    silence()
    warnDeprecated('test:silent', '[evlog/test] silent', 'browser-entry-removed')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('ignores other values of EVLOG_NO_DEPRECATION_WARNINGS', () => {
    vi.stubEnv('EVLOG_NO_DEPRECATION_WARNINGS', 'yes')
    warnDeprecated('test:yes', '[evlog/test] yes', 'browser-entry-removed')
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('does not consume the id while silenced', () => {
    vi.stubEnv('NODE_ENV', 'production')
    warnDeprecated('test:later', '[evlog/test] later', 'browser-entry-removed')
    vi.stubEnv('NODE_ENV', 'development')
    warnDeprecated('test:later', '[evlog/test] later', 'browser-entry-removed')
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})

describe('deprecated entry points warn on call', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    enableDeprecationWarnings()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    delete process.env.AXIOM_TOKEN
    resetGlobalRegistry()
  })

  it('warns once for createPostHogEventsDrain()', () => {
    createPostHogEventsDrain({ apiKey: 'k' })
    createPostHogEventsDrain({ apiKey: 'k' })
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/posthog] createPostHogEventsDrain() is deprecated and removed in v3. Use createPostHogDrain({ mode: \'events\' }). See https://www.evlog.dev/reference/migrate-v3#posthog-events-drain-removed',
    )
  })

  it('warns once for the evlog/browser entry point', () => {
    createBrowserDrain({ endpoint: 'https://example.test/ingest' })
    createBrowserDrain({ endpoint: 'https://example.test/ingest' })
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog] \'evlog/browser\' is deprecated and removed in v3. Import from \'evlog/http\' instead (createBrowserDrain to createHttpDrain). See https://www.evlog.dev/reference/migrate-v3#browser-entry-removed',
    )
  })

  it('warns when the legacy AXIOM_TOKEN env var is set', () => {
    process.env.AXIOM_TOKEN = 'legacy-token'
    createAxiomDrain({ apiKey: 'k', dataset: 'logs' })
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/axiom] AXIOM_TOKEN is deprecated and ignored in v3. Rename it to AXIOM_API_KEY. See https://www.evlog.dev/reference/migrate-v3#credential-aliases-removed',
    )
  })

  it('warns when redactMessage is passed to defineEvlogHook()', () => {
    defineEvlogHook({ redactMessage: true })
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/eve] redactMessage is deprecated and removed in v3. Use message: \'omit\' (was true) or \'preview\' (was false). See https://www.evlog.dev/reference/migrate-v3#eve-moves-to-evlogeve',
    )
  })

  it('warns once for the evlog/eve entry, from either definition', () => {
    defineEvlogHook()
    defineEvlogInstrumentation()
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/eve] \'evlog/eve\' is removed in v3. Agents move to the evlog() extension from \'@evlog/eve\', which requires eve 1.0. See https://www.evlog.dev/reference/migrate-v3#eve-moves-to-evlogeve',
    )
  })

  it('warns for createLoggerStorage from evlog/toolkit, not from evlog/toolkit/storage', () => {
    createLoggerStorageFromStorageEntry('storage entry')
    expect(warnSpy).not.toHaveBeenCalled()

    const { useLogger } = createLoggerStorage('toolkit barrel')
    expect(useLogger).toBeTypeOf('function')
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/toolkit] createLoggerStorage() is removed from \'evlog/toolkit\' in v3. Import it from \'evlog/toolkit/storage\' instead. See https://www.evlog.dev/reference/migrate-v3#logger-storage-moved',
    )
  })

  it('warns for applyDeprecatedAlias from evlog/toolkit and still copies the field', () => {
    const config = applyDeprecatedAlias({ token: 'k' } as { token?: string, apiKey?: string }, { adapter: 'custom', from: 'token', to: 'apiKey' })
    expect(config.apiKey).toBe('k')
    expect(warnSpy.mock.calls[0]).toEqual(['[evlog/toolkit] applyDeprecatedAlias() is removed from \'evlog/toolkit\' in v3. Copy the deprecated field in your adapter\'s config resolver. See https://www.evlog.dev/reference/migrate-v3#credential-aliases-removed',])
  })
})

describe('default changes warn when the option is unset', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  const ctx: DrainContext = { event: { timestamp: '2026-11-19T00:00:00.000Z', level: 'info', service: 'api', environment: 'development' } }

  beforeEach(() => {
    enableDeprecationWarnings()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetGlobalRegistry()
  })

  it('names both OTLP options when neither is set', async () => {
    await createOTLPDrain({ endpoint: 'http://localhost:4318' })(ctx)
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/otlp] v3 changes the default of recordShape to \'compact\' and semanticConventions to true. Set recordShape: \'json\', semanticConventions: false to keep this output. See https://www.evlog.dev/reference/migrate-v3#compact-output-by-default',
    )
  })

  it('names only the OTLP option left unset', async () => {
    await createOTLPDrain({ endpoint: 'http://localhost:4318', recordShape: 'compact' })(ctx)
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/otlp] v3 changes the default of semanticConventions to true. Set semanticConventions: false to keep this output. See https://www.evlog.dev/reference/migrate-v3#compact-output-by-default',
    )
  })

  it('stays silent when both OTLP options are set', async () => {
    await createOTLPDrain({ endpoint: 'http://localhost:4318', recordShape: 'json', semanticConventions: false })(ctx)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it.each(['logs', 'events'] as const)('warns when the PostHog recordShape is unset in %s mode', async (mode) => {
    await createPostHogDrain({ apiKey: 'phc_test', mode })(ctx)
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/posthog] v3 changes the default of recordShape to \'compact\'. Set recordShape: \'json\' to keep this output. See https://www.evlog.dev/reference/migrate-v3#compact-output-by-default',
    )
  })

  it('stays silent when the PostHog recordShape is set', async () => {
    await createPostHogDrain({ apiKey: 'phc_test', recordShape: 'json' })(ctx)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('migration page links', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    delete process.env.AXIOM_TOKEN
    resetGlobalRegistry()
  })

  it('point at a heading of the migration page', async () => {
    enableDeprecationWarnings()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    process.env.AXIOM_TOKEN = 'legacy-token'

    createBrowserDrain({ endpoint: 'https://example.test/ingest' })
    createAxiomDrain({ token: 'k', dataset: 'logs' })
    createPostHogEventsDrain({ apiKey: 'k' })
    createLoggerStorage('links')
    applyDeprecatedAlias({ token: 'k' } as { token?: string, apiKey?: string }, { adapter: 'custom', from: 'token', to: 'apiKey' })
    defineEvlogHook({ redactMessage: true })
    await createOTLPDrain({ endpoint: 'http://localhost:4318' })({ event: { timestamp: '2026-11-19T00:00:00.000Z', level: 'info', service: 'api', environment: 'development' } })

    const page = readFileSync(new URL('../../../../apps/docs/content/7.reference/9.migrate-v3.md', import.meta.url), 'utf8')
    const anchors = new Set(
      [...page.matchAll(/^#{2,3} (.+)$/gm)].map(([, heading]) => heading!.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s/g, '-')),
    )
    const linked = warnSpy.mock.calls.map(([message]) => String(message).match(/migrate-v3#([\w-]+)$/)?.[1])
    expect(new Set(linked)).toEqual(new Set([
      'browser-entry-removed',
      'credential-aliases-removed',
      'posthog-events-drain-removed',
      'logger-storage-moved',
      'eve-moves-to-evlogeve',
      'compact-output-by-default',
    ]))
    for (const anchor of linked) expect(anchors).toContain(anchor)
  })
})

