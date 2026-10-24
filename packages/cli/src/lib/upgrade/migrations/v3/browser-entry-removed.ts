import { moveModules } from '../../rename-modules'

/** `evlog/browser` is gone; `evlog/http` has the same drains under transport-neutral names. */
export default moveModules('v3/browser-entry-removed', {
  'evlog/browser': {
    to: 'evlog/http',
    exports: {
      createBrowserDrain: 'createHttpDrain',
      createBrowserLogDrain: 'createHttpLogDrain',
      BrowserDrainConfig: 'HttpDrainConfig',
      BrowserLogDrainOptions: 'HttpLogDrainOptions',
    },
  },
})
