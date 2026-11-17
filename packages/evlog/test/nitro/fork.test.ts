import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequestLogger, initLogger, noopLogger } from '../../src/logger'
import { useLogger } from '../../src/runtime/server/useLogger'
import { useLogger as useLoggerV3 } from '../../src/nitro-v3/useLogger'
import { setNitroRequestLoggerResolver } from '../../src/shared/globalRegistry'
import type { MiddlewareLoggerOptions } from '../../src/shared/middleware'
import { attachNitroFork } from '../../src/shared/nitroFork'
import type { AuditableLogger } from '../../src/audit'
import { defined } from '../helpers/defined'

function requestLogger(): AuditableLogger {
  return createRequestLogger({ method: 'GET', path: '/api/orders', requestId: 'parent-id' }, { _deferDrain: true })
}

describe('Nitro log.fork()', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'nitro-fork' }, pretty: false, silent: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drains the child through the enrich and drain hooks, after enrich', async () => {
    const calls: string[] = []
    const drain = vi.fn<NonNullable<MiddlewareLoggerOptions['drain']>>(() => {
      calls.push('drain')
    })
    const options: MiddlewareLoggerOptions = {
      method: 'GET',
      path: '/api/orders',
      enrich: (ctx) => {
        calls.push('enrich')
        ctx.event.region = 'eu'
      },
      drain,
    }
    const log = attachNitroFork(requestLogger(), () => options, true)

    await log.fork('send_receipt', (child) => {
      child.set({ receipt: { sent: true } })
    })

    const event = defined(drain.mock.calls[0]?.[0].event, 'child event')
    expect(event).toMatchObject({ operation: 'send_receipt', _parentRequestId: 'parent-id', region: 'eu', receipt: { sent: true } })
    expect(calls).toEqual(['enrich', 'drain'])
  })

  it('runs fn on a filtered-out route without draining, registered with waitUntil', async () => {
    const drain = vi.fn()
    const waitUntil = vi.fn()
    const fn = vi.fn()
    const log = attachNitroFork(requestLogger(), () => ({ method: 'GET', path: '/health', drain, waitUntil }), false)

    await log.fork('cleanup', fn)

    expect(fn).toHaveBeenCalledWith(noopLogger)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(drain).not.toHaveBeenCalled()
  })

  it('leaves the shared no-op logger untouched when evlog is disabled', () => {
    const before = noopLogger.fork
    const log = attachNitroFork(noopLogger, () => ({ method: 'GET', path: '/' }), false)

    expect(log).not.toBe(noopLogger)
    expect(noopLogger.fork).toBe(before)
  })
})

describe('Nitro useLogger() without an event', () => {
  afterEach(() => {
    setNitroRequestLoggerResolver(() => undefined)
  })

  it('returns the logger of the request Nitro\'s async context holds', () => {
    const log = attachNitroFork(requestLogger(), () => ({ method: 'GET', path: '/' }), true)
    setNitroRequestLoggerResolver(() => log)

    expect(useLogger()).toBe(log)
    expect(useLoggerV3()).toBe(log)
  })

  it('throws an error naming experimental.asyncContext when no request is in context', () => {
    setNitroRequestLoggerResolver(() => undefined)

    expect(() => useLogger()).toThrow('experimental: { asyncContext: true }')
    expect(() => useLoggerV3()).toThrow('experimental: { asyncContext: true }')
  })
})
