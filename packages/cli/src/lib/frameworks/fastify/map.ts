import { codeRoutesAdapter } from '../shared/code-routes'
import { FASTIFY_METHODS } from './index'

/**
 * Fastify: `app.get/post/…('/path', [options,] handler)` and the object form
 * `app.route({ method, url, handler })`. evlog registers as a plugin, so the
 * ambient capability comes from `app.register(evlog)` rather than `app.use`.
 */
export default codeRoutesAdapter({
  framework: 'fastify',
  methods: FASTIFY_METHODS,
  routeObject: { member: 'route', method: 'method', path: 'url' },
  middleware: { source: 'evlog/fastify', register: ['register'] },
})
