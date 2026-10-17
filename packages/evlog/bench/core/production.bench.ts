import { afterAll, beforeAll, bench, describe, vi } from 'vitest'
import { createLogger, createRequestLogger, log } from '../../src/logger'
import { redactEvent, resolveRedactConfig } from '../../src/redact'
import { initProductionLogger, PAYLOADS } from './_fixtures'

// Every bench in this file runs as a production process does: NODE_ENV is
// production, so stacks are not shortened, and redaction is on. The other
// files run with Vitest's NODE_ENV and redaction off.
initProductionLogger()
beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'production')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('production defaults: request', () => {
  bench('request lifecycle (create + 4 set + emit)', () => {
    const logger = createRequestLogger({ method: 'POST', path: '/api/checkout', requestId: 'req_abc123' })
    logger.set({ user: { id: 'usr_123', plan: 'pro', email: 'jane@example.com' } })
    logger.set({ cart: { items: [{ id: 'a', qty: 1, price: 2999 }, { id: 'b', qty: 2, price: 3500 }], total: 9999, currency: 'USD' } })
    logger.set({ payment: { method: 'card', last4: '4242', gateway: 'stripe' }, flags: { beta: true } })
    logger.set({ status: 200 })
    logger.emit()
  })

  // Created once: building an Error and its stack is the application's cost, and
  // under Vitest's call stack it outweighs everything evlog does with it.
  const error = new Error('Payment failed')

  bench('request that logs an error', () => {
    const logger = createRequestLogger({ method: 'POST', path: '/api/checkout' })
    logger.set({ user: { id: 'usr_123' } })
    logger.error(error)
    logger.emit({ status: 500 })
  })

  bench('request carrying secrets and PII', () => {
    const logger = createRequestLogger({ method: 'POST', path: '/api/login' })
    logger.set({ auth: { password: 'hunter2', accessToken: 'at_123', header: 'Bearer abcdefghijkl' } })
    logger.set({ contact: { email: 'jane@example.com', phone: '+33 6 12 34 56 78', ip: '10.0.0.12' } })
    logger.emit({ status: 200 })
  })
})

describe('production defaults: payload sizes', () => {
  bench('deep nested payload', () => {
    const logger = createLogger()
    logger.set(PAYLOADS.deep)
    logger.emit()
  })

  bench('medium payload (50 fields)', () => {
    const logger = createLogger()
    logger.set(PAYLOADS.medium)
    logger.emit()
  })

  bench('log.info(object)', () => {
    log.info(PAYLOADS.shallow)
  })
})

const builtinConfig = resolveRedactConfig(true)!
const pathConfig = resolveRedactConfig({ paths: ['user.email', '**.token'] })!
const event = { method: 'POST', path: '/api/checkout', status: 200, ...PAYLOADS.deep }

describe('redactEvent', () => {
  bench('built-ins only (production default)', () => {
    redactEvent(event, builtinConfig)
  })

  bench('built-ins + paths', () => {
    redactEvent(event, pathConfig)
  })
})
