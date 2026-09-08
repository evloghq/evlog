/**
 * These workloads use different output paths, not equivalent-output configurations.
 * Pino serializes JSON and writes to /dev/null; Winston serializes to a no-op stream.
 * Silent evlog and the no-op Consola reporter exclude console serialization.
 * The lifecycle group also compares one evlog event with multiple alternative records.
 */

import { Writable } from 'node:stream'
import { bench, describe } from 'vitest'
import pino from 'pino'
import winston from 'winston'
import { createConsola } from 'consola'
import { createLogger, initLogger } from '../../src/logger'
import { PAYLOADS } from '../core/_fixtures'

// --- No-op destinations ---

const devNull = new Writable({
  write(_chunk, _encoding, cb) {
    cb()
  },
})

// --- Logger setup ---

const pinoLogger = pino(
  { level: 'info' },
  pino.destination({ dest: '/dev/null', sync: true }),
)

const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Stream({ stream: devNull })],
})

const consolaLogger = createConsola({
  level: 4,
  reporters: [{ log: () => {} }],
})

initLogger({
  env: { service: 'bench', environment: 'production' },
  pretty: false,
  silent: true,
  _suppressDrainWarning: true,
})

// --- Benchmarks ---

describe('simple string log', () => {
  const msg = 'User logged in successfully'

  bench('evlog', () => {
    const log = createLogger()
    log.set({ message: msg })
    log.emit()
  })

  bench('pino', () => {
    pinoLogger.info(msg)
  })

  bench('winston', () => {
    winstonLogger.info(msg)
  })

  bench('consola', () => {
    consolaLogger.info(msg)
  })
})

describe('structured log (5 fields)', () => {
  bench('evlog', () => {
    const log = createLogger()
    log.set(PAYLOADS.shallow)
    log.emit()
  })

  bench('pino', () => {
    pinoLogger.info(PAYLOADS.shallow, 'checkout')
  })

  bench('winston', () => {
    winstonLogger.info('checkout', PAYLOADS.shallow)
  })

  bench('consola', () => {
    consolaLogger.info('checkout', PAYLOADS.shallow)
  })
})

describe('deep nested log', () => {
  bench('evlog', () => {
    const log = createLogger()
    log.set(PAYLOADS.deep)
    log.emit()
  })

  bench('pino', () => {
    pinoLogger.info(PAYLOADS.deep, 'deep event')
  })

  bench('winston', () => {
    winstonLogger.info('deep event', PAYLOADS.deep)
  })

  bench('consola', () => {
    consolaLogger.info('deep event', PAYLOADS.deep)
  })
})

describe('child / scoped logger', () => {
  const scope = { service: 'checkout', requestId: 'req_abc' }
  const payload = { userId: 'usr_123', action: 'pay', status: 200 }

  const pinoChild = pinoLogger.child(scope)
  const winstonChild = winstonLogger.child(scope)

  bench('evlog (createLogger + set + emit)', () => {
    const log = createLogger(scope)
    log.set(payload)
    log.emit()
  })

  bench('pino (child.info)', () => {
    pinoChild.info(payload, 'request')
  })

  bench('winston (child.info)', () => {
    winstonChild.info('request', payload)
  })

  bench('consola (withTag.info)', () => {
    const tagged = consolaLogger.withTag('checkout')
    tagged.info('request', payload)
  })
})

describe('wide event lifecycle (evlog-native pattern)', () => {
  bench('evlog — accumulate + emit (1 event)', () => {
    const log = createLogger({ method: 'POST', path: '/api/checkout', requestId: 'req_abc' })
    log.set({ user: { id: 'usr_123', plan: 'pro' } })
    log.set({ cart: { items: 3, total: 9999 } })
    log.set({ payment: { method: 'card', last4: '4242' } })
    log.emit({ status: 200 })
  })

  bench('pino — 4 separate log calls', () => {
    const child = pinoLogger.child({ method: 'POST', path: '/api/checkout', requestId: 'req_abc' })
    child.info({ user: { id: 'usr_123', plan: 'pro' } }, 'user context')
    child.info({ cart: { items: 3, total: 9999 } }, 'cart context')
    child.info({ payment: { method: 'card', last4: '4242' } }, 'payment context')
    child.info({ status: 200 }, 'request complete')
  })

  bench('winston — 4 separate log calls', () => {
    const child = winstonLogger.child({ method: 'POST', path: '/api/checkout', requestId: 'req_abc' })
    child.info('user context', { user: { id: 'usr_123', plan: 'pro' } })
    child.info('cart context', { cart: { items: 3, total: 9999 } })
    child.info('payment context', { payment: { method: 'card', last4: '4242' } })
    child.info('request complete', { status: 200 })
  })
})

describe('burst — 100 sequential logs', () => {
  bench('evlog', () => {
    for (let i = 0; i < 100; i++) {
      const log = createLogger()
      log.set({ i, action: 'tick' })
      log.emit()
    }
  })

  bench('pino', () => {
    for (let i = 0; i < 100; i++) {
      pinoLogger.info({ i, action: 'tick' })
    }
  })

  bench('winston', () => {
    for (let i = 0; i < 100; i++) {
      winstonLogger.info('tick', { i, action: 'tick' })
    }
  })

  bench('consola', () => {
    for (let i = 0; i < 100; i++) {
      consolaLogger.info('tick', { i, action: 'tick' })
    }
  })
})

describe('logger creation cost', () => {
  bench('evlog — createLogger()', () => {
    createLogger({ service: 'bench', requestId: 'req_abc' })
  })

  bench('pino — pino.child()', () => {
    pinoLogger.child({ service: 'bench', requestId: 'req_abc' })
  })

  bench('winston — winston.child()', () => {
    winstonLogger.child({ service: 'bench', requestId: 'req_abc' })
  })

  bench('consola — consola.withTag()', () => {
    consolaLogger.withTag('bench')
  })
})
