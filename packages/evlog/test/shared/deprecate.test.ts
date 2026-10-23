import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPostHogEventsDrain } from '../../src/adapters/posthog'
import { defineEvlogHook } from '../../src/eve'
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
    warnDeprecated('test:once', '[evlog/test] first')
    warnDeprecated('test:once', '[evlog/test] first')
    warnDeprecated('test:other', '[evlog/test] second')
    expect(warnSpy.mock.calls).toEqual([['[evlog/test] first'], ['[evlog/test] second']])
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
    warnDeprecated('test:silent', '[evlog/test] silent')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('ignores other values of EVLOG_NO_DEPRECATION_WARNINGS', () => {
    vi.stubEnv('EVLOG_NO_DEPRECATION_WARNINGS', 'yes')
    warnDeprecated('test:yes', '[evlog/test] yes')
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('does not consume the id while silenced', () => {
    vi.stubEnv('NODE_ENV', 'production')
    warnDeprecated('test:later', '[evlog/test] later')
    vi.stubEnv('NODE_ENV', 'development')
    warnDeprecated('test:later', '[evlog/test] later')
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
    resetGlobalRegistry()
  })

  it('warns once for createPostHogEventsDrain()', () => {
    createPostHogEventsDrain({ apiKey: 'k' })
    createPostHogEventsDrain({ apiKey: 'k' })
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/posthog] createPostHogEventsDrain() is deprecated and removed in v3. Use createPostHogDrain({ mode: \'events\' }).',
    )
  })

  it('warns when redactMessage is passed to defineEvlogHook()', () => {
    defineEvlogHook({ redactMessage: true })
    expect(warnSpy).toHaveBeenCalledWith(
      '[evlog/eve] redactMessage is deprecated and removed in v3. Use message: \'omit\' (was true) or \'preview\' (was false).',
    )
  })
})
