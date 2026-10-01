import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetGlobalRegistry } from '../../src/shared/globalRegistry'
import logger, { initLogger } from '../../src/logger'

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '')
}

describe('default export (drop-in logger)', () => {
  beforeEach(() => {
    resetGlobalRegistry()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('prints a tagged message immediately without initLogger', () => {
    logger.info('auth', 'User logged in')

    const output = stripAnsi(vi.mocked(console.log).mock.calls.map(call => String(call[0])).join('\n'))
    expect(output).toContain('[auth]')
    expect(output).toContain('User logged in')
  })

  it('prints a bare string under the "log" tag without initLogger', () => {
    logger.info('hello')

    const output = stripAnsi(vi.mocked(console.log).mock.calls.map(call => String(call[0])).join('\n'))
    expect(output).toContain('[log]')
    expect(output).toContain('hello')
  })

  it('prints an event object immediately without initLogger', () => {
    logger.info({ action: 'login', userId: '123' })

    const output = stripAnsi(vi.mocked(console.log).mock.calls.map(call => String(call[0])).join('\n'))
    expect(output).toContain('action: login')
    expect(output).toContain('userId: 123')
  })

  it('is the bare log API, not a wide-event scope', () => {
    expect('emit' in logger).toBe(false)
    expect('set' in logger).toBe(false)
  })

  it('stays silent after initLogger({ enabled: false })', () => {
    initLogger({ enabled: false })

    logger.info('auth', 'User logged in')

    expect(console.log).not.toHaveBeenCalled()
    expect(console.info).not.toHaveBeenCalled()
  })

  describe('uninitialized production warning', () => {
    it('warns once on the first emit in production without initLogger', () => {
      vi.stubEnv('NODE_ENV', 'production')

      logger.info({ action: 'login' })
      logger.info({ action: 'logout' })
      logger.info('tag', 'message')

      expect(console.warn).toHaveBeenCalledTimes(1)
      const warning = String(vi.mocked(console.warn).mock.calls[0][0])
      expect(warning).toContain('initLogger')
      expect(warning).toContain('redaction')
    })

    it('does not warn once initLogger has run', () => {
      vi.stubEnv('NODE_ENV', 'production')

      logger.info({ action: 'login' })
      initLogger()
      vi.mocked(console.warn).mockClear()
      logger.info({ action: 'logout' })

      expect(console.warn).not.toHaveBeenCalled()
    })

    it('does not warn in development', () => {
      logger.info({ action: 'login' })

      expect(console.warn).not.toHaveBeenCalled()
    })
  })
})
