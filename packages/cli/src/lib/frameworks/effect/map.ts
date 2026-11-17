import { codeRoutesAdapter } from '../shared/code-routes'

/**
 * Effect 4: `HttpRouter.add('GET', '/path', handler)`, and `HttpRouter.route`
 * with the same arguments inside `HttpRouter.addAll([…])`. `HttpApi` endpoints
 * declare the path apart from the handler and are not read.
 */
export default codeRoutesAdapter({
  framework: 'effect',
  methods: new Map(),
  on: ['add', 'route'],
  middleware: { source: 'evlog/effect', exports: ['routerLayer', 'evlog'], register: [] },
})
