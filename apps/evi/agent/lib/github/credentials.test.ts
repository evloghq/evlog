import { ConnectorInstallationRequiredError } from '@vercel/connect'
import { describe, expect, it, vi } from 'vitest'
import { githubCredentials, githubCredentialsFor, homeInstallationParams, installationParams, mintInstallationToken, repositoryToken } from './credentials'

const minted = vi.hoisted(() => ({ fail: false }))

vi.mock('@vercel/connect/eve', () => ({
  connectGitHubCredentials: (_connector: string, params: { authorizationDetails: Array<{ org: string, repositories?: string[] }> }) => ({
    params,
    installationToken: () => {
      if (minted.fail) return Promise.reject(new ConnectorInstallationRequiredError('no installation'))
      const [detail] = params.authorizationDetails
      return Promise.resolve(`tok_${detail!.org}_${detail!.repositories?.join(',') ?? '*'}`)
    },
    webhookVerifier: 'verifier',
  }),
}))

describe('installationParams', () => {
  it('names the account and, when given, the repositories', () => {
    expect(installationParams({ owner: 'evloghq', repo: 'evlog' })).toEqual({
      authorizationDetails: [{ type: 'github_app_installation', org: 'evloghq' }],
    })
    expect(installationParams({ owner: 'evloghq', repo: 'evlog' }, ['evlog'])).toEqual({
      authorizationDetails: [{ type: 'github_app_installation', org: 'evloghq', repositories: ['evlog'] }],
    })
  })
})

describe('githubCredentialsFor', () => {
  it('mints from the installation covering the repository, narrowed to it', async () => {
    const token = githubCredentialsFor({ owner: 'acme', repo: 'widgets' }).installationToken
    await expect(typeof token === 'function' ? token() : token).resolves.toBe('tok_acme_widgets')
  })
})

describe('mintInstallationToken', () => {
  it('returns a static token as-is and resolves a lazy one', async () => {
    await expect(mintInstallationToken({ installationToken: 'tok' })).resolves.toBe('tok')
    await expect(mintInstallationToken({ installationToken: () => Promise.resolve('lazy') })).resolves.toBe('lazy')
  })

  it('throws when the connector exposes no token', async () => {
    await expect(mintInstallationToken({})).rejects.toThrow('no installation token')
  })
})

describe('repositoryToken', () => {
  it('returns the token', async () => {
    await expect(repositoryToken({ owner: 'acme', repo: 'widgets' })).resolves.toBe('tok_acme_widgets')
  })

  it('is null when the App is not installed on the account', async () => {
    minted.fail = true
    await expect(repositoryToken({ owner: 'acme', repo: 'widgets' })).resolves.toBeNull()
    minted.fail = false
  })
})

describe('githubCredentials', () => {
  it('covers the whole home account and keeps Connect webhook verification', () => {
    expect(homeInstallationParams).toEqual({
      authorizationDetails: [{ type: 'github_app_installation', org: 'evloghq' }],
    })
    expect(githubCredentials.webhookVerifier).toBe('verifier')
  })
})
