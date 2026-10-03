import { codeRoutesAdapter } from '../shared/code-routes'
import { HONO_METHODS } from './index'

/**
 * Hono: `app.get/post/…('/path', …)` registrations, plus `app.on(method, path, …)`,
 * the one spelling where the method is an argument. It takes arrays on both
 * sides: `app.on(['PUT', 'DELETE'], ['/a', '/b'], …)` registers every combination.
 */
export default codeRoutesAdapter({
  framework: 'hono',
  methods: HONO_METHODS,
  on: 'on',
  middleware: { source: 'evlog/hono', register: ['use'] },
})
