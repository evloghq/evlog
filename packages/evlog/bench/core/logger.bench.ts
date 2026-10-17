import { bench, describe } from 'vitest'
import { createLogger, createRequestLogger } from '../../src/logger'
import { enableDiagnosticsChannel } from '../../src/diagnostics'
import { registerWideEventPublisher } from '../../src/shared/wideEventChannel'
import { initSilentLogger, PAYLOADS } from './_fixtures'

initSilentLogger()

/** Registered once so the enabled/disabled benches differ only by the publish. */
const disableChannel = await enableDiagnosticsChannel()
disableChannel()

describe('createLogger', () => {
  bench('no initial context', () => {
    createLogger()
  })

  bench('with shallow context', () => {
    createLogger({ userId: '123', plan: 'pro' })
  })

  bench('with nested context', () => {
    createLogger({
      user: { id: '123', plan: 'pro', email: 'user@example.com' },
      request: { method: 'POST', path: '/api/checkout' },
    })
  })
})

describe('createRequestLogger', () => {
  bench('with method + path', () => {
    createRequestLogger({ method: 'POST', path: '/api/checkout' })
  })

  bench('with method + path + requestId', () => {
    createRequestLogger({ method: 'POST', path: '/api/checkout', requestId: 'req_abc123' })
  })
})

describe('log.set()', () => {
  bench('shallow merge (3 fields)', () => {
    const log = createLogger()
    log.set({ userId: '123', plan: 'pro', action: 'checkout' })
  })

  bench('shallow merge (10 fields)', () => {
    const log = createLogger()
    log.set({
      userId: '123',
      plan: 'pro',
      action: 'checkout',
      cartItems: 5,
      total: 9999,
      currency: 'USD',
      region: 'us-east-1',
      source: 'web',
      referrer: 'google',
      sessionId: 'sess_xyz',
    })
  })

  bench('deep nested merge', () => {
    const log = createLogger()
    log.set(PAYLOADS.deep)
  })

  bench('multiple sequential sets', () => {
    const log = createLogger()
    log.set({ userId: '123' })
    log.set({ plan: 'pro' })
    log.set({ cart: { items: 3, total: 9999 } })
    log.set({ checkout: { step: 'payment' } })
  })

  bench('merge into an existing nested key', () => {
    const log = createLogger()
    log.set({ user: { id: '123' }, cart: { items: 3 } })
    log.set({ user: { plan: 'pro' }, cart: { total: 9999 } })
    log.set({ user: { role: 'admin' } })
  })
})

describe('log.emit()', () => {
  bench('emit minimal event', () => {
    const log = createLogger()
    log.emit()
  })

  bench('emit with context', () => {
    const log = createLogger({ method: 'POST', path: '/api/checkout' })
    log.set({ userId: '123', plan: 'pro' })
    log.set({ cart: { items: 3, total: 9999 } })
    log.emit({ status: 200 })
  })

  bench('emit with error', () => {
    const log = createLogger({ method: 'POST', path: '/api/checkout' })
    log.set({ userId: '123' })
    log.error(new Error('Payment failed'))
    log.emit({ status: 500 })
  })

  bench('full lifecycle (create + set + emit)', () => {
    const log = createRequestLogger({ method: 'POST', path: '/api/checkout' })
    log.set({ user: { id: '123', plan: 'pro' } })
    log.set({ cart: { items: 3, total: 9999 } })
    log.set({ payment: { method: 'card', last4: '4242' } })
    log.emit({ status: 200 })
  })
})

describe('log.set() payload sizes', () => {
  bench('small payload (2 fields)', () => {
    const log = createLogger()
    log.set(PAYLOADS.simple)
    log.emit()
  })

  bench('medium payload (50 fields)', () => {
    const log = createLogger()
    log.set(PAYLOADS.medium)
    log.emit()
  })

  bench('large payload (200 nested fields)', () => {
    const log = createLogger()
    log.set(PAYLOADS.large)
    log.emit()
  })
})

function emitOnce(): void {
  const log = createRequestLogger({ method: 'POST', path: '/api/checkout' })
  log.set({ user: { id: '123', plan: 'pro' } })
  log.emit({ status: 200 })
}

describe('diagnostics channel', () => {
  bench('emit — channel disabled', emitOnce, {
    setup: () => void registerWideEventPublisher(null),
  })

  bench('emit — channel enabled, no subscriber', emitOnce, {
    setup: async () => void await enableDiagnosticsChannel(),
    teardown: () => void registerWideEventPublisher(null),
  })
})
