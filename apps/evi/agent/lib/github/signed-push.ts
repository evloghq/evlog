import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { GitHubConfig, GitHubShellInput, GitHubShellOutput } from 'eve/extensions/git/sandbox'
import type { SandboxNetworkPolicy, SandboxSession } from 'eve/sandbox'
import { eviErrors } from '../errors'
import { cloneUrl, type Repository, repositorySlug } from '../repo'
import { canAccessAdminTools } from '../trust'
import { runOutput } from '../workspace'
import { GITHUB_CONNECTOR } from './credentials'

const SHA = /^[0-9a-f]{40}$/
// gh-signed-commit sends file contents without a mode, so it carries regular files only.
const REGULAR_FILE = '100644'
const NO_FILE = '000000'

type GitSandbox = Pick<SandboxSession, 'run'>

/** A local branch of the checkout at `dir`, pushed to the same branch name on `repository`. */
export interface Push {
  readonly dir: string
  readonly repository: Repository
  readonly branch: string
}

/** Runs one `git` or `gh-signed-commit` command with a GitHub token leased for the pushed repository. */
export type GitHubCommand = (input: Omit<GitHubShellInput, 'repository'> & { workingDirectory: string }) => Promise<GitHubShellOutput>

/**
 * How `git__push` leases GitHub tokens to eve's `executeGitHubShell`, through
 * the firewall of `sandbox`. The tool already gated the session; `authorize`
 * repeats that gate because it is the only check eve itself applies before a
 * token reaches the sandbox.
 */
