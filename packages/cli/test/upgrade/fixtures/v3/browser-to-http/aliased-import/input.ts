import { createBrowserLogDrain as logDrain } from 'evlog/browser'

export const drain = logDrain({ drain: { endpoint: '/_evlog' } })
