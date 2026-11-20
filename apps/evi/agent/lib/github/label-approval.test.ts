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

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  // Tests model deployed behavior; the local dev grant would trust every caller.
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('EVE_RUN_MODE', undefined)
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, '')
    else vi.stubEnv(key, value)
  }
  const trust = await import('../trust')
  const labels = await import('./label-approval')
  return { trust, labels }
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

describe('writePolicy', () => {
  it('denies autonomous label writes', async () => {
    const { trust, labels } = await load({ MAINTAINER_GITHUB_ID: '12345' })
    expect(labels.writePolicy(auth({ principalId: trust.AUTONOMOUS_GITHUB_PRINCIPAL }))).toEqual({
      type: 'denied',
      reason: expect.stringContaining('Autonomous turns'),
    })
  })

  it('skips approval for the maintainer and asks everyone else', async () => {
    const { labels } = await load({ MAINTAINER_GITHUB_ID: '12345' })
    expect(labels.writePolicy(auth({ principalId: 'github:12345' }))).toBe('not-applicable')
    expect(labels.writePolicy(auth({ principalId: 'github:99999' }))).toBe('user-approval')
  })

  it('denies a scheduled task even though it carries a workspace member', async () => {
    const { trust, labels } = await load({ EVI_SLACK_TEAM_ID: 'T0HOME' })
    const member = { authenticator: 'slack-webhook', principalId: 'slack:T0HOME:U0ADA' }
    expect(labels.writePolicy(auth(member))).toBe('not-applicable')
    const scheduled = auth({ ...member, attributes: { [trust.SCHEDULED_TASK_ATTRIBUTE]: 'true' } })
    expect(trust.isMaintainer(scheduled)).toBe(false)
    expect(labels.writePolicy(scheduled)).toEqual({ type: 'denied', reason: expect.stringContaining('scheduled task') })
  })
})

describe('createLabelPolicy', () => {
  it('allows a taxonomy-shaped autonomous create', async () => {
    const { trust, labels } = await load({})
    expect(labels.createLabelPolicy(
      auth({ principalId: trust.AUTONOMOUS_GITHUB_PRINCIPAL }),
      { name: 'good first issue', color: '7057ff', description: 'Good for newcomers' },
    )).toBe('not-applicable')
  })

  it('rejects padded or overlong payloads the tool would still receive', async () => {
    const { trust, labels } = await load({})
    const autonomous = auth({ principalId: trust.AUTONOMOUS_GITHUB_PRINCIPAL })
    expect(labels.createLabelPolicy(autonomous, { name: 'bug ', color: 'ffffff' })).toEqual({
      type: 'denied',
      reason: expect.stringContaining('name'),
    })
    expect(labels.createLabelPolicy(autonomous, { name: 'bug', color: ' ffffff' })).toEqual({
      type: 'denied',
      reason: expect.stringContaining('color'),
    })
    expect(labels.createLabelPolicy(autonomous, {
      name: 'bug',
      color: 'ffffff',
      description: ' padded',
    })).toEqual({
      type: 'denied',
      reason: expect.stringContaining('description'),
    })
    expect(labels.createLabelPolicy(autonomous, {
      name: 'a'.repeat(51),
      color: 'ffffff',
    })).toEqual({
      type: 'denied',
      reason: expect.stringContaining('name'),
    })
    expect(labels.createLabelPolicy(autonomous, {
      name: 'bug',
      color: 'ffffff',
      description: 'd'.repeat(101),
    })).toEqual({
      type: 'denied',
      reason: expect.stringContaining('description'),
    })
  })

  it('rejects URL label names', async () => {
    const { trust, labels } = await load({})
    expect(labels.createLabelPolicy(
      auth({ principalId: trust.AUTONOMOUS_GITHUB_PRINCIPAL }),
      { name: 'http://evil.example', color: 'ffffff' },
    )).toEqual({
      type: 'denied',
      reason: expect.stringContaining('name'),
    })
  })

  it('rejects Unicode line separators in descriptions', async () => {
    const { trust, labels } = await load({})
    const autonomous = auth({ principalId: trust.AUTONOMOUS_GITHUB_PRINCIPAL })
    for (const separator of ['\u2028', '\u2029']) {
      expect(labels.createLabelPolicy(autonomous, {
        name: 'bug',
        color: 'ffffff',
        description: `one${separator}two`,
      })).toEqual({
        type: 'denied',
        reason: expect.stringContaining('description'),
      })
    }
  })

  it('falls through to writePolicy for interactive callers', async () => {
    const { labels } = await load({ MAINTAINER_GITHUB_ID: '12345' })
    expect(labels.createLabelPolicy(
      auth({ principalId: 'github:12345' }),
      { name: 'anything', color: 'not-hex' },
    )).toBe('not-applicable')
    expect(labels.createLabelPolicy(
      auth({ principalId: 'github:99999' }),
      { name: 'anything', color: 'not-hex' },
    )).toBe('user-approval')
  })
})
