/**
 * Equivalent-output comparison. Every logger builds the record, serializes it
 * to one JSON line and writes it to the same no-op stream, so each row prices
 * the same work. evlog reaches the stream through a drain, as a deployed app does.
 * Each group logs the same fields; check a library's output before adding it.
 */

import { Writable } from 'node:stream'
import { afterAll, beforeAll, bench, describe, vi } from 'vitest'
import pino from 'pino'
import winston from 'winston'
import { createConsola } from 'consola'
import { configureSync, getLogger, jsonLinesFormatter } from '@logtape/logtape'
import { LogLayer } from 'loglayer'
import { PinoTransport } from '@loglayer/transport-pino'
import { createRequestLogger, initLogger, log } from '../../src/logger'
import type { LoggerConfig } from '../../src/types'
import { PAYLOADS } from '../core/_fixtures'

const devNull = new Writable({
  decodeStrings: false,
  write(_chunk, _encoding, cb) {
    cb()
  },
})
const writeLine = (line: string) => devNull.write(line)

const request = { method: 'POST', path: '/api/checkout', requestId: 'req_abc123' }
const user = { id: 'usr_123', plan: 'pro', email: 'jane@example.com' }
const cart = { items: [{ id: 'a', qty: 1, price: 2999 }, { id: 'b', qty: 2, price: 3500 }], total: 9999, currency: 'USD' }
const payment = { method: 'card', last4: '4242', gateway: 'stripe' }
const auth = { password: 'hunter2', provider: 'password' }
const redactPaths = ['user.email', 'auth.password']
// Created once: building an Error and its stack is the application's cost.
const error = new Error('Payment failed')

const useEvlog = (redact: LoggerConfig['redact']) => () => {
  initLogger({
    env: { service: 'bench' },
    pretty: false,
    silent: true,
    redact,
    drain: ({ event }) => {
      writeLine(`${JSON.stringify(event)}\n`)
    },
  })
}

const pinoLogger = pino({ level: 'info' }, devNull)
const pinoRedacting = pino({ level: 'info', redact: redactPaths }, devNull)

const { combine, errors, timestamp, json } = winston.format
const winstonLogger = winston.createLogger({
  level: 'info',
  format: combine(errors({ stack: true }), timestamp(), json()),
  transports: [new winston.transports.Stream({ stream: devNull })],
})

configureSync({
  sinks: { out: record => writeLine(jsonLinesFormatter(record)) },
  loggers: [
    { category: ['bench'], lowestLevel: 'info', sinks: ['out'] },
    { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] },
  ],
})
const logtapeLogger = getLogger(['bench'])

const logLayer = new LogLayer({ transport: new PinoTransport({ logger: pino({ level: 'info' }, devNull) }) })

const consolaLogger = createConsola({ level: 3, reporters: [{ log: entry => writeLine(`${JSON.stringify(entry)}\n`) }] })

// evlog compacts stacks outside production; the other loggers have no such mode.
beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'production')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('one structured record (5 fields)', () => {
  const record = { message: 'checkout', ...PAYLOADS.shallow }

  bench('evlog', () => {
    log.info(record)
  }, { setup: useEvlog(false) })

  bench('pino', () => {
    pinoLogger.info(PAYLOADS.shallow, 'checkout')
  })

  bench('winston', () => {
    winstonLogger.info('checkout', PAYLOADS.shallow)
  })

  bench('LogTape', () => {
    logtapeLogger.info('checkout', PAYLOADS.shallow)
  })

  bench('LogLayer (pino transport)', () => {
    logLayer.withMetadata(PAYLOADS.shallow).info('checkout')
  })

  bench('consola (JSON reporter)', () => {
    consolaLogger.info('checkout', PAYLOADS.shallow)
  })
})

describe('one request record', () => {
  bench('evlog (request logger, 3 set + emit)', () => {
    const logger = createRequestLogger(request)
    logger.set({ user })
    logger.set({ cart })
    logger.set({ payment })
    logger.emit({ status: 200 })
  }, { setup: useEvlog(false) })

  bench('pino (child.info)', () => {
    pinoLogger.child(request).info({ user, cart, payment, status: 200 }, 'request')
  })

  bench('winston (child.info)', () => {
    winstonLogger.child(request).info('request', { user, cart, payment, status: 200 })
  })

  bench('LogTape (with().info)', () => {
    logtapeLogger.with(request).info('request', { user, cart, payment, status: 200 })
  })

  bench('LogLayer (pino transport)', () => {
    logLayer.child().withContext(request).withMetadata({ user, cart, payment, status: 200 }).info('request')
  })
})

describe('one request record with an error', () => {
  bench('evlog', () => {
    const logger = createRequestLogger(request)
    logger.set({ user })
    logger.error(error)
    logger.emit({ status: 500 })
  }, { setup: useEvlog(false) })

  bench('pino', () => {
    pinoLogger.child(request).error({ user, err: error, status: 500 }, 'request failed')
  })

  bench('winston', () => {
    winstonLogger.child(request).error({ message: error, user, status: 500 })
  })

  bench('LogTape', () => {
    logtapeLogger.with(request).error('request failed', { user, error, status: 500 })
  })

  bench('LogLayer (pino transport)', () => {
    logLayer.child().withContext(request).withMetadata({ user, status: 500 }).withError(error).error('request failed')
  })
})

describe('redact two paths in a request record', () => {
  bench('evlog (redact.paths)', () => {
    const logger = createRequestLogger(request)
    logger.set({ user, auth })
    logger.set({ cart })
    logger.emit({ status: 200 })
  }, { setup: useEvlog({ builtins: false, paths: redactPaths }) })

  bench('pino (redact)', () => {
    pinoRedacting.child(request).info({ user, auth, cart, status: 200 }, 'request')
  })
})

// No alternative scans every string for PII by default, so this group has no counterpart.
describe('evlog default production redaction', () => {
  bench('evlog (redact: true)', () => {
    const logger = createRequestLogger(request)
    logger.set({ user, auth })
    logger.set({ cart })
    logger.emit({ status: 200 })
  }, { setup: useEvlog(true) })
})
