/**
 * evlog Toolkit — building blocks for custom adapters, enrichers, plugins,
 * and framework integrations.
 *
 * @see https://evlog.dev/extend/custom-framework
 */

import { applyDeprecatedAlias as applyAlias } from './config'
import { warnDeprecated } from './deprecate'
import { createLoggerStorage as createStorage } from './storage'

export * from './streamResponse'
export * from './compose'
export { formatPublicEnvKeys, getRuntimeConfig, resolveAdapterConfig } from './config'
export type { ConfigField } from './config'
export * from './define'
export * from './drain'
export * from './enricher'
export * from './errors'
export * from './event'
export * from './fork'
export * from './headers'
export * from './http'
export * from './integration'
export * from './middleware'
export * from './plugin'
export * from './routes'
export * from './severity'

/**
 * Copy a deprecated config field onto its replacement when the replacement is
 * unset, warning once per adapter/field pair.
 *
 * @deprecated Removed from `evlog/toolkit` in v3 with no replacement. Copy the field in your adapter's config resolver.
 */
export const applyDeprecatedAlias: typeof applyAlias = (config, opts) => {
  warnDeprecated(
    'toolkit:applyDeprecatedAlias',
    '[evlog/toolkit] applyDeprecatedAlias() is removed from \'evlog/toolkit\' in v3. Copy the deprecated field in your adapter\'s config resolver.',
    'credential-aliases-removed',
  )
  return applyAlias(config, opts)
}

/**
 * Create a request-scoped `AsyncLocalStorage` and matching `useLogger` accessor.
 *
 * @deprecated Removed from `evlog/toolkit` in v3. Import it from `evlog/toolkit/storage`, which keeps `node:async_hooks` out of this entry.
 */
export const createLoggerStorage: typeof createStorage = (contextHint, id) => {
  warnDeprecated(
    'toolkit:createLoggerStorage',
    '[evlog/toolkit] createLoggerStorage() is removed from \'evlog/toolkit\' in v3. Import it from \'evlog/toolkit/storage\' instead.',
    'logger-storage-moved',
  )
  return createStorage(contextHint, id)
}
