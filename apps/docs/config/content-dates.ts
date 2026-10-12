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

/**
 * Vercel builds from a shallow clone, and the ignore step's `git fetch --unshallow`
 * does not reach the build (it exits early when there is no previous SHA), so every
 * file used to collapse onto the build commit's date. Fetch the full history here,
 * best effort: a failed fetch keeps the shallow dates rather than failing the build.
 */
export function ensureFullHistory(cwd: string, git: GitRunner = runGit): void {
  try {
    if (git(['rev-parse', '--is-shallow-repository'], cwd).trim() !== 'true') return
    git(['fetch', '--unshallow', '--filter=blob:none', '--quiet'], cwd, { timeout: UNSHALLOW_TIMEOUT_MS })
  } catch {
    // Offline or no remote: fall back to whatever history the clone has.
  }
}

/**
 * Sitemap `lastmod` is the recrawl signal Google acts on, and no content file carries
 * `modifiedAt` frontmatter, so the date comes from each file's last commit.
 */
export function readContentCommitDates(cwd: string, git: GitRunner = runGit): Record<string, string> {
  ensureFullHistory(cwd, git)
  const gitLog = git(
    ['log', '--format=%cs', '--name-only', '--relative', '--diff-filter=d', '--', CONTENT_PREFIX],
    cwd,
  )

  return parseCommitDates(gitLog)
}
