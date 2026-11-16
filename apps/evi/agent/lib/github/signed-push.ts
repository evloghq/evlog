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
 * Refuses what gh-signed-commit cannot reproduce (merges, empty commits,
 * symlinks, submodules, executable bits) before anything reaches GitHub, so a refused
 * branch never lands half pushed.
 */
async function assertReproducible(sandbox: GitSandbox, dir: string, branch: string, range: string): Promise<void> {
  if (shas(await git(sandbox, dir, `rev-list --min-parents=2 ${range}`)).length > 0) {
    throw eviErrors.GIT_PUSH_REFUSED({ message: `${branch} contains a merge commit, which cannot be pushed as signed commits. Rebase it onto the base branch instead.` })
  }
  for (const line of (await git(sandbox, dir, `log --format='%H %T %P' ${range}`)).split('\n')) {
    const [sha, tree, parent] = line.trim().split(' ')
    if (sha === undefined || tree === undefined || parent === undefined) continue
    if ((await git(sandbox, dir, `rev-parse ${parent}^{tree}`)).trim() === tree) {
      throw eviErrors.GIT_PUSH_REFUSED({ message: `${sha.slice(0, 8)} on ${branch} changes no files, which a signed push cannot publish. Squash it into a neighbouring commit or drop it.` })
    }
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

/** The tree and headline of `sha`: what a signed replay of a commit keeps from it. */
async function snapshot(sandbox: GitSandbox, dir: string, sha: string): Promise<string> {
  const [tree = '', headline = ''] = (await git(sandbox, dir, `log -1 --format=%T%n%B ${sha}`)).split('\n')
  return `${tree} ${headline.trim()}`
}

/**
 * Takes over the commits an earlier push left on GitHub without moving the
 * local branch onto them: a publish failed after others landed, or a reply was
 * lost after its commit landed. Each commit GitHub has past the fork point must
 * match the local commit in the same position. Rebuilds the rest of the local
 * branch on the last of them and returns the new head, or null when GitHub's
 * branch holds anything else: someone else wrote to it.
 */
async function adopt(sandbox: GitSandbox, gh: GitHubCommand, { dir, repository, branch }: Push, { head, remoteHead }: { head: string, remoteHead: string }): Promise<string | null> {
  await github(gh, `git fetch ${cloneUrl(repository)} refs/heads/${branch}`, { description: `Read what reached ${branch} on GitHub`, workingDirectory: dir })
  const fork = await sandbox.run({ command: `git -C ${dir} merge-base ${remoteHead} ${head}` })
  if (fork.exitCode !== 0) return null
  const base = String(fork.stdout ?? '').trim()
  // The rebuild below gives each commit one parent, so a local merge must be refused before it, not after.
  await assertReproducible(sandbox, dir, branch, `${base}..${head}`)
  const theirs = shas(await git(sandbox, dir, `rev-list --reverse ${base}..${remoteHead}`))
  const ours = shas(await git(sandbox, dir, `rev-list --reverse ${base}..${head}`))
  if (theirs.length > ours.length) return null
  for (const [index, sha] of theirs.entries()) {
    const [published, local] = await Promise.all([snapshot(sandbox, dir, sha), snapshot(sandbox, dir, ours[index]!)])
    if (published !== local) return null
  }
  let tip = remoteHead
  for (const sha of ours.slice(theirs.length)) {
    tip = (await git(sandbox, dir, `log -1 --format=%B ${sha} | git -C ${dir} commit-tree ${sha}^{tree} -p ${tip}`)).trim()
  }
  await git(sandbox, dir, `update-ref 'refs/heads/${branch}' ${tip} ${head}`)
  return tip
}

/**
 * Pushes the commits of local `branch` that GitHub lacks, one
 * `gh-signed-commit` per commit, so GitHub signs each one as the App: same
 * files and messages, new shas. A `git push` from the sandbox has no key to
 * sign with, and `main` requires signed commits. Each commit is replayed from
 * a scratch worktree, because gh-signed-commit publishes the index against
 * HEAD. Moves the local branch onto the pushed head and returns it. A push
 * that fails partway does not move the local branch onto what it published;
 * the next one adopts what reached GitHub.
 */
export async function pushSignedBranch(sandbox: GitSandbox, gh: GitHubCommand, { dir, repository, branch }: Push): Promise<{ sha: string, commits: number }> {
  let head = (await git(sandbox, dir, `rev-parse --verify 'refs/heads/${branch}^{commit}'`)).trim()
  // The URL is spelled out, never `origin`: remote config inside the sandbox is model-writable.
  const url = cloneUrl(repository)
  const listed = await github(gh, `git ls-remote ${url} refs/heads/${branch}`, { description: `Read the head of ${branch} on GitHub`, workingDirectory: dir })
  const remoteHead = shas(listed.split(/\s/).join('\n'))[0] ?? null
  if (remoteHead !== null) {
    const contained = await sandbox.run({ command: `git -C ${dir} merge-base --is-ancestor ${remoteHead} ${head}` })
    if (contained.exitCode !== 0) {
      const adopted = await adopt(sandbox, gh, { dir, repository, branch }, { head, remoteHead })
      if (adopted === null) {
        throw eviErrors.GIT_PUSH_REFUSED({ message: `${branch} on GitHub is at ${remoteHead.slice(0, 8)}, which the local branch does not contain. Rebuild the work on top of it, or push it under a new branch name.` })
      }
      head = adopted
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
      const parent = (await git(sandbox, worktree, 'rev-parse HEAD')).trim()
      const result = await gh({ command: args.map(shellQuote).join(' '), description: `Publish ${sha.slice(0, 8)} on ${branch} as a signed commit`, workingDirectory: worktree })
      if (result.exitCode !== 0) {
        throw eviErrors.GIT_COMMAND_FAILED({ command: 'gh-signed-commit', exitCode: result.exitCode, message: `gh-signed-commit exited ${result.exitCode}: ${runOutput(result)}. ${index} of ${order.length} commits reached GitHub before this one, which may have landed too. The local branch was not moved onto what reached GitHub; git__push again takes it over and publishes the rest.` })
      }
      // gh-signed-commit builds on whatever head it reads from GitHub, so a commit another writer landed first sits underneath.
      const landedOn = (await git(sandbox, worktree, 'rev-parse HEAD^')).trim()
      if (landedOn !== parent) {
        throw eviErrors.GIT_PUSH_REFUSED({ message: `${branch} on GitHub moved while this push ran: ${sha.slice(0, 8)} landed on ${landedOn.slice(0, 8)} instead of ${parent.slice(0, 8)}. The push stopped there without moving the local branch onto it. Check the branch on GitHub before pushing again.` })
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
