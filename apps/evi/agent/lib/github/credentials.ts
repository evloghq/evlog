import { ConnectorInstallationRequiredError } from '@vercel/connect'
import { type ConnectGitHubCredentialsParams, connectGitHubCredentials } from '@vercel/connect/eve'
import type { GitHubChannelCredentials } from 'eve/channels/github'
import { eviErrors } from '../errors'
import { homeRepository, type Repository } from '../repo'

/** The Connect connector shared by the GitHub channel, the `github__*` and `git__gh` extensions, and `git__push`. */
export const GITHUB_CONNECTOR = 'github/evi-github-production'

// A GitHub App token is minted per installation and reaches that account only.
// Connect resolves the installation from the account named here, so no
// installation id is held anywhere in Evi.
export function installationParams(repository: Repository, repositories?: readonly string[]): ConnectGitHubCredentialsParams {
  return {
    authorizationDetails: [
      {
        type: 'github_app_installation',
        org: repository.owner,
        ...(repositories === undefined ? {} : { repositories: [...repositories] }),
      },
    ],
  }
}

/** Credentials Connect mints from the installation covering `repository`, narrowed to that repository. */
export function githubCredentialsFor(repository: Repository): GitHubChannelCredentials {
  return connectGitHubCredentials(GITHUB_CONNECTOR, installationParams(repository, [repository.repo]))
}

/** Resolves the Connect-managed installation token, minting when it is lazy. */
export async function mintInstallationToken(credentials: GitHubChannelCredentials): Promise<string> {
  const token = credentials.installationToken
  if (token === undefined) throw eviErrors.GITHUB_NO_INSTALLATION_TOKEN()
  return typeof token === 'function' ? await token() : token
}

/** A token for `repository`; null when the App is not installed on its account. */
export async function repositoryToken(repository: Repository): Promise<string | null> {
  try {
    return await mintInstallationToken(githubCredentialsFor(repository))
  } catch (error) {
    if (error instanceof ConnectorInstallationRequiredError) return null
    throw error
  }
}

/** The home account's installation, for the surfaces that take one credential: the channel and the `github__*` extension. */
export const homeInstallationParams = installationParams(homeRepository())

export const githubCredentials = connectGitHubCredentials(GITHUB_CONNECTOR, homeInstallationParams)
