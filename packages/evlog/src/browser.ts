import type { HttpDrainConfig, HttpLogDrainOptions } from './http'
import { createHttpDrain, createHttpLogDrain } from './http'
import { warnDeprecated } from './shared/deprecate'

const BROWSER_ENTRY_MESSAGE = '[evlog] \'evlog/browser\' is deprecated and removed in v3. Import from \'evlog/http\' instead (createBrowserDrain to createHttpDrain).'

/**
 * @deprecated Removed in evlog v3. Use `HttpDrainConfig` from `evlog/http` instead.
 */
export type BrowserDrainConfig = HttpDrainConfig

/**
 * @deprecated Removed in evlog v3. Use `HttpLogDrainOptions` from `evlog/http` instead.
 */
export type BrowserLogDrainOptions = HttpLogDrainOptions

/**
 * @deprecated Removed in evlog v3. Use `createHttpDrain` from `evlog/http` instead.
 */
export function createBrowserDrain(config: BrowserDrainConfig) {
  warnDeprecated('browser:entry', BROWSER_ENTRY_MESSAGE)
  return createHttpDrain(config)
}

/**
 * @deprecated Removed in evlog v3. Use `createHttpLogDrain` from `evlog/http` instead.
 */
export function createBrowserLogDrain(options: BrowserLogDrainOptions) {
  warnDeprecated('browser:entry', BROWSER_ENTRY_MESSAGE)
  return createHttpLogDrain(options)
}
