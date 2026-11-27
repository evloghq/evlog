import { mkdir, stat } from 'node:fs/promises'
import type { ComarkPlugin } from 'comark'
import { defineNuxtModule, useLogger } from '@nuxt/kit'
import { DEFAULT_CONTENT_NAME } from 'comark-content'
import { writeSnapshots } from 'comark-content/build'
import fs from 'comark-content/sources/fs'
import { createJiti } from 'jiti'
import { join } from 'pathe'
import { createBuildContentInstance } from '../../utils/factory'
import { resolveSnapshotSha } from './utils'

const logger = useLogger('docs')

/** Where the snapshot lives in the build, and the server-asset namespace it is read back through. */
const ASSET_BASE = 'comark-content'

/**
 * Writes a build-time snapshot into the function bundle stamped with the commit it was parsed at.
 * A cold start at that commit hydrates from it instead of walking the content repository.
 * At a later commit it still supplies every unchanged body.
 */
export default defineNuxtModule({
  meta: { name: 'docs:snapshot' },
  setup(_options, nuxt) {
    // Do not run in dev or prepare.
    if (nuxt.options.dev || nuxt.options._prepare) return

    const dir = join(nuxt.options.buildDir, ASSET_BASE)

    nuxt.hook('modules:done', async () => {
      await mkdir(dir, { recursive: true })
      nuxt.options.nitro.serverAssets = [
        ...(nuxt.options.nitro.serverAssets ?? []),
        { baseName: ASSET_BASE, dir },
      ]
    })

    nuxt.hook('build:before', async () => {
      const { docs } = nuxt.options.runtimeConfig
      const { repoRoot, contentDir, contentPath, github } = docs

      const resolveStart = performance.now()
      const sha = await resolveSnapshotSha({
        repoRoot,
        contentDir,
        repo: `${github.owner}/${github.repo}`,
        token: docs.githubToken || process.env.NUXT_DOCS_GITHUB_TOKEN || process.env.GITHUB_TOKEN,
        warn: (message) => logger.warn(message),
      })
      const resolveMs = Math.round(performance.now() - resolveStart)
      if (!sha) {
        logger.warn(
          'No commit in this checkout could be confirmed to hold the content being built, ' +
            'so no snapshot is shipped: cold starts will walk the content repository.'
        )
        return
      }

      try {
        // The highlighter the runtime parser imports through `#docs/highlighter`, loaded with Nuxt's
        // aliases like the bundle resolves it.
        const highlighter = await createJiti(import.meta.url, { alias: nuxt.options.alias }).import<ComarkPlugin>(
          nuxt.options.alias['#docs/highlighter']!,
          { default: true },
        )
        // `withRef` stamps the artifact with the commit.
        // At runtime, even with a different commit, we can reuse unchanged bodies.
        const content = createBuildContentInstance({ source: fs(contentPath) }, highlighter).withRef(sha)

        const writeStart = performance.now()
        await writeSnapshots(content, { dir })
        const writeMs = Math.round(performance.now() - writeStart)

        // Size is the number to watch: the snapshot is inlined into the bundle as a string.
        // Every cold start that reads it pays for that.
        const { size } = await stat(join(dir, DEFAULT_CONTENT_NAME, 'snapshot.json'))
        logger.success(
          `Content snapshot ${sha.slice(0, 7)}: ${Math.round(size / 1024)} kB parsed and written in ${writeMs}ms ` +
            `(ref resolved in ${resolveMs}ms)`
        )
      } catch (error) {
        logger.warn('Could not write the content snapshot — cold starts will walk the content repository.', error)
      }
    })
  },
})
