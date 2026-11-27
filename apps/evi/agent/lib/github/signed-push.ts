import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { GitHubConfig, GitHubShellInput, GitHubShellOutput } from 'eve/extensions/git/sandbox'
import type { SandboxNetworkPolicy, SandboxSession } from 'eve/sandbox'
import { eviErrors } from '../errors'
import { cloneUrl, type Repository, repositorySlug } from '../repo'
import { canAccessAdminTools } from '../trust'
import { runOutput } from '../workspace'
import { GITHUB_CONNECTOR } from './credentials'
import { isValidRefName } from './push'

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
    // Pull requests are only read: a merge may bring in the base branch of the pushed branch's pull request.
    permissions: ['contents:write', 'pull_requests:read'],
    authorize: ({ auth }) => canAccessAdminTools(auth),
    // A lease replaces the whole network policy, so general egress stays open next to it.
    broker: (_session, rules) => sandbox.setNetworkPolicy(rules === null ? 'allow-all' : { allow: { ...rules, '*': [] } }),
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

async function shell(sandbox: GitSandbox, command: string, label: string): Promise<string> {
  const result = await sandbox.run({ command })
  if (result.exitCode !== 0) {
    throw eviErrors.GIT_COMMAND_FAILED({ command: label, exitCode: result.exitCode, message: `${command} exited ${result.exitCode}: ${runOutput(result)}` })
  }
  return String(result.stdout ?? '')
}

function git(sandbox: GitSandbox, dir: string, args: string): Promise<string> {
  return shell(sandbox, `git -C ${dir} ${args}`, args.split(' ')[0] ?? 'git')
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

/** One path of a tree that differs from a parent's, as the REST trees API takes it: a null sha removes it. */
interface TreeEntry {
  readonly path: string
  readonly mode: string
  readonly sha: string | null
}

function treeEntries(output: string): TreeEntry[] {
  const tokens = output.split('\0')
  const entries: TreeEntry[] = []
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const [, newMode = '', , newSha = ''] = tokens[index]!.trim().slice(1).split(' ')
    entries.push({ path: tokens[index + 1]!, mode: newMode, sha: newMode === NO_FILE ? null : newSha })
  }
  return entries
}

/**
 * How a merge commit is rebuilt on GitHub: on the tree of whichever parent it
 * differs from least, with the paths that differ. Both parents' blobs are
 * already on GitHub, so only `written` (the paths the merge holds in a version
 * neither parent has, its conflict resolutions) are uploaded.
 */
async function mergeChanges(sandbox: GitSandbox, dir: string, merge: string, parents: readonly [string, string]) {
  const diff = async (parent: string) => treeEntries(await git(sandbox, dir, `diff-tree -r -z --no-renames ${parent} ${merge}`))
  const [fromFirst, fromSecond] = await Promise.all(parents.map(diff)) as [TreeEntry[], TreeEntry[]]
  const [base, entries, other] = fromSecond.length <= fromFirst.length ? [parents[1], fromSecond, fromFirst] : [parents[0], fromFirst, fromSecond]
  const changedFromOther = new Set(other.map(entry => entry.path))
  return {
    baseTree: (await git(sandbox, dir, `rev-parse ${base}^{tree}`)).trim(),
    entries,
    written: entries.filter((entry): entry is TreeEntry & { sha: string } => entry.sha !== null && changedFromOther.has(entry.path)),
  }
}

async function parentsOf(sandbox: GitSandbox, dir: string, sha: string): Promise<string[]> {
  return (await git(sandbox, dir, `log -1 --format=%P ${sha}`)).trim().split(' ').filter(Boolean)
}

/**
 * The heads, read from GitHub, that a merge on `branch` may bring in: the
 * default branch, and the base branch of each open pull request from `branch`
 * that GitHub reports as protected. Protection is what makes a base reviewed
 * code; a pull request can name any branch as its base.
 */
async function mergeSources(sandbox: GitSandbox, gh: GitHubCommand, { dir, repository, branch }: Push): Promise<string[]> {
  const slug = repositorySlug(repository)
  const read = async (ref: string, name: string) => {
    await github(gh, `git fetch ${cloneUrl(repository)} ${ref}`, { description: `Read ${name} on GitHub`, workingDirectory: dir })
    return (await git(sandbox, dir, 'rev-parse FETCH_HEAD')).trim()
  }
  const heads = [await read('HEAD', `the default branch of ${slug}`)]
  const listed = await github(gh, `gh api 'repos/${slug}/pulls?head=${repository.owner}:${branch}&state=open' --jq '.[].base.ref'`, { description: `List the base branches of open pull requests from ${branch}`, workingDirectory: dir })
  for (const base of new Set(listed.split('\n').map(line => line.trim()).filter(isValidRefName))) {
    const protectedBase = await github(gh, `gh api repos/${slug}/branches/${base} --jq .protected`, { description: `Check that ${base} is protected`, workingDirectory: dir })
    if (protectedBase.trim() === 'true') heads.push(await read(`refs/heads/${base}`, base))
  }
  return heads
}

