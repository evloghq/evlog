import type { MapAdapter } from '../types'

/** Tools, schedules and channels are not read yet, so `evlog map` lists no entry points for an agent. */
export default {
  extractRoutes: () => Promise.resolve([]),
} satisfies MapAdapter
