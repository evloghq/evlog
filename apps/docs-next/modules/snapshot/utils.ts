import { getLastCommit, getTreeSha, hasParent, headCommit } from '../../utils/git'
import { fetchLastContentCommit } from '../../utils/github'

export interface SnapshotShaInput {
  /** Repository root of the checkout being built. */
  repoRoot: string
  /** Content directory, relative to the repository root. */
  contentDir: string
  /** `owner/name` of the content repository. Empty when the checkout has no usable remote. */
  repo: string
  /** GitHub token, if the build has one. Without it only the git fallback runs. */
  token?: string
  /** Reported to the caller; defaults to `console.warn`. */
  warn?: (message: string) => void
}

/** {@link fetchLastContentCommit}, but never throwing: a build-time optimization must not fail a build. */
async function lastContentCommit(
  repo: string,
  contentDir: string,
  ref: string,
  token?: string
): Promise<string | undefined> {
  try {
    const sha = await fetchLastContentCommit({ repo, path: contentDir, ref, token })
    // Validated here rather than in the shared query: this one names a directory in the build.
    return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined
  } catch {
    return undefined
  }
}

/**
 * The commit whose `contentDir` holds the content being parsed.
 * The only ref the snapshot may be stored under.
 * The same one `resolveContentSha()` resolves at runtime.
 */
export async function resolveSnapshotSha(input: SnapshotShaInput): Promise<string | undefined> {
  const { repoRoot, contentDir, repo, token } = input
  const warn = input.warn ?? ((message: string) => console.warn(message))

  const head = headCommit(repoRoot)
  const fromApi = head && repo ? await lastContentCommit(repo, contentDir, head, token) : undefined
  if (fromApi) return fromApi

  // No API answer: fall back to git, which needs the tree check to be trustworthy.
  const parsed = getTreeSha(repoRoot, 'HEAD', contentDir)
  const fromGit = getLastCommit(repoRoot, contentDir)
  if (!parsed || !fromGit) return undefined

  if (getTreeSha(repoRoot, fromGit, contentDir) !== parsed) return undefined

  if (!hasParent(repoRoot, fromGit)) {
    warn(
      `Could not reach the GitHub API, and git labels the snapshot ${fromGit.slice(0, 7)}, ` +
        `which has no parent in this checkout — a shallow clone boundary.\n` +
        `  The snapshot is safe, but probably will not be looked up under that commit at runtime.`
    )
  }

  return fromGit
}
