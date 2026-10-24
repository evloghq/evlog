import { createHttpLogDrain as logDrain } from 'evlog/http'

export const drain = logDrain({ drain: { endpoint: '/_evlog' } })
