import type { CacheDriver, ContentSource } from 'comark-content'
import forge from 'comark-content/sources/forge'
import { createRuntimeContentInstance } from 'comark-docs/utils/factory.ts'
import highlighter from '#comark-docs/highlighter'

interface MountedVersion {
  id: string
  branch: string
  contentDir: string
}

function mountedVersion(id: string): MountedVersion {
  // Nuxt types an array in the runtime config without its entries.
  const versions = useRuntimeConfig().public.docsVersions as Partial<MountedVersion>[]
  const version = versions.find(version => version.id === id)
  if (!version?.branch || !version.contentDir) {
    throw new Error(`"${id}" is not a mounted version: it needs a branch and a contentDir in nuxt.config.ts`)
  }
  return { id, branch: version.branch, contentDir: version.contentDir }
}

/**
 * The layer's source for another content directory: the local repository in development, GitHub in
 * production. No build snapshot, which only holds the app's own content.
 */
function versionSource(version: MountedVersion): ContentSource {
  if (import.meta.dev) {
    return {
      ...gitLocalSource(version.branch, version.contentDir),
      withRef: ref => gitLocalSource(ref, version.contentDir),
    }
  }
  return forge({
    provider: githubProvider(),
    repo: githubRepo(),
    ref: version.branch,
    path: version.contentDir,
  })
}

// Every instance the layer builds is named `default` and keys its cache by commit only. A commit can be
// the head of two content directories, so a version keeps its entries under its own prefix.
function scopedDriver(driver: CacheDriver, scope: string): CacheDriver {
  const scoped = (key: string) => `${scope}:${key}`
  return {
    getItem: (key, opts) => driver.getItem(scoped(key), opts),
    setItem: (key, value, opts) => driver.setItem?.(scoped(key), value, opts),
    removeItem: (key, opts) => driver.removeItem?.(scoped(key), opts),
    getKeys: async (base, opts) => (await driver.getKeys(scoped(base), opts))
      .filter(key => key.startsWith(scoped('')))
      .map(key => key.slice(scope.length + 1)),
  }
}

const bases = new Map<string, DocsContent>()

function versionBase(version: MountedVersion): DocsContent {
  let base = bases.get(version.id)
  if (!base) {
    base = createRuntimeContentInstance(
      {
        source: versionSource(version),
        cache: { driver: scopedDriver(contentCacheDriver(), `version:${version.id}`) },
      },
      highlighter,
    )
    bases.set(version.id, base)
  }
  return base
}

/** The commit a mounted version is served at, following its branch. */
export function resolveVersionSha(id: string): Promise<string> {
  const version = mountedVersion(id)
  // Development has no GitHub pipeline: the branch resolves in the local repository, as for `/tree/:branch`.
  return import.meta.dev ? resolveGitRef(version.branch) : resolveContentSha(version.branch, version.contentDir)
}

const pinned = new Map<string, { sha: string, content: DocsContent }>()

async function versionContent(id: string): Promise<DocsContent> {
  const sha = await resolveVersionSha(id)
  const current = pinned.get(id)
  if (current?.sha === sha) return current.content

  const content = versionBase(mountedVersion(id)).withRef(sha)
  pinned.set(id, { sha, content })
  await current?.content.dispose()
  return content
}

/** Answer a `/api/content/<id>/**` request from the mounted version, as `servePreview()` does for a preview. */
export async function serveVersion(event: Parameters<typeof toWebRequest>[0], id: string) {
  const request = toWebRequest(event)
  const url = new URL(request.url)
  url.pathname = url.pathname.replace(`/${id}`, '')
  const content = await versionContent(id)
  return content.handler(new Request(url, request))
}
