import { createHttpLogDrain } from 'evlog/http'
import { createBrowserDrain, createBrowserLogDrain } from 'evlog/browser'

export const drains = [
  createBrowserDrain({ endpoint: '/a' }),
  createBrowserLogDrain({ endpoint: '/b' }),
  createHttpLogDrain({ endpoint: '/c' }),
]
