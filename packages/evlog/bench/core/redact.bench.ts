import { bench, describe } from 'vitest'
import { redactEvent, resolveRedactConfig } from '../../src/redact'
import { createLogger, initLogger } from '../../src/logger'
import { USER_AGENTS } from './_fixtures'

const defaults = resolveRedactConfig(true)!

const request = {
  method: 'GET',
  path: '/api/health',
  status: 200,
  durationMs: 1,
  duration: '1ms',
  timestamp: '2026-01-01T00:00:00.000Z',
  level: 'info',
  service: 'bench',
  environment: 'production',
}

const checkout = {
  ...request,
  path: '/api/checkout/8f14e45f',
  requestId: '0b0f7d4e-6c1b-4a8e-9d2f-3f6f1c2a9b77',
  user: { id: 'usr_abc123', plan: 'pro' },
  cart: { items: 3, total: 9999, currency: 'USD' },
  headers: { 'user-agent': USER_AGENTS.chrome, 'accept': 'application/json', 'referer': 'https://shop.example.com/cart' },
  payment: { id: 'pay_xyz', method: 'card', last4: '4242' },
}

const sensitive = {
  ...checkout,
  user: { id: 'usr_abc123', email: 'jane.doe@example.com', phone: '+33 6 12 34 56 78', password: 'hunter2' },
  ip: '203.0.113.42',
  headers: { ...checkout.headers, authorization: 'Bearer abcdefgh12345678' },
  card: '4111 1111 1111 1111',
}

describe('redactEvent with default built-ins', () => {
  bench('request event, nothing to redact', () => {
    redactEvent(request, defaults)
  })

  bench('checkout event, nothing to redact', () => {
    redactEvent(checkout, defaults)
  })

  bench('checkout event with PII', () => {
    redactEvent(sensitive, defaults)
  })

  bench('event holding a Date (structuredClone path)', () => {
    redactEvent({ ...checkout, at: new Date(0) }, defaults)
  })
})

describe('emit with redaction', () => {
  bench('redact: false', () => {
    initLogger({ pretty: false, silent: true, redact: false, _suppressDrainWarning: true })
    createLogger({ method: 'GET', path: '/api/health' }).emit({ status: 200 })
  })

  bench('redact: true', () => {
    initLogger({ pretty: false, silent: true, redact: true, _suppressDrainWarning: true })
    createLogger({ method: 'GET', path: '/api/health' }).emit({ status: 200 })
  })
})
