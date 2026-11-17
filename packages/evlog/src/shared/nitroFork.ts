import type { AuditableLogger } from '../audit'
import { noopLogger } from '../logger'
import type { NitroRequestLogger } from '../nitro'
import { forkBackgroundLogger } from './fork'
import type { MiddlewareLoggerOptions } from './middleware'

/**
 * Attach `fork` to a Nitro request logger. `options` runs on the first `fork()` call,
 * keeping the per-request cost to one closure. Its `enrich` and `drain`
 * call the `evlog:enrich` / `evlog:drain` hooks, so the child takes the same path
 * as the request event. When `emit` is false (route filtered out, or evlog disabled),
 * `fn` still runs with a logger that records nothing.
 */
export function attachNitroFork(
  logger: AuditableLogger,
  options: () => MiddlewareLoggerOptions,
  emit: boolean,
): NitroRequestLogger {
  const fork: NitroRequestLogger['fork'] = emit
    ? (label, fn) => forkBackgroundLogger({ parent: logger, middlewareOptions: options(), label, fn })
    : (label, fn) => {
      const lifetime = noopLogger.fork(label, () => fn(noopLogger))
      options().waitUntil?.(lifetime)
      return lifetime
    }
  // The disabled path hands out the shared no-op logger, which must stay unchanged.
  const target = logger === (noopLogger as unknown) ? { ...logger } : logger
  return Object.assign(target, { fork })
}
