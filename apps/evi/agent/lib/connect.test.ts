import type { SessionAuthContext, SessionContext } from 'eve/context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminGatedAuth } from './connect'

function auth(overrides: Partial<SessionAuthContext>): SessionAuthContext {
  return {
    attributes: {},
    authenticator: 'test',
    principalId: 'test:none',
    principalType: 'user',
    ...overrides,
  }
}

function context(current: SessionAuthContext): SessionContext {
  return { session: { auth: { current, initiator: null } } } as unknown as SessionContext
}

async function loadConnect() {
  vi.resetModules()
  // Tests model deployed behavior: no maintainer principals, no local grant.
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('EVE_RUN_MODE', undefined)
  return await import('./connect')
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

describe('adminGatedAuth', () => {
  it('gives an untrusted session a terminal error instead of the credential', async () => {
    const { adminGatedAuth: gated } = await loadConnect()
    const grant = vi.fn()
    const result = gated(grant)(context(auth({ principalId: 'github:evlogai', authenticator: 'github-webhook' })))
    expect(result).toMatchObject({ principalType: 'app' })
    await expect((result as { getToken(): Promise<never> }).getToken()).rejects.toThrow(
      'This tool is not available in the current session.',
    )
    expect(grant).not.toHaveBeenCalled()
  })

  it('delegates to the grant for a schedule session', async () => {
    const { adminGatedAuth: gated } = await loadConnect()
    const grant = vi.fn(() => 'granted')
    const result = gated(grant)(context(auth({ authenticator: 'app', principalId: 'eve:app', principalType: 'runtime' })))
    expect(result).toBe('granted')
    expect(grant).toHaveBeenCalledTimes(1)
  })

  it('delegates to the grant for a maintainer principal', async () => {
    vi.stubEnv('MAINTAINER_GITHUB_ID', '12345')
    const { adminGatedAuth: gated } = await loadConnect()
    const grant = vi.fn(() => 'granted')
    const result = gated(grant)(context(auth({ principalId: 'github:12345', authenticator: 'github-webhook' })))
    expect(result).toBe('granted')
    expect(grant).toHaveBeenCalledTimes(1)
  })
})
