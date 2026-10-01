import { describe, expect, it } from 'vitest'
import { isValidRefName, mintInstallationToken, pushBrokerPolicy, validatePushBranch } from './push'

describe('isValidRefName', () => {
  it('accepts branch names and commit shas', () => {
    expect(isValidRefName('main')).toBe(true)
    expect(isValidRefName('release/2.1')).toBe(true)
    expect(isValidRefName('9c1a3515f0e2b7c4d8a6e1f3b5c7d9e0a2b4c6d8')).toBe(true)
  })

  it('refuses anything that could escape the command line or the ref namespace', () => {
    expect(isValidRefName('main; rm -rf /')).toBe(false)
    expect(isValidRefName('v1`x')).toBe(false)
    expect(isValidRefName('-flag')).toBe(false)
    expect(isValidRefName('a..b')).toBe(false)
    expect(isValidRefName('a//b')).toBe(false)
    expect(isValidRefName('')).toBe(false)
  })

  it('refuses components git itself rejects', () => {
    expect(isValidRefName('release/.draft')).toBe(false)
    expect(isValidRefName('release./x')).toBe(false)
    expect(isValidRefName('release.lock')).toBe(false)
    expect(isValidRefName('release.lock/x')).toBe(false)
    expect(isValidRefName('release/v2.lock.1')).toBe(true)
  })
})

describe('validatePushBranch', () => {
  it('accepts ordinary feature branch names', () => {
    expect(validatePushBranch('fix/pipeline-flush')).toBeNull()
    expect(validatePushBranch('feat/adapter.loki-v2')).toBeNull()
    expect(validatePushBranch('chore_1')).toBeNull()
  })

  it('refuses protected branches', () => {
    expect(validatePushBranch('main')).toMatch(/not allowed/)
    expect(validatePushBranch('master')).toMatch(/not allowed/)
  })

  it('refuses qualified refs and HEAD that reach a branch under another name', () => {
    expect(validatePushBranch('refs/heads/main')).toMatch(/not a plain branch name/)
    expect(validatePushBranch('refs/heads/master')).toMatch(/not a plain branch name/)
    expect(validatePushBranch('refs/heads/feature')).toMatch(/not a plain branch name/)
    expect(validatePushBranch('HEAD')).toMatch(/not a plain branch name/)
    expect(validatePushBranch('feature/main')).toBeNull()
  })

  it('refuses names that could escape the command line or the ref namespace', () => {
    expect(validatePushBranch('fix; rm -rf /')).toMatch(/not a valid branch name/)
    expect(validatePushBranch("fix'`x")).toMatch(/not a valid branch name/)
    expect(validatePushBranch('-leading-dash')).toMatch(/not a valid branch name/)
    expect(validatePushBranch('a..b')).toMatch(/not a valid branch name/)
    expect(validatePushBranch('a//b')).toMatch(/not a valid branch name/)
    expect(validatePushBranch('trailing/')).toMatch(/not a valid branch name/)
    expect(validatePushBranch('')).toMatch(/not a valid branch name/)
  })
})

describe('pushBrokerPolicy', () => {
  it('brokers a basic x-access-token header for github.com only', () => {
    const policy = pushBrokerPolicy('tok_123')
    expect(policy).toEqual({
      allow: {
        'github.com': [
          {
            transform: [
              {
                headers: {
                  Authorization: `Basic ${Buffer.from('x-access-token:tok_123').toString('base64')}`,
                },
              },
            ],
          },
        ],
        '*': [],
      },
    })
  })
})

describe('mintInstallationToken', () => {
  it('returns a static token as-is and resolves a lazy one', async () => {
    await expect(mintInstallationToken({ installationToken: 'tok' })).resolves.toBe('tok')
    await expect(mintInstallationToken({ installationToken: async () => 'lazy' })).resolves.toBe('lazy')
  })

  it('throws when the connector exposes no token', async () => {
    await expect(mintInstallationToken({})).rejects.toThrow('no installation token')
  })
})