/**
 * Refuses what a signed push cannot reproduce before anything reaches GitHub,
 * so a refused branch never lands half pushed. Ordinary commits go through
 * gh-signed-commit: no empty commits, symlinks, submodules or executable bits.
 * A merge commit is published through the Git database API, and only when it
 * brings in reviewed code (see `mergeSources`): two parents, the second
 * already on one of those branches, and its own resolutions regular files. Walks first parents, so the
 * default branch's commits are never published again.
 */
async function assertReproducible(sandbox: GitSandbox, gh: GitHubCommand, { dir, repository, branch }: Push, range: string): Promise<void> {
  const merges = shas(await git(sandbox, dir, `rev-list --first-parent --min-parents=2 ${range}`))
  if (merges.length > 0) {
    const sources = await mergeSources(sandbox, gh, { dir, repository, branch })
    for (const merge of merges) {
      const parents = await parentsOf(sandbox, dir, merge)
      const [first, second] = parents
      if (parents.length !== 2 || first === undefined || second === undefined) {
        throw eviErrors.GIT_PUSH_REFUSED({ message: `${merge.slice(0, 8)} on ${branch} is a merge commit with ${parents.length} parents. Only a two-parent merge of a reviewed branch can be pushed.` })
      }
      const contained = await Promise.all(sources.map(head => sandbox.run({ command: `git -C ${dir} merge-base --is-ancestor ${second} ${head}` })))
      if (contained.every(result => result.exitCode !== 0)) {
        throw eviErrors.GIT_PUSH_REFUSED({ message: `${merge.slice(0, 8)} on ${branch} is a merge commit whose second parent ${second.slice(0, 8)} is on neither the default branch nor the protected base branch of an open pull request from ${branch}. Only merges that bring one of those in can be pushed: merge it from GitHub, or rebuild the branch without this merge.` })
      }
      for (const { path, mode } of (await mergeChanges(sandbox, dir, merge, [first, second])).written) {
        if (mode !== REGULAR_FILE) {
          throw eviErrors.GIT_PUSH_REFUSED({ message: `${path}, which ${merge.slice(0, 8)} resolves, is not a regular file (mode ${mode}), which a signed push cannot carry.` })
        }
      }
    }
  }
  for (const line of (await git(sandbox, dir, `log --first-parent --no-merges --format='%H %T %P' ${range}`)).split('\n')) {
    const [sha, tree, parent] = line.trim().split(' ')
    if (sha === undefined || tree === undefined || parent === undefined) continue
    if ((await git(sandbox, dir, `rev-parse ${parent}^{tree}`)).trim() === tree) {
      throw eviErrors.GIT_PUSH_REFUSED({ message: `${sha.slice(0, 8)} on ${branch} changes no files, which a signed push cannot publish. Squash it into a neighbouring commit or drop it.` })
    }
  }
  const raw = await git(sandbox, dir, `log --first-parent --no-merges --format= --raw --no-renames ${range}`)
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

/** Writes `content` to `path` in the sandbox in pieces, so no argument outgrows the kernel's per-argument limit. */
async function writeSandboxFile(sandbox: GitSandbox, path: string, content: string): Promise<void> {
  await shell(sandbox, `: > ${path}`, 'write')
  for (let offset = 0; offset < content.length; offset += 32_000) {
    await shell(sandbox, `printf '%s' ${shellQuote(content.slice(offset, offset + 32_000))} >> ${path}`, 'write')
  }
}

/**
 * Publishes the merge commit `merge` on top of the worktree's HEAD through
 * GitHub's Git database API, which signs a commit an App creates without a
 * custom author. Moves the branch without forcing, so a branch someone else
 * moved is left alone, and checks out the published commit in the worktree.
 */
async function publishMerge(sandbox: GitSandbox, gh: GitHubCommand, { dir, repository, branch }: Push, { worktree, merge, parents }: { worktree: string, merge: string, parents: readonly [string, string] }): Promise<void> {
  const slug = repositorySlug(repository)
  const api = async (path: string, args: string, description: string) => (await github(gh, `gh api repos/${slug}/git/${path} ${args}`, { description, workingDirectory: worktree })).trim()
  const fail = (message: string) => eviErrors.GIT_COMMAND_FAILED({ command: 'gh api', exitCode: 0, message })
  const { baseTree, entries, written } = await mergeChanges(sandbox, dir, merge, parents)
  const request = posix.join(posix.dirname(dir), `.evi-merge-${randomUUID()}.json`)
  let commit: string
  try {
    for (const { path, sha } of written) {
      await shell(sandbox, `{ printf '%s' '{"encoding":"base64","content":"'; git -C ${dir} cat-file blob ${sha} | base64 | tr -d '\\n'; printf '"}'; } > ${request}`, 'cat-file')
      const uploaded = await api('blobs', `--method POST --input ${request} --jq .sha`, `Upload ${path}, resolved in ${merge.slice(0, 8)}`)
      if (uploaded !== sha) throw fail(`GitHub stored ${path} as ${uploaded.slice(0, 8)}, not ${sha.slice(0, 8)}.`)
    }
    await writeSandboxFile(sandbox, request, JSON.stringify({ base_tree: baseTree, tree: entries.map(({ path, mode, sha }) => ({ path, mode, type: mode === '160000' ? 'commit' : 'blob', sha })) }))
    const tree = await api('trees', `--method POST --input ${request} --jq .sha`, `Build the tree of ${merge.slice(0, 8)}`)
    const localTree = (await git(sandbox, dir, `rev-parse ${merge}^{tree}`)).trim()
    if (tree !== localTree) throw fail(`GitHub built the tree of ${merge.slice(0, 8)} as ${tree.slice(0, 8)}, not ${localTree.slice(0, 8)}. Nothing was published for it.`)
    const tip = (await git(sandbox, worktree, 'rev-parse HEAD')).trim()
    const message = (await git(sandbox, dir, `log -1 --format=%B ${merge}`)).trim()
    await writeSandboxFile(sandbox, request, JSON.stringify({ message, tree, parents: [tip, parents[1]] }))
    commit = await api('commits', `--method POST --input ${request} --jq .sha`, `Create the signed merge commit for ${merge.slice(0, 8)}`)
  } finally {
    await sandbox.run({ command: `rm -f ${request}` })
  }
  const moved = await gh({ command: `gh api repos/${slug}/git/refs/heads/${branch} --method PATCH -f sha=${commit} -F force=false --jq .object.sha`, description: `Move ${branch} to the merge ${commit.slice(0, 8)}`, workingDirectory: worktree })
  if (moved.exitCode !== 0) {
    throw eviErrors.GIT_COMMAND_FAILED({ command: 'gh api', exitCode: moved.exitCode, message: `Moving ${branch} to the merge ${commit.slice(0, 8)} failed: ${runOutput(moved)}. Either the branch moved on GitHub, or the move landed and its reply was lost. The local branch was not moved; git__push again takes over what landed, and refuses a branch someone else wrote to.` })
  }
  await github(gh, `git fetch ${cloneUrl(repository)} refs/heads/${branch}`, { description: `Read the merge back from ${branch}`, workingDirectory: worktree })
  await git(sandbox, worktree, `reset --quiet --soft ${commit}`)
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
  await assertReproducible(sandbox, gh, { dir, repository, branch }, `${base}..${head}`)
  const theirs = shas(await git(sandbox, dir, `rev-list --reverse --first-parent ${base}..${remoteHead}`))
  const ours = shas(await git(sandbox, dir, `rev-list --reverse --first-parent ${base}..${head}`))
  if (theirs.length > ours.length) return null
  for (const [index, sha] of theirs.entries()) {
    const [published, local] = await Promise.all([snapshot(sandbox, dir, sha), snapshot(sandbox, dir, ours[index]!)])
    if (published !== local) return null
  }
  let tip = remoteHead
  for (const sha of ours.slice(theirs.length)) {
    const [, merged] = await parentsOf(sandbox, dir, sha)
    tip = (await git(sandbox, dir, `log -1 --format=%B ${sha} | git -C ${dir} commit-tree ${sha}^{tree} -p ${tip}${merged === undefined ? '' : ` -p ${merged}`}`)).trim()
  }
  await git(sandbox, dir, `update-ref 'refs/heads/${branch}' ${tip} ${head}`)
  return tip
}

/**
 * Pushes the commits of local `branch` that GitHub lacks, one
 * `gh-signed-commit` per commit, so GitHub signs each one as the App: same
 * files and messages, new shas. A merge of the default branch or the pull
 * request's base goes through `publishMerge` instead, keeping both parents. A `git push` from the sandbox has no key to
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
  await assertReproducible(sandbox, gh, { dir, repository, branch }, range)
  const order = shas(await git(sandbox, dir, `rev-list --reverse --first-parent ${range}`))
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
      const [first, merged] = await parentsOf(sandbox, dir, sha)
      if (first !== undefined && merged !== undefined) {
        await publishMerge(sandbox, gh, { dir, repository, branch }, { worktree, merge: sha, parents: [first, merged] })
        continue
      }
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
