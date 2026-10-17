import { vi } from 'vitest'
import { resetGlobalRegistry } from '../../src/shared/globalRegistry'

/**
 * Deprecation warnings are silent under Vitest. Call this from `beforeEach` in
 * a test that asserts on them; pair it with `vi.unstubAllEnvs()` in `afterEach`.
 */
export function enableDeprecationWarnings(): void {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('VITEST', '')
  vi.stubEnv('JEST_WORKER_ID', '')
  vi.stubEnv('EVLOG_NO_DEPRECATION_WARNINGS', '')
  resetGlobalRegistry()
}
