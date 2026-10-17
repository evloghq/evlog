/**
 * Count the records one request lifecycle produces, per logger.
 *
 * This is a count, not a timing: the number is deterministic for a given
 * workload, so a change in it is a change in output shape (for example one
 * wide event becoming four log lines), never a speed claim.
 *
 * Usage:
 *   tsx bench/scripts/event-count.ts
 */

import { Writable } from 'node:stream'
import pino from 'pino'
import winston from 'winston'
import { createRequestLogger, initLogger } from '../../src/logger'

const request = { method: 'POST', path: '/api/checkout', requestId: 'req_abc' }

function countingStream(): { stream: Writable, count: () => number } {
  let records = 0
  const stream = new Writable({
    write(_chunk, _encoding, cb) {
      records++
      cb()
    },
  })
  return { stream, count: () => records }
}

// evlog: one wide event per request, however many set() calls happen.
let evlogRecords = 0
initLogger({
  env: { service: 'bench', environment: 'production' },
  pretty: false,
  silent: true,
  _suppressDrainWarning: true,
  drain: () => {
    evlogRecords++
  },
})

const evlogLog = createRequestLogger(request)
evlogLog.set({ user: { id: 'usr_123', plan: 'pro' } })
evlogLog.set({ cart: { items: 3, total: 9999 } })
evlogLog.set({ payment: { method: 'card', last4: '4242' } })
evlogLog.emit({ status: 200 })

// pino: one record per call, as the comparison bench writes them.
const pinoOut = countingStream()
const pinoChild = pino({ level: 'info' }, pinoOut.stream).child(request)
pinoChild.info({ user: { id: 'usr_123', plan: 'pro' } }, 'user context')
pinoChild.info({ cart: { items: 3, total: 9999 } }, 'cart context')
pinoChild.info({ payment: { method: 'card', last4: '4242' } }, 'payment context')
pinoChild.info({ status: 200 }, 'request complete')

// winston: one record per call, same four calls.
const winstonOut = countingStream()
const winstonChild = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Stream({ stream: winstonOut.stream })],
}).child(request)
winstonChild.info('user context', { user: { id: 'usr_123', plan: 'pro' } })
winstonChild.info('cart context', { cart: { items: 3, total: 9999 } })
winstonChild.info('payment context', { payment: { method: 'card', last4: '4242' } })
winstonChild.info('request complete', { status: 200 })

// Winston writes asynchronously through its transport, so wait for the flush.
await new Promise(resolve => setTimeout(resolve, 50))

const rows = [
  { logger: 'evlog', records: evlogRecords, shape: 'one wide event, three set() calls, one emit()' },
  { logger: 'pino', records: pinoOut.count(), shape: 'four child.info() calls' },
  { logger: 'winston', records: winstonOut.count(), shape: 'four child.info() calls' },
]

console.log('| Logger | Records per request | Shape |')
console.log('|--------|--------------------:|-------|')
for (const row of rows) {
  console.log(`| ${row.logger} | ${row.records} | ${row.shape} |`)
}
