import { createStorage } from 'unstorage'
import { github } from 'forges/github'
import { fetchLastContentCommit } from '../../utils/github'

export function githubRepo(): string {
  const { docs } = useRuntimeConfig()
  const owner = docs.github.owner || process.env.VERCEL_GIT_REPO_OWNER
  const slug = docs.github.repo || process.env.VERCEL_GIT_REPO_SLUG
  if (!owner || !slug) {
    throw new Error(
      'The content repository is not configured: set NUXT_DOCS_GITHUB_OWNER and NUXT_DOCS_GITHUB_REPO (auto-inferred from git and on Vercel Git-connected deployments)'
    )
  }
  return `${owner}/${slug}`
}

export function githubToken(): string | undefined {
  const { docs } = useRuntimeConfig()
  return docs.githubToken || process.env.GITHUB_TOKEN || undefined
}

/** A forges GitHub provider, authenticated with {@link githubToken} when one is set. */
export function githubProvider() {
  const token = githubToken()
  return github(token ? { auth: { type: 'token', token } } : {})
}

/** Production branch, resolved per request. */
export function targetBranch(): string {
  return process.env.VERCEL_GIT_COMMIT_REF || useRuntimeConfig().docs.github.branch || 'main'
}

/** How long a branch keeps resolving to the same content commit before GitHub is asked again. */
const REF_TTL = 600

// Branch + content directory → content commit SHA pointer, shared across every instance.
const refStorage = createStorage({ driver: refCacheDriver(REF_TTL) })
const normalizeContentDir = (contentDir: string) => contentDir.replace(/^\/+|\/+$/g, '')
const refKey = (branch: string, contentDir: string) =>
  `branch:${encodeURIComponent(branch)}:path:${encodeURIComponent(normalizeContentDir(contentDir))}`

/**
 * Resolve a branch to the latest commit that touched `contentDir`.
 *
 * A missing ref is not cached: GitHub answers 404, not 403, for a repo a token can't see, so a
 * rotated token looks like a missing ref and caching that would down the site for the TTL.
 */
export async function resolveContentSha(branch: string, contentDir: string): Promise<string> {
  if (import.meta.dev) return branch

  const key = refKey(branch, contentDir)
  const cached = await refStorage.getItem<string>(key)
  if (cached) return cached

  // Shared with the build-time snapshot, which walks the built commit instead of a branch.
  let sha: string | undefined
  try {
    sha = await fetchLastContentCommit({
      repo: githubRepo(),
      path: contentDir,
      ref: branch,
      token: githubToken(),
    })
  } catch (error: unknown) {
    const failure = error as { statusCode?: number; response?: { status?: number } }
    const status = failure.statusCode ?? failure.response?.status
    if (status === 404) throw createError({ statusCode: 404, statusMessage: `Ref not found: ${branch}` })
    throw error
  }

  if (!sha) throw createError({ statusCode: 404, statusMessage: `Content not found at ref: ${branch}` })

  await refStorage.setItem(key, sha, { ttl: REF_TTL })
  return sha
}
