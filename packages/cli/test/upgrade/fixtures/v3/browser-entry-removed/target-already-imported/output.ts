import { createHttpLogDrain } from 'evlog/http'
import { createHttpDrain, createHttpLogDrain as createBrowserLogDrain } from 'evlog/http'

export const drains = [
  createHttpDrain({ endpoint: '/a' }),
  createBrowserLogDrain({ endpoint: '/b' }),
  createHttpLogDrain({ endpoint: '/c' }),
]
