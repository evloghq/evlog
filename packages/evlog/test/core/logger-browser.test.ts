import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/utils')>()
  return {
    ...original,
    isBrowser: () => true,
  }
})

import { createRequestLogger, initLogger, log } from '../../src/logger'

describe('browser pretty printing', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    initLogger({ pretty: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses %c CSS formatting for tagged logs instead of ANSI codes', () => {
    log.info('auth', 'User logged in')

    expect(logSpy).toHaveBeenCalledTimes(1)
    const [format, ...styles] = logSpy.mock.calls[0]!

    expect(format).toContain('%c')
    expect(format).toContain('[auth]')
    expect(format).toContain('User logged in')
    expect(format).not.toContain('\x1B')

    expect(styles.length).toBeGreaterThanOrEqual(2)
    for (const style of styles) {
      expect(style).toMatch(/^color:|^font-weight:/)
    }
  })

  it('uses %c CSS formatting for wide event pretty print', () => {
    const logger = createRequestLogger({ method: 'GET', path: '/api/test' })
    logger.set({ user: { id: '123' } })
    logger.emit()

    expect(logSpy).toHaveBeenCalled()

    const headerCall = logSpy.mock.calls[0]!
    const [headerFormat] = headerCall
    expect(headerFormat).toContain('%c')
    expect(headerFormat).not.toContain('\x1B')
  })

  it('renders tree branches with CSS in browser mode', () => {
    const logger = createRequestLogger({ method: 'POST', path: '/api/checkout' })
    logger.set({ user: { id: '123' } })
    logger.set({ cart: { items: 3 } })
    logger.emit()

    const treeCalls = logSpy.mock.calls.slice(1)
    expect(treeCalls.length).toBeGreaterThanOrEqual(1)

    for (const call of treeCalls) {
      const [format] = call
      expect(format).toContain('%c')
      expect(format).not.toContain('\x1B')
    }
  })

  it('shows status with CSS color in browser mode', () => {
    const logger = createRequestLogger({ method: 'GET', path: '/api/test' })
    logger.set({ status: 500 })
    logger.emit()

    const headerCall = logSpy.mock.calls[0]!
    const [headerFormat, ...styles] = headerCall
    expect(headerFormat).toContain('500')
    expect(headerFormat).toContain('%c')
    expect(styles.some((s: string) => s.includes('#ef4444'))).toBe(true)
  })

  it('shows duration with CSS dim in browser mode', () => {
    const logger = createRequestLogger({})
    logger.emit()

    const headerCall = logSpy.mock.calls[0]!
    const [headerFormat, ...styles] = headerCall
    expect(headerFormat).toContain('in ')
    expect(styles.some((s: string) => s.includes('#6b7280'))).toBe(true)
  })

  it('does not render durationMs as a tree field', () => {
    const logger = createRequestLogger({ method: 'GET', path: '/api/test' })
    logger.emit()

    for (const call of logSpy.mock.calls) {
      expect(String(call[0])).not.toContain('durationMs')
    }
  })

  it('escapes % in dynamic values to prevent format string injection', () => {
    log.info('test', '100% complete %c injected %s')

    expect(logSpy).toHaveBeenCalledTimes(1)
    const [format, ...styles] = logSpy.mock.calls[0]!

    expect(format).toContain('100%% complete %%c injected %%s')
    expect(format).not.toContain('\x1B')
    expect(styles).toHaveLength(4)
  })

  it('escapes % in wide event field values', () => {
    const logger = createRequestLogger({ method: 'GET', path: '/api/100%25-done' })
    logger.set({ note: '50% off' })
    logger.emit()

    const headerCall = logSpy.mock.calls[0]!
    const [headerFormat] = headerCall
    expect(headerFormat).toContain('/api/100%%25-done')

    const treeCalls = logSpy.mock.calls.slice(1)
    const noteCall = treeCalls.find(([fmt]: string[]) => fmt.includes('note'))
    expect(noteCall).toBeDefined()
    expect(noteCall![0]).toContain('50%% off')
  })

  it('keeps line breaks in field values and error messages', () => {
    const logger = createRequestLogger({ method: 'GET', path: '/x' })
    logger.set({ note: 'first\nsecond' })
    logger.error(new Error('bad\ninput'))
    logger.emit()

    const output = logSpy.mock.calls.map(([fmt]: string[]) => fmt).join('\n')
    expect(output).toContain('first\nsecond')
    expect(output).toContain('bad\ninput')
    expect(output).not.toContain('\\n')
  })
})
