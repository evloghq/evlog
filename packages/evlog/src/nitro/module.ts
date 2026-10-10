import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Nitro } from 'nitropack'
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
      nitro.options.plugins.push(resolveModulePath('plugin'))

      // Prepend so evlog runs before any framework handler (Nuxt registers its own).
      nitro.options.errorHandler = prependNitroErrorHandler(
        nitro.options.errorHandler,
        resolveModulePath('errorHandler'),
      )

      // explicitly tell nitro to bundle evlog's files to correctly resolve nitro dependencies
      // in nitro v2 we can only disable externals globally

      nitro.options.noExternals = true

      // runtimeConfig and the JSON bridges below serialize the config:
      // RegExps would collapse to {} and function-valued redact policy
      // would vanish silently.
      prepareRedactForBridge(options?.redact)

      // Inject config into runtimeConfig — works in production where the
      // plugin is bundled through Nitro's builder and the virtual
      // runtime-config module resolves correctly.
      nitro.options.runtimeConfig.evlog = options || {}

      // Bake the config into the bundle as a literal so the plugin never has
      // to do a runtime `import('nitropack/runtime/internal/config')` to
      // discover it. The dynamic probe transitively imports a build-only
      // virtual module; on Vercel + Bun the missing virtual triggers Bun's
      // auto-installer and crashes with `ReadOnlyFileSystem` (issue #312).
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

export { useLogger } from '../runtime/server/useLogger'
