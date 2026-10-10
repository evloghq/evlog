import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Nitro } from 'nitro/types'
import type { NitroModuleOptions } from '../nitro'
import { prependNitroErrorHandler, serializeBundledEvlogConfig } from '../nitro'
import { prepareRedactForBridge } from '../redact'

export type { NitroModuleOptions }

const _dir = dirname(fileURLToPath(import.meta.url))

// Nitro raw-interpolates these paths into JS string literals when generating
// the #nitro/virtual/plugins and #nitro/virtual/error-handler modules, so
// Windows backslashes would be parsed as escape sequences (\n, \v, …) and
// break module resolution. Normalize to POSIX separators.
function resolveModulePath(name: string): string {
  return resolve(_dir, name).replace(/\\/g, '/')
}

export default function evlog(options?: NitroModuleOptions) {
  return {
    name: 'evlog',
    setup(nitro: Nitro) {
      // Push the plugin (no extension — Nitro's bundler resolves it)
      nitro.options.plugins = nitro.options.plugins || []
      nitro.options.plugins.push(resolveModulePath('plugin'))

      // explicitly tell nitro to bundle evlog's files to correctly resolve nitro dependencies
      if (!nitro.options.noExternals) {
        nitro.options.noExternals = ['evlog']
      } else if (Array.isArray(nitro.options.noExternals)) {
        nitro.options.noExternals.push('evlog')
      }


      const handlers = prependNitroErrorHandler(
        nitro.options.errorHandler,
        resolveModulePath('errorHandler'),
      )
      nitro.options.errorHandler = Array.isArray(handlers) ? handlers : [handlers]

      // runtimeConfig and the JSON bridges below serialize the config:
      // RegExps would collapse to {} and function-valued redact policy
      // would vanish silently.
      prepareRedactForBridge(options?.redact)

      // Inject config into runtimeConfig — works in production where the
      // plugin is bundled through Nitro's builder and the virtual
      // runtime-config module resolves correctly.
      nitro.options.runtimeConfig = nitro.options.runtimeConfig || {}
      nitro.options.runtimeConfig.evlog = options || {}

      // Bake the config into the bundle as a literal so the plugin never has
      // to do a runtime `import('nitro/runtime-config')` to discover it. That
      // dynamic import resolves to a module which itself imports the build-only
      // virtual `#nitro/virtual/runtime-config` — fine inside the Nitro build,
      // but on Vercel + Bun the missing virtual triggers Bun's auto-installer
      // and crashes with `ReadOnlyFileSystem` (see issue #312).
      nitro.options.replace = nitro.options.replace || {}
      nitro.options.replace.__EVLOG_CONFIG__ = serializeBundledEvlogConfig(options)

      // In dev mode, Nitro loads plugins externally (not bundled), so the
      // virtual runtime-config module is unreachable and useRuntimeConfig()
      // returns a stub without our values. process.env is inherited by the
      // Worker Threads that run the dev server, making it a reliable bridge.
      // The plugin reads: useRuntimeConfig().evlog ?? process.env.__EVLOG_CONFIG
      process.env.__EVLOG_CONFIG = JSON.stringify(options || {})
    },
  }
}
