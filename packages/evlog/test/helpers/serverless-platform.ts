import { beforeEach } from 'vitest'

// `detectServerlessPlatform()` reads the environment once per process; tests stub it per test.
beforeEach(() => {
  const registry = (globalThis as Record<symbol, { platform?: string | null } | undefined>)[Symbol.for('evlog.drains.v2')]
  if (registry) registry.platform = undefined
})
