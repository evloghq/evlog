import { eviErrors } from '../errors'
import { type Repository, repositorySlug } from '../repo'
import { runOutput } from '../workspace'

const GITHUB_API = 'https://api.github.com'
const SHA = /^[0-9a-f]{40}$/
// createCommitOnBranch takes file contents and no mode, so it writes regular files only.
const REGULAR_FILE = '100644'
const NO_FILE = '000000'

interface GitSandbox {
  run: (input: { command: string }) => PromiseLike<{ exitCode: number, stdout?: unknown, stderr?: unknown }>
}

/** One local commit in the shape createCommitOnBranch takes: whole files in base64, deletions by path. */
export interface CommitChanges {
  readonly message: string
  readonly additions: ReadonlyArray<{ path: string, contents: string }>
  readonly deletions: ReadonlyArray<{ path: string }>
}

/**
 * What a branch push recreates on GitHub: `base` is the commit GitHub already has
 * under the first one, `head` the local branch tip the commits were read from.
 */
export interface BranchCommits {
  readonly base: string
  readonly head: string
  readonly branchExists: boolean
  readonly commits: readonly CommitChanges[]
}

async function git(sandbox: GitSandbox, dir: string, args: string): Promise<string> {
  const result = await sandbox.run({ command: `git -C ${dir} ${args}` })
  if (result.exitCode !== 0) {
    throw eviErrors.GIT_COMMAND_FAILED({ command: args.split(' ')[0] ?? 'git', exitCode: result.exitCode, message: `git ${args} exited ${result.exitCode}: ${runOutput(result)}` })
  }
  return String(result.stdout ?? '')
}

function shas(output: string): string[] {
  return output.split('\n').map(line => line.trim()).filter(line => SHA.test(line))
}

/**
 * Read the commits `branch` has that GitHub lacks: those after `remoteHead`, or
 * those on no remote-tracking ref when the branch is new on GitHub. Refuses
 * what createCommitOnBranch cannot reproduce exactly (merges, symlinks,
 * submodules, executable bits), so the signed commits carry the local tree.
 */
export async function collectBranchCommits(sandbox: GitSandbox, dir: string, branch: string, remoteHead: string | null): Promise<BranchCommits> {
  const head = (await git(sandbox, dir, `rev-parse --verify 'refs/heads/${branch}^{commit}'`)).trim()
  // The head reaches the command that runs with the brokered credential, so it has to be a sha.
  if (!SHA.test(head)) {
    throw eviErrors.GIT_PUSH_REFUSED({ message: `${branch} does not resolve to a commit.` })
  }
  if (remoteHead !== null) {
    const contained = await sandbox.run({ command: `git -C ${dir} merge-base --is-ancestor ${remoteHead} ${head}` })
    if (contained.exitCode !== 0) {
      throw eviErrors.GIT_PUSH_REFUSED({ message: `${branch} on GitHub is at ${remoteHead.slice(0, 8)}, which the local branch does not contain. Rebuild the work on top of it, or push it under a new branch name.` })
    }
  }
  const range = remoteHead === null ? `${head} --not --remotes` : `${remoteHead}..${head}`
  if (shas(await git(sandbox, dir, `rev-list --min-parents=2 ${range}`)).length > 0) {
    throw eviErrors.GIT_PUSH_REFUSED({ message: `${branch} contains a merge commit, which cannot be pushed as signed commits. Rebase it onto the base branch instead.` })
  }
  const order = shas(await git(sandbox, dir, `rev-list --reverse ${range}`))
  const [first] = order
  const base = remoteHead ?? (first === undefined ? head : (await git(sandbox, dir, `rev-parse ${first}^`)).trim())
  const commits: CommitChanges[] = []
  for (const sha of order) {
    commits.push(await readCommit(sandbox, dir, sha))
  }
  return { base, head, branchExists: remoteHead !== null, commits }
}

async function readCommit(sandbox: GitSandbox, dir: string, sha: string): Promise<CommitChanges> {
  const message = await git(sandbox, dir, `log -1 --format=%B ${sha}`)
  // `-z` keeps paths verbatim, and blobs are read by id, so no path ever reaches the command line.
  const fields = (await git(sandbox, dir, `diff-tree -r -z --no-renames --raw ${sha}^ ${sha}`)).split('\0')
  const additions: Array<{ path: string, contents: string }> = []
  const deletions: Array<{ path: string }> = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [oldMode, newMode, , blob, status] = fields[i]!.replace(/^\s*:/, '').split(' ')
    const path = fields[i + 1]!
    if (status === 'D') {
      deletions.push({ path })
      continue
    }
    if (newMode !== REGULAR_FILE || (oldMode !== NO_FILE && oldMode !== REGULAR_FILE)) {
      throw eviErrors.GIT_PUSH_REFUSED({ message: `${path} in ${sha.slice(0, 8)} is not a regular file (mode ${newMode}), which a signed push cannot carry. Leave symlinks, submodules and executable bits out of the branch.` })
    }
    // The pipe exits with base64's status, so the blob is checked on its own first.
    await git(sandbox, dir, `cat-file -e ${blob}`)
    additions.push({ path, contents: (await git(sandbox, dir, `cat-file blob ${blob} | base64 -w0`)).trim() })
  }
  return { message, additions, deletions }
}

