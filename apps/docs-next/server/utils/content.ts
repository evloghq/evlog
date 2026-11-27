import { type ContentSource, DEFAULT_CONTENT_NAME } from 'comark-content'
import fs from 'comark-content/sources/fs'
import forge from 'comark-content/sources/forge'
import { withSnapshot } from 'comark-content/sources/snapshot'
import { createRuntimeContentInstance } from '../../utils/factory.ts'
import highlighter from '#docs/highlighter'

/**
 * The instance serving requests.
 */
export type DocsContent = ReturnType<typeof createBaseContent>

/**
 * Holds the source, the plugins and the cache driver.
 * Once per function invocation.
 * Base for all instances "cloned" with `withRef(sha)` in `contentAt()`.
 */
let base: DocsContent | undefined

function getBaseContent(): DocsContent {
  base ??= createBaseContent()
  return base
}

function createBaseContent() {
  return createRuntimeContentInstance(
    {
      source: contentSource(),
      cache: { driver: contentCacheDriver() },
    },
    highlighter,
  )
}

/**
 * Base instance cloned and pinned to a SHA.
 * Nothing is read until the first call.
 * `dispose()` it when you replace it.
*/
export function contentAt(sha: string): DocsContent {
  return getBaseContent().withRef(sha)
}

// The content commit currently served, once `getProdContent()` has resolved one.
// Pin GitHub reads to an immutable SHA:
// bypasses the stale `raw.githubusercontent.com/<branch>` CDN.
let headSha: string | undefined

/**
 * The pinned head commit, or nothing while none is resolved (dev, off-Vercel, pre-first-resolve).
 */
export function getHeadSha(): string | undefined {
  return headSha
}

/**
 * The pinned head SHA, falling back to the branch while none is resolved.
 * The fallback only ever applies off-Vercel (self-hosted, `nuxt preview`, `vercel dev`).
 */
export function getHeadRef(): string {
  return headSha ?? targetBranch()
}

// Share pending promises to avoid multiple concurrent requests.
let pendingSha: Promise<string> | undefined

/**
 * The SHA prod instance currently serves:
 * - global config pin if one is set (production only)
 * - latest commit touching the content directory via `resolveContentSha()`
 */
export function resolveProdSha(): Promise<string> {
  pendingSha ??= (async () => {
    const { contentDir } = useRuntimeConfig().docs
    if (process.env.VERCEL_ENV === 'production') {
      const pinned = await getPinnedSha()
      if (pinned) return pinned
    }
    return resolveContentSha(targetBranch(), contentDir)
  })().finally(() => {
    pendingSha = undefined
  })
  return pendingSha
}

// Rebuild the promise when the head advances.
// Holds the promise to ensure two requests on a cold process don't each build one.
let prod: Promise<DocsContent> | undefined

/**
 * Shared instance for the lifetime of the process, pinned to `headSha`.
 * Always resolves the head via `resolveProdSha()`.
 * Swaps to a new pinned instance when the head advances.
 */
export async function getProdContent(): Promise<DocsContent> {
  if (['production', 'preview'].includes(process.env.VERCEL_ENV || '')) {
    const sha = await resolveProdSha()
    if (sha !== headSha) {
      if (headSha) {
        console.log(`[docs] New head: ${headSha} -> ${sha}`)
        void prod?.then((instance) => instance.dispose()).catch(() => {})
        prod = undefined
      }
      headSha = sha
    }
  }

  if (!prod) {
    prod = (async () => {
      const instance = import.meta.dev ? await watchedDevContent() : contentAt(getHeadRef())
      await instance.init()
      return instance
    })().catch((error) => {
      prod = undefined
      throw error
    })
  }
  return prod
}

/** The unpinned base in development — it reads the working tree and follows file changes. */
async function watchedDevContent(): Promise<DocsContent> {
  const instance = getBaseContent()
  await instance.watch()
  instance.hooks.hook('watch:file:update', (_source: string, key: string) => {
    invalidateSearchSections(instance)
    console.log(`[docs] ${key} updated`)
  })
  instance.hooks.hook('watch:file:remove', () => invalidateSearchSections(instance))
  return instance
}

/**
 * The source every instance derives from.
 * `withRef(sha)` pins it to a commit.
 *
 * Production:
 * - GitHub reads the tree and files at `sha`
 * - the build snapshot supplies every body whose source hash is unchanged
 *
 * Development:
 * - unpinned reads the working tree, which `watch()` follows
 * - pinned reads the repo at that commit
 * - no snapshot
 */
function contentSource(): ContentSource {
  const { docs } = useRuntimeConfig()

  if (import.meta.dev) {
    return {
      ...fs(docs.contentPath),
      withRef: (ref) => gitLocalSource(ref, docs.contentDir),
    }
  }

  const source = forge({
    provider: githubProvider(),
    repo: githubRepo(),
    ref: targetBranch(),
    path: docs.contentDir,
  })

  // Snaphot build during build time by `modules/snapshot/` is used.
  // Snpahost is pinned to the latest commit at the time of the build.
  // First head moves, only the bodies whose source hash matches are reused.
  return withSnapshot(source, () => readSnapshot(), () => readManifest())
}

// Untyped reads: unstorage runs every value through `destr`, so these arrive already parsed.

/** The build-time snapshot, or nothing when this deployment did not ship one. */
function readSnapshot(): Promise<unknown> {
  return useStorage('assets:comark-content').get(`${DEFAULT_CONTENT_NAME}/snapshot.json`)
}

/** The build-time manifest, or nothing when this deployment did not ship one. */
function readManifest(): Promise<unknown> {
  return useStorage('assets:comark-content').get(`${DEFAULT_CONTENT_NAME}/manifest.json`)
}
