import { execFileSync } from 'node:child_process'

const CONTENT_PREFIX = 'content/'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parses `git log --format=%cs --name-only --relative` output into a map of content
 * stem to the date of the commit that last touched it. Commits come newest first,
 * so the first date seen for a stem is the answer.
 */
export function parseCommitDates(gitLog: string): Record<string, string> {
  const dates: Record<string, string> = {}
  let commitDate = ''

  for (const line of gitLog.split('\n')) {
    if (!line) continue

    if (ISO_DATE.test(line)) {
      commitDate = line
      continue
    }

    if (!line.startsWith(CONTENT_PREFIX)) continue

    const stem = line.slice(CONTENT_PREFIX.length).replace(/\.[^./]+$/, '')
    dates[stem] ??= commitDate
  }

  return dates
}

type GitRunner = (args: string[], cwd: string, options?: { timeout?: number }) => string

/** A stalled remote must not hang the build: past this, the fetch is killed and the shallow dates are kept. */
export const UNSHALLOW_TIMEOUT_MS = 60_000

const runGit: GitRunner = (args, cwd, options) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  timeout: options?.timeout,
})

type Env = Record<string, string | undefined>

/**
 * Vercel's clone has no `origin` remote, so a bare `git fetch --unshallow` always
 * failed and every page kept a shallow-history date. Fetch from the public GitHub URL
 * instead. Vercel sets the owner and slug; the defaults cover local and CI builds.
 */
export function historySource(env: Env = process.env): { url: string, ref: string } {
  const owner = env.VERCEL_GIT_REPO_OWNER || 'evloghq'
  const slug = env.VERCEL_GIT_REPO_SLUG || 'evlog'
  return { url: `https://github.com/${owner}/${slug}.git`, ref: env.VERCEL_GIT_COMMIT_REF || 'HEAD' }
}

/**
 * Fetches the full history when the clone is shallow. Best effort: a failed fetch keeps
 * the shallow dates rather than failing the build. Returns the outcome for the build log.
 */
export function ensureFullHistory(cwd: string, git: GitRunner = runGit, env: Env = process.env): string {
  try {
    if (git(['rev-parse', '--is-shallow-repository'], cwd).trim() !== 'true') return 'full clone'
  } catch (error) {
    return `not a git checkout (${errorReason(error)})`
  }

  const { url, ref } = historySource(env)
  try {
    git(['fetch', '--unshallow', '--filter=blob:none', '--quiet', url, ref], cwd, { timeout: UNSHALLOW_TIMEOUT_MS })
    return `unshallowed from ${url}`
  } catch (error) {
    return `unshallow from ${url} failed (${errorReason(error)}), keeping shallow dates`
  }
}

function errorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n')[0]!.slice(0, 200)
}

/**
 * Sitemap `lastmod` is the recrawl signal Google acts on, and no content file carries
 * `modifiedAt` frontmatter, so the date comes from each file's last commit.
 */
export function readContentCommitDates(
  cwd: string,
  git: GitRunner = runGit,
  { env = process.env, log = console.log }: { env?: Env, log?: (line: string) => void } = {},
): Record<string, string> {
  const history = ensureFullHistory(cwd, git, env)
  const gitLog = git(
    ['log', '--format=%cs', '--name-only', '--relative', '--diff-filter=d', '--', CONTENT_PREFIX],
    cwd,
  )

  const dates = parseCommitDates(gitLog)
  const distinct = new Set(Object.values(dates)).size
  log(`[content-dates] ${history}; ${Object.keys(dates).length} files, ${distinct} distinct dates`)
  return dates
}