function headers(token: string): Record<string, string> {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** The head of `branch` on GitHub, or null when GitHub has no such branch. */
export async function remoteBranchHead(token: string, repository: Repository, branch: string): Promise<string | null> {
  const response = await fetch(`${GITHUB_API}/repos/${repositorySlug(repository)}/git/ref/heads/${branch}`, { headers: headers(token) })
  if (response.status === 404) return null
  if (!response.ok) {
    throw eviErrors.GITHUB_REQUEST_FAILED({ request: 'branch lookup', responseStatus: response.status, internal: { body: await response.text() } })
  }
  const ref = await response.json() as { object: { sha: string } }
  // The sha reaches a sandbox command line, so it has to be a sha.
  if (!SHA.test(ref.object.sha)) {
    throw eviErrors.GITHUB_REQUEST_FAILED({ request: 'branch lookup', responseStatus: response.status })
  }
  return ref.object.sha
}

const CREATE_COMMIT = 'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }'

/**
 * Recreate `commits` on `branch` through GitHub's createCommitOnBranch, which
 * signs each commit as the App; a `git push` from the sandbox has no key to sign
 * with. Creates the branch at `base` first unless it exists. Returns the new head.
 *
 * Each mutation moves the branch on GitHub at once. When one fails, the branch is
 * put back where it was (deleted if this call created it), so the local branch
 * still builds on GitHub's and the same push can run again. The restore only
 * applies while the branch is still at the last commit this push wrote, so a
 * commit someone else added since is never dropped.
 */
export async function pushSignedCommits(token: string, repository: Repository, branch: string, { base, branchExists, commits }: BranchCommits): Promise<string> {
  const slug = repositorySlug(repository)
  if (!branchExists) {
    const created = await fetch(`${GITHUB_API}/repos/${slug}/git/refs`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base }),
    })
    if (!created.ok) {
      throw eviErrors.GITHUB_REQUEST_FAILED({ request: 'branch creation', responseStatus: created.status, internal: { body: await created.text() } })
    }
  }
  let head = base
  try {
    for (const commit of commits) {
      const [headline = '', ...rest] = commit.message.trim().split('\n')
      const body = rest.join('\n').trim()
      const response = await fetch(`${GITHUB_API}/graphql`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({
          query: CREATE_COMMIT,
          variables: {
            input: {
              branch: { repositoryNameWithOwner: slug, branchName: branch },
              expectedHeadOid: head,
              message: body ? { headline, body } : { headline },
              fileChanges: { additions: commit.additions, deletions: commit.deletions },
            },
          },
        }),
      })
      const text = await response.text()
      const oid = response.ok ? (JSON.parse(text) as { data?: { createCommitOnBranch?: { commit?: { oid?: string } } } }).data?.createCommitOnBranch?.commit?.oid : undefined
      if (oid === undefined || !SHA.test(oid)) {
        throw eviErrors.GITHUB_REQUEST_FAILED({ request: 'commit creation', responseStatus: response.status, internal: { body: text } })
      }
      head = oid
    }
  } catch (error) {
    if (!branchExists || head !== base) await restoreBranch(token, repository, branch, { from: head, to: branchExists ? base : null })
    throw error
  }
  return head
}

const REPOSITORY_ID = 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }'
const UPDATE_REFS = 'mutation($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }'
const NO_COMMIT = '0'.repeat(40)

async function graphql<T>(token: string, request: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${GITHUB_API}/graphql`, { method: 'POST', headers: headers(token), body: JSON.stringify({ query, variables }) })
  const text = await response.text()
  const payload = response.ok ? JSON.parse(text) as { data?: T, errors?: unknown[] } : {}
  if (payload.data === undefined || payload.data === null || payload.errors !== undefined) {
    throw eviErrors.GITHUB_REQUEST_FAILED({ request, responseStatus: response.status, internal: { body: text } })
  }
  return payload.data
}

/**
 * Move `branch` from `from` back to `to`, or delete it when `to` is null. GitHub
 * refuses the update when the branch no longer points at `from`.
 */
async function restoreBranch(token: string, repository: Repository, branch: string, { from, to }: { from: string, to: string | null }): Promise<void> {
  const { repository: target } = await graphql<{ repository: { id: string } }>(token, 'branch restore', REPOSITORY_ID, { owner: repository.owner, name: repository.repo })
  await graphql(token, 'branch restore', UPDATE_REFS, {
    input: { repositoryId: target.id, refUpdates: [{ name: `refs/heads/${branch}`, beforeOid: from, afterOid: to ?? NO_COMMIT, force: true }] },
  })
}