export function signedPushGitHub(sandbox: { setNetworkPolicy: (policy: SandboxNetworkPolicy) => Promise<void> }): GitHubConfig {
  return {
    connector: GITHUB_CONNECTOR,
    principalType: 'app',
    permissions: ['contents:write'],
    authorize: ({ auth }) => canAccessAdminTools(auth),
    // A lease replaces the whole network policy, so general egress stays open next to it.
    broker: (_session, rules) => sandbox.setNetworkPolicy(rules === null ? 'allow-all' : { allow: { ...rules, '*': [] } }),
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

async function git(sandbox: GitSandbox, dir: string, args: string): Promise<string> {
  const result = await sandbox.run({ command: `git -C ${dir} ${args}` })
  if (result.exitCode !== 0) {
    throw eviErrors.GIT_COMMAND_FAILED({ command: args.split(' ')[0] ?? 'git', exitCode: result.exitCode, message: `git ${args} exited ${result.exitCode}: ${runOutput(result)}` })
  }
  return String(result.stdout ?? '')
}

async function github(gh: GitHubCommand, command: string, input: Omit<Parameters<GitHubCommand>[0], 'command'>): Promise<string> {
  const result = await gh({ command, ...input })
  if (result.exitCode !== 0) {
    throw eviErrors.GIT_COMMAND_FAILED({ command: command.split(' ')[0] ?? 'git', exitCode: result.exitCode, message: `${command.split(' ')[0]} exited ${result.exitCode}: ${runOutput(result)}` })
  }
  return result.stdout
}

function shas(output: string): string[] {
  return output.split('\n').map(line => line.trim()).filter(line => SHA.test(line))
}

/**
 * Refuses what gh-signed-commit cannot reproduce (merges, symlinks,
 * submodules, executable bits) before anything reaches GitHub, so a refused
 * branch never lands half pushed.
 */
async function assertReproducible(sandbox: GitSandbox, dir: string, branch: string, range: string): Promise<void> {
  if (shas(await git(sandbox, dir, `rev-list --min-parents=2 ${range}`)).length > 0) {
    throw eviErrors.GIT_PUSH_REFUSED({ message: `${branch} contains a merge commit, which cannot be pushed as signed commits. Rebase it onto the base branch instead.` })
  }
  const raw = await git(sandbox, dir, `log --format= --raw --no-renames ${range}`)
  for (const line of raw.split('\n')) {
    const match = /^:(\d{6}) (\d{6}) \S+ \S+ (\w)\t(.*)$/.exec(line)
    if (match === null) continue
    const [, oldMode, newMode, status, path] = match
    if (status === 'D') continue
    if (newMode !== REGULAR_FILE || (oldMode !== NO_FILE && oldMode !== REGULAR_FILE)) {
      throw eviErrors.GIT_PUSH_REFUSED({ message: `${path} is not a regular file (mode ${oldMode} -> ${newMode}), which a signed push cannot carry. Leave symlinks, submodules and executable bits out of the branch.` })
    }
  }
}

/** Where a branch replay stood when gh-signed-commit failed on `order[index]`. */
interface Replay {
  readonly worktree: string
  readonly head: string
  readonly order: readonly string[]
  readonly index: number
}

/**
 * Works out how much of the branch GitHub took from the branch itself, not from
 * the reply: a commit can land and its reply still be lost. Rebuilds the commits
 * GitHub lacks on top of what it has, so the next push resumes there, and returns
 * how many it took. Returns null and leaves the local branch alone when GitHub's
 * branch matches neither case: someone else wrote to it mid-push, and rebuilding
 * from local snapshots would undo their change.
 */
async function recover(sandbox: GitSandbox, gh: GitHubCommand, { dir, repository, branch }: Push, { worktree, head, order, index }: Replay): Promise<number | null> {
  const fetched = await gh({ command: `git fetch ${cloneUrl(repository)} refs/heads/${branch}`, description: `Read what reached ${branch} on GitHub`, workingDirectory: worktree })
  if (fetched.exitCode !== 0) return null
  const [acknowledged = '', remote = ''] = (await git(sandbox, worktree, 'rev-parse HEAD FETCH_HEAD')).trim().split('\n')
  let taken = index
  if (remote !== acknowledged) {
    const parent = await sandbox.run({ command: `git -C ${dir} rev-parse --verify --quiet ${remote}^` })
    if (String(parent.stdout ?? '').trim() !== acknowledged) return null
    taken = index + 1
  }
  if (taken === 0) return 0
  const [remoteTree, localTree] = await Promise.all([git(sandbox, dir, `rev-parse ${remote}^{tree}`), git(sandbox, dir, `rev-parse ${order[taken - 1]}^{tree}`)])
  if (remoteTree.trim() !== localTree.trim()) return null
  let tip = remote
  for (const sha of order.slice(taken)) {
    tip = (await git(sandbox, dir, `log -1 --format=%B ${sha} | git -C ${dir} commit-tree ${sha}^{tree} -p ${tip}`)).trim()
  }
  await git(sandbox, dir, `update-ref 'refs/heads/${branch}' ${tip} ${head}`)
  return taken
}

/**
 * Pushes the commits of local `branch` that GitHub lacks, one
 * `gh-signed-commit` per commit, so GitHub signs each one as the App: same
 * files and messages, new shas. A `git push` from the sandbox has no key to
 * sign with, and `main` requires signed commits. Each commit is replayed from
 * a scratch worktree, because gh-signed-commit publishes the index against
 * HEAD. Moves the local branch onto the pushed head and returns it.
 */
export async function pushSignedBranch(sandbox: GitSandbox, gh: GitHubCommand, { dir, repository, branch }: Push): Promise<{ sha: string, commits: number }> {
  const head = (await git(sandbox, dir, `rev-parse --verify 'refs/heads/${branch}^{commit}'`)).trim()
  // The URL is spelled out, never `origin`: remote config inside the sandbox is model-writable.
  const url = cloneUrl(repository)
  const listed = await github(gh, `git ls-remote ${url} refs/heads/${branch}`, { description: `Read the head of ${branch} on GitHub`, workingDirectory: dir })
  const remoteHead = shas(listed.split(/\s/).join('\n'))[0] ?? null
  if (remoteHead !== null) {
    const contained = await sandbox.run({ command: `git -C ${dir} merge-base --is-ancestor ${remoteHead} ${head}` })
    if (contained.exitCode !== 0) {
      throw eviErrors.GIT_PUSH_REFUSED({ message: `${branch} on GitHub is at ${remoteHead.slice(0, 8)}, which the local branch does not contain. Rebuild the work on top of it, or push it under a new branch name.` })
    }
  }
  const range = remoteHead === null ? `${head} --not --remotes` : `${remoteHead}..${head}`
  await assertReproducible(sandbox, dir, branch, range)
  const order = shas(await git(sandbox, dir, `rev-list --reverse ${range}`))
  const [first] = order
  const base = remoteHead ?? (first === undefined ? head : (await git(sandbox, dir, `rev-parse ${first}^`)).trim())
  if (remoteHead === null) {
    // gh-signed-commit would branch from the tip of the default branch, which may have moved since this branch forked.
    await github(gh, `git push ${url} ${base}:refs/heads/${branch}`, { description: `Create ${branch} on GitHub at its base commit`, workingDirectory: dir })
  }
  if (order.length === 0) return { sha: base, commits: 0 }

  const worktree = posix.join(posix.dirname(dir), `.evi-push-${randomUUID()}`)
  await git(sandbox, dir, `worktree add --quiet --detach --no-checkout ${worktree} ${base}`)
  try {
    for (const [index, sha] of order.entries()) {
      await git(sandbox, worktree, `read-tree -u --reset ${sha}`)
      const [headline = '', ...rest] = (await git(sandbox, dir, `log -1 --format=%B ${sha}`)).trim().split('\n')
      const body = rest.join('\n').trim()
      const args = ['gh-signed-commit', '--repo', repositorySlug(repository), '--branch', branch, '-m', headline, ...(body ? ['-b', body] : [])]
      const result = await gh({ command: args.map(shellQuote).join(' '), description: `Publish ${sha.slice(0, 8)} on ${branch} as a signed commit`, workingDirectory: worktree })
      if (result.exitCode !== 0) {
        const taken = await recover(sandbox, gh, { dir, repository, branch }, { worktree, head, order, index })
        const outcome = taken === null
          ? `${branch} on GitHub no longer matches what this push wrote, so the local branch was left as it was`
          : `${taken} of ${order.length} commits reached GitHub${taken > 0 ? ', and the local branch now builds on them, so git__push again publishes the rest' : ''}`
        throw eviErrors.GIT_COMMAND_FAILED({ command: 'gh-signed-commit', exitCode: result.exitCode, message: `gh-signed-commit exited ${result.exitCode}: ${runOutput(result)}. ${outcome}.` })
      }
    }
    const pushed = (await git(sandbox, worktree, 'rev-parse HEAD')).trim()
    const [pushedTree, localTree] = await Promise.all([git(sandbox, dir, `rev-parse ${pushed}^{tree}`), git(sandbox, dir, `rev-parse ${head}^{tree}`)])
    if (pushedTree.trim() !== localTree.trim()) {
      throw eviErrors.GIT_COMMAND_FAILED({ command: 'gh-signed-commit', exitCode: 0, message: `Pushed ${branch} to ${pushed}, but its files differ from the local branch, which was left at ${head}.` })
    }
    await git(sandbox, dir, `update-ref 'refs/heads/${branch}' ${pushed} ${head}`)
    return { sha: pushed, commits: order.length }
  } finally {
    await sandbox.run({ command: `git -C ${dir} worktree remove --force ${worktree}` })
  }
}
