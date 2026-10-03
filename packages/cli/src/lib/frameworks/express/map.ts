import { codeRoutesAdapter } from '../shared/code-routes'
import { EXPRESS_METHODS } from './index'

/**
 * Express: `app.get/post/…('/path', …handlers)` on the app or on a `Router()`.
 * `app.use('/prefix', router)` mounts, and a mount is not an entry point.
 */
export default codeRoutesAdapter({
  framework: 'express',
  methods: EXPRESS_METHODS,
  middleware: { source: 'evlog/express', register: ['use'] },
})
