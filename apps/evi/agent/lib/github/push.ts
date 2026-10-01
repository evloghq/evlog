import type { GitHubChannelCredentials } from 'eve/channels/github'
import type { SandboxNetworkPolicy } from 'eve/sandbox'
import { eviErrors } from '../errors'

const PROTECTED_BRANCHES = new Set(['main', 'master'])

/**
 * Conservative subset of valid git ref names: alphanumeric segments separated
 * by `.`, `_`, `-` or `/`. Everything a git command interpolates has to match
 * this, so shell metacharacters can never reach the command line.
 */
const REF_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/

/** git-check-ref-format, per slash component: no leading dot, no trailing dot or `.lock`. */
function isValidRefComponent(component: string): boolean {
  return component.length > 0 && !component.startsWith('.') && !component.endsWith('.') && !component.endsWith('.lock')
}

export function isValidRefName(ref: string): boolean {
  return REF_PATTERN.test(ref) && !ref.includes('..') && ref.split('/').every(isValidRefComponent)
}

/** Returns the refusal reason, or null when the branch may be pushed. */
export function validatePushBranch(branch: string): string | null {
  if (!isValidRefName(branch)) {
    return `"${branch}" is not a valid branch name.`
  }
  // `refs/heads/main` and `HEAD` would reach the protected branch under
  // another name; only plain branch names are accepted.
  if (branch.startsWith('refs/') || branch === 'HEAD') {
    return `"${branch}" is not a plain branch name. Pass the branch name without a refs/ prefix.`
  }
  if (PROTECTED_BRANCHES.has(branch)) {
    return `Direct pushes to ${branch} are not allowed. Push a feature branch and open a pull request.`
  }
  return null
}

/**
 * Firewall policy that brokers the installation token onto egress to
 * github.com only, mirroring the shape eve's own channel checkout uses. The
 * token never enters the sandbox process. `"*": []` keeps general egress open.
 */
export function pushBrokerPolicy(installationToken: string): SandboxNetworkPolicy {
  const authorization = `Basic ${Buffer.from(`x-access-token:${installationToken}`).toString('base64')}`
  return {
    allow: {
      'github.com': [{ transform: [{ headers: { Authorization: authorization } }] }],
      '*': [],
    },
  }
}

/** Resolves the Connect-managed installation token, minting when it is lazy. */
export async function mintInstallationToken(credentials: GitHubChannelCredentials): Promise<string> {
  const token = credentials.installationToken
  if (token === undefined) throw eviErrors.GITHUB_NO_INSTALLATION_TOKEN()
  return typeof token === 'function' ? await token() : token
}
