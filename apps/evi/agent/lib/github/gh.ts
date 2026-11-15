import type { GitHubAppAuthorizeRequest, GitHubLeaseRule } from 'eve/extensions/git'
import type { SandboxSession } from 'eve/sandbox'
import type { VercelSandboxSession } from 'eve/sandbox/vercel'
import { canAccessAdminTools } from '../trust'

const PROTECTED_BRANCHES = new Set(['main', 'master'])

/** Fetching git data writes nothing on GitHub. */
const GIT_READS = new Set(['clone', 'fetch', 'pull', 'ls-remote'])

/** `git push` flags that cannot widen what a push reaches: no deletes, tags, mirrors or every branch at once. */
const PUSH_FLAGS = /^(?:-u|--set-upstream|-f|--force|--force-with-lease(?:=.*)?|--no-verify|-q|--quiet|-v|--verbose|-n|--dry-run|--porcelain)$/

/** The branch a refspec writes, or null when it deletes, globs, or names anything but a branch. */
function pushedBranch(refspec: string): string | null {
  const [source, destination = source] = refspec.replace(/^\+/, '').split(':')
  if (!source || refspec.includes('*')) return null
  const branch = destination.replace(/^refs\/heads\//, '')
  if (branch === 'HEAD' || branch === '@' || branch.startsWith('refs/')) return null
  return branch
}

/** Every refspec names a branch outside main and master. `git push` without one would push whatever is checked out. */
function isFeaturePush(args: readonly string[]): boolean {
  const positional = args.filter(arg => !arg.startsWith('-'))
  if (args.some(arg => arg.startsWith('-') && !PUSH_FLAGS.test(arg))) return false
  const refspecs = positional.slice(1)
  if (refspecs.length === 0) return false
  return refspecs.every((refspec) => {
    const branch = pushedBranch(refspec)
    return branch !== null && !PROTECTED_BRANCHES.has(branch)
  })
}

/**
 * The `git__gh` access policy, eve's only gate on it. Maintainer and schedule
 * turns may clone, fetch and push feature branches; every other GitHub write
 * goes through the `github__*` tools and their approvals.
 */
export function authorizeGitHubCommand({ argv, auth }: Pick<GitHubAppAuthorizeRequest, 'argv' | 'auth'>): boolean {
  if (!canAccessAdminTools(auth)) return false
  const [program, ...rest] = argv
  if (program === 'gh') return rest[0] === 'repo' && rest[1] === 'clone'
  if (program !== 'git') return false
  let index = 0
  while (rest[index] === '-C') index += 2
  const [command, ...args] = rest.slice(index)
  if (command === undefined || command.startsWith('-')) return false
  if (GIT_READS.has(command)) return true
  return command === 'push' && isFeaturePush(args)
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
