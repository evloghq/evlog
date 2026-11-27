import { execFileSync } from 'node:child_process'

export interface GitInfo {
  name: string
  owner: string
  url: string
}

/** Run git with an argv array — no shell, so paths with spaces need no quoting. */
function git(args: string[], cwd: string): string | undefined {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

/** The branch this checkout/deployment tracks (CI env first, local git as fallback). */
export function getGitBranch(cwd: string): string {
  const envName =
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.CF_PAGES_BRANCH ||
    process.env.CI_COMMIT_BRANCH ||
    process.env.BRANCH ||
    process.env.GITHUB_REF_NAME

  if (envName && envName !== 'HEAD') return envName

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return branch && branch !== 'HEAD' ? branch : 'main'
}

/** Absolute path of the git repository root containing `cwd`, if any. */
export function getGitRoot(cwd: string): string | undefined {
  return git(['rev-parse', '--show-toplevel'], cwd)
}

/**
 * Owner/name/url from a git remote URL, in both forms `git remote get-url` emits (`git@host:owner/name.git`,
 * `https://host/owner/name(.git)`). Split out from `getLocalGitInfo` so the regex is testable without a
 * checkout — every inferred default in `modules/config/` (site name, edit links, GitHub repo) flows from it.
 */
export function parseGitRemote(remote: string): GitInfo | undefined {
  const match = remote.trim().match(/^(?:git@|https?:\/\/)([^/:]+)[/:]([^/]+)\/(.+?)(?:\.git)?$/)
  if (!match) return undefined

  const [, host, owner, name] = match
  return { name: name!, owner: owner!, url: `https://${host}/${owner}/${name}` }
}

/** Owner/name/url parsed from the `origin` remote of the local checkout. */
export function getLocalGitInfo(cwd: string): GitInfo | undefined {
  const remote = git(['remote', 'get-url', 'origin'], cwd)
  return remote ? parseGitRemote(remote) : undefined
}

/** Owner/name/url from CI provider env vars (Vercel, GitHub Actions, GitLab). */
export function getGitEnv(): GitInfo | undefined {
  const provider =
    process.env.VERCEL_GIT_PROVIDER || (process.env.GITHUB_SERVER_URL ? 'github' : undefined) || ''
  const owner =
    process.env.VERCEL_GIT_REPO_OWNER ||
    process.env.GITHUB_REPOSITORY_OWNER ||
    process.env.CI_PROJECT_PATH?.split('/').shift() ||
    ''
  const name =
    process.env.VERCEL_GIT_REPO_SLUG ||
    process.env.GITHUB_REPOSITORY?.split('/').pop() ||
    process.env.CI_PROJECT_PATH?.split('/').slice(1).join('/') ||
    ''

  if (!owner || !name) return undefined

  return { name, owner, url: `https://${provider || 'github'}.com/${owner}/${name}` }
}

/**
 * The last commit touching `dir`, or `undefined`.
 *
 * Unverified on purpose. CI clones shallowly, and when the last commit touching `dir` predates the
 * fetched window git answers with the shallow boundary commit rather than nothing — at depth 1,
 * that is HEAD for every path. Confirm the answer with {@link getTreeSha} before trusting it to
 * name a commit's content.
 */
export function getLastCommit(cwd: string, dir: string): string | undefined {
  const sha = git(['log', '-1', '--format=%H', '--', dir], cwd)
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined
}

/** Tree object id of `<ref>:<dir>`, or `undefined` when the ref or the path is not in this checkout. */
export function getTreeSha(cwd: string, ref: string, dir: string): string | undefined {
  return git(['rev-parse', `${ref}:${dir}`], cwd)
}

/** Whether `ref` has a parent in this checkout. `false` at a shallow-clone boundary. */
export function hasParent(cwd: string, ref: string): boolean {
  return Boolean(git(['rev-parse', '--verify', `${ref}^`], cwd))
}

/** The commit checked out here, falling back to the CI-provided one. */
export function headCommit(cwd: string): string | undefined {
  const sha = git(['rev-parse', 'HEAD'], cwd) || process.env.VERCEL_GIT_COMMIT_SHA
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined
}
