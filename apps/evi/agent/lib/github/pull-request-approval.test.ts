import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionAuthContext } from 'eve/context'
import { createPullRequestPolicy } from './pull-request-approval'

function auth(overrides: Partial<SessionAuthContext> = {}): SessionAuthContext {
  return {
    attributes: {},
    authenticator: 'app',
    principalId: 'eve:app',
    principalType: 'runtime',
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('EVE_RUN_MODE', undefined)
  vi.stubEnv('EVI_REPOSITORY', 'evloghq/evlog')
})

afterEach(() => vi.unstubAllEnvs())

describe('createPullRequestPolicy', () => {
  it.each([undefined, false, true])('allows scheduled PR creation with draft=%s', (draft) => {
    expect(createPullRequestPolicy(auth(), { owner: 'evloghq', repo: 'evlog', draft })).toBe('not-applicable')
  })

  it('uses the configured repository defaults when inputs are omitted', () => {
    vi.stubEnv('EVI_REPOSITORY', 'example/project')
    expect(createPullRequestPolicy(auth(), {})).toBe('not-applicable')
    expect(createPullRequestPolicy(auth(), { owner: 'example' })).toBe('not-applicable')
    expect(createPullRequestPolicy(auth(), { repo: 'project' })).toBe('not-applicable')
    expect(createPullRequestPolicy(auth(), { owner: 'EXAMPLE', repo: 'PROJECT' })).toBe('not-applicable')
  })

  it.each([
    { owner: 'other', repo: 'evlog' },
    { owner: 'evloghq', repo: 'other' },
    { owner: 'other' },
    { repo: 'other' },
  ])('requires approval outside the configured repository: %j', (input) => {
    expect(createPullRequestPolicy(auth(), { ...input, draft: true })).toBe('user-approval')
  })

  it.each([
    { authenticator: 'test' },
    { principalId: 'test:none' },
    { principalType: 'user' as const },
  ])('requires the complete app identity: %j', (identity) => {
    expect(createPullRequestPolicy(auth(identity), { draft: true })).toBe('user-approval')
  })

  it('requires approval when tool input is unavailable', () => {
    expect(createPullRequestPolicy(auth(), undefined)).toBe('user-approval')
  })

  it('requires approval for unauthenticated callers', () => {
    expect(createPullRequestPolicy(null, { draft: true })).toBe('user-approval')
  })

  it('denies autonomous first-responder PR creation', () => {
    expect(createPullRequestPolicy(auth({ principalId: 'github:evlogai' }), { draft: true })).toEqual({
      type: 'denied',
      reason: expect.stringContaining('Autonomous turns'),
    })
  })
})
