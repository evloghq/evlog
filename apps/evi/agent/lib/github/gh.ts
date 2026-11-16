import type { GitHubAppAuthorizeRequest, GitHubLeaseRule } from 'eve/extensions/git'
import type { SandboxSession } from 'eve/sandbox'
import type { VercelSandboxSession } from 'eve/sandbox/vercel'
import { canAccessAdminTools } from '../trust'

/** Fetching git data writes nothing on GitHub. */
const GIT_READS = new Set(['clone', 'fetch', 'pull', 'ls-remote'])

/**
 * The `git__gh` access policy, eve's only gate on it. Maintainer and schedule
 * turns may clone and fetch. Nothing pushes through it: a `git push` from the
 * sandbox lands unsigned commits, so branches ship through `git__push`, and
 * every other GitHub write through the `github__*` tools and their approvals.
 */
export function authorizeGitHubCommand({ argv, auth }: Pick<GitHubAppAuthorizeRequest, 'argv' | 'auth'>): boolean {
  if (!canAccessAdminTools(auth)) return false
  const [program, ...rest] = argv
  if (program === 'gh') return rest[0] === 'repo' && rest[1] === 'clone'
  if (program !== 'git') return false
  let index = 0
  while (rest[index] === '-C') index += 2
  const command = rest[index]
  return command !== undefined && GIT_READS.has(command)
}

/**
 * Installs eve's GitHub header rules for one `gh` command and removes them
 * after it. General egress stays open, as it is outside a command. Only Vercel
 * Sandbox rewrites headers at its firewall; the Docker sandbox refuses, so a
 * local session cannot reach GitHub with the token.
 */
export async function brokerGitHubLease(sandbox: SandboxSession, rules: Readonly<Record<string, readonly GitHubLeaseRule[]>> | null): Promise<void> {
  await (sandbox as VercelSandboxSession).setNetworkPolicy(rules === null ? 'allow-all' : { allow: { ...rules, '*': [] } })
}
