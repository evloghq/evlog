import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionAuthContext } from 'eve/context'

function auth(overrides: Partial<SessionAuthContext>): SessionAuthContext {
  return {
    attributes: {},
    authenticator: 'test',
    principalId: 'test:none',
    principalType: 'user',
    ...overrides,
  }
}

async function loadTrust(env: Record<string, string | undefined>) {
  vi.resetModules()
  // Tests model deployed behavior unless a case opts into the local grant.
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('EVE_RUN_MODE', undefined)
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, undefined)
    else vi.stubEnv(key, value)
  }
  return await import('./trust')
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

describe('isMaintainer', () => {
  it('matches the configured principals per channel', async () => {
    const trust = await loadTrust({
      MAINTAINER_GITHUB_ID: '12345',
      MAINTAINER_LINEAR_ID: 'abc-def',
      MAINTAINER_PHONE: '+33600000000',
    })
    expect(trust.isMaintainer(auth({ principalId: 'github:12345' }))).toBe(true)
    expect(trust.isMaintainer(auth({ principalId: 'linear:abc-def' }))).toBe(true)
    expect(trust.isMaintainer(auth({ principalId: 'imessage:+33600000000' }))).toBe(true)
    expect(trust.isMaintainer(auth({ principalId: 'github:99999' }))).toBe(false)
    expect(trust.isMaintainer(null)).toBe(false)
  })

  it('drops a channel whose env variable is missing', async () => {
    const trust = await loadTrust({
      MAINTAINER_GITHUB_ID: '12345',
      MAINTAINER_LINEAR_ID: undefined,
      MAINTAINER_PHONE: undefined,
    })
    expect(trust.isMaintainer(auth({ principalId: 'github:12345' }))).toBe(true)
    expect(trust.isMaintainer(auth({ principalId: 'linear:abc-def' }))).toBe(false)
    expect(trust.isMaintainer(auth({ principalId: 'imessage:+33600000000' }))).toBe(false)
  })
})

describe('slack workspace members', () => {
  const slack = (principalId: string, overrides: Partial<SessionAuthContext> = {}) =>
    auth({ authenticator: 'slack-webhook', principalId, ...overrides })

  it('trusts every human of the configured workspace', async () => {
    const trust = await loadTrust({ EVI_SLACK_TEAM_ID: 'T0123' })
    expect(trust.isMaintainer(slack('slack:T0123:U0123'))).toBe(true)
    expect(trust.isMaintainer(slack('slack:T0123:U9999'))).toBe(true)
  })

  it('refuses another workspace, a bot, a forged authenticator, and an unconfigured team', async () => {
    const trust = await loadTrust({ EVI_SLACK_TEAM_ID: 'T0123' })
    expect(trust.isMaintainer(slack('slack:T9999:U0123'))).toBe(false)
    expect(trust.isMaintainer(slack('slack:T0123:bot:B0123', { principalType: 'service' }))).toBe(false)
    expect(trust.isMaintainer(auth({ principalId: 'slack:T0123:U0123' }))).toBe(false)
    const unconfigured = await loadTrust({ EVI_SLACK_TEAM_ID: undefined })
    expect(unconfigured.isMaintainer(slack('slack:T0123:U0123'))).toBe(false)
  })
})

describe('local dev grant', () => {
  const oidc = (claims: Record<string, unknown>) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

  it('requires local environment and a decodable team OIDC token together', async () => {
    const granted = await loadTrust({
      VERCEL_ENV: undefined,
      VERCEL_OIDC_TOKEN: oidc({ owner_id: 'team_x' }),
      VERCEL_TEAM_ID: 'team_x',
    })
    expect(granted.isMaintainer(null)).toBe(true)
    expect(granted.canAccessAdminTools(auth({ principalId: 'anon' }))).toBe(true)

    const noToken = await loadTrust({ VERCEL_ENV: undefined, VERCEL_OIDC_TOKEN: undefined })
    expect(noToken.isMaintainer(null)).toBe(false)

    const wrongTeam = await loadTrust({
      VERCEL_ENV: undefined,
      VERCEL_OIDC_TOKEN: oidc({ owner_id: 'team_other' }),
      VERCEL_TEAM_ID: 'team_x',
    })
    expect(wrongTeam.isMaintainer(null)).toBe(false)

    const garbage = await loadTrust({ VERCEL_ENV: undefined, VERCEL_OIDC_TOKEN: 'not-a-jwt' })
    expect(garbage.isMaintainer(null)).toBe(false)
  })

  it('never applies in eval or deployed runs, token or not', async () => {
    const evalRun = await loadTrust({
      VERCEL_ENV: undefined,
      EVE_RUN_MODE: 'eval',
      VERCEL_OIDC_TOKEN: oidc({ owner_id: 'team_x' }),
    })
    expect(evalRun.isMaintainer(null)).toBe(false)
    const deployed = await loadTrust({ VERCEL_OIDC_TOKEN: oidc({ owner_id: 'team_x' }) })
    expect(deployed.isMaintainer(auth({ principalId: 'anon' }))).toBe(false)
  })
})

describe('mcp principal', () => {
  it('is trusted only while the mcp token is configured', async () => {
    const withToken = await loadTrust({ EVI_MAINTAINER_TOKEN: 'tok' })
    expect(withToken.isMaintainer(auth({ principalId: 'mcp:hugo' }))).toBe(true)
    const without = await loadTrust({ EVI_MAINTAINER_TOKEN: undefined })
    expect(without.isMaintainer(auth({ principalId: 'mcp:hugo' }))).toBe(false)
  })
})

describe('isAutonomous', () => {
  it('matches only the constructed first-responder principal', async () => {
    const trust = await loadTrust({})
    expect(trust.isAutonomous(auth({ principalId: trust.AUTONOMOUS_GITHUB_PRINCIPAL }))).toBe(true)
    expect(trust.isAutonomous(auth({ principalId: 'github:12345' }))).toBe(false)
    expect(trust.isAutonomous(null)).toBe(false)
  })
})

describe('isScheduleAppAuth', () => {
  it('matches only the app principal stamped on schedule turns', async () => {
    const trust = await loadTrust({})
    expect(
      trust.isScheduleAppAuth(
        auth({ authenticator: 'app', principalId: 'eve:app', principalType: 'runtime' }),
      ),
    ).toBe(true)
    expect(
      trust.isScheduleAppAuth(auth({ principalId: 'eve:app', principalType: 'runtime' })),
    ).toBe(false)
    expect(trust.isScheduleAppAuth(auth({ principalId: 'github:12345' }))).toBe(false)
    expect(trust.isScheduleAppAuth(null)).toBe(false)
  })
})

describe('canAccessAdminTools', () => {
  it('allows the maintainer and schedule app principals, nobody else', async () => {
    const trust = await loadTrust({ MAINTAINER_GITHUB_ID: '12345' })
    expect(trust.canAccessAdminTools(auth({ principalId: 'github:12345' }))).toBe(true)
    expect(
      trust.canAccessAdminTools(
        auth({ authenticator: 'app', principalId: 'eve:app', principalType: 'runtime' }),
      ),
    ).toBe(true)
    expect(trust.canAccessAdminTools(auth({ principalId: 'github:67890' }))).toBe(false)
    expect(
      trust.canAccessAdminTools(auth({ principalId: 'eve:app', principalType: 'runtime' })),
    ).toBe(false)
    expect(trust.canAccessAdminTools(null)).toBe(false)
  })
})
